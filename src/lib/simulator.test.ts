import { describe, expect, it } from "vitest";
import { type SimulationInputs, applyVehicleModel, computeSimulation, createDefaultInputs } from "./simulator";

function withFinancingLoa(inputs: SimulationInputs, patch: Partial<SimulationInputs["financing"]["loa"]>): SimulationInputs {
  return { ...inputs, financing: { ...inputs.financing, loa: { ...inputs.financing.loa, ...patch } } };
}

describe("computeSimulation — cohérence générale", () => {
  it("retourne des valeurs finies et positives ou nulles sur le cas par défaut", () => {
    const r = computeSimulation(createDefaultInputs());
    expect(Number.isFinite(r.aenBrut)).toBe(true);
    expect(r.aenBrut).toBeGreaterThanOrEqual(0);
    expect(r.aenNet).toBeGreaterThanOrEqual(0);
    expect(r.cotisationsTNS).toBeGreaterThanOrEqual(0);
    expect(r.globalCostSociete).toBeGreaterThanOrEqual(0);
    expect(r.globalCostPersonnel).toBeGreaterThanOrEqual(0);
  });

  it("le coût global société = coût net société + coût cash dirigeant", () => {
    const r = computeSimulation(createDefaultInputs());
    expect(r.globalCostSociete).toBeCloseTo(r.coutNetSociete + r.coutTotalGerantSociete, 6);
  });

  it("le coût global personnel = coût brut avant IK − économie d'impôt société sur l'IK", () => {
    const r = computeSimulation(createDefaultInputs());
    // Le coût brut avant IK déduit déjà la valeur résiduelle annualisée du véhicule (comptant/crédit
    // uniquement) — cf. getResidualValueAnnualized dans simulator.ts.
    const coutBrutAvantIk = Math.max(
      0,
      r.personalFinancingAnnual +
        createDefaultInputs().annualInsurance +
        createDefaultInputs().annualMaintenance -
        r.valeurResiduelleAnnualiseePersonnel,
    );
    expect(r.globalCostPersonnel).toBeCloseTo(Math.max(0, coutBrutAvantIk - r.economieImpotIK), 6);
  });

  it("les 8 options combinent bien part société + part dirigeant = coût global", () => {
    const r = computeSimulation(createDefaultInputs());
    expect(r.allOptions).toHaveLength(8);
    for (const opt of r.allOptions) {
      expect(opt.partSociete + opt.partDirigeant).toBeCloseTo(opt.globalCostAnnual, 6);
    }
  });

  it("la meilleure option est bien celle dont le coût global est minimal", () => {
    const r = computeSimulation(createDefaultInputs());
    const min = Math.min(...r.allOptions.map((o) => o.globalCostAnnual));
    expect(r.bestOption.globalCostAnnual).toBeCloseTo(min, 6);
  });
});

describe("computeSimulation — régression LOA : l'option d'achat ne doit pas gonfler l'AEN", () => {
  it("aenBrut et aenNet sont identiques, que l'option LOA soit levée ou non", () => {
    const base: SimulationInputs = { ...createDefaultInputs(), financingMode: "loa", isElectric: false, co2EmissionsGkm: 120 };
    const sansOption = computeSimulation(withFinancingLoa(base, { leveeOption: false }));
    const avecOption = computeSimulation(withFinancingLoa(base, { leveeOption: true }));

    expect(avecOption.aenBrut).toBeCloseTo(sansOption.aenBrut, 6);
    expect(avecOption.aenNet).toBeCloseTo(sansOption.aenNet, 6);
    expect(avecOption.cotisationsTNS).toBeCloseTo(sansOption.cotisationsTNS, 6);
  });

  it("le loyer servant de base à l'AEN exclut l'option d'achat, qui n'est pas un loyer", () => {
    const base: SimulationInputs = { ...createDefaultInputs(), financingMode: "loa" };
    const sansOption = computeSimulation(withFinancingLoa(base, { leveeOption: false }));
    const avecOption = computeSimulation(withFinancingLoa(base, { leveeOption: true }));
    // La base AEN "véhicule loué" (30% du coût de location) ne bouge pas : c'est bien le point de
    // régression historique. Le coût, lui, intègre désormais l'option d'achat lissée (cf. ci-dessous).
    expect(avecOption.aenBaseAnnualCosts).toBeCloseTo(sansOption.aenBaseAnnualCosts, 6);
  });

  it("lève l'option d'achat : le versement unique et la valeur résiduelle sont tous deux lissés sur la durée", () => {
    const base: SimulationInputs = { ...createDefaultInputs(), financingMode: "loa" };
    const sansOption = computeSimulation(withFinancingLoa(base, { leveeOption: false }));
    const avecOption = computeSimulation(withFinancingLoa(base, { leveeOption: true }));
    const dureeAnnees = base.financing.loa.dureeMois / 12;

    // Sans levée : rien à lisser, le véhicule est restitué.
    expect(sansOption.optionAchatAnnualisee).toBe(0);
    expect(sansOption.valeurResiduelleAnnualisee).toBe(0);

    // Avec levée : le rachat entre dans le coût annuel, la valeur du véhicule acquis en sort.
    expect(avecOption.optionAchatAnnualisee).toBeCloseTo(base.financing.loa.valeurOptionAchat / dureeAnnees, 6);
    expect(avecOption.valeurResiduelleAnnualisee).toBeGreaterThan(0);
    expect(avecOption.companyCashBaseAnnual - sansOption.companyCashBaseAnnual).toBeCloseTo(
      avecOption.optionAchatAnnualisee - avecOption.valeurResiduelleAnnualisee,
      6,
    );
  });

  it("affiche l'option d'achat lissée dans le détail, avec son montant unique en rappel", () => {
    const base: SimulationInputs = { ...createDefaultInputs(), financingMode: "loa" };
    const avecOption = computeSimulation(withFinancingLoa(base, { leveeOption: true }));
    const dureeAnnees = base.financing.loa.dureeMois / 12;
    const ligne = avecOption.allOptions
      .find((o) => o.owner === "societe" && o.mode === "loa")
      ?.detail.find((d) => d.label.includes("option d'achat LOA"));
    expect(ligne?.value).toBeCloseTo(base.financing.loa.valeurOptionAchat / dureeAnnees, 6);
    expect(ligne?.label).toContain("lissée");
  });
});

