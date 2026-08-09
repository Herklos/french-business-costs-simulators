import { describe, expect, it } from "vitest";
import { COUNTRIES, DEFAULT_COUNTRY, getCountry } from "./countries";

describe("countries", () => {
  it("seule la France est disponible pour l'instant", () => {
    const disponibles = COUNTRIES.filter((c) => c.available);
    expect(disponibles).toHaveLength(1);
    expect(disponibles[0].code).toBe("FR");
  });

  it("le pays par défaut est bien disponible", () => {
    const defaut = getCountry(DEFAULT_COUNTRY);
    expect(defaut.available).toBe(true);
  });

  it("retourne la France par défaut pour un code inconnu", () => {
    expect(getCountry("XX").code).toBe("FR");
  });
});
