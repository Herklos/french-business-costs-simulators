import { describe, expect, it } from "vitest";
import {
  BANDES_SURFACE_BUREAU,
  FORFAIT_TELETRAVAIL_MENSUEL_AVEC_ACCORD,
  FORFAIT_TELETRAVAIL_MENSUEL_SANS_ACCORD,
  LOYER_ANNUEL_M2_PRUDENT,
  SOURCES_SEUIL_SURFACE,
  bandeSurfaceBureau,
} from "./surfaceBureau";
import { TOLERANCE_SURFACE_BUREAU_DEFAUT } from "./homeOffice";

describe("BANDES_SURFACE_BUREAU — cohérence de l'échelle", () => {
  it("les identifiants sont uniques", () => {
    const ids = BANDES_SURFACE_BUREAU.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("les bornes sont strictement croissantes et couvrent tout l'intervalle [0, 1]", () => {
    for (let i = 1; i < BANDES_SURFACE_BUREAU.length; i++) {
      expect(BANDES_SURFACE_BUREAU[i].max).toBeGreaterThan(BANDES_SURFACE_BUREAU[i - 1].max);
    }
    expect(BANDES_SURFACE_BUREAU[0].max).toBeGreaterThan(0);
    expect(BANDES_SURFACE_BUREAU[BANDES_SURFACE_BUREAU.length - 1].max).toBe(1);
  });

  it("la sévérité ne redescend jamais quand la quote-part monte", () => {
    const severite = { good: 0, neutral: 1, warn: 2, bad: 3 };
    for (let i = 1; i < BANDES_SURFACE_BUREAU.length; i++) {
      expect(severite[BANDES_SURFACE_BUREAU[i].ton]).toBeGreaterThanOrEqual(
        severite[BANDES_SURFACE_BUREAU[i - 1].ton],
      );
    }
  });

  it("chaque bande est documentée (libellé court, résumé et détail)", () => {
    for (const b of BANDES_SURFACE_BUREAU) {
      expect(b.label.length, b.id).toBeGreaterThan(2);
      expect(b.label.length, b.id).toBeLessThan(20);
      expect(b.resume.length, b.id).toBeGreaterThan(30);
      expect(b.detail.length, b.id).toBeGreaterThan(100);
    }
  });

  it("le seuil par défaut du simulateur coïncide avec une borne de bande", () => {
    // Sinon la jauge afficherait un repère au milieu d'une bande, sans correspondance avec le
    // vocabulaire employé juste en dessous.
    expect(BANDES_SURFACE_BUREAU.some((b) => b.max === TOLERANCE_SURFACE_BUREAU_DEFAUT)).toBe(true);
  });
});

describe("bandeSurfaceBureau", () => {
  it("classe les quote-parts usuelles dans la bande la plus rassurante", () => {
    // Exemples repris par la doctrine et l'URSSAF : 10 m²/70 m², 15 m²/100 m².
    expect(bandeSurfaceBureau(10 / 70).id).toBe("usuel");
    expect(bandeSurfaceBureau(15 / 100).id).toBe("usuel");
  });

  it("classe une pièce entière dans un logement moyen en « courant »", () => {
    expect(bandeSurfaceBureau(15 / 75).id).toBe("courant"); // 20 %
    expect(bandeSurfaceBureau(0.3).id).toBe("courant");
  });

  it("bascule en « à documenter » juste au-dessus du seuil de pratique", () => {
    expect(bandeSurfaceBureau(0.301).id).toBe("a-documenter");
    expect(bandeSurfaceBureau(0.5).id).toBe("a-documenter");
  });

  it("bascule en « risqué » au-delà de la moitié du logement", () => {
    expect(bandeSurfaceBureau(0.51).id).toBe("risque");
    expect(bandeSurfaceBureau(0.9).id).toBe("risque");
  });

  it("réserve « exclu » à la location du logement entier", () => {
    expect(bandeSurfaceBureau(1).id).toBe("exclu");
    expect(bandeSurfaceBureau(0.99).id).toBe("risque");
  });

  it("les bornes sont incluses dans leur bande, jamais dans la suivante", () => {
    for (const b of BANDES_SURFACE_BUREAU) {
      expect(bandeSurfaceBureau(b.max).id, `borne ${b.max}`).toBe(b.id);
    }
  });

  it("ramène les valeurs hors bornes plutôt que de renvoyer undefined", () => {
    expect(bandeSurfaceBureau(-1).id).toBe("usuel");
    expect(bandeSurfaceBureau(5).id).toBe("exclu");
    expect(bandeSurfaceBureau(0).id).toBe("usuel");
  });

  it("retourne toujours une bande, quelle que soit la valeur testée", () => {
    for (let v = 0; v <= 1.0001; v += 0.01) {
      expect(bandeSurfaceBureau(v), String(v)).toBeDefined();
    }
  });
});

describe("repères chiffrés", () => {
  it("le forfait télétravail avec accord collectif est supérieur à celui sans accord", () => {
    expect(FORFAIT_TELETRAVAIL_MENSUEL_AVEC_ACCORD).toBeGreaterThan(FORFAIT_TELETRAVAIL_MENSUEL_SANS_ACCORD);
  });

  it("les forfaits télétravail correspondent à 22 jours au barème URSSAF", () => {
    expect(FORFAIT_TELETRAVAIL_MENSUEL_SANS_ACCORD).toBeCloseTo(2.7 * 22, 2);
    expect(FORFAIT_TELETRAVAIL_MENSUEL_AVEC_ACCORD).toBeCloseTo(3.3 * 22, 2);
  });

  it("le repère de loyer prudent reste dans un ordre de grandeur plausible", () => {
    expect(LOYER_ANNUEL_M2_PRUDENT).toBeGreaterThan(50);
    expect(LOYER_ANNUEL_M2_PRUDENT).toBeLessThan(600);
  });
});

describe("SOURCES_SEUIL_SURFACE", () => {
  it("chaque source a un libellé, une note et une URL exploitable", () => {
    for (const s of SOURCES_SEUIL_SURFACE) {
      expect(s.label.length, s.url).toBeGreaterThan(10);
      expect(s.note.length, s.url).toBeGreaterThan(40);
      expect(s.url).toMatch(/^https:\/\/[^\s]+$/);
      expect(() => new URL(s.url), s.url).not.toThrow();
      expect(s.url, s.label).not.toMatch(/[,\s]$/);
    }
  });

  it("ne cite pas deux fois la même URL", () => {
    const urls = SOURCES_SEUIL_SURFACE.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("cite le texte qui fonde l'exercice d'une activité au domicile (art. L631-7-3 CCH)", () => {
    expect(SOURCES_SEUIL_SURFACE.some((s) => s.url.includes("legifrance.gouv.fr"))).toBe(true);
  });

  it("cite l'URSSAF, qui fonde le calcul de la quote-part au prorata de surface", () => {
    expect(SOURCES_SEUIL_SURFACE.some((s) => s.url.includes("urssaf.fr"))).toBe(true);
  });
});