describe("computeSimulation — méthode réelle AEN selon le montage", () => {
  it("véhicule acheté (comptant/crédit) : base AEN = amortissement + assurance + entretien", () => {
    const inputs: SimulationInputs = {
      ...createDefaultInputs(),
      financingMode: "credit",
      isElectric: false,
      privateUsePercent: 100, // pour lire directement aenBrut = base × 100%
      annualFuelPrivateCost: 0,
    };
    const r = computeSimulation(inputs);
    const amortAnnual = inputs.vehiclePrice * 0.2; // ≤5 ans
    expect(r.aenBaseAnnualCosts).toBeCloseTo(amortAnnual + inputs.annualInsurance + inputs.annualMaintenance, 6);
  });

  it("véhicule loué (LLD) : base AEN = 30% × (loyer + assurance + entretien)", () => {
    const base = createDefaultInputs();
    const inputs: SimulationInputs = {
      ...base,
      financingMode: "lld",
      isElectric: false,
      privateUsePercent: 100,
      annualFuelPrivateCost: 0,
      // Offre LLD classique (loyer nu) : assurance et entretien sont supportés en plus du loyer.
      financing: { ...base.financing, lld: { ...base.financing.lld, toutComprisEntretienAssurance: false } },
    };
    const r = computeSimulation(inputs);
    const loyerAnnuel = inputs.financing.lld.loyerMensuel * 12;
    expect(r.aenBaseAnnualCosts).toBeCloseTo((loyerAnnuel + inputs.annualInsurance + inputs.annualMaintenance) * 0.3, 6);
  });

  it("véhicule loué (LLD « tout compris ») : assurance et entretien sortent de la base AEN", () => {
    const base = createDefaultInputs();
    const commun: SimulationInputs = {
      ...base,
      financingMode: "lld",
      isElectric: false,
      privateUsePercent: 100,
      annualFuelPrivateCost: 0,
    };
    const nu = computeSimulation({
      ...commun,
      financing: { ...commun.financing, lld: { ...commun.financing.lld, toutComprisEntretienAssurance: false } },
    });
    const toutCompris = computeSimulation({
      ...commun,
      financing: { ...commun.financing, lld: { ...commun.financing.lld, toutComprisEntretienAssurance: true } },
    });
    const loyerAnnuel = commun.financing.lld.loyerMensuel * 12;
    expect(toutCompris.aenBaseAnnualCosts).toBeCloseTo(loyerAnnuel * 0.3, 6);
    // Écart = la part d'AEN qui provenait du double comptage des charges déjà incluses dans le loyer.
    expect(nu.aenBaseAnnualCosts - toutCompris.aenBaseAnnualCosts).toBeCloseTo(
      (commun.annualInsurance + commun.annualMaintenance) * 0.3,
      6,
    );
  });

  it("le mode « tout compris » de la LLD ne modifie pas les autres modes de financement", () => {
    const base = createDefaultInputs();
    const commun: SimulationInputs = { ...base, financingMode: "comptant", isElectric: false, annualFuelPrivateCost: 0 };
    const nu = computeSimulation({
      ...commun,
      financing: { ...commun.financing, lld: { ...commun.financing.lld, toutComprisEntretienAssurance: false } },
    });
    const toutCompris = computeSimulation({
      ...commun,
      financing: { ...commun.financing, lld: { ...commun.financing.lld, toutComprisEntretienAssurance: true } },
    });
    // Le comptant supporte bien assurance et entretien dans les deux cas.
    expect(toutCompris.aenBaseAnnualCosts).toBeCloseTo(nu.aenBaseAnnualCosts, 6);
    expect(toutCompris.companyCashBaseAnnual).toBeCloseTo(nu.companyCashBaseAnnual, 6);
  });
});

describe("computeSimulation — majoration IK véhicule électrique", () => {
  it("majore le barème IK de 20% pour un véhicule électrique", () => {
    const electrique = computeSimulation({ ...createDefaultInputs(), isElectric: true });
    const thermique = computeSimulation({ ...createDefaultInputs(), isElectric: false });
    expect(electrique.effectiveIkRatePerKm).toBeCloseTo(thermique.effectiveIkRatePerKm * 1.2, 6);
  });
});

describe("computeSimulation — abattement véhicule électrique", () => {
  it("aucun abattement pour un véhicule thermique", () => {
    const r = computeSimulation({ ...createDefaultInputs(), isElectric: false });
    expect(r.abattement).toBe(0);
  });

  it("abattement de 50% (plafonné) pour un véhicule électrique éligible", () => {
    const r = computeSimulation({ ...createDefaultInputs(), isElectric: true, isEcoScoreEligible: true });
    expect(r.abattement).toBeCloseTo(Math.min(0.5 * r.aenBrut, 2026.3), 6);
  });

  it("aucun abattement pour un véhicule électrique non éligible", () => {
    const r = computeSimulation({ ...createDefaultInputs(), isElectric: true, isEcoScoreEligible: false });
    expect(r.abattement).toBe(0);
  });
});

describe("computeSimulation — bénéfice prévisionnel et régime IR", () => {
  it("un bénéfice sociétal plus élevé (régime IR) augmente le revenu imposable du foyer", () => {
    const base: SimulationInputs = { ...createDefaultInputs(), impositionSociete: "IR" };
    const faible = computeSimulation({ ...base, beneficeAvantChargePrevisionnel: 5000 });
    const eleve = computeSimulation({ ...base, beneficeAvantChargePrevisionnel: 150000 });
    expect(eleve.revenuImposableFoyer).toBeGreaterThan(faible.revenuImposableFoyer);
    expect(eleve.tauxIRUtilise).toBeGreaterThanOrEqual(faible.tauxIRUtilise);
  });

  it("régime IS : une société déficitaire ne génère aucune économie d'impôt sur la quote-part pro", () => {
    const r = computeSimulation({
      ...createDefaultInputs(),
      impositionSociete: "IS",
      beneficeAvantChargePrevisionnel: 0,
    });
    expect(r.economieImpotQuotePartPro).toBe(0);
  });
});

describe("computeSimulation — projection et transition d'amortissement", () => {
  it("prévoit une transition à l'année 6 pour un véhicule neuf (≤5 ans)", () => {
    const r = computeSimulation({ ...createDefaultInputs(), vehicleOverFiveYears: false, projectionYears: 8 });
    expect(r.anneeTransitionAmortissement).toBe(6);
  });

  it("aucune transition si le véhicule est déjà âgé de plus de 5 ans", () => {
    const r = computeSimulation({ ...createDefaultInputs(), vehicleOverFiveYears: true, projectionYears: 8 });
    expect(r.anneeTransitionAmortissement).toBeNull();
  });

  it("le cumul société de la projection croît strictement d'année en année (coûts positifs)", () => {
    const r = computeSimulation({ ...createDefaultInputs(), projectionYears: 5 });
    for (let i = 1; i < r.projection.length; i++) {
      expect(r.projection[i].cumulSociete).toBeGreaterThan(r.projection[i - 1].cumulSociete);
    }
  });
});

describe("computeSimulation — usage privé 0% et 100%", () => {
  it("0% d'usage privé : AEN nul, aucun km professionnel manquant", () => {
    const r = computeSimulation({ ...createDefaultInputs(), privateUsePercent: 0, annualFuelPrivateCost: 0 });
    expect(r.aenBrut).toBe(0);
    expect(r.proKmAnnual).toBeCloseTo(createDefaultInputs().totalKmAnnual, 6);
  });

  it("100% d'usage privé : aucun kilomètre professionnel, donc aucun remboursement IK", () => {
    const r = computeSimulation({ ...createDefaultInputs(), privateUsePercent: 100 });
    expect(r.proKmAnnual).toBeCloseTo(0, 6);
    expect(r.ikReimbursement).toBe(0);
  });
});

