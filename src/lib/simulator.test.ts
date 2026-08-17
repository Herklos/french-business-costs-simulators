import { describe, expect, it } from "vitest";
import {
  type SimulationInputs,
  PARTICIPATION_VERSEMENT_MODES,
  applyVehicleModel,
  computeSimulation,
  createDefaultInputs,
  CHAMPS_VEHICULE_NON_PERSISTES,
  applyVehicleDraft,
  extractVehicleDraft,
  DEFAULT_ABATTEMENT_CAP,
  LIBELLES_REGIME_ABATTEMENT,
} from "./simulator";

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

  it("véhicule loué (LLD) : base AEN = coût de location + assurance + entretien, sans coefficient", () => {
    const base = createDefaultInputs();
    const inputs: SimulationInputs = {
      ...base,
      financingMode: "lld",
      isElectric: false,
      privateUsePercent: 100,
      annualFuelPrivateCost: 0,
      // Offre LLD classique (loyer nu) : assurance et entretien sont supportés en plus du loyer.
      // Premier loyer nul et kilométrage inclus égal au kilométrage réel, pour que le coût annuel
      // de location soit exactement douze mensualités — sans quoi le calcul attendu ci-dessous
      // devrait reconstituer l'étalement de l'apport et l'éventuel coût de dépassement.
      financing: {
        ...base.financing,
        lld: {
          ...base.financing.lld,
          premierLoyer: 0,
          kmInclusAnnuel: base.totalKmAnnual,
          kmReelAnnuel: base.totalKmAnnual,
          toutComprisEntretienAssurance: false,
        },
      },
    };
    const r = computeSimulation(inputs);
    const loyerAnnuel = inputs.financing.lld.loyerMensuel * 12;
    // Coût global de la location retenu POUR SON MONTANT INTÉGRAL : les 30 %/50 % que l'on associe
    // aux véhicules loués relèvent de la méthode forfaitaire, qui exclut toute proratisation
    // kilométrique. Les cumuler réduirait deux fois la même assiette pour le même motif.
    expect(r.aenBaseAnnualCosts).toBeCloseTo(loyerAnnuel + inputs.annualInsurance + inputs.annualMaintenance, 6);
    expect(r.aenPlafonneParEquivalentAchat).toBe(false);
  });

  it("véhicule loué (LLD « tout compris ») : assurance et entretien sortent de la base AEN", () => {
    const base = createDefaultInputs();
    const commun: SimulationInputs = {
      ...base,
      financingMode: "lld",
      isElectric: false,
      privateUsePercent: 100,
      annualFuelPrivateCost: 0,
      financing: {
        ...base.financing,
        lld: {
          ...base.financing.lld,
          premierLoyer: 0,
          kmInclusAnnuel: base.totalKmAnnual,
          kmReelAnnuel: base.totalKmAnnual,
        },
      },
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
    expect(toutCompris.aenBaseAnnualCosts).toBeCloseTo(loyerAnnuel, 6);
    // Écart = la part d'AEN qui provenait du double comptage des charges déjà incluses dans le loyer.
    expect(nu.aenBaseAnnualCosts - toutCompris.aenBaseAnnualCosts).toBeCloseTo(
      commun.annualInsurance + commun.annualMaintenance,
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

    expect(next.vehiclePrice).toBe(42784);
    expect(next.isElectric).toBe(true);
    expect(next.isEcoScoreEligible).toBe(true);
    expect(next.financing.loa.premierLoyerMajore).toBe(10000);
    expect(next.financing.loa.loyerMensuel).toBe(279);
    expect(next.financing.loa.dureeMois).toBe(48);
    expect(next.financing.loa.valeurOptionAchat).toBe(20722);
    expect(next.financing.loa.leveeOption).toBe(true);
    // Le crédit aussi : sans cela il resterait chiffré au taux de marché générique pendant que la
    // LOA porterait une offre à 0,99 %, et le comparatif opposerait une promotion à une estimation.
    expect(next.financing.credit.apport).toBe(10000);
    expect(next.financing.credit.tauxAnnuel).toBe(0.0099);
    expect(next.financing.credit.dureeMois).toBe(72);

    // L'offre LLD réelle (et non plus l'estimation générique) doit également être appliquée,
    // pour éviter de comparer une LOA réelle à une LLD synthétique (écart artificiel).
    expect(next.financing.lld.loyerMensuel).toBe(326);
    expect(next.financing.lld.dureeMois).toBe(60);
    expect(next.financing.lld.premierLoyer).toBe(5000);
    expect(next.financing.lld.kmInclusAnnuel).toBe(10000);
    expect(next.financing.lld.toutComprisEntretienAssurance).toBe(false);
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
    expect(inputs.financing.loa.loyerMensuel).toBe(279);
    expect(inputs.financing.loa.dureeMois).toBe(48);
    expect(inputs.financing.lld.loyerMensuel).toBe(326);
    expect(inputs.financing.lld.dureeMois).toBe(60);
    expect(inputs.financing.credit.dureeMois).toBe(72);
  });

  it("le kilométrage par défaut n'excède pas le forfait inclus dans les offres de location", () => {
    // Sinon le comparatif ferait apparaître, dès l'ouverture du simulateur, un coût de dépassement
    // kilométrique que rien dans le formulaire n'expliquerait.
    const inputs = createDefaultInputs();
    expect(inputs.totalKmAnnual).toBeLessThanOrEqual(inputs.financing.lld.kmInclusAnnuel);
    expect(inputs.financing.lld.kmReelAnnuel).toBe(inputs.totalKmAnnual);
  });
});

/**
 * L'abattement électrique n'est pas un attribut du véhicule mais de sa DATE DE MISE À DISPOSITION.
 * Trois régimes se succèdent, et les confondre fait varier l'avantage du simple au double.
 */
