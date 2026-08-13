// Garde-fou : toute règle citée par un composant doit exister dans le registre. Un `ruleId` erroné
// ne casse rien à l'exécution — RuleNote rend `null` — mais fait disparaître silencieusement la
// référence légale de l'écran, ce qu'aucun test ne détectait jusqu'ici.
//
// Le code source est lu via le glob de Vite plutôt que via `node:fs`, pour éviter d'ajouter une
// dépendance de types Node à un projet qui cible le navigateur.

import { describe, expect, it } from "vitest";
import { TAX_RULES } from "./taxRules";

const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** Toutes les occurrences `ruleId="..."` du code applicatif, avec le fichier qui les porte. */
const REFERENCES = Object.entries(SOURCES)
  .filter(([chemin]) => !chemin.includes(".test."))
  .flatMap(([chemin, contenu]) =>
    [...contenu.matchAll(/ruleId="([^"]+)"/g)].map((m) => ({ fichier: chemin, id: m[1] })),
  );

describe("cohérence entre les règles citées par l'interface et le registre", () => {
  const ids = new Set(TAX_RULES.map((r) => r.id));

  it("trouve effectivement des références dans le code source", () => {
    expect(REFERENCES.length).toBeGreaterThan(20);
  });

  it("ne cite aucune règle absente du registre", () => {
    for (const { fichier, id } of REFERENCES) {
      expect(ids.has(id), `${fichier} cite la règle « ${id} », qui n'existe pas`).toBe(true);
    }
  });

  it("rend chaque règle du simulateur véhicule atteignable depuis le simulateur lui-même", () => {
    // Ces règles doivent éclairer une décision au moment où elle se prend, et pas seulement
    // figurer sur la page « Règles fiscales ».
    const citees = new Set(REFERENCES.map((r) => r.id));
    const categoriesVehicule = ["aen_vehicule", "fiscalite_vehicule_societe", "indemnites_kilometriques"];
    const manquantes = TAX_RULES.filter((r) => categoriesVehicule.includes(r.category) && !citees.has(r.id)).map(
      (r) => r.id,
    );
    expect(manquantes, `règles véhicule jamais affichées dans le simulateur : ${manquantes.join(", ")}`).toEqual([]);
  });
});