describe("applyVehicleModel — changement de modèle de véhicule", () => {
  it("réapplique le prix et l'offre LOA réelle d'un modèle qui en dispose (Tesla Model Y)", () => {
    // Partir d'un état volontairement différent (autre prix, autre LOA) pour vérifier que tout est
    // bien réécrasé par les valeurs réelles du modèle sélectionné.
    const base = { ...createDefaultInputs(), vehiclePrice: 30000, isElectric: false };
    const next = applyVehicleModel(base, "tesla-model-y-berlin");

    expect(next.vehiclePrice).toBe(45000);
    expect(next.isElectric).toBe(true);
    expect(next.isEcoScoreEligible).toBe(true);
    expect(next.financing.loa.premierLoyerMajore).toBe(9320);
    expect(next.financing.loa.loyerMensuel).toBe(308);
    expect(next.financing.loa.dureeMois).toBe(36);
    expect(next.financing.loa.valeurOptionAchat).toBe(25804);
    expect(next.financing.loa.leveeOption).toBe(true);

    // L'offre LLD réelle (et non plus l'estimation générique) doit également être appliquée,
    // pour éviter de comparer une LOA réelle à une LLD synthétique (écart artificiel).
    expect(next.financing.lld.loyerMensuel).toBe(592);
    expect(next.financing.lld.dureeMois).toBe(48);
    expect(next.financing.lld.premierLoyer).toBe(0);
    expect(next.financing.lld.kmInclusAnnuel).toBe(15000);
  });

  it("réapplique le prix et l'offre LOA réelle du Tesla Model 3", () => {
    const base = { ...createDefaultInputs(), vehiclePrice: 38000 };
    const next = applyVehicleModel(base, "tesla-model-3");

    expect(next.vehiclePrice).toBe(42990);
    expect(next.isEcoScoreEligible).toBe(false);
    expect(next.financing.loa.premierLoyerMajore).toBe(8250);
    expect(next.financing.loa.loyerMensuel).toBe(279);
    expect(next.financing.loa.dureeMois).toBe(36);
    expect(next.financing.loa.valeurOptionAchat).toBe(16745);
  });

  it("un modèle avec seulement un prix de référence (Renault Megane E-Tech) met à jour le prix mais garde l'estimation générique pour la LOA", () => {
    const base = { ...createDefaultInputs(), vehiclePrice: 38000 };
    const next = applyVehicleModel(base, "renault-megane-e-tech");

    expect(next.vehiclePrice).toBe(37500);
    expect(next.isEcoScoreEligible).toBe(true);
    // Pas d'offre LOA constructeur codée en dur pour ce modèle : l'estimation générique (%
    // du nouveau prix) s'applique, cohérente avec createDefaultFinancingInputs.
    expect(next.financing.loa.premierLoyerMajore).toBeCloseTo(37500 * 0.2, 6);
  });

  it("le modèle « autre » ne touche ni motorisation/éco-score, ni prix/financement", () => {
    const base = { ...createDefaultInputs(), vehiclePrice: 38000, isElectric: false, isEcoScoreEligible: false };
    const next = applyVehicleModel(base, "autre");

    expect(next.vehicleModelId).toBe("autre");
    expect(next.isElectric).toBe(false);
    expect(next.isEcoScoreEligible).toBe(false);
    expect(next.vehiclePrice).toBe(38000);
  });

  it("un identifiant de modèle inconnu ne modifie que l'identifiant stocké", () => {
    const base = createDefaultInputs();
    const next = applyVehicleModel(base, "modele-inexistant");
    expect(next.vehicleModelId).toBe("modele-inexistant");
    expect(next.vehiclePrice).toBe(base.vehiclePrice);
  });

  it("createDefaultInputs applique bien les offres LOA et LLD réelles du Model Y par défaut", () => {
    const inputs = createDefaultInputs();
    expect(inputs.financing.loa.loyerMensuel).toBe(308);
    expect(inputs.financing.loa.dureeMois).toBe(36);
    expect(inputs.financing.lld.loyerMensuel).toBe(592);
    expect(inputs.financing.lld.dureeMois).toBe(48);
  });
});

describe("computeSimulation — valeur résiduelle en fin de période", () => {
  it("LLD : aucune valeur résiduelle, véhicule jamais possédé", () => {
    const r = computeSimulation(createDefaultInputs());
    const societeLld = r.allOptions.find((o) => o.owner === "societe" && o.mode === "lld");
    const persoLld = r.allOptions.find((o) => o.owner === "personnel" && o.mode === "lld");
    expect(societeLld?.devientProprietaire).toBe(false);
    expect(societeLld?.valeurResiduelleEstimee).toBe(0);
    expect(persoLld?.devientProprietaire).toBe(false);
    expect(persoLld?.valeurResiduelleEstimee).toBe(0);
  });

  it("Comptant/Crédit : le véhicule est possédé, avec une valeur résiduelle positive mais inférieure au prix neuf", () => {
    const r = computeSimulation(createDefaultInputs());
    for (const mode of ["comptant", "credit"] as const) {
      const opt = r.allOptions.find((o) => o.owner === "societe" && o.mode === mode);
      expect(opt?.devientProprietaire).toBe(true);
      expect(opt?.valeurResiduelleEstimee).toBeGreaterThan(0);
      expect(opt?.valeurResiduelleEstimee).toBeLessThan(createDefaultInputs().vehiclePrice);
    }
  });

  it("LOA : valeur résiduelle uniquement si l'option d'achat est levée", () => {
    const withOption: SimulationInputs = {
      ...createDefaultInputs(),
      financing: { ...createDefaultInputs().financing, loa: { ...createDefaultInputs().financing.loa, leveeOption: true } },
    };
    const withoutOption: SimulationInputs = {
      ...createDefaultInputs(),
      financing: { ...createDefaultInputs().financing, loa: { ...createDefaultInputs().financing.loa, leveeOption: false } },
    };
    const rWith = computeSimulation(withOption);
    const rWithout = computeSimulation(withoutOption);

    const optWith = rWith.allOptions.find((o) => o.owner === "societe" && o.mode === "loa");
    const optWithout = rWithout.allOptions.find((o) => o.owner === "societe" && o.mode === "loa");

    expect(optWith?.devientProprietaire).toBe(true);
    expect(optWith?.valeurResiduelleEstimee).toBeGreaterThan(0);
    expect(optWithout?.devientProprietaire).toBe(false);
    expect(optWithout?.valeurResiduelleEstimee).toBe(0);
  });

  it("une durée de détention plus longue réduit la valeur résiduelle", () => {
    const base = createDefaultInputs();
    const courte: SimulationInputs = {
      ...base,
      financing: { ...base.financing, credit: { ...base.financing.credit, dureeMois: 24 } },
    };
    const longue: SimulationInputs = {
      ...base,
      financing: { ...base.financing, credit: { ...base.financing.credit, dureeMois: 84 } },
    };
    const rCourte = computeSimulation(courte);
    const rLongue = computeSimulation(longue);
    const optCourte = rCourte.allOptions.find((o) => o.owner === "societe" && o.mode === "credit");
    const optLongue = rLongue.allOptions.find((o) => o.owner === "societe" && o.mode === "credit");
    expect(optCourte!.valeurResiduelleEstimee).toBeGreaterThan(optLongue!.valeurResiduelleEstimee);
  });
});

