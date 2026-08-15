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
      expect(ref.source.length).toBeGreaterThan(10);
      expect(ref.note.length).toBeGreaterThan(30);
    }
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
