import { describe, expect, it } from "vitest";
import { estimateAnnualVehicleTax, getPlafondAmortissementDeductible } from "./vehicleTaxes";

describe("getPlafondAmortissementDeductible", () => {
  it("30 000€ pour un véhicule électrique, quel que soit le CO2 saisi", () => {
    expect(getPlafondAmortissementDeductible(150, true)).toBe(30000);
    expect(getPlafondAmortissementDeductible(0, true)).toBe(30000);
  });

  it("respecte les 4 paliers CO2 pour un véhicule thermique", () => {
    expect(getPlafondAmortissementDeductible(10, false)).toBe(30000);
    expect(getPlafondAmortissementDeductible(19, false)).toBe(30000);
    expect(getPlafondAmortissementDeductible(20, false)).toBe(20300);
    expect(getPlafondAmortissementDeductible(49, false)).toBe(20300);
    expect(getPlafondAmortissementDeductible(50, false)).toBe(18300);
    expect(getPlafondAmortissementDeductible(160, false)).toBe(18300);
    expect(getPlafondAmortissementDeductible(161, false)).toBe(9900);
    expect(getPlafondAmortissementDeductible(300, false)).toBe(9900);
  });
});

describe("estimateAnnualVehicleTax", () => {
  it("exonération totale pour un véhicule électrique", () => {
    expect(estimateAnnualVehicleTax(150, true)).toBe(0);
  });

  it("aucune taxe sous le seuil d'exonération (20g/km)", () => {
    expect(estimateAnnualVehicleTax(0, false)).toBe(0);
    expect(estimateAnnualVehicleTax(20, false)).toBe(0);
  });

  it("est strictement croissante avec les émissions de CO2", () => {
    const valeurs = [30, 60, 90, 110, 140, 170, 200].map((co2) => estimateAnnualVehicleTax(co2, false));
    for (let i = 1; i < valeurs.length; i++) {
      expect(valeurs[i]).toBeGreaterThan(valeurs[i - 1]);
    }
  });

  it("plafonne à 3000€ pour les très fortes émissions", () => {
    expect(estimateAnnualVehicleTax(250, false)).toBeCloseTo(3000, 6);
    expect(estimateAnnualVehicleTax(500, false)).toBeCloseTo(3000, 6);
  });

  it("ne retourne jamais de valeur négative pour un CO2 négatif saisi par erreur", () => {
    expect(estimateAnnualVehicleTax(-10, false)).toBeGreaterThanOrEqual(0);
  });
});
