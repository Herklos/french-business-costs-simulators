import { describe, expect, it } from "vitest";
import {
  LOYERS_VILLES,
  LOYER_M2_DEFAUT_AUTRE,
  VILLE_AUTRE,
  findLoyerVille,
  loyerAnnuelLogement,
  prixM2Ville,
} from "./loyersVille";

describe("LOYERS_VILLES — cohérence de la table de référence", () => {
  it("les identifiants sont uniques", () => {
    const ids = LOYERS_VILLES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("aucune ville ne porte l'identifiant réservé à la saisie manuelle", () => {
    expect(LOYERS_VILLES.some((v) => v.id === VILLE_AUTRE)).toBe(false);
  });

  it("tous les prix au m² sont strictement positifs et plausibles (5 à 50 €/m²/mois)", () => {
    for (const v of LOYERS_VILLES) {
      expect(v.prixM2Mensuel).toBeGreaterThanOrEqual(5);
      expect(v.prixM2Mensuel).toBeLessThanOrEqual(50);
    }
  });

  it("la liste est triée par prix décroissant, pour situer sa ville d'un coup d'œil", () => {
    for (let i = 1; i < LOYERS_VILLES.length; i++) {
      expect(LOYERS_VILLES[i].prixM2Mensuel).toBeLessThanOrEqual(LOYERS_VILLES[i - 1].prixM2Mensuel);
    }
  });

  it("Paris est la ville la plus chère de la table", () => {
    expect(LOYERS_VILLES[0].id).toBe("paris");
  });
});

describe("prixM2Ville", () => {
  it("retourne le prix référencé pour une ville connue", () => {
    expect(prixM2Ville("lyon")).toBe(findLoyerVille("lyon")?.prixM2Mensuel);
  });

  it("retombe sur la valeur nationale par défaut pour une ville inconnue", () => {
    expect(prixM2Ville(VILLE_AUTRE)).toBe(LOYER_M2_DEFAUT_AUTRE);
    expect(prixM2Ville("ville-inexistante")).toBe(LOYER_M2_DEFAUT_AUTRE);
  });
});

describe("loyerAnnuelLogement", () => {
  it("annualise le prix au m² mensuel sur la surface totale", () => {
    expect(loyerAnnuelLogement(16, 80)).toBe(16 * 80 * 12);
  });

  it("neutralise les valeurs négatives plutôt que de produire un loyer négatif", () => {
    expect(loyerAnnuelLogement(-16, 80)).toBe(0);
    expect(loyerAnnuelLogement(16, -80)).toBe(0);
  });

  it("surface nulle : loyer nul", () => {
    expect(loyerAnnuelLogement(16, 0)).toBe(0);
  });
});