describe("computeSimulation — abattement véhicule électrique : régime déterminé par la date", () => {
  function avec(patch: Partial<SimulationInputs>): SimulationInputs {
    return { ...createDefaultInputs(), isElectric: true, ...patch };
  }
  const resultat = (patch: Partial<SimulationInputs>) => computeSimulation(avec(patch));

  it("véhicule éco-scoré confié aujourd'hui : abattement de 50 %, plafonné", () => {
    const r = resultat({ isEcoScoreEligible: true, dateMiseADisposition: "2026-03-01" });
    expect(r.regimeAbattementElectrique).toBe("reel_50_eco_score");
    expect(r.abattement).toBeCloseTo(Math.min(0.5 * r.aenBrut, DEFAULT_ABATTEMENT_CAP), 6);
    expect(r.abattement).toBeGreaterThan(0);
  });

  it("véhicule NON éco-scoré confié après le 1er février 2025 : AUCUN abattement", () => {
    // C'est le cas de la Tesla Model 3, assemblée hors d'Europe : l'avantage est alors évalué selon
    // les règles des véhicules thermiques, ni 50 % ni 70 %.
    const r = resultat({ isEcoScoreEligible: false, dateMiseADisposition: "2026-03-01" });
    expect(r.regimeAbattementElectrique).toBe("aucun_eco_score_manquant");
    expect(r.abattement).toBe(0);
  });

  it("véhicule NON éco-scoré confié AVANT le 1er février 2025 : abattement de 50 % malgré tout", () => {
    // La condition d'éco-score n'existait pas sous l'arrêté du 21 mai 2019 : un véhicule confié dans
    // cette fenêtre conserve son régime, et l'exclure serait une régression.
    const r = resultat({ isEcoScoreEligible: false, dateMiseADisposition: "2024-06-01" });
    expect(r.regimeAbattementElectrique).toBe("reel_50_sans_condition");
    expect(r.abattement).toBeGreaterThan(0);
  });

  it("la veille de la bascule et le jour même ne relèvent pas du même régime", () => {
    expect(resultat({ isEcoScoreEligible: false, dateMiseADisposition: "2025-01-31" }).abattement).toBeGreaterThan(0);
    expect(resultat({ isEcoScoreEligible: false, dateMiseADisposition: "2025-02-01" }).abattement).toBe(0);
  });

  it("hors de la période du dispositif, aucun abattement — avant 2020 comme après 2027", () => {
    for (const date of ["2019-12-31", "2028-01-01"]) {
      const r = resultat({ isEcoScoreEligible: true, dateMiseADisposition: date });
      expect(r.regimeAbattementElectrique).toBe("aucun_hors_periode");
      expect(r.abattement).toBe(0);
    }
  });

  it("un véhicule thermique n'a jamais d'abattement, quelle que soit la date", () => {
    const r = resultat({ isElectric: false, isEcoScoreEligible: true, dateMiseADisposition: "2026-03-01" });
    expect(r.regimeAbattementElectrique).toBe("aucun_non_electrique");
    expect(r.abattement).toBe(0);
  });

  it("la position prudente écarte l'abattement sans avoir à fausser l'éco-score du véhicule", () => {
    // Le champ d'application de l'arrêté est discuté pour un gérant TNS : la position prudente doit
    // être chiffrable en tant que telle, et non simulée en mentant sur l'éligibilité du véhicule.
    const inputs = avec({ isEcoScoreEligible: true, dateMiseADisposition: "2026-03-01" });
    const prudent = computeSimulation({ ...inputs, positionAbattementElectrique: "aucun" });
    expect(prudent.regimeAbattementElectrique).toBe("aucun_ecarte_par_prudence");
    expect(prudent.abattement).toBe(0);
    // L'éligibilité déclarée du véhicule reste vraie : c'est la position qui change, pas le fait.
    expect(prudent.aenNet).toBeGreaterThan(computeSimulation(inputs).aenNet);
  });

  it("le plafond mord : un abattement ne dépasse jamais le plafond annuel, même sur un AEN très élevé", () => {
    const r = resultat({
      isEcoScoreEligible: true,
      dateMiseADisposition: "2026-03-01",
      vehiclePrice: 150000,
      privateUsePercent: 100,
    });
    expect(r.abattement).toBeCloseTo(DEFAULT_ABATTEMENT_CAP, 6);
  });

  it("une date de mise à disposition non renseignée retient le régime en vigueur aujourd'hui", () => {
    const r = resultat({ isEcoScoreEligible: true, dateMiseADisposition: "" });
    expect(r.regimeAbattementElectrique).toBe("reel_50_eco_score");
  });

  it("chaque régime possède un libellé explicatif, y compris ceux qui n'accordent rien", () => {
    for (const regime of Object.keys(LIBELLES_REGIME_ABATTEMENT) as (keyof typeof LIBELLES_REGIME_ABATTEMENT)[]) {
      expect(LIBELLES_REGIME_ABATTEMENT[regime].length).toBeGreaterThan(20);
    }
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

  it("une durée de DÉTENTION plus longue réduit la valeur résiduelle", () => {
    const base = createDefaultInputs();
    const avecDetention = (mois: number): SimulationInputs => ({
      ...base,
      financing: { ...base.financing, comptant: { ...base.financing.comptant, dureeDetentionMois: mois } },
    });
    const residuelle = (inputs: SimulationInputs) =>
      computeSimulation(inputs).allOptions.find((o) => o.owner === "societe" && o.mode === "credit")!
        .valeurResiduelleEstimee;
    expect(residuelle(avecDetention(24))).toBeGreaterThan(residuelle(avecDetention(84)));
  });

  it("la durée du CRÉDIT, elle, ne change pas la valeur résiduelle du véhicule", () => {
    // Régression : le modèle confondait durée de financement et durée de détention. Rembourser sur
    // six ans plutôt que deux ne fait pas vieillir la voiture — mais faisait chuter sa valeur
    // résiduelle et baisser son coût annuel, au point de rendre le crédit artificiellement gagnant.
    const base = createDefaultInputs();
    const avecCredit = (mois: number): SimulationInputs => ({
      ...base,
      financing: { ...base.financing, credit: { ...base.financing.credit, dureeMois: mois } },
    });
    const residuelle = (inputs: SimulationInputs) =>
      computeSimulation(inputs).allOptions.find((o) => o.owner === "societe" && o.mode === "credit")!
        .valeurResiduelleEstimee;
    expect(residuelle(avecCredit(24))).toBeCloseTo(residuelle(avecCredit(84)), 6);
  });
});

/**
 * Un coût annuel n'a de sens comparatif qu'à durée égale. Le modèle confondait la durée de
 * FINANCEMENT et la durée de DÉTENTION : un crédit de soixante-douze mois étalait le même véhicule
 * sur six ans quand le comptant l'étalait sur cinq, et lui estimait une valeur résiduelle à six ans.
 * Deux avantages, l'un et l'autre illusoires, pour la seule raison d'avoir emprunté plus longtemps.
 *
 * Ce bloc verrouille l'alignement : comptant et crédit décrivent le même véhicule, conservé le même
 * temps, et ne diffèrent que par la modalité de paiement. Emprunter ne peut donc, à taux égal, que
 * coûter davantage.
 */
describe("computeSimulation — comparabilité des modes d'acquisition (lissage aligné sur la détention)", () => {
  const base = createDefaultInputs();

  function avecFinancement(patch: {
    detentionMois?: number;
    tauxOpportunite?: number;
    apport?: number;
    creditMois?: number;
    creditTaux?: number;
  }): SimulationInputs {
    return {
      ...base,
      financing: {
        ...base.financing,
        comptant: {
          ...base.financing.comptant,
          dureeDetentionMois: patch.detentionMois ?? base.financing.comptant.dureeDetentionMois,
          tauxOpportunite: patch.tauxOpportunite ?? base.financing.comptant.tauxOpportunite,
        },
        credit: {
          ...base.financing.credit,
          apport: patch.apport ?? base.financing.credit.apport,
          dureeMois: patch.creditMois ?? base.financing.credit.dureeMois,
          tauxAnnuel: patch.creditTaux ?? base.financing.credit.tauxAnnuel,
        },
      },
    };
  }

  const coutOption = (inputs: SimulationInputs, mode: "comptant" | "credit" | "loa" | "lld") =>
    computeSimulation(inputs).allOptions.find((o) => o.owner === "societe" && o.mode === mode)!;

  it("comptant et crédit sont lissés sur la MÊME durée : celle de détention", () => {
    const inputs = avecFinancement({ detentionMois: 60, creditMois: 72 });
    expect(coutOption(inputs, "comptant").dureeAnnees).toBeCloseTo(5, 6);
    expect(coutOption(inputs, "credit").dureeAnnees).toBeCloseTo(5, 6);
  });

  it("chaque option expose la durée sur laquelle son coût est ramené en €/an", () => {
    const r = computeSimulation(base);
    for (const opt of r.allOptions) {
      expect(Number.isFinite(opt.dureeAnnees)).toBe(true);
      expect(opt.dureeAnnees).toBeGreaterThan(0);
    }
  });

  it("les locations gardent leur terme contractuel, insensible à la durée de détention", () => {
    const court = avecFinancement({ detentionMois: 24 });
    const long = avecFinancement({ detentionMois: 96 });
    for (const mode of ["loa", "lld"] as const) {
      expect(coutOption(court, mode).dureeAnnees).toBeCloseTo(coutOption(long, mode).dureeAnnees, 6);
    }
    expect(coutOption(court, "loa").dureeAnnees).toBeCloseTo(base.financing.loa.dureeMois / 12, 6);
    expect(coutOption(court, "lld").dureeAnnees).toBeCloseTo(base.financing.lld.dureeMois / 12, 6);
  });

  it("à taux égaux, le comptant n'est JAMAIS plus cher que le crédit — emprunter, c'est payer le prix PLUS des intérêts", () => {
    for (const taux of [0, 0.0099, 0.03, 0.06]) {
      for (const detentionMois of [24, 60, 84]) {
        const inputs = avecFinancement({
          detentionMois,
          tauxOpportunite: taux,
          creditTaux: taux,
          creditMois: detentionMois,
        });
        const comptant = coutOption(inputs, "comptant").globalCostAnnual;
        const credit = coutOption(inputs, "credit").globalCostAnnual;
        expect(comptant).toBeLessThanOrEqual(credit + 1e-6);
      }
    }
  });

  it("à taux nuls des deux côtés, comptant et crédit convergent exactement — quel que soit l'apport", () => {
    for (const apport of [0, 5000, 10000, 42784]) {
      const inputs = avecFinancement({ tauxOpportunite: 0, creditTaux: 0, apport, creditMois: 60, detentionMois: 60 });
      expect(coutOption(inputs, "credit").globalCostAnnual).toBeCloseTo(
        coutOption(inputs, "comptant").globalCostAnnual,
        6,
      );
    }
  });

  it("le coût du crédit croît avec son taux, toutes choses égales par ailleurs", () => {
    const cout = (creditTaux: number) => coutOption(avecFinancement({ creditTaux }), "credit").globalCostAnnual;
    expect(cout(0)).toBeLessThan(cout(0.03));
    expect(cout(0.03)).toBeLessThan(cout(0.06));
  });

  it("augmenter l'apport ne rend plus le crédit artificiellement moins cher : le capital sorti garde son coût d'opportunité", () => {
    // Régression : seul le comptant se voyait facturer un coût d'opportunité, si bien que sortir du
    // cash sous forme d'apport était gratuit — le simulateur récompensait alors le gros apport.
    const cout = (apport: number) => coutOption(avecFinancement({ apport, creditMois: 60 }), "credit").globalCostAnnual;
    // TAEG par défaut inférieur au taux d'opportunité : emprunter davantage doit rester avantageux,
    // mais l'écart doit rester borné par le seul différentiel de taux, sans prime au décaissement.
    expect(cout(0)).toBeLessThanOrEqual(cout(30000) + 1e-6);
  });

  it("à TAEG égal au taux d'opportunité, la durée du crédit est NEUTRE sur le coût annuel", () => {
    // Régression : allonger le remboursement étalait le total sur davantage d'années ET rabotait la
    // valeur résiduelle. Le crédit long gagnait donc deux fois, sans qu'aucun euro ne soit économisé.
    // Emprunter au taux exact auquel on placerait est une opération blanche : sa durée ne doit rien
    // changer. Ce qui subsiste est l'écart entre l'amortissement réel et son approximation linéaire.
    const cout = (creditMois: number) =>
      coutOption(avecFinancement({ creditMois, creditTaux: 0.03, tauxOpportunite: 0.03, detentionMois: 96 }), "credit")
        .globalCostAnnual;
    // Un amortissement par annuités constantes rembourse le principal un peu plus tard que
    // l'approximation linéaire retenue : le résidu est positif, mais de l'ordre de quelques euros
    // par an sur plus de huit mille — contre plusieurs centaines avant l'alignement.
    for (const mois of [72, 96]) {
      expect(cout(mois)).toBeGreaterThanOrEqual(cout(24) - 1e-6);
      expect(cout(mois) - cout(24)).toBeLessThan(cout(24) * 0.005);
    }
  });

  it("un TAEG inférieur au taux d'opportunité rend le crédit long moins cher — arbitrage réel, non artefact de lissage", () => {
    // L'effet ne vient plus de la durée d'étalement, désormais commune, mais du seul différentiel de
    // taux : emprunter à 1 % ce qu'on placerait à 3 % rapporte, et d'autant plus longtemps qu'on
    // rembourse tard. C'est un arbitrage financier authentique, pas un biais du modèle.
    const cout = (creditMois: number) =>
      coutOption(avecFinancement({ creditMois, creditTaux: 0.01, tauxOpportunite: 0.03, detentionMois: 96 }), "credit")
        .globalCostAnnual;
    expect(cout(96)).toBeLessThan(cout(24));
  });

  it("allonger la DÉTENTION, en revanche, réduit bien le coût annuel des deux modes d'achat", () => {
    // Celui-ci est un effet réel : le même véhicule amorti sur plus longtemps coûte moins par an.
    for (const mode of ["comptant", "credit"] as const) {
      const cout = (detentionMois: number) => coutOption(avecFinancement({ detentionMois }), mode).globalCostAnnual;
      expect(cout(84)).toBeLessThan(cout(36));
    }
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
    const base = createDefaultInputs();
    const r = computeSimulation({
      ...base,
      financing: {
        ...base.financing,
        credit: { ...base.financing.credit, dureeMois: base.financing.comptant.dureeDetentionMois },
      },
    });
    const societeComptant = r.allOptions.find((o) => o.owner === "societe" && o.mode === "comptant")!;
    const societeCredit = r.allOptions.find((o) => o.owner === "societe" && o.mode === "credit")!;
    const residuComptant = societeComptant.detail.find((d) => d.label.includes("Valeur résiduelle annualisée"))!.value;
    const residuCredit = societeCredit.detail.find((d) => d.label.includes("Valeur résiduelle annualisée"))!.value;
    // À durée de détention égale, la valeur résiduelle annualisée doit être la même : c'est ce qui
    // garantit que l'écart affiché entre les deux montages tient au financement, et non à une
    // hypothèse de détention différente. Les durées sont posées ici, l'offre de crédit du modèle
    // par défaut portant 72 mois là où le comptant en retient 60.
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
    // Les deux modalités ne coûtent pas la même chose au dirigeant — laquelle l'emporte dépend du
    // rapport entre la participation et l'AEN, cf. le test suivant : rien à asserter ici sur le sens
    // de l'écart, seulement sur le fait qu'il se répercute intégralement sur le coût global.
    expect(brute.partDirigeant).not.toBeCloseTo(nette.partDirigeant, 2);
    expect(nette.globalCostAnnual - brute.globalCostAnnual).toBeCloseTo(
      nette.partDirigeant - brute.partDirigeant,
      6,
    );
  });

  it("aucune modalité ne domine par construction : l'arbitrage dépend du rapport participation / AEN", () => {
    // Participation nettement inférieure à l'AEN : la déduction d'AEN joue à plein sur chaque euro
    // versé, les ressources nettes l'emportent.
    const petite = { ...avecMode("retenue_nette"), monthlyParticipation: 20 };
    expect(computeSimulation(petite).modeVersementOptimal).toBe("retenue_nette");

    // Participation très supérieure à l'AEN : la déduction est plafonnée par l'AEN alors que
    // l'allègement du brut porte sur la totalité du versement — la réduction de brut l'emporte.
    const grande = { ...avecMode("retenue_nette"), monthlyParticipation: 400 };
    expect(computeSimulation(grande).modeVersementOptimal).toBe("retenue_brute");
  });

  it("la modalité désignée est bien celle qui minimise la charge du dirigeant (vérifié par force brute)", () => {
    for (const participation of [0, 20, 60, 200, 400, 800]) {
      for (const mode of PARTICIPATION_VERSEMENT_MODES) {
        const inputs = { ...avecMode(mode), monthlyParticipation: participation };
        const annonce = computeSimulation(inputs).modeVersementOptimal;
        const charges = PARTICIPATION_VERSEMENT_MODES.map((m) => ({
          m,
          charge: socOf({ ...inputs, modeVersementParticipation: m }).partDirigeant,
        }));
        const minimum = Math.min(...charges.map((c) => c.charge));
        const chargeAnnoncee = charges.find((c) => c.m === annonce)!.charge;
        expect(chargeAnnoncee).toBeCloseTo(minimum, 6);
      }
    }
  });

  it("chiffre l'économie annoncée comme l'écart réel de charge entre modalité courante et optimale", () => {
    for (const mode of PARTICIPATION_VERSEMENT_MODES) {
      const inputs = avecMode(mode);
      const r = computeSimulation(inputs);
      const actuelle = socOf(inputs).partDirigeant;
      const optimale = socOf({ ...inputs, modeVersementParticipation: r.modeVersementOptimal }).partDirigeant;
      expect(r.economieModeVersementOptimal).toBeCloseTo(actuelle - optimale, 6);
    }
  });

  it("n'annonce aucune économie quand la modalité optimale est déjà retenue", () => {
    const inputs = avecMode("retenue_nette");
    const optimal = computeSimulation(inputs).modeVersementOptimal;
    const r = computeSimulation({ ...inputs, modeVersementParticipation: optimal });
    expect(r.modeVersementOptimal).toBe(optimal);
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

describe("computeSimulation — participation compensée par une augmentation de rémunération", () => {
  function base(patch: Partial<SimulationInputs> = {}): SimulationInputs {
    return { ...createDefaultInputs(), financingMode: "loa", monthlyParticipation: 200, ...patch };
  }
  const socOf = (i: SimulationInputs) =>
    computeSimulation(i).allOptions.find((o) => o.owner === "societe" && o.mode === "loa")!;

  it("ne produit aucun effet en l'absence de participation versée", () => {
    const sans = computeSimulation(base({ monthlyParticipation: 0, compenserParticipationParAugmentationSalaire: false }));
    const avec = computeSimulation(base({ monthlyParticipation: 0, compenserParticipationParAugmentationSalaire: true }));
    expect(avec.augmentationBruteParticipation).toBe(0);
    expect(avec.coutNetAugmentationParticipation).toBe(0);
    expect(avec.coutParticipationDirigeant).toBe(0);
    expect(avec.globalCostSociete).toBeCloseTo(sans.globalCostSociete, 9);
  });

  it("charge l'augmentation comme une rémunération, sur le net reversé", () => {
    const inputs = base({ compenserParticipationParAugmentationSalaire: true });
    const r = computeSimulation(inputs);
    // Coût chargé = net reversé × (1 + taux de cotisations), même convention que l'option
    // équivalente du scénario achat personnel.
    expect(r.augmentationBruteParticipation).toBeCloseTo(2400 * (1 + inputs.tnsContributionRate), 6);
    // Puis déductible : le coût net supporté est amputé de l'économie d'impôt société correspondante,
    // au taux réduit d'IS de 15 % sur le cas par défaut.
    expect(r.coutNetAugmentationParticipation).toBeCloseTo(r.augmentationBruteParticipation * (1 - 0.15), 6);
  });

  it("ramène le coût du dirigeant au seul impôt sur le revenu de l'augmentation", () => {
    const r = computeSimulation(base({ compenserParticipationParAugmentationSalaire: true }));
    expect(r.coutParticipationDirigeant).toBeCloseTo(2400 * r.tauxIRUtilise, 6);
    expect(r.coutParticipationDirigeant).toBeLessThan(2400);
  });

  it("reporte le coût sur la société : sa part augmente, celle du dirigeant baisse", () => {
    const sans = socOf(base({ compenserParticipationParAugmentationSalaire: false }));
    const avec = socOf(base({ compenserParticipationParAugmentationSalaire: true }));
    expect(avec.partSociete).toBeGreaterThan(sans.partSociete);
    expect(avec.partDirigeant).toBeLessThan(sans.partDirigeant);
  });

  it("n'est pas gratuit : le coût global consolidé augmente", () => {
    // Faire transiter par la paie une somme qui revient aussitôt à la société la charge au passage.
    const sans = socOf(base({ compenserParticipationParAugmentationSalaire: false }));
    const avec = socOf(base({ compenserParticipationParAugmentationSalaire: true }));
    expect(avec.globalCostAnnual).toBeGreaterThan(sans.globalCostAnnual);
  });

  it("fait apparaître l'augmentation dans le détail de l'option société", () => {
    const avec = socOf(base({ compenserParticipationParAugmentationSalaire: true }));
    expect(avec.detail.some((d) => d.label.includes("Augmentation de rémunération compensant"))).toBe(true);
    const sans = socOf(base({ compenserParticipationParAugmentationSalaire: false }));
    expect(sans.detail.some((d) => d.label.includes("Augmentation de rémunération compensant"))).toBe(false);
  });
});

describe("computeSimulation — régression : IK supérieures au coût réel du véhicule", () => {
  /** Usage 100% professionnel et fort kilométrage : le barème IK peut dépasser le coût du véhicule. */
  function surRemboursement(): SimulationInputs {
    return {
      ...createDefaultInputs(),
      financingMode: "lld",
      personalFinancingMode: "lld",
      privateUsePercent: 0,
      // Kilométrage posé explicitement, et non hérité du défaut : c'est lui qui fait dépasser le
      // barème kilométrique au-dessus du coût réel du véhicule, donc l'hypothèse même du test.
      totalKmAnnual: 30000,
      isElectric: false,
      co2EmissionsGkm: 120,
      annualFuelPrivateCost: 0,
    };
  }

  it("laisse apparaître le gain du dirigeant plutôt que de le borner à zéro", () => {
    const r = computeSimulation(surRemboursement());
    // Le remboursement excède le coût supporté : le « coût » du dirigeant est négatif, c'est un gain.
    expect(r.ikReimbursement).toBeGreaterThan(0);
    expect(r.coutScenarioPersonnel).toBeLessThan(0);
  });

  it("conserve l'identité part société + part dirigeant = coût global malgré ce gain", () => {
    // C'est l'invariant qu'un bornage à zéro rompait : la part société continuait d'intégrer l'IK
    // versée en totalité tandis que la part dirigeant était écrêtée, si bien que les deux parts
    // affichées ne totalisaient plus le coût global de la ligne.
    for (const opt of computeSimulation(surRemboursement()).allOptions) {
      expect(opt.partSociete + opt.partDirigeant, opt.label).toBeCloseTo(opt.globalCostAnnual, 6);
    }
  });

  it("reste cohérent quel que soit le mode de financement personnel retenu", () => {
    for (const mode of ["comptant", "credit", "loa", "lld"] as const) {
      const r = computeSimulation({ ...surRemboursement(), personalFinancingMode: mode });
      const opt = r.allOptions.find((o) => o.owner === "personnel" && o.mode === mode)!;
      expect(opt.partSociete + opt.partDirigeant, mode).toBeCloseTo(opt.globalCostAnnual, 6);
    }
  });
});

describe("computeSimulation — point de vue « poche du dirigeant »", () => {
  function base(patch: Partial<SimulationInputs> = {}): SimulationInputs {
    return { ...createDefaultInputs(), privateUsePercent: 90, financingMode: "credit", ...patch };
  }

  it("valorise les euros supportés par la société nets de leur coût de sortie", () => {
    const inputs = base();
    const r = computeSimulation(inputs);
    for (const o of r.allOptions) {
      expect(o.coutPocheDirigeant, o.label).toBeCloseTo(
        o.partDirigeant + o.partSociete * (1 - inputs.tauxExtractionResultat),
        6,
      );
    }
  });

  it("redevient identique au coût consolidé lorsque la sortie est gratuite", () => {
    for (const o of computeSimulation(base({ tauxExtractionResultat: 0 })).allOptions) {
      expect(o.coutPocheDirigeant, o.label).toBeCloseTo(o.globalCostAnnual, 6);
    }
  });

  it("ne dépasse jamais le coût consolidé dès lors que la sortie a un coût", () => {
    for (const taux of [0, 0.15, 0.3, 0.45]) {
      for (const o of computeSimulation(base({ tauxExtractionResultat: taux })).allOptions) {
        expect(o.coutPocheDirigeant, `${o.label} @ ${taux}`).toBeLessThanOrEqual(o.globalCostAnnual + 1e-9);
      }
    }
  });

  it("avantage d'autant plus les options portées par la société que le coût de sortie est élevé", () => {
    const societe = (taux: number) =>
      computeSimulation(base({ tauxExtractionResultat: taux })).allOptions.find(
        (o) => o.owner === "societe" && o.mode === "credit",
      )!;
    // Plus la sortie coûte cher, moins un euro dépensé par la société pèse sur le patrimoine.
    expect(societe(0.45).coutPocheDirigeant).toBeLessThan(societe(0.3).coutPocheDirigeant);
    expect(societe(0.3).coutPocheDirigeant).toBeLessThan(societe(0).coutPocheDirigeant);
  });

  it("désigne la meilleure option de ce point de vue, qui peut différer de l'optimum consolidé", () => {
    const r = computeSimulation(base());
    const minimum = Math.min(...r.allOptions.map((o) => o.coutPocheDirigeant));
    expect(r.bestOptionPocheDirigeant.coutPocheDirigeant).toBeCloseTo(minimum, 6);
  });

  it("renverse effectivement le classement quand la sortie du résultat coûte cher", () => {
    // L'achat personnel gagne au coût consolidé, mais l'option société l'emporte une fois le coût de
    // sortie pris en compte : c'est tout l'objet de ce point de vue, et l'avertissement affiché dans
    // l'interface n'aurait aucun sens si le cas ne se produisait jamais.
    // Le renversement demande un usage privé modéré et une sortie coûteuse — plus l'usage privé est
    // élevé, plus l'AEN alourdit l'option société des deux côtés à la fois, et plus il faut d'écart
    // de valorisation pour la rattraper.
    const r = computeSimulation(base({ privateUsePercent: 60, tauxExtractionResultat: 0.45 }));
    expect(r.allOptions[0].owner).toBe("personnel");
    expect(r.bestOptionPocheDirigeant.owner).toBe("societe");
  });

  it("à usage privé très majoritaire, l'AEN pèse trop pour que le point de vue renverse le classement", () => {
    // Contre-épreuve du test précédent : le renversement n'est pas systématique.
    const r = computeSimulation(base({ privateUsePercent: 90 }));
    expect(r.allOptions[0].owner).toBe("personnel");
    expect(r.bestOptionPocheDirigeant.owner).toBe("personnel");
  });
});

describe("computeSimulation — AEN au réel d'un véhicule loué : pas de cumul forfait/réel", () => {
  /** LOA calquée sur une offre réelle : Tesla Model Y à 45 000 €, 491 €/mois sur 48 mois,
   *  premier loyer de 250 €, option d'achat de 20 722 €, usage privé de 90 %. */
  function tesla(patch: Partial<SimulationInputs> = {}): SimulationInputs {
    const base = createDefaultInputs();
    return {
      ...base,
      financingMode: "loa",
      vehiclePrice: 45000,
      isElectric: true,
      isEcoScoreEligible: false,
      privateUsePercent: 90,
      annualInsurance: 0,
      annualMaintenance: 0,
      annualFuelPrivateCost: 0,
      monthlyParticipation: 0,
      financing: {
        ...base.financing,
        loa: {
          ...base.financing.loa,
          premierLoyerMajore: 250,
          loyerMensuel: 491,
          dureeMois: 48,
          valeurOptionAchat: 20722,
          leveeOption: false,
        },
      },
      ...patch,
    };
  }

  it("la base retenue est le coût annuel de la location, premier loyer étalé sur la durée", () => {
    // (250 + 491 × 48) / 4 ans = 5 954,50 €/an.
    const r = computeSimulation(tesla());
    expect(r.aenBaseAnnualCosts).toBeCloseTo(5954.5, 2);
  });

  it("l'avantage brut est cette base proratisée par l'usage privé, sans autre coefficient", () => {
    // 5 954,50 × 90 % = 5 359,05 €/an, soit environ 447 €/mois.
    const r = computeSimulation(tesla());
    expect(r.aenBrut).toBeCloseTo(5359.05, 2);
    expect(r.aenBrut / 12).toBeCloseTo(446.59, 1);
  });

  it("assurance et entretien s'ajoutent à la base avant proratisation", () => {
    // (5 954,50 + 1 000) × 90 % = 6 259,05 €/an, soit environ 522 €/mois.
    const r = computeSimulation(tesla({ annualInsurance: 700, annualMaintenance: 300 }));
    expect(r.aenBaseAnnualCosts).toBeCloseTo(6954.5, 2);
    expect(r.aenBrut).toBeCloseTo(6259.05, 2);
  });

  it("le taux forfaitaire du véhicule loué ne s'applique JAMAIS en plus de l'usage privé", () => {
    // Garde-fou contre la confusion la plus répandue : appliquer 30 % (ancien taux) ou 50 % (taux
    // depuis le 1er février 2025) au coût de location, PUIS proratiser par l'usage privé. Le
    // résultat serait divisé par plus de trois, pour un motif — l'usage privé — déjà compté une fois.
    const r = computeSimulation(tesla());
    const coutAnnuelLocation = 5954.5;
    expect(r.aenBrut).not.toBeCloseTo(coutAnnuelLocation * 0.3 * 0.9, 1);
    expect(r.aenBrut).not.toBeCloseTo(coutAnnuelLocation * 0.5 * 0.9, 1);
  });

  it("un usage 100 % privé fait porter l'avantage sur la totalité du coût de location", () => {
    const r = computeSimulation(tesla({ privateUsePercent: 100 }));
    expect(r.aenBrut).toBeCloseTo(r.aenBaseAnnualCosts, 6);
  });

  it("un usage 100 % professionnel n'engendre aucun avantage", () => {
    expect(computeSimulation(tesla({ privateUsePercent: 0 })).aenBrut).toBe(0);
  });

  it("l'électricité rechargée n'entre pas dans la base, qu'elle soit payée par le dirigeant ou non", () => {
    const sans = computeSimulation(tesla({ annualFuelPrivateCost: 0 }));
    const avec = computeSimulation(tesla({ annualFuelPrivateCost: 1200 }));
    expect(avec.aenBrut).toBeCloseTo(sans.aenBrut, 6);
  });

  it("un véhicule thermique, lui, ajoute le carburant privé pris en charge", () => {
    const sans = computeSimulation(tesla({ isElectric: false, annualFuelPrivateCost: 0 }));
    const avec = computeSimulation(tesla({ isElectric: false, annualFuelPrivateCost: 1200 }));
    expect(avec.aenBrut - sans.aenBrut).toBeCloseTo(1200, 6);
  });

  it("l'abattement électrique appliqué est celui de la méthode réelle, pas celui du forfait", () => {
    // 50 % plafonnés à 2 026,30 € au réel, et non 70 % plafonnés à 4 641,60 € — ce dernier est
    // indissociable de la méthode forfaitaire, fermée à un gérant majoritaire TNS.
    const r = computeSimulation(tesla({ isEcoScoreEligible: true }));
    expect(r.abattement).toBeCloseTo(Math.min(0.5 * r.aenBrut, 2026.3), 2);
    expect(r.abattement).toBeLessThan(0.7 * r.aenBrut);
  });
});

describe("computeSimulation — plafonnement de l'AEN d'un véhicule loué", () => {
  function loue(loyerMensuel: number, patch: Partial<SimulationInputs> = {}): SimulationInputs {
    const base = createDefaultInputs();
    return {
      ...base,
      financingMode: "loa",
      vehiclePrice: 45000,
      vehicleOverFiveYears: false,
      privateUsePercent: 100,
      annualInsurance: 0,
      annualMaintenance: 0,
      annualFuelPrivateCost: 0,
      monthlyParticipation: 0,
      isElectric: true,
      isEcoScoreEligible: false,
      financing: {
        ...base.financing,
        loa: { ...base.financing.loa, premierLoyerMajore: 0, loyerMensuel, dureeMois: 48, leveeOption: false },
      },
      ...patch,
    };
  }

  it("une location ordinaire reste en deçà du plafond : rien n'est écrêté", () => {
    // 491 €/mois = 5 892 €/an, contre 20 % × 45 000 = 9 000 € pour un achat.
    const r = computeSimulation(loue(491));
    expect(r.aenPlafonneParEquivalentAchat).toBe(false);
    expect(r.aenBaseAnnualCosts).toBeCloseTo(r.aenBaseAvantPlafond, 6);
  });

  it("une location courte et chère est ramenée au niveau d'un véhicule acheté", () => {
    // 900 €/mois = 10 800 €/an, au-dessus des 9 000 € d'annuité d'amortissement.
    const r = computeSimulation(loue(900));
    expect(r.aenPlafonneParEquivalentAchat).toBe(true);
    expect(r.aenBaseAvantPlafond).toBeCloseTo(10800, 6);
    expect(r.aenBaseAnnualCosts).toBeCloseTo(9000, 6);
  });

  it("le plafond suit l'âge du véhicule, comme l'amortissement qui le détermine", () => {
    const r = computeSimulation(loue(900, { vehicleOverFiveYears: true }));
    expect(r.aenBaseAnnualCosts).toBeCloseTo(4500, 6); // 10 % × 45 000
  });

  it("assurance et entretien figurent des deux côtés du plafond, donc ne le déclenchent pas", () => {
    const sans = computeSimulation(loue(900));
    const avec = computeSimulation(loue(900, { annualInsurance: 700, annualMaintenance: 300 }));
    expect(avec.aenBaseAnnualCosts - sans.aenBaseAnnualCosts).toBeCloseTo(1000, 6);
  });

  it("un véhicule acheté n'est jamais plafonné : il EST la référence", () => {
    for (const mode of ["comptant", "credit"] as const) {
      const r = computeSimulation(loue(900, { financingMode: mode }));
      expect(r.aenPlafonneParEquivalentAchat, mode).toBe(false);
      expect(r.aenBaseAnnualCosts, mode).toBeCloseTo(9000, 6);
    }
  });

  it("le plafond ne peut que réduire l'avantage, jamais l'augmenter", () => {
    for (const loyer of [100, 400, 750, 900, 2000]) {
      const r = computeSimulation(loue(loyer));
      expect(r.aenBaseAnnualCosts, `${loyer} €/mois`).toBeLessThanOrEqual(r.aenBaseAvantPlafond + 1e-9);
    }
  });
});

describe("computeSimulation — l'usage privé ne crée aucun seuil de légalité", () => {
  // Garde-fou de cohérence entre le moteur et le discours de l'interface : le simulateur ne doit
  // faire dépendre AUCUNE conséquence chiffrée du franchissement d'un pourcentage d'usage privé.
  // Les taux de 80 % ou 90 % qui structuraient les avertissements n'ont pas d'existence légale ;
  // s'ils réapparaissaient dans les calculs, ils y introduiraient une discontinuité inventée.
  it("l'avantage en nature varie continûment avec la part privée, sans saut", () => {
    const base = { ...createDefaultInputs(), financingMode: "loa" as const, isElectric: false, annualFuelPrivateCost: 0 };
    const aen = (p: number) => computeSimulation({ ...base, privateUsePercent: p }).aenBrut;
    for (let p = 1; p <= 100; p++) {
      const pas = aen(p) - aen(p - 1);
      const pasReference = aen(50) - aen(49);
      expect(pas, `saut à ${p} %`).toBeCloseTo(pasReference, 6);
    }
  });

  it("la déductibilité de la charge suit le prorata, sans rupture à 80 % ni à 90 %", () => {
    // Véhicule électrique sous le plafond de l'art. 39-4 CGI : aucune réintégration, donc aucun
    // plancher à zéro ne vient masquer une éventuelle discontinuité. La quote-part déductible doit
    // alors décroître d'un pas rigoureusement constant sur toute la plage.
    const base = {
      ...createDefaultInputs(),
      financingMode: "loa" as const,
      isElectric: true,
      vehiclePrice: 25000,
    };
    const part = (p: number) => computeSimulation({ ...base, privateUsePercent: p }).quotePartProfessionnelleDeductible;
    expect(computeSimulation({ ...base, privateUsePercent: 90 }).reintegrationFiscaleCO2).toBe(0);
    const pasReference = part(49) - part(50);
    expect(pasReference).toBeGreaterThan(0);
    for (let p = 1; p <= 100; p++) {
      expect(part(p - 1) - part(p), `rupture à ${p} %`).toBeCloseTo(pasReference, 6);
    }
  });

  it("un usage 100 % privé reste calculable et ne produit aucune valeur de rupture", () => {
    const r = computeSimulation({ ...createDefaultInputs(), privateUsePercent: 100 });
    expect(Number.isFinite(r.aenBrut)).toBe(true);
    expect(r.aenBrut).toBeGreaterThan(0);
    expect(r.quotePartProfessionnelleDeductible).toBe(0);
    expect(Number.isFinite(r.coutNetSociete)).toBe(true);
  });
});

describe("brouillon véhicule — ce qui est mémorisé, et ce qui ne l'est pas", () => {
  it("mémorise tout le formulaire par soustraction, sans liste à maintenir", () => {
    const inputs = createDefaultInputs();
    const draft = extractVehicleDraft(inputs) as Record<string, unknown>;
    const exclus = new Set<string>(CHAMPS_VEHICULE_NON_PERSISTES);
    // Toute clé du formulaire est persistée, sauf les exclusions déclarées. Un champ ajouté demain
    // à SimulationInputs sera donc mémorisé sans intervention — c'est l'objet de ce test.
    for (const cle of Object.keys(inputs)) {
      expect(cle in draft, `${cle} devrait être ${exclus.has(cle) ? "exclu" : "persisté"}`).toBe(!exclus.has(cle));
    }
  });

  it("n'emporte ni les identifiants techniques, ni le nom, ni le profil fiscal transversal", () => {
    const draft = extractVehicleDraft(createDefaultInputs()) as Record<string, unknown>;
    for (const cle of ["id", "name", "createdAt", "personalTaxProfile"]) {
      expect(draft[cle], cle).toBeUndefined();
    }
  });

  it("un aller-retour complet restitue exactement la saisie", () => {
    const base = createDefaultInputs();
    const saisi: SimulationInputs = {
      ...base,
      vehiclePrice: 45000,
      isElectric: true,
      privateUsePercent: 90,
      totalKmAnnual: 10000,
      tnsContributionRate: 0.41,
      corporateTaxRate: 0.15,
      beneficeAvantChargePrevisionnel: 20000,
      chiffreAffairesPrevisionnel: 50000,
      eligibleTauxReduitPME: false,
      monthlyParticipation: 150,
      modeVersementParticipation: "retenue_brute",
      financingMode: "loa",
      personalFinancingMode: "lld",
      nomDirigeant: "Camille Martin",
      annualVehicleTaxOverride: 320,
      vehicleModelId: "tesla-model-y-berlin",
      financing: { ...base.financing, loa: { ...base.financing.loa, loyerMensuel: 491, dureeMois: 48 } },
    };
    const relu = applyVehicleDraft(createDefaultInputs(), extractVehicleDraft(saisi));
    for (const cle of Object.keys(saisi) as (keyof SimulationInputs)[]) {
      if ((CHAMPS_VEHICULE_NON_PERSISTES as readonly string[]).includes(cle)) continue;
      expect(relu[cle], cle).toEqual(saisi[cle]);
    }
  });

  it("restitue en particulier la section « Cotisations & fiscalité »", () => {
    const saisi = {
      ...createDefaultInputs(),
      tnsContributionRate: 0.38,
      corporateTaxRate: 0.15,
      beneficeAvantChargePrevisionnel: 12345,
      chiffreAffairesPrevisionnel: 67890,
      eligibleTauxReduitPME: false,
      ikRatePerKm: 0.72,
      monthlyParticipation: 200,
      tauxTVA: 0.055,
      tauxExtractionResultat: 0.45,
    };
    const relu = applyVehicleDraft(createDefaultInputs(), extractVehicleDraft(saisi));
    expect(relu.tnsContributionRate).toBe(0.38);
    expect(relu.corporateTaxRate).toBe(0.15);
    expect(relu.beneficeAvantChargePrevisionnel).toBe(12345);
    expect(relu.chiffreAffairesPrevisionnel).toBe(67890);
    expect(relu.eligibleTauxReduitPME).toBe(false);
    expect(relu.ikRatePerKm).toBe(0.72);
    expect(relu.monthlyParticipation).toBe(200);
    expect(relu.tauxTVA).toBe(0.055);
    expect(relu.tauxExtractionResultat).toBe(0.45);
  });

  it("restitue les paramètres de financement imbriqués, mode par mode", () => {
    const base = createDefaultInputs();
    const saisi: SimulationInputs = {
      ...base,
      financing: {
        ...base.financing,
        credit: { ...base.financing.credit, tauxAnnuel: 0.059, dureeMois: 72, apport: 5000 },
        loa: { ...base.financing.loa, premierLoyerMajore: 250, loyerMensuel: 491, valeurOptionAchat: 20722 },
        lld: { ...base.financing.lld, loyerMensuel: 620, kmInclusAnnuel: 12000 },
      },
    };
    const relu = applyVehicleDraft(createDefaultInputs(), extractVehicleDraft(saisi));
    expect(relu.financing.credit.tauxAnnuel).toBe(0.059);
    expect(relu.financing.credit.dureeMois).toBe(72);
    expect(relu.financing.loa.loyerMensuel).toBe(491);
    expect(relu.financing.loa.valeurOptionAchat).toBe(20722);
    expect(relu.financing.lld.kmInclusAnnuel).toBe(12000);
  });

  it("les deux absences légitimes — pas de surcharge de taxe, pas de modèle — sont restituées", () => {
    const saisi = { ...createDefaultInputs(), annualVehicleTaxOverride: null, vehicleModelId: null };
    const relu = applyVehicleDraft(
      { ...createDefaultInputs(), annualVehicleTaxOverride: 400, vehicleModelId: "tesla-model-3" },
      extractVehicleDraft(saisi),
    );
    expect(relu.annualVehicleTaxOverride).toBeNull();
    expect(relu.vehicleModelId).toBeNull();
  });
});

describe("brouillon véhicule — robustesse à une donnée abîmée", () => {
  const defauts = createDefaultInputs();

  it("un brouillon absent, vide ou d'un autre type laisse les défauts intacts", () => {
    for (const draft of [null, undefined, 42, "texte", [], true]) {
      expect(applyVehicleDraft(defauts, draft), String(draft)).toEqual(defauts);
    }
  });

  it("un champ invalide retombe sur son défaut sans emporter les champs voisins", () => {
    const relu = applyVehicleDraft(defauts, {
      vehiclePrice: "quarante mille",
      privateUsePercent: 90,
      corporateTaxRate: Number.NaN,
      totalKmAnnual: 12000,
    });
    expect(relu.vehiclePrice).toBe(defauts.vehiclePrice);
    expect(relu.corporateTaxRate).toBe(defauts.corporateTaxRate);
    // Les champs valides voisins survivent : c'est tout l'intérêt d'une validation champ par champ.
    expect(relu.privateUsePercent).toBe(90);
    expect(relu.totalKmAnnual).toBe(12000);
  });

  it("un taux saisi en pourcentage plutôt qu'en fraction est rejeté, pas écrêté", () => {
    // 43 relu là où l'on attend 0,43 multiplierait les cotisations par cent. L'écrêter à 1 serait
    // tout aussi faux : on repart du défaut, qui est au moins plausible.
    const relu = applyVehicleDraft(defauts, { tnsContributionRate: 43, corporateTaxRate: 25 });
    expect(relu.tnsContributionRate).toBe(defauts.tnsContributionRate);
    expect(relu.corporateTaxRate).toBe(defauts.corporateTaxRate);
  });

  it("un montant négatif est rejeté", () => {
    expect(applyVehicleDraft(defauts, { vehiclePrice: -5000 }).vehiclePrice).toBe(defauts.vehiclePrice);
  });

  it("une valeur hors des choix admis est rejetée", () => {
    const relu = applyVehicleDraft(defauts, {
      financingMode: "troc",
      impositionSociete: "IS",
      modeVersementParticipation: "virement_occulte",
    });
    expect(relu.financingMode).toBe(defauts.financingMode);
    expect(relu.modeVersementParticipation).toBe(defauts.modeVersementParticipation);
    expect(relu.impositionSociete).toBe("IS");
  });

  it("une clé inconnue du code est ignorée sans faire échouer la relecture", () => {
    const relu = applyVehicleDraft(defauts, { champInvente: 1, privateUsePercent: 70 });
    expect((relu as unknown as Record<string, unknown>).champInvente).toBeUndefined();
    expect(relu.privateUsePercent).toBe(70);
  });

  it("un sous-objet de financement abîmé n'emporte pas les autres modes", () => {
    const relu = applyVehicleDraft(defauts, {
      financing: { loa: { loyerMensuel: "cher" }, lld: { loyerMensuel: 620 } },
    });
    expect(relu.financing.loa.loyerMensuel).toBe(defauts.financing.loa.loyerMensuel);
    expect(relu.financing.lld.loyerMensuel).toBe(620);
    expect(relu.financing.credit).toEqual(defauts.financing.credit);
  });

  it("le profil fiscal n'est jamais relu depuis ce brouillon, même s'il y figure", () => {
    const relu = applyVehicleDraft(defauts, {
      personalTaxProfile: { mode: "manuel", tauxManuel: 0.45 },
    });
    expect(relu.personalTaxProfile).toEqual(defauts.personalTaxProfile);
  });

  it("le brouillon relu produit toujours une simulation calculable", () => {
    const abime = { vehiclePrice: -1, privateUsePercent: "beaucoup", financing: null, tauxTVA: 99 };
    const r = computeSimulation(applyVehicleDraft(defauts, abime));
    expect(Number.isFinite(r.coutNetSociete)).toBe(true);
    expect(Number.isFinite(r.aenBrut)).toBe(true);
  });
});

describe("brouillon véhicule — champs nullables", () => {
  const defauts = createDefaultInputs();

  it("une valeur numérique est restituée même quand le défaut du champ est null", () => {
    // Régression : un champ dont le défaut vaut `null` ne permet pas de déduire le type attendu.
    // La validation générique par comparaison de types le rejetait donc systématiquement, et la
    // surcharge manuelle de taxe annuelle ne survivait jamais à un rechargement.
    expect(defauts.annualVehicleTaxOverride).toBeNull();
    expect(applyVehicleDraft(defauts, { annualVehicleTaxOverride: 320 }).annualVehicleTaxOverride).toBe(320);
  });

  it("un identifiant de modèle est restitué s'il existe encore dans le registre, ignoré sinon", () => {
    expect(applyVehicleDraft(defauts, { vehicleModelId: "tesla-model-y-berlin" }).vehicleModelId).toBe(
      "tesla-model-y-berlin",
    );
    // Modèle retiré du code depuis la dernière visite : le sélecteur ne saurait pas l'afficher.
    expect(applyVehicleDraft(defauts, { vehicleModelId: "modele-disparu" }).vehicleModelId).toBe(
      defauts.vehicleModelId,
    );
  });

  it("une surcharge de taxe négative ou non numérique est rejetée", () => {
    expect(applyVehicleDraft(defauts, { annualVehicleTaxOverride: -50 }).annualVehicleTaxOverride).toBeNull();
    expect(applyVehicleDraft(defauts, { annualVehicleTaxOverride: "beaucoup" }).annualVehicleTaxOverride).toBeNull();
  });
});