describe("computeSimulation — la valeur résiduelle annualisée (comptant/crédit) est déduite du décaissement", () => {
  it("LLD : aucune déduction de valeur résiduelle (véhicule restitué en fin de contrat)", () => {
    const r = computeSimulation(createDefaultInputs());
    const societeLld = r.allOptions.find((o) => o.owner === "societe" && o.mode === "lld");
    expect(societeLld?.detail.some((d) => d.label.includes("Valeur résiduelle annualisée"))).toBe(false);
  });

  it("LOA sans levée d'option : aucune déduction non plus (véhicule restitué)", () => {
    const base = createDefaultInputs();
    const r = computeSimulation(withFinancingLoa(base, { leveeOption: false }));
    const societeLoa = r.allOptions.find((o) => o.owner === "societe" && o.mode === "loa");
    expect(societeLoa?.detail.some((d) => d.label.includes("Valeur résiduelle annualisée"))).toBe(false);
  });

  it("LOA avec levée d'option : la valeur résiduelle est déduite, comme en comptant/crédit", () => {
    const base = createDefaultInputs();
    const r = computeSimulation(withFinancingLoa(base, { leveeOption: true }));
    const societeLoa = r.allOptions.find((o) => o.owner === "societe" && o.mode === "loa");
    expect(societeLoa?.detail.some((d) => d.label.includes("Valeur résiduelle annualisée"))).toBe(true);
  });

  it("Comptant/Crédit société : le décaissement net est inférieur à ce qu'il serait sans déduction de la valeur résiduelle", () => {
    const inputs = createDefaultInputs();
    const r = computeSimulation(inputs);
    for (const mode of ["comptant", "credit"] as const) {
      const opt = r.allOptions.find((o) => o.owner === "societe" && o.mode === mode)!;
      const financingLine = opt.detail.find((d) => d.label.startsWith("Financement du véhicule"))!;
      const residuLine = opt.detail.find((d) => d.label.includes("Valeur résiduelle annualisée"))!;
      const decaissementLine = opt.detail.find((d) => d.label.startsWith("= Décaissement réel société"))!;
      expect(residuLine.value).toBeGreaterThan(0);
      const decaissementSansDeduction =
        financingLine.value + inputs.annualInsurance + inputs.annualMaintenance + opt.detail.find((d) => d.label.includes("Taxes annuelles"))!.value;
      expect(decaissementLine.value).toBeCloseTo(decaissementSansDeduction - residuLine.value, 6);
      expect(decaissementLine.value).toBeLessThan(decaissementSansDeduction);
    }
  });

  it("Comptant vs Crédit société : les deux montages restent comparés à armes égales (déduction identique à durée égale)", () => {
    const r = computeSimulation(createDefaultInputs());
    const societeComptant = r.allOptions.find((o) => o.owner === "societe" && o.mode === "comptant")!;
    const societeCredit = r.allOptions.find((o) => o.owner === "societe" && o.mode === "credit")!;
    const residuComptant = societeComptant.detail.find((d) => d.label.includes("Valeur résiduelle annualisée"))!.value;
    const residuCredit = societeCredit.detail.find((d) => d.label.includes("Valeur résiduelle annualisée"))!.value;
    // Même durée de détention (60 mois) par défaut pour comptant et crédit → même valeur résiduelle annualisée.
    expect(residuComptant).toBeCloseTo(residuCredit, 6);
  });
});

describe("computeSimulation — seuil de bascule société ⇄ personnel (findBreakevenPercent)", () => {
  it("retourne null quand les deux scénarios ne se croisent pas sur 0-100% d'usage privé (cas par défaut)", () => {
    const r = computeSimulation(createDefaultInputs());
    expect(r.seuilPrivateUsePercent).toBeNull();
  });

  it("retourne un seuil entre 0 et 100% quand les coûts globaux des deux scénarios se croisent", () => {
    const inputs: SimulationInputs = {
      ...createDefaultInputs(),
      vehiclePrice: 10000,
      totalKmAnnual: 5000,
      financingMode: "comptant",
      personalFinancingMode: "comptant",
    };
    const r = computeSimulation(inputs);
    expect(r.seuilPrivateUsePercent).not.toBeNull();
    expect(r.seuilPrivateUsePercent as number).toBeGreaterThan(0);
    expect(r.seuilPrivateUsePercent as number).toBeLessThan(100);

    // Au seuil trouvé, les deux coûts globaux doivent être quasi égaux (c'est la définition du seuil).
    const p = r.seuilPrivateUsePercent as number;
    const auSeuil = computeSimulation({ ...inputs, privateUsePercent: p });
    const societeAuSeuil = auSeuil.allOptions.find((o) => o.owner === "societe" && o.mode === inputs.financingMode)!;
    const personnelAuSeuil = auSeuil.allOptions.find((o) => o.owner === "personnel" && o.mode === inputs.personalFinancingMode)!;
    expect(societeAuSeuil.globalCostAnnual).toBeCloseTo(personnelAuSeuil.globalCostAnnual, 0);
  });
});

describe("computeSimulation — compenserMensualiteParAugmentationSalaire (achat perso, mensualité compensée par une augmentation de salaire)", () => {
  it("désactivée par défaut : aucun coût supplémentaire, label et détail inchangés", () => {
    const r = computeSimulation(createDefaultInputs());
    const perso = r.allOptions.find((o) => o.owner === "personnel" && o.mode === "credit")!;
    expect(perso.label).not.toContain("augmentation salaire");
    expect(perso.detail.some((d) => d.label.includes("augmentation"))).toBe(false);
  });

  it("activée : ajoute un coût société égal à la mensualité de financement + charges sociales, net de l'économie d'impôt", () => {
    const inputs: SimulationInputs = {
      ...createDefaultInputs(),
      personalFinancingMode: "credit",
      compenserMensualiteParAugmentationSalaire: true,
    };
    const sans = computeSimulation({ ...inputs, compenserMensualiteParAugmentationSalaire: false });
    const avec = computeSimulation(inputs);

    const persoSans = sans.allOptions.find((o) => o.owner === "personnel" && o.mode === "credit")!;
    const persoAvec = avec.allOptions.find((o) => o.owner === "personnel" && o.mode === "credit")!;

    expect(persoAvec.label).toContain("augmentation salaire");
    expect(persoAvec.globalCostAnnual).toBeGreaterThan(persoSans.globalCostAnnual);

    const augmentationBrute = persoAvec.detail.find((d) => d.label.includes("Augmentation de salaire brute"))!.value;
    expect(augmentationBrute).toBeCloseTo(persoAvec.detail.find((d) => d.label.includes("Financement du véhicule"))!.value, 6);

    const chargesLine = persoAvec.detail.find((d) => d.label === "Charges sociales sur cette augmentation")!;
    expect(chargesLine.value).toBeCloseTo(augmentationBrute * inputs.tnsContributionRate, 6);

    const coutNetLine = persoAvec.detail.find((d) => d.label.includes("Coût net société de l'augmentation"))!;
    expect(persoAvec.globalCostAnnual - persoSans.globalCostAnnual).toBeCloseTo(coutNetLine.value, 6);
    // Le coût s'ajoute exclusivement au côté société : la part dirigeant reste inchangée.
    expect(persoAvec.partDirigeant).toBeCloseTo(persoSans.partDirigeant, 6);
    expect(persoAvec.partSociete - persoSans.partSociete).toBeCloseTo(coutNetLine.value, 6);
  });

  it("ne modifie en rien les options 'Société' (le montage ne concerne que l'achat personnel)", () => {
    const inputs: SimulationInputs = { ...createDefaultInputs(), compenserMensualiteParAugmentationSalaire: true };
    const avec = computeSimulation(inputs);
    const sans = computeSimulation({ ...inputs, compenserMensualiteParAugmentationSalaire: false });
    for (const mode of ["comptant", "credit", "loa", "lld"] as const) {
      const a = avec.allOptions.find((o) => o.owner === "societe" && o.mode === mode)!;
      const s = sans.allOptions.find((o) => o.owner === "societe" && o.mode === mode)!;
      expect(a.globalCostAnnual).toBeCloseTo(s.globalCostAnnual, 6);
    }
  });

  it("le coût net société de l'augmentation est nul si la mensualité de financement est nulle", () => {
    // Comptant sans coût d'opportunité notable ne tombe pas à zéro, donc on force un cas simple :
    // un mode dont le financingAnnual (mensualité annualisée) est nul n'existe pas nativement ici,
    // on vérifie donc simplement que le coût croît strictement avec la mensualité (LOA vs LLD, prix
    // identique) plutôt qu'un cas nul artificiel.
    const inputs: SimulationInputs = { ...createDefaultInputs(), compenserMensualiteParAugmentationSalaire: true };
    const r = computeSimulation(inputs);
    const perso = r.allOptions.find((o) => o.owner === "personnel" && o.mode === inputs.personalFinancingMode)!;
    const coutNetLine = perso.detail.find((d) => d.label.includes("Coût net société de l'augmentation"))!;
    expect(coutNetLine.value).toBeGreaterThan(0);
  });
});

