import { describe, expect, it } from "vitest";
import {
  CHARGES_REFERENCES,
  findChargeReference,
  fourchetteReferenceCharge,
  montantReferenceCharge,
} from "./logementCharges";
import { DEFAULT_CHARGE_LINES } from "./homeOffice";

describe("CHARGES_REFERENCES — cohérence de la table", () => {
  it("les identifiants sont uniques", () => {
    const ids = CHARGES_REFERENCES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chaque référence correspond à une ligne de charge du simulateur", () => {
    const idsLignes = new Set(DEFAULT_CHARGE_LINES.map((c) => c.id));
    for (const ref of CHARGES_REFERENCES) {
      expect(idsLignes.has(ref.id)).toBe(true);
    }
  });

  it("tous les postes sauf le loyer disposent d'une référence chiffrée", () => {
    const idsReferences = new Set(CHARGES_REFERENCES.map((c) => c.id));
    for (const ligne of DEFAULT_CHARGE_LINES) {
      // Le loyer est calculé à part, depuis le prix au m² de la ville.
      if (ligne.id === "loyer") continue;
      expect(idsReferences.has(ligne.id)).toBe(true);
    }
  });

  it("chaque fourchette encadre le montant de référence", () => {
    for (const ref of CHARGES_REFERENCES) {
      expect(ref.fourchette[0]).toBeLessThanOrEqual(ref.montant);
      expect(ref.montant).toBeLessThanOrEqual(ref.fourchette[1]);
      expect(ref.fourchette[0]).toBeLessThan(ref.fourchette[1]);
    }
  });

  it("chaque référence est documentée (source et note non vides)", () => {
    for (const ref of CHARGES_REFERENCES) {
      expect(ref.source.length, ref.id).toBeGreaterThan(10);
      expect(ref.note.length, ref.id).toBeGreaterThan(30);
    }
  });

  it("chaque référence pointe vers une URL de source vérifiable", () => {
    for (const ref of CHARGES_REFERENCES) {
      expect(ref.sourceUrl, ref.id).toMatch(/^https:\/\/[^\s]+$/);
      // Une URL doit rester analysable : une coquille de saisie (virgule finale, espace) casse le
      // lien sans que rien ne le signale à l'exécution.
      expect(() => new URL(ref.sourceUrl), ref.id).not.toThrow();
      expect(ref.sourceUrl, ref.id).not.toMatch(/[,\s]$/);
    }
  });

  it("les sources ne se répètent pas d'un poste à l'autre", () => {
    // Deux postes qui partagent une source signalent le plus souvent un copier-coller non relu.
    const urls = CHARGES_REFERENCES.map((c) => c.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("montantReferenceCharge", () => {
  it("les postes « surface » sont proportionnels à la surface du logement", () => {
    const a = montantReferenceCharge("chauffage", 40, "proprietaire") ?? 0;
    const b = montantReferenceCharge("chauffage", 80, "proprietaire") ?? 0;
    expect(b).toBeCloseTo(2 * a, 0);
  });

  it("les postes « forfait » sont indépendants de la surface", () => {
    expect(montantReferenceCharge("eau", 40, "proprietaire")).toBe(montantReferenceCharge("eau", 200, "proprietaire"));
  });

  it("un locataire ne se voit pas attribuer de taxe foncière", () => {
    expect(montantReferenceCharge("taxeFonciere", 80, "locataire")).toBe(0);
    expect(montantReferenceCharge("taxeFonciere", 80, "proprietaire")).toBeGreaterThan(0);
  });

  it("l'assurance habitation d'un locataire est inférieure à celle d'un propriétaire", () => {
    const locataire = montantReferenceCharge("assuranceHabitation", 80, "locataire") ?? 0;
    const proprietaire = montantReferenceCharge("assuranceHabitation", 80, "proprietaire") ?? 0;
    expect(locataire).toBeGreaterThan(0);
    expect(locataire).toBeLessThan(proprietaire);
  });

  it("retourne undefined pour un poste sans référence (le loyer)", () => {
    expect(montantReferenceCharge("loyer", 80, "proprietaire")).toBeUndefined();
    expect(findChargeReference("loyer")).toBeUndefined();
  });

  it("une surface négative ne produit pas de montant négatif", () => {
    expect(montantReferenceCharge("chauffage", -50, "proprietaire")).toBe(0);
  });
});

describe("fourchetteReferenceCharge", () => {
  it("la fourchette d'un poste « surface » est mise à l'échelle de la surface", () => {
    const [min, max] = fourchetteReferenceCharge("entretienCopropriete", 80) ?? [0, 0];
    const ref = findChargeReference("entretienCopropriete");
    expect(min).toBe(Math.round((ref?.fourchette[0] ?? 0) * 80));
    expect(max).toBe(Math.round((ref?.fourchette[1] ?? 0) * 80));
  });

  it("la fourchette encadre toujours le montant de référence, quels que soient surface et statut", () => {
    for (const ref of CHARGES_REFERENCES) {
      for (const surface of [25, 80, 200]) {
        for (const statut of ["proprietaire", "locataire"] as const) {
          const montant = montantReferenceCharge(ref.id, surface, statut) ?? 0;
          const [min, max] = fourchetteReferenceCharge(ref.id, surface, statut) ?? [0, 0];
          expect(montant).toBeGreaterThanOrEqual(min - 1);
          expect(montant).toBeLessThanOrEqual(max + 1);
        }
      }
    }
  });

  it("la fourchette de taxe foncière d'un locataire est nulle (aucune sous-évaluation signalée)", () => {
    expect(fourchetteReferenceCharge("taxeFonciere", 80, "locataire")).toEqual([0, 0]);
  });

  it("retourne undefined pour un poste sans référence", () => {
    expect(fourchetteReferenceCharge("loyer", 80)).toBeUndefined();
  });
});

describe("montantReferenceCharge — type de logement", () => {
  it("les charges de copropriété sont nulles en maison individuelle", () => {
    expect(montantReferenceCharge("entretienCopropriete", 80, "proprietaire", "maison")).toBe(0);
    expect(montantReferenceCharge("entretienCopropriete", 80, "proprietaire", "appartement")).toBeGreaterThan(0);
  });

  it("l'entretien courant est plus élevé en maison, où il remplace la copropriété", () => {
    const maison = montantReferenceCharge("travauxEntretien", 80, "proprietaire", "maison") ?? 0;
    const appartement = montantReferenceCharge("travauxEntretien", 80, "proprietaire", "appartement") ?? 0;
    expect(maison).toBeGreaterThan(appartement);
  });

  it("chauffage, eau, assurance et taxe foncière sont plus élevés en maison", () => {
    for (const id of ["chauffage", "eau", "assuranceHabitation", "taxeFonciere"]) {
      const maison = montantReferenceCharge(id, 80, "proprietaire", "maison") ?? 0;
      const appartement = montantReferenceCharge(id, 80, "proprietaire", "appartement") ?? 0;
      expect(maison, id).toBeGreaterThan(appartement);
    }
  });

  it("le type de logement laisse inchangés les postes qui n'en dépendent pas", () => {
    for (const id of ["electricite", "internetTelephone", "taxeOrduresMenageres", "menageNettoyage"]) {
      expect(montantReferenceCharge(id, 80, "proprietaire", "maison"), id).toBe(
        montantReferenceCharge(id, 80, "proprietaire", "appartement"),
      );
    }
  });

  it("le total des références reste du même ordre entre immeuble et maison", () => {
    // La maison n'a pas de copropriété mais davantage d'entretien et d'énergie : les deux
    // structures de charges doivent rester comparables, sans écart d'un facteur deux.
    const total = (type: "appartement" | "maison") =>
      CHARGES_REFERENCES.reduce((s, r) => s + (montantReferenceCharge(r.id, 80, "proprietaire", type) ?? 0), 0);
    const ratio = total("maison") / total("appartement");
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.6);
  });

  it("statut et type de logement se combinent : un locataire en maison ne paie pas de taxe foncière", () => {
    expect(montantReferenceCharge("taxeFonciere", 80, "locataire", "maison")).toBe(0);
  });

  it("l'assurance d'un locataire reste proportionnellement réduite en maison", () => {
    const proprietaire = montantReferenceCharge("assuranceHabitation", 80, "proprietaire", "maison") ?? 0;
    const locataire = montantReferenceCharge("assuranceHabitation", 80, "locataire", "maison") ?? 0;
    expect(locataire).toBeGreaterThan(0);
    expect(locataire).toBeLessThan(proprietaire);
  });
});

describe("fourchetteReferenceCharge — type de logement", () => {
  it("la fourchette de copropriété est nulle en maison (aucune sous-évaluation possible)", () => {
    expect(fourchetteReferenceCharge("entretienCopropriete", 80, "proprietaire", "maison")).toEqual([0, 0]);
  });

  it("la fourchette encadre le montant pour toutes les combinaisons surface × statut × type", () => {
    for (const ref of CHARGES_REFERENCES) {
      for (const surface of [25, 80, 200]) {
        for (const statut of ["proprietaire", "locataire"] as const) {
          for (const type of ["appartement", "maison"] as const) {
            const montant = montantReferenceCharge(ref.id, surface, statut, type) ?? 0;
            const [min, max] = fourchetteReferenceCharge(ref.id, surface, statut, type) ?? [0, 0];
            const contexte = `${ref.id}/${surface}/${statut}/${type}`;
            expect(montant, contexte).toBeGreaterThanOrEqual(min - 1);
            expect(montant, contexte).toBeLessThanOrEqual(max + 1);
          }
        }
      }
    }
  });

  it("aucune référence ne produit de montant ou de borne négatifs", () => {
    for (const ref of CHARGES_REFERENCES) {
      for (const surface of [0, 12, 300]) {
        for (const statut of ["proprietaire", "locataire"] as const) {
          for (const type of ["appartement", "maison"] as const) {
            expect(montantReferenceCharge(ref.id, surface, statut, type) ?? 0, ref.id).toBeGreaterThanOrEqual(0);
            const [min, max] = fourchetteReferenceCharge(ref.id, surface, statut, type) ?? [0, 0];
            expect(min, ref.id).toBeGreaterThanOrEqual(0);
            expect(max, ref.id).toBeGreaterThanOrEqual(min);
          }
        }
      }
    }
  });
});

describe("valeurs par défaut du simulateur — non sous-évaluées", () => {
  it("chaque référence pour 80 m² est au moins égale à l'ancienne valeur par défaut du simulateur", () => {
    // Les anciens placeholders sous-évaluaient nettement les charges d'un logement de 80 m².
    const anciennesValeurs: Record<string, number> = {
      electricite: 900,
      chauffage: 800,
      eau: 300,
      assuranceHabitation: 250,
      entretienCopropriete: 600,
      internetTelephone: 360,
    };
    for (const [id, ancienne] of Object.entries(anciennesValeurs)) {
      expect(montantReferenceCharge(id, 80, "proprietaire")).toBeGreaterThan(ancienne);
    }
  });
});
