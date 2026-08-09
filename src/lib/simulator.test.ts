import { describe, expect, it } from "vitest";
import { type SimulationInputs, computeSimulation, createDefaultInputs } from "./simulator";

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
    const coutBrutAvantIk = r.personalFinancingAnnual + createDefaultInputs().annualInsurance + createDefaultInputs().annualMaintenance;
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

  it("en revanche, le décaissement réel société augmente bien avec l'option levée (coût cash réel)", () => {
    const base: SimulationInputs = { ...createDefaultInputs(), financingMode: "loa" };
    const sansOption = computeSimulation(withFinancingLoa(base, { leveeOption: false }));
    const avecOption = computeSimulation(withFinancingLoa(base, { leveeOption: true }));

    expect(avecOption.companyCashBaseAnnual).toBeGreaterThan(sansOption.companyCashBaseAnnual);
    expect(avecOption.globalCostSociete).toBeGreaterThan(sansOption.globalCostSociete);
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