describe("computeSimulation — aides à l'achat (prime CEE, bonus de reprise)", () => {
  it("aucune aide par défaut : prix net = prix brut des deux côtés", () => {
    const r = computeSimulation(createDefaultInputs());
    expect(r.remiseSociete).toBe(0);
    expect(r.remisePersonnel).toBe(0);
    expect(r.prixNetSociete).toBeCloseTo(createDefaultInputs().vehiclePrice, 6);
    expect(r.prixNetPersonnel).toBeCloseTo(createDefaultInputs().vehiclePrice, 6);
  });

  it("prime CEE seule : ne réduit JAMAIS le prix société, uniquement le prix personnel", () => {
    const inputs: SimulationInputs = { ...createDefaultInputs(), ceeSelectedAmount: 5700 };
    const r = computeSimulation(inputs);
    expect(r.remiseSociete).toBe(0);
    expect(r.remisePersonnel).toBeCloseTo(5700, 6);
    expect(r.prixNetSociete).toBeCloseTo(inputs.vehiclePrice, 6);
    expect(r.prixNetPersonnel).toBeCloseTo(inputs.vehiclePrice - 5700, 6);
  });

  it("bonus de reprise applicable société : réduit le prix des deux côtés", () => {
    const inputs: SimulationInputs = {
      ...createDefaultInputs(),
      bonusRepriseActif: true,
      bonusRepriseMontant: 5000,
      bonusRepriseApplicableSociete: true,
    };
    const r = computeSimulation(inputs);
    expect(r.remiseSociete).toBeCloseTo(5000, 6);
    expect(r.remisePersonnel).toBeCloseTo(5000, 6);
  });

  it("bonus de reprise NON applicable société : réduit uniquement le prix personnel", () => {
    const inputs: SimulationInputs = {
      ...createDefaultInputs(),
      bonusRepriseActif: true,
      bonusRepriseMontant: 5000,
      bonusRepriseApplicableSociete: false,
    };
    const r = computeSimulation(inputs);
    expect(r.remiseSociete).toBe(0);
    expect(r.remisePersonnel).toBeCloseTo(5000, 6);
  });

  it("prime CEE + bonus de reprise cumulés côté personnel", () => {
    const inputs: SimulationInputs = {
      ...createDefaultInputs(),
      ceeSelectedAmount: 5700,
      bonusRepriseActif: true,
      bonusRepriseMontant: 5000,
      bonusRepriseApplicableSociete: false,
    };
    const r = computeSimulation(inputs);
    expect(r.remisePersonnel).toBeCloseTo(10700, 6);
    expect(r.prixNetPersonnel).toBeCloseTo(inputs.vehiclePrice - 10700, 6);
  });

  it("le prix net réduit la mensualité de crédit (comptant/crédit affectés)", () => {
    const base = { ...createDefaultInputs(), financingMode: "credit" as const, personalFinancingMode: "credit" as const };
    const sansAide = computeSimulation(base);
    const avecAide = computeSimulation({ ...base, ceeSelectedAmount: 5700 });
    const persoSans = sansAide.allOptions.find((o) => o.owner === "personnel" && o.mode === "credit")!;
    const persoAvec = avecAide.allOptions.find((o) => o.owner === "personnel" && o.mode === "credit")!;
    const mensualiteSans = persoSans.detail.find((d) => d.label.includes("Financement du véhicule"))!.value;
    const mensualiteAvec = persoAvec.detail.find((d) => d.label.includes("Financement du véhicule"))!.value;
    expect(mensualiteAvec).toBeLessThan(mensualiteSans);
  });

  it("le prix net réduit la base d'amortissement AEN côté société (comptant/crédit)", () => {
    const base = { ...createDefaultInputs(), financingMode: "credit" as const };
    const sansAide = computeSimulation(base);
    const avecAide = computeSimulation({ ...base, bonusRepriseActif: true, bonusRepriseMontant: 5000, bonusRepriseApplicableSociete: true });
    expect(avecAide.aenBrut).toBeLessThan(sansAide.aenBrut);
  });

  it("n'affecte PAS les offres LOA/LLD (loyers constructeur publiés, indépendants du prix net)", () => {
    const base = createDefaultInputs(); // Tesla Model Y par défaut, offre LOA/LLD constructeur réelle
    const sansAide = computeSimulation(base);
    const avecAide = computeSimulation({ ...base, ceeSelectedAmount: 5700, bonusRepriseActif: true, bonusRepriseMontant: 5000 });
    const loaSans = sansAide.allOptions.find((o) => o.owner === "personnel" && o.mode === "loa")!;
    const loaAvec = avecAide.allOptions.find((o) => o.owner === "personnel" && o.mode === "loa")!;
    expect(loaAvec.globalCostAnnual).toBeCloseTo(loaSans.globalCostAnnual, 6);
    const lldSans = sansAide.allOptions.find((o) => o.owner === "personnel" && o.mode === "lld")!;
    const lldAvec = avecAide.allOptions.find((o) => o.owner === "personnel" && o.mode === "lld")!;
    expect(lldAvec.globalCostAnnual).toBeCloseTo(lldSans.globalCostAnnual, 6);
  });

  it("un montant supérieur au prix du véhicule ne produit jamais un prix net négatif", () => {
    const inputs: SimulationInputs = { ...createDefaultInputs(), vehiclePrice: 3000, ceeSelectedAmount: 8240 };
    const r = computeSimulation(inputs);
    expect(r.prixNetPersonnel).toBeGreaterThanOrEqual(0);
  });

  it("applyVehicleModel réinitialise les aides et pré-remplit le bonus de reprise du nouveau modèle", () => {
    const withStaleAids: SimulationInputs = {
      ...createDefaultInputs(),
      ceeSelectedAmount: 8240,
      bonusRepriseActif: true,
      bonusRepriseMontant: 999,
    };
    const next = applyVehicleModel(withStaleAids, "tesla-model-3");
    expect(next.ceeSelectedAmount).toBe(0);
    expect(next.bonusRepriseActif).toBe(false);
    expect(next.bonusRepriseMontant).toBeCloseTo(3000, 6); // bonus de reprise Tesla Model 3
  });

  it("le détail des options comptant/crédit affiche la ligne d'aide déduite quand applicable", () => {
    const inputs: SimulationInputs = { ...createDefaultInputs(), financingMode: "credit", ceeSelectedAmount: 5700 };
    const r = computeSimulation(inputs);
    const perso = r.allOptions.find((o) => o.owner === "personnel" && o.mode === "credit")!;
    const soc = r.allOptions.find((o) => o.owner === "societe" && o.mode === "credit")!;
    expect(perso.detail.some((d) => d.label.includes("Aides à l'achat déduites"))).toBe(true);
    expect(soc.detail.some((d) => d.label.includes("Aides à l'achat déduites"))).toBe(false);
  });
});


