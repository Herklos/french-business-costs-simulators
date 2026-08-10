import { describe, expect, it } from "vitest";
import { type HomeOfficeInputs, computeHomeOffice, createDefaultHomeOfficeInputs } from "./homeOffice";

function disableCharge(inputs: HomeOfficeInputs, id: string): HomeOfficeInputs {
  return { ...inputs, chargeLines: inputs.chargeLines.map((c) => (c.id === id ? { ...c, enabled: false } : c)) };
}

describe("computeHomeOffice — quote-part et charges", () => {
  it("la quote-part de surface est bornée à 100% même si le bureau dépasse le logement", () => {
    const inputs = { ...createDefaultHomeOfficeInputs(), surfaceTotaleM2: 50, surfaceBureauM2: 80 };
    const r = computeHomeOffice(inputs);
    expect(r.quotePartSurface).toBe(1);
  });

  it("surface totale nulle : quote-part nulle (division par zéro évitée)", () => {
    const inputs = { ...createDefaultHomeOfficeInputs(), surfaceTotaleM2: 0, surfaceBureauM2: 12 };
    const r = computeHomeOffice(inputs);
    expect(r.quotePartSurface).toBe(0);
    expect(r.indemniteAnnuelleBrute).toBe(0);
  });

  it("désactiver un poste de charge réduit l'indemnité annuelle brute", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const avecTout = computeHomeOffice(inputs);
    const sansElectricite = computeHomeOffice(disableCharge(inputs, "electricite"));
    expect(sansElectricite.indemniteAnnuelleBrute).toBeLessThan(avecTout.indemniteAnnuelleBrute);
  });

  it("désactiver toutes les charges donne une indemnité nulle", () => {
    let inputs = createDefaultHomeOfficeInputs();
    for (const c of inputs.chargeLines) {
      inputs = disableCharge(inputs, c.id);
    }
    const r = computeHomeOffice(inputs);
    expect(r.indemniteAnnuelleBrute).toBe(0);
    expect(r.totalChargesRetenuesAnnuel).toBe(0);
  });

  it("l'indemnité brute = charges retenues × quote-part de surface", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const r = computeHomeOffice(inputs);
    expect(r.indemniteAnnuelleBrute).toBeCloseTo(r.totalChargesRetenuesAnnuel * r.quotePartSurface, 6);
  });
});

describe("computeHomeOffice — régime micro-foncier / réel", () => {
  it("bascule automatiquement en régime réel si le plafond micro-foncier (15 000€) est dépassé", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      regimeFoncier: "micro",
      autresRevenusFonciersFoyer: 20000, // dépasse déjà le plafond à lui seul
    };
    const r = computeHomeOffice(inputs);
    expect(r.eligibleMicroFoncier).toBe(false);
  });

  it("le régime micro-foncier applique un abattement de 30% sur l'indemnité brute", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      regimeFoncier: "micro",
      autresRevenusFonciersFoyer: 0,
    };
    const r = computeHomeOffice(inputs);
    expect(r.abattementApplique).toBeCloseTo(r.indemniteAnnuelleBrute * 0.3, 6);
    expect(r.baseImposableFonciere).toBeCloseTo(r.indemniteAnnuelleBrute * 0.7, 6);
  });
});

describe("computeHomeOffice — formalisation bail professionnel", () => {
  it("les frais de mise en place n'affectent que le gain net de la 1ère année, pas le gain récurrent", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      formalisation: "bail_professionnel",
      fraisMiseEnPlaceBail: 500,
    };
    const r = computeHomeOffice(inputs);
    expect(r.gainNetGerantAnnee1).toBeCloseTo(r.gainNetGerant - 500, 6);
  });

  it("les frais de mise en place sont ignorés si la formalisation est une simple indemnité", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      formalisation: "indemnite",
      fraisMiseEnPlaceBail: 500,
    };
    const r = computeHomeOffice(inputs);
    expect(r.gainNetGerantAnnee1).toBeCloseTo(r.gainNetGerant, 6);
  });
});

describe("computeHomeOffice — régime IS et bénéfice prévisionnel", () => {
  it("une société déficitaire (régime IS) ne génère aucune économie d'impôt immédiate", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IS",
      beneficeAvantChargePrevisionnel: 0,
    };
    const r = computeHomeOffice(inputs);
    expect(r.economieImpotSociete).toBe(0);
  });

  it("coût net société = indemnité brute − économie d'impôt", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetSociete).toBeCloseTo(r.indemniteAnnuelleBrute - r.economieImpotSociete, 6);
  });
});

describe("computeHomeOffice — coût net global (société + dirigeant ensemble)", () => {
  it("coutNetGlobal = coût fiscal dirigeant − économie d'impôt société", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetGlobal).toBeCloseTo(r.coutFiscalGerant - r.economieImpotSociete, 6);
  });

  it("coutNetGlobal = coutNetSociete − gainNetGerant (les deux formulations coïncident)", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetGlobal).toBeCloseTo(r.coutNetSociete - r.gainNetGerant, 6);
  });

  it("indemnité nulle : coût net global nul", () => {
    let inputs = createDefaultHomeOfficeInputs();
    for (const c of inputs.chargeLines) {
      inputs = disableCharge(inputs, c.id);
    }
    const r = computeHomeOffice(inputs);
    expect(r.coutNetGlobal).toBe(0);
  });
});

describe("computeHomeOffice — comparaison bureau externe : bail classique vs coworking", () => {
  it("régime location : coût annuel = loyer mensuel × 12", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "location",
      loyerBureauExterneMensuel: 400,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(4800, 6);
  });

  it("régime coworking : coût annuel = tarif journalier × jours/mois × 12", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "coworking",
      coworkingTarifJournalier: 25,
      coworkingJoursParMois: 20,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(25 * 20 * 12, 6);
  });

  it("le champ loyer mensuel est ignoré en mode coworking", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "coworking",
      loyerBureauExterneMensuel: 999999,
      coworkingTarifJournalier: 25,
      coworkingJoursParMois: 20,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(25 * 20 * 12, 6);
  });
});

describe("computeHomeOffice — régime IR (société translucide)", () => {
  it("utilise le taux marginal manuel du foyer plutôt que le barème IS pour l'économie société", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IR",
      beneficeAvantChargePrevisionnel: 40000,
      personalTaxProfile: { ...createDefaultHomeOfficeInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    };
    const r = computeHomeOffice(inputs);
    expect(r.economieImpotSociete).toBeCloseTo(r.indemniteAnnuelleBrute * 0.3, 6);
  });

  it("en régime IR, le bénéfice prévisionnel de la société s'ajoute au revenu du foyer pour le calcul du TMI", () => {
    const base: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IR",
      personalTaxProfile: { ...createDefaultHomeOfficeInputs().personalTaxProfile, mode: "calcule" },
    };
    const faibleBenefice = computeHomeOffice({ ...base, beneficeAvantChargePrevisionnel: 5000 });
    const fortBenefice = computeHomeOffice({ ...base, beneficeAvantChargePrevisionnel: 200000 });
    expect(fortBenefice.tauxIRUtilise).toBeGreaterThan(faibleBenefice.tauxIRUtilise);
  });
});
