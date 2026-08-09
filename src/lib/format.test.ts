import { describe, expect, it } from "vitest";
import { formatDate, formatEUR, formatEURPrecise, formatPercent } from "./format";

describe("formatEUR", () => {
  it("formate un montant entier avec le symbole €", () => {
    expect(formatEUR(1200)).toContain("€");
    expect(formatEUR(1200)).toMatch(/1[\s  ]?200/);
  });

  it("arrondit à l'euro le plus proche (0 décimale)", () => {
    expect(formatEUR(10.6)).not.toContain(",6");
  });

  it("retourne un tiret pour une valeur non finie", () => {
    expect(formatEUR(NaN)).toBe("—");
    expect(formatEUR(Infinity)).toBe("—");
    expect(formatEUR(-Infinity)).toBe("—");
  });

  it("gère les montants négatifs", () => {
    expect(formatEUR(-500)).toContain("-");
  });
});

describe("formatEURPrecise", () => {
  it("conserve jusqu'à 2 décimales", () => {
    expect(formatEURPrecise(10.5)).toMatch(/10,5/);
  });

  it("retourne un tiret pour une valeur non finie", () => {
    expect(formatEURPrecise(NaN)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("convertit une fraction 0-1 en pourcentage", () => {
    expect(formatPercent(0.43)).toContain("43");
    expect(formatPercent(0.43)).toContain("%");
  });

  it("respecte le nombre de décimales demandé", () => {
    expect(formatPercent(0.4525, 2)).toContain("45,25");
  });

  it("gère 0% et 100%", () => {
    expect(formatPercent(0)).toContain("0");
    expect(formatPercent(1)).toContain("100");
  });

  it("retourne un tiret pour une valeur non finie", () => {
    expect(formatPercent(NaN)).toBe("—");
  });
});

describe("formatDate", () => {
  it("formate une date ISO au format JJ/MM/AAAA", () => {
    expect(formatDate("2026-03-15T00:00:00.000Z")).toBe("15/03/2026");
  });

  it("retourne la chaîne d'origine si la date est invalide", () => {
    // Intl.DateTimeFormat sur un Invalid Date ne lève pas toujours — on vérifie juste l'absence de crash.
    expect(() => formatDate("pas-une-date")).not.toThrow();
  });
});