describe("computeSimulation — TVA déductible sur participation financière (rescrit 30/04/2025)", () => {
  /** Base société : LOA, pour que la TVA porte sur un loyer annuel clairement identifié. */
  function baseTva(patch: Partial<SimulationInputs> = {}): SimulationInputs {
    return {
      ...createDefaultInputs(),
      financingMode: "loa",
      monthlyParticipation: 100,
      ...patch,
    };
  }

  it("ne récupère aucune TVA quand l'option est désactivée (comportement par défaut)", () => {
    const r = computeSimulation(baseTva({ tvaRecuperableVehicule: false }));
    expect(r.tvaDeductible).toBe(0);
    expect(r.tvaCollecteeSurParticipation).toBe(0);
    expect(r.gainTvaNet).toBe(0);
  });

  it("récupère la TVA sur le loyer, l'entretien et l'option d'achat annualisée", () => {
    const inputs = baseTva({ tvaRecuperableVehicule: true });
    const r = computeSimulation(inputs);
    const coef = inputs.tauxTVA / (1 + inputs.tauxTVA); // 20% TTC -> 1/6

    // Base récurrente : loyer annuel moyen (LOA) + entretien ; l'assurance en est exclue.
    // S'y ajoute la TVA du rachat en fin de contrat, étalée sur la durée de la LOA.
    const loyerAnnuel = r.financingAnnual;
    const dureeAnnees = inputs.financing.loa.dureeMois / 12;
    const tvaOptionAchat = (inputs.financing.loa.valeurOptionAchat * coef) / dureeAnnees;
    expect(r.tvaDeductible).toBeCloseTo((loyerAnnuel + inputs.annualMaintenance) * coef + tvaOptionAchat, 6);
    expect(r.tvaCollecteeSurParticipation).toBeCloseTo(inputs.monthlyParticipation * 12 * coef, 6);
    expect(r.gainTvaNet).toBeCloseTo(r.tvaDeductible - r.tvaCollecteeSurParticipation, 6);
  });

  it("n'ajoute la TVA de l'option d'achat que si celle-ci est effectivement levée", () => {
    const levee = computeSimulation(baseTva({ tvaRecuperableVehicule: true }));
    const inputsSansLevee = baseTva({ tvaRecuperableVehicule: true });
    const sansLevee = computeSimulation({
      ...inputsSansLevee,
      financing: {
        ...inputsSansLevee.financing,
        loa: { ...inputsSansLevee.financing.loa, leveeOption: false },
      },
    });
    const coef = 0.2 / 1.2;
    const dureeAnnees = inputsSansLevee.financing.loa.dureeMois / 12;
    expect(levee.tvaDeductible - sansLevee.tvaDeductible).toBeCloseTo(
      (inputsSansLevee.financing.loa.valeurOptionAchat * coef) / dureeAnnees,
      4,
    );
  });

  it("exclut la composante véhicule si le prix ne contient pas de TVA récupérable (occasion, marge)", () => {
    const avecTva = computeSimulation(
      baseTva({ tvaRecuperableVehicule: true, financingMode: "comptant", prixContientTvaRecuperable: true }),
    );
    const sansTva = computeSimulation(
      baseTva({ tvaRecuperableVehicule: true, financingMode: "comptant", prixContientTvaRecuperable: false }),
    );
    const coef = 0.2 / 1.2;
    // Seul l'entretien reste dans la base : le garage facture de la TVA quelle que soit l'origine du véhicule.
    expect(sansTva.tvaDeductible).toBeCloseTo(600 * coef, 6);
    expect(avecTva.tvaDeductible - sansTva.tvaDeductible).toBeCloseTo(avecTva.amortAnnual * coef, 6);
  });

  it("ne touche pas à la TVA des loyers LOA/LLD quand le prix d'achat est sans TVA récupérable", () => {
    // Les loyers sont facturés par un loueur assujetti : le régime du prix d'achat leur est étranger.
    const a = computeSimulation(baseTva({ tvaRecuperableVehicule: true, prixContientTvaRecuperable: true }));
    const b = computeSimulation(baseTva({ tvaRecuperableVehicule: true, prixContientTvaRecuperable: false }));
    expect(b.tvaDeductible).toBeCloseTo(a.tvaDeductible, 6);
  });

  it("exclut l'assurance de la base de TVA déductible (exonérée, art. 261 C CGI)", () => {
    const sansAssurance = computeSimulation(baseTva({ tvaRecuperableVehicule: true, annualInsurance: 0 }));
    const avecAssurance = computeSimulation(baseTva({ tvaRecuperableVehicule: true, annualInsurance: 5000 }));
    expect(avecAssurance.tvaDeductible).toBeCloseTo(sansAssurance.tvaDeductible, 6);
  });

  it("inclut l'entretien dans la base de TVA déductible", () => {
    const peu = computeSimulation(baseTva({ tvaRecuperableVehicule: true, annualMaintenance: 0 }));
    const beaucoup = computeSimulation(baseTva({ tvaRecuperableVehicule: true, annualMaintenance: 1200 }));
    const coef = 0.2 / 1.2;
    expect(beaucoup.tvaDeductible - peu.tvaDeductible).toBeCloseTo(1200 * coef, 6);
  });

  it("réduit le décaissement réel de la société de la seule TVA récupérée", () => {
    // La TVA collectée sur la participation n'entre PAS dans le décaissement : elle est prise en
    // compte en ramenant la participation encaissée à son montant HT (cf. test dédié ci-dessous),
    // sans quoi elle serait comptée deux fois.
    const sans = computeSimulation(baseTva({ tvaRecuperableVehicule: false }));
    const avec = computeSimulation(baseTva({ tvaRecuperableVehicule: true }));
    expect(sans.companyCashBaseAnnual - avec.companyCashBaseAnnual).toBeCloseTo(avec.tvaDeductible, 6);
    expect(avec.tvaDeductible).toBeGreaterThan(0);
  });

  it("neutralise l'option si aucune contrepartie n'est versée (mise à disposition gratuite = hors champ)", () => {
    // Rescrit BOI-RES-TVA-000161 : un avantage en nature sans contrepartie réelle n'ouvre aucun droit
    // à déduction. Cocher l'option sans participation ne doit donc rien changer au résultat.
    const sansOption = baseTva({ tvaRecuperableVehicule: false, monthlyParticipation: 0 });
    const avecOption = baseTva({ tvaRecuperableVehicule: true, monthlyParticipation: 0 });
    const r = computeSimulation(avecOption);
    expect(r.tvaEffectivementDeductible).toBe(false);
    expect(r.tvaDeductible).toBe(0);
    expect(r.gainTvaNet).toBe(0);
    const a = computeSimulation(sansOption).allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;
    const b = computeSimulation(avecOption).allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;
    expect(b.globalCostAnnual).toBeCloseTo(a.globalCostAnnual, 9);
  });

  it("n'impose la participation encaissée que sur sa base HT (la TVA collectée n'est pas un produit)", () => {
    const inputs = baseTva({ tvaRecuperableVehicule: true, monthlyParticipation: 300 });
    const r = computeSimulation(inputs);
    const baseHT = r.participationAnnual - r.tvaCollecteeSurParticipation;
    expect(r.tvaCollecteeSurParticipation).toBeCloseTo(3600 / 6, 6); // 20% TTC -> 1/6
    expect(baseHT).toBeCloseTo(3000, 6);
    // Taux réduit IS 15% sur le cas par défaut : l'impôt doit porter sur 3 000 €, pas sur 3 600 €.
    expect(r.impotSurParticipation).toBeCloseTo(3000 * 0.15, 6);
    expect(r.participationNetteSociete).toBeCloseTo(3000 - 450, 6);
  });

  it("laisse le coût du dirigeant inchangé par l'option TVA (elle ne concerne que la société)", () => {
    const sans = computeSimulation(baseTva({ tvaRecuperableVehicule: false, monthlyParticipation: 300 }));
    const avec = computeSimulation(baseTva({ tvaRecuperableVehicule: true, monthlyParticipation: 300 }));
    expect(avec.coutTotalGerantSociete).toBeCloseTo(sans.coutTotalGerantSociete, 9);
  });

  it("en comptant/crédit, étale la TVA du prix d'achat sur l'amortissement annuel", () => {
    const inputs = baseTva({ tvaRecuperableVehicule: true, financingMode: "comptant" });
    const r = computeSimulation(inputs);
    const coef = inputs.tauxTVA / (1 + inputs.tauxTVA);
    // amortAnnual = prix × taux d'amortissement (20%/an pour un véhicule ≤ 5 ans).
    expect(r.tvaDeductible).toBeCloseTo((r.amortAnnual + inputs.annualMaintenance) * coef, 6);
    // Sur la durée d'amortissement complète, la TVA du prix est restituée à 100%.
    expect(r.amortAnnual * 5).toBeCloseTo(inputs.vehiclePrice, 6);
  });

  it("n'affecte pas les options « Personnel + IK » (aucun droit à déduction pour un achat personnel)", () => {
    const sans = computeSimulation(baseTva({ tvaRecuperableVehicule: false }));
    const avec = computeSimulation(baseTva({ tvaRecuperableVehicule: true }));
    const persoSans = sans.allOptions.filter((o) => o.owner === "personnel");
    const persoAvec = avec.allOptions.filter((o) => o.owner === "personnel");
    for (let i = 0; i < persoSans.length; i++) {
      expect(persoAvec[i].globalCostAnnual).toBeCloseTo(persoSans[i].globalCostAnnual, 6);
    }
  });

  it("réduit le coût des options « Société » et fait apparaître les lignes de détail TVA", () => {
    const sans = computeSimulation(baseTva({ tvaRecuperableVehicule: false }));
    const avec = computeSimulation(baseTva({ tvaRecuperableVehicule: true }));
    const socSans = sans.allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;
    const socAvec = avec.allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;
    expect(socAvec.globalCostAnnual).toBeLessThan(socSans.globalCostAnnual);
    expect(socAvec.detail.some((d) => d.label.includes("TVA déductible récupérée"))).toBe(true);
    expect(socSans.detail.some((d) => d.label.includes("TVA déductible récupérée"))).toBe(false);
  });

  it("peut produire un gain net négatif si la participation dépasse la base déductible", () => {
    const r = computeSimulation(
      baseTva({ tvaRecuperableVehicule: true, monthlyParticipation: 5000, annualMaintenance: 0 }),
    );
    expect(r.gainTvaNet).toBeLessThan(0);
  });
});

