import { describe, expect, it } from "vitest";
import {
  IS_SEUIL_TAUX_REDUIT,
  IS_TAUX_REDUIT,
  type CompanyTaxContext,
  computeEconomieImpotIS,
  computeEconomieImpotSociete,
  computeIS,
} from "./corporateTax";

describe("computeIS", () => {
  it("applique le taux normal uniquement si non éligible au taux réduit", () => {
    expect(computeIS(100000, false, 0.25)).toBeCloseTo(25000, 6);
  });

  it("applique le barème progressif 15%/25% si éligible", () => {
    // Entièrement dans la tranche réduite.
    expect(computeIS(30000, true, 0.25)).toBeCloseTo(30000 * IS_TAUX_REDUIT, 6);
    // À cheval sur les deux tranches.
    const benefice = 100000;
    const attendu = IS_SEUIL_TAUX_REDUIT * IS_TAUX_REDUIT + (benefice - IS_SEUIL_TAUX_REDUIT) * 0.25;
    expect(computeIS(benefice, true, 0.25)).toBeCloseTo(attendu, 6);
  });

  it("un bénéfice négatif ou nul ne génère aucun IS", () => {
    expect(computeIS(0, true, 0.25)).toBe(0);
    expect(computeIS(-5000, true, 0.25)).toBe(0);
  });
});

describe("computeEconomieImpotIS", () => {
  it("économie = charge × taux réduit quand tout reste dans la tranche à 15%", () => {
    const economie = computeEconomieImpotIS(40000, 5000, true, 0.25);
    expect(economie).toBeCloseTo(5000 * IS_TAUX_REDUIT, 6);
  });

  it("économie à cheval sur les deux tranches (marginal, pas un taux moyen)", () => {
    // Bénéfice 45 000€, charge 5 000€ : la charge retire les 5 000 derniers euros, qui sont
    // à cheval sur la tranche à 25% (42 500 → 45 000, soit 2 500€) et à 15% (2 500€ restants).
    const economie = computeEconomieImpotIS(45000, 5000, true, 0.25);
    const attendu = 2500 * 0.25 + 2500 * IS_TAUX_REDUIT;
    expect(economie).toBeCloseTo(attendu, 6);
  });

  it("plafonne l'économie au montant d'IS réellement dû (société peu profitable)", () => {
    // Bénéfice de 3 000€ avant charge, charge déductible de 10 000€ : la société ne peut pas
    // « économiser » plus que l'IS qu'elle aurait payé sur son bénéfice réel.
    const economie = computeEconomieImpotIS(3000, 10000, true, 0.25);
    expect(economie).toBeCloseTo(3000 * IS_TAUX_REDUIT, 6);
  });

  it("une société déjà déficitaire ne génère aucune économie d'impôt immédiate", () => {
    const economie = computeEconomieImpotIS(0, 5000, true, 0.25);
    expect(economie).toBe(0);
    const economieNegatif = computeEconomieImpotIS(-2000, 5000, true, 0.25);
    expect(economieNegatif).toBe(0);
  });

  it("l'économie ne peut jamais être négative", () => {
    const economie = computeEconomieImpotIS(50000, 0, true, 0.25);
    expect(economie).toBe(0);
  });
});

describe("computeEconomieImpotSociete", () => {
  const ctxIS: CompanyTaxContext = {
    impositionSociete: "IS",
    beneficeAvantChargePrevisionnel: 40000,
    eligibleTauxReduitPME: true,
    corporateTaxRate: 0.25,
  };

  it("régime IS : délègue à computeEconomieImpotIS (barème progressif + plafonnement)", () => {
    const viaHelper = computeEconomieImpotSociete(ctxIS, 5000, 0.3);
    const viaDirect = computeEconomieImpotIS(40000, 5000, true, 0.25);
    expect(viaHelper).toBeCloseTo(viaDirect, 6);
  });

  it("régime IS : le taux IR passé en paramètre est ignoré (utilise le barème IS, pas le TMI foyer)", () => {
    const avecTaux10 = computeEconomieImpotSociete(ctxIS, 5000, 0.1);
    const avecTaux45 = computeEconomieImpotSociete(ctxIS, 5000, 0.45);
    expect(avecTaux10).toBeCloseTo(avecTaux45, 6);
  });

  it("régime IR (société translucide) : économie = charge × taux marginal du foyer, sans barème IS", () => {
    const ctxIR: CompanyTaxContext = { ...ctxIS, impositionSociete: "IR" };
    expect(computeEconomieImpotSociete(ctxIR, 5000, 0.3)).toBeCloseTo(5000 * 0.3, 6);
    expect(computeEconomieImpotSociete(ctxIR, 5000, 0)).toBe(0);
  });

  it("régime IR : le bénéfice/taux réduit du contexte IS sont sans effet", () => {
    const ctxIR: CompanyTaxContext = { ...ctxIS, impositionSociete: "IR", beneficeAvantChargePrevisionnel: 0, eligibleTauxReduitPME: false };
    expect(computeEconomieImpotSociete(ctxIR, 5000, 0.3)).toBeCloseTo(5000 * 0.3, 6);
  });
});
