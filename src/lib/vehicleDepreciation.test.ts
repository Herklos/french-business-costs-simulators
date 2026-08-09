import { describe, expect, it } from "vitest";
import { DEFAULT_DEPRECIATION_RATE_ANNUAL, estimateResidualValue } from "./vehicleDepreciation";

describe("estimateResidualValue", () => {
  it("vaut le prix TTC à l'âge 0", () => {
    expect(estimateResidualValue(45000, 0)).toBe(45000);
  });

  it("décroît de façon composée avec le taux par défaut", () => {
    const v1 = estimateResidualValue(45000, 1);
    expect(v1).toBeCloseTo(45000 * (1 - DEFAULT_DEPRECIATION_RATE_ANNUAL), 6);
  });

  it("est strictement décroissante avec l'âge", () => {
    const valeurs = [0, 1, 2, 3, 4, 5].map((age) => estimateResidualValue(45000, age));
    for (let i = 1; i < valeurs.length; i++) {
      expect(valeurs[i]).toBeLessThan(valeurs[i - 1]);
    }
  });

  it("ne devient jamais négative même sur une longue durée", () => {
    expect(estimateResidualValue(45000, 50)).toBeGreaterThanOrEqual(0);
  });

  it("un taux de dépréciation de 0% conserve la valeur intacte", () => {
    expect(estimateResidualValue(45000, 5, 0)).toBe(45000);
  });

  it("un taux de dépréciation de 100% annule la valeur dès la première année", () => {
    expect(estimateResidualValue(45000, 1, 1)).toBe(0);
  });

  it("un prix nul ou négatif donne une valeur résiduelle nulle", () => {
    expect(estimateResidualValue(0, 3)).toBe(0);
    expect(estimateResidualValue(-1000, 3)).toBe(0);
  });
});