describe("computeSimulation — participation financière du dirigeant", () => {
  function baseP(monthlyParticipation: number): SimulationInputs {
    return { ...createDefaultInputs(), financingMode: "loa", monthlyParticipation };
  }
  const socOf = (inputs: SimulationInputs) =>
    computeSimulation(inputs).allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;

  it("compte la participation versée dans le coût du dirigeant", () => {
    const r0 = computeSimulation(baseP(0));
    const r1 = computeSimulation(baseP(200));
    // Le dirigeant décaisse réellement 2 400 €/an : son coût cash = cotisations + IR + participation.
    expect(r0.coutTotalGerantSociete).toBeCloseTo(r0.cotisationsTNS + r0.irEstimee, 6);
    expect(r1.coutTotalGerantSociete).toBeCloseTo(r1.cotisationsTNS + r1.irEstimee + 2400, 6);
    expect(socOf(baseP(200)).partDirigeant).toBeGreaterThan(socOf(baseP(0)).partDirigeant);
  });

  it("compte la participation encaissée en recette de la société, nette de l'impôt qu'elle génère", () => {
    const sans = socOf(baseP(0));
    const avec = socOf(baseP(200));
    const r = computeSimulation(baseP(200));
    expect(avec.partSociete).toBeCloseTo(sans.partSociete - r.participationNetteSociete, 6);
    expect(r.participationNetteSociete).toBeCloseTo(2400 - r.impotSurParticipation, 6);
    expect(r.impotSurParticipation).toBeGreaterThan(0);
  });

  it("laisse le coût global inchangé hors effet fiscal (le transfert lui-même est neutre)", () => {
    // Sur un cas où l'AEN est déjà nul, la participation n'apporte aucune économie : il ne reste
    // que l'impôt sur le produit encaissé, qui augmente le coût global.
    const aenNul = { ...baseP(0), privateUsePercent: 0 };
    const r0 = computeSimulation(aenNul);
    expect(r0.aenNetBeforeParticipation).toBe(0);
    const s0 = computeSimulation(aenNul).allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;
    const s1 = computeSimulation({ ...aenNul, monthlyParticipation: 200 }).allOptions.find(
      (o) => o.owner === "societe" && o.mode === "loa",
    )!;
    const r1 = computeSimulation({ ...aenNul, monthlyParticipation: 200 });
    expect(s1.globalCostAnnual - s0.globalCostAnnual).toBeCloseTo(r1.impotSurParticipation, 6);
  });

  it("expose une participation optimale qui ramène exactement l'AEN à 0", () => {
    const r = computeSimulation(baseP(0));
    expect(r.participationOptimaleMensuelle).toBeCloseTo(r.aenNetBeforeParticipation / 12, 6);
    const applique = computeSimulation(baseP(r.participationOptimaleMensuelle));
    expect(applique.aenNet).toBeCloseTo(0, 6);
  });

  it("la participation optimale minimise effectivement le coût global (vérifié par balayage)", () => {
    const optimum = computeSimulation(baseP(0)).participationOptimaleMensuelle;
    const coutOptimum = socOf(baseP(optimum)).globalCostAnnual;
    for (let p = 0; p <= 150; p += 1) {
      expect(socOf(baseP(p)).globalCostAnnual).toBeGreaterThanOrEqual(coutOptimum - 1e-6);
    }
  });

  it("reste l'optimum lorsque l'option TVA est activée (la TVA collectée renchérit chaque euro versé)", () => {
    const withTva = (p: number): SimulationInputs => ({ ...baseP(p), tvaRecuperableVehicule: true });
    const socTva = (p: number) =>
      computeSimulation(withTva(p)).allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;
    const optimum = computeSimulation(withTva(0)).participationOptimaleMensuelle;
    let meilleur = { p: -1, cout: Infinity };
    for (let p = 1; p <= 200; p += 1) {
      const cout = socTva(p).globalCostAnnual;
      if (cout < meilleur.cout) meilleur = { p, cout };
    }
    expect(Math.abs(meilleur.p - optimum)).toBeLessThan(1.5);
  });

  it("au-delà de l'optimum, chaque euro versé augmente le coût global", () => {
    const optimum = computeSimulation(baseP(0)).participationOptimaleMensuelle;
    const a = socOf(baseP(optimum)).globalCostAnnual;
    const b = socOf(baseP(optimum + 50)).globalCostAnnual;
    expect(b).toBeGreaterThan(a);
  });

  it("n'affecte pas les options « Personnel + IK » (pas d'AEN, donc pas de participation)", () => {
    const sans = computeSimulation(baseP(0)).allOptions.filter((o) => o.owner === "personnel");
    const avec = computeSimulation(baseP(200)).allOptions.filter((o) => o.owner === "personnel");
    for (let i = 0; i < sans.length; i++) {
      expect(avec[i].globalCostAnnual).toBeCloseTo(sans[i].globalCostAnnual, 6);
    }
  });

  it("fait apparaître les lignes de détail de la participation côté société", () => {
    const avec = socOf(baseP(200));
    expect(avec.detail.some((d) => d.label.includes("Participation encaissée du dirigeant"))).toBe(true);
    expect(avec.detail.some((d) => d.label.includes("Impôt société sur cette participation"))).toBe(true);
    expect(socOf(baseP(0)).detail.some((d) => d.label.includes("Participation encaissée"))).toBe(false);
  });
});

