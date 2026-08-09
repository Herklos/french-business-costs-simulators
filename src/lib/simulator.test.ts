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

  it("le décaissement récurrent (annuel) reste identique, que l'option soit levée ou non — l'option d'achat est un versement unique, non lissé sur le coût annuel", () => {
    const base: SimulationInputs = { ...createDefaultInputs(), financingMode: "loa" };
    const sansOption = computeSimulation(withFinancingLoa(base, { leveeOption: false }));
    const avecOption = computeSimulation(withFinancingLoa(base, { leveeOption: true }));

    expect(avecOption.companyCashBaseAnnual).toBeCloseTo(sansOption.companyCashBaseAnnual, 6);
    expect(avecOption.globalCostSociete).toBeCloseTo(sansOption.globalCostSociete, 6);

    // L'option d'achat apparaît en revanche, une fois, dans le détail de l'option correspondante
    // (paiement unique de fin de contrat), sans être comptée dans le coût annuel récurrent.
    const optionLine = avecOption.allOptions
      .find((o) => o.owner === "societe" && o.mode === "loa")
      ?.detail.find((d) => d.label.includes("Option d'achat"));
    expect(optionLine?.value).toBeCloseTo(base.financing.loa.valeurOptionAchat, 6);
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
    const inputs: SimulationInputs = {
      ...createDefaultInputs(),
      financingMode: "lld",
      isElectric: false,
      privateUsePercent: 100,
      annualFuelPrivateCost: 0,
    };
    const r = computeSimulation(inputs);
    const loyerAnnuel = inputs.financing.lld.loyerMensuel * 12;
    expect(r.aenBaseAnnualCosts).toBeCloseTo((loyerAnnuel + inputs.annualInsurance + inputs.annualMaintenance) * 0.3, 6);
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
  it("LOA/LLD : aucune déduction de valeur résiduelle annualisée (hors périmètre comptant/crédit)", () => {
    const r = computeSimulation(createDefaultInputs());
    const societeLoa = r.allOptions.find((o) => o.owner === "societe" && o.mode === "loa");
    const societeLld = r.allOptions.find((o) => o.owner === "societe" && o.mode === "lld");
    expect(societeLoa?.detail.some((d) => d.label.includes("Valeur résiduelle annualisée"))).toBe(false);
    expect(societeLld?.detail.some((d) => d.label.includes("Valeur résiduelle annualisée"))).toBe(false);
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