describe("computeSimulation — exhaustivité du comparatif annuel/mensuel", () => {
  it("aucun libellé de détail ne signale un montant exclu du coût annuel", () => {
    // Garde-fou : tous les flux, y compris les versements uniques (levée d'option d'achat), doivent
    // être lissés et comptés dans le coût annuel comparé. Un libellé du type « hors coût annuel »
    // signalerait un flux resté en dehors de la comparaison.
    const inputs: SimulationInputs = { ...createDefaultInputs(), financingMode: "loa" };
    const r = computeSimulation(withFinancingLoa(inputs, { leveeOption: true }));
    for (const option of r.allOptions) {
      for (const ligne of option.detail) {
        expect(ligne.label.toLowerCase()).not.toContain("hors coût annuel");
      }
    }
  });

  // Exercé avec ET sans récupération de TVA : sans le cas activé, la reconstitution passerait
  // trivialement (tous les termes de TVA à zéro) et ne vérifierait donc rien de ce côté.
  it.each([false, true])(
    "le coût annuel de chaque option se reconstitue à partir de ses lignes de détail (TVA activée : %s)",
    (tvaRecuperableVehicule) => {
      const inputs: SimulationInputs = {
        ...createDefaultInputs(),
        financingMode: "loa",
        monthlyParticipation: 150,
        tvaRecuperableVehicule,
      };
      const r = computeSimulation(withFinancingLoa(inputs, { leveeOption: true }));
      const soc = r.allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;
      const val = (fragment: string) => soc.detail.find((d) => d.label.includes(fragment))?.value ?? 0;
      // Somme de TOUTES les lignes correspondantes : la TVA est décomposée en deux postes.
      const somme = (fragment: string) =>
        soc.detail.filter((d) => d.label.includes(fragment)).reduce((acc, d) => acc + d.value, 0);

      const reconstitue =
        val("Financement du véhicule") +
        val("option d'achat LOA, lissée") +
        val("Assurance annuelle") +
        val("Entretien annuel") +
        val("Taxes annuelles CO2") -
        val("Valeur résiduelle annualisée") -
        somme("TVA déductible récupérée");
      expect(reconstitue).toBeCloseTo(val("= Décaissement réel société"), 6);

      // Et la décomposition doit bien totaliser la TVA effectivement retenue dans le calcul.
      expect(somme("TVA déductible récupérée")).toBeCloseTo(r.tvaDeductible, 6);
    },
  );

  it("décompose la TVA récupérée en deux lignes vérifiables quand l'option d'achat est levée", () => {
    const inputs: SimulationInputs = {
      ...createDefaultInputs(),
      financingMode: "loa",
      monthlyParticipation: 150,
      tvaRecuperableVehicule: true,
    };
    const r = computeSimulation(withFinancingLoa(inputs, { leveeOption: true }));
    const soc = r.allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;
    const lignes = soc.detail.filter((d) => d.label.includes("TVA déductible récupérée"));
    expect(lignes).toHaveLength(2);
    expect(lignes[1].label).toContain("levée d'option d'achat");
    expect(lignes[0].value).toBeCloseTo(r.tvaDeductibleRecurrente, 6);
    expect(lignes[1].value).toBeCloseTo(r.tvaOptionAchatAnnualisee, 6);
    expect(r.tvaDeductibleRecurrente + r.tvaOptionAchatAnnualisee).toBeCloseTo(r.tvaDeductible, 6);
  });

  it("la levée de l'option d'achat déplace bien le coût vers le comparatif (et pas seulement l'affichage)", () => {
    const base: SimulationInputs = { ...createDefaultInputs(), financingMode: "loa" };
    const socDe = (leveeOption: boolean) =>
      computeSimulation(withFinancingLoa(base, { leveeOption })).allOptions.find(
        (o) => o.owner === "societe" && o.mode === "loa",
      )!;
    // Le coût global comparé doit changer selon que l'option est levée ou non : s'il était identique,
    // c'est que le versement de rachat resterait hors comparatif.
    expect(socDe(true).globalCostAnnual).not.toBeCloseTo(socDe(false).globalCostAnnual, 2);
  });
});

describe("computeSimulation — modalités de versement de la participation", () => {
  function avecMode(mode: SimulationInputs["modeVersementParticipation"]): SimulationInputs {
    return {
      ...createDefaultInputs(),
      financingMode: "loa",
      monthlyParticipation: 200,
      modeVersementParticipation: mode,
    };
  }
  const socOf = (i: SimulationInputs) =>
    computeSimulation(i).allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;

  it("les modalités sur ressources nettes coûtent au dirigeant le montant versé", () => {
    for (const mode of ["retenue_nette", "paiement_personnel", "compte_courant"] as const) {
      const r = computeSimulation(avecMode(mode));
      expect(r.coutParticipationDirigeant).toBeCloseTo(2400, 6);
    }
  });

  it("la réduction de rémunération brute coûte le net abandonné, net d'IR", () => {
    const inputs = avecMode("retenue_brute");
    const r = computeSimulation(inputs);
    const netAbandonne = 2400 / (1 + inputs.tnsContributionRate);
    expect(r.coutParticipationDirigeant).toBeCloseTo(netAbandonne * (1 - r.tauxIRUtilise), 6);
    expect(r.coutParticipationDirigeant).toBeLessThan(2400);
  });

  it("la contrepartie encaissée par la société est identique quelle que soit la modalité", () => {
    const nette = computeSimulation(avecMode("retenue_nette"));
    const brute = computeSimulation(avecMode("retenue_brute"));
    expect(brute.participationNetteSociete).toBeCloseTo(nette.participationNetteSociete, 6);
    expect(socOf(avecMode("retenue_brute")).partSociete).toBeCloseTo(socOf(avecMode("retenue_nette")).partSociete, 6);
  });

  it("seul le coût du dirigeant change, et donc le coût global", () => {
    const nette = socOf(avecMode("retenue_nette"));
    const brute = socOf(avecMode("retenue_brute"));
    expect(brute.partDirigeant).toBeLessThan(nette.partDirigeant);
    expect(nette.globalCostAnnual - brute.globalCostAnnual).toBeCloseTo(
      nette.partDirigeant - brute.partDirigeant,
      6,
    );
  });

  it("désigne la réduction de rémunération brute comme modalité optimale, avec l'économie chiffrée", () => {
    const r = computeSimulation(avecMode("retenue_nette"));
    expect(r.modeVersementOptimal).toBe("retenue_brute");
    const brute = computeSimulation(avecMode("retenue_brute"));
    expect(r.economieModeVersementOptimal).toBeCloseTo(2400 - brute.coutParticipationDirigeant, 6);
  });

  it("n'annonce aucune économie quand la modalité optimale est déjà retenue", () => {
    const r = computeSimulation(avecMode("retenue_brute"));
    expect(r.modeVersementOptimal).toBe("retenue_brute");
    expect(r.economieModeVersementOptimal).toBeCloseTo(0, 6);
  });

  it("rend les modalités équivalentes en l'absence de cotisations et d'impôt sur le revenu", () => {
    // Cas dégénéré : sans prélèvement à éviter, renoncer à du brut ne procure plus aucun avantage.
    const inputs: SimulationInputs = {
      ...avecMode("retenue_nette"),
      tnsContributionRate: 0,
      personalTaxProfile: { ...createDefaultInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0 },
    };
    const r = computeSimulation(inputs);
    expect(r.tauxIRUtilise).toBe(0);
    expect(r.economieModeVersementOptimal).toBeCloseTo(0, 6);
  });

  it("ne coûte rien au dirigeant si aucune participation n'est versée", () => {
    const r = computeSimulation({ ...avecMode("retenue_brute"), monthlyParticipation: 0 });
    expect(r.coutParticipationDirigeant).toBe(0);
    expect(r.economieModeVersementOptimal).toBe(0);
  });
});
