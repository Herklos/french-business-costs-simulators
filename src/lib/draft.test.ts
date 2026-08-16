// Garde-fou transversal de la persistance des formulaires.
//
// Chaque simulateur déclare ses propres exclusions et ses propres champs à choix fermé, mais tous
// partagent la même mécanique. Ce fichier vérifie les propriétés qui doivent tenir pour TOUS, de
// sorte qu'un simulateur ajouté demain sans persistance, ou avec une partition mal déclarée, soit
// signalé ici plutôt que découvert par un utilisateur dont la saisie a disparu.

import { describe, expect, it } from "vitest";
import { applyDraft, extractDraft } from "./draft";
import { CHAMPS_VEHICULE_NON_PERSISTES, applyVehicleDraft, createDefaultInputs, extractVehicleDraft } from "./simulator";
import {
  CHAMPS_NON_PERSISTES as CHAMPS_DOMICILE,
  applyHomeOfficeDraft,
  createDefaultHomeOfficeInputs,
  extractHomeOfficeDraft,
} from "./homeOffice";
import {
  CHAMPS_MATERIEL_NON_PERSISTES,
  applyMaterielDraft,
  createDefaultMaterielInputs,
  extractMaterielDraft,
} from "./materiel";
import {
  CHAMPS_MUTUELLE_NON_PERSISTES,
  applyMutuelleDraft,
  createDefaultMutuellePrevoyanceInputs,
  extractMutuelleDraft,
} from "./mutuellePrevoyance";
import {
  CHAMPS_RETRAITE_NON_PERSISTES,
  applyRetraiteDraft,
  createDefaultRetraiteInputs,
  extractRetraiteDraft,
} from "./retraite";
import {
  CHAMPS_HOLDING_NON_PERSISTES,
  applyHoldingDraft,
  createDefaultHoldingInputs,
  extractHoldingDraft,
} from "./holding";
import {
  CHAMPS_REMUNERATION_NON_PERSISTES,
  applyRemunerationDraft,
  createDefaultRemunerationInputs,
  extractRemunerationDraft,
} from "./remuneration";

interface CasSimulateur {
  nom: string;
  defauts: () => Record<string, unknown>;
  extract: (i: never) => unknown;
  apply: (d: never, draft: unknown) => Record<string, unknown>;
  exclus: readonly string[];
}

const SIMULATEURS: CasSimulateur[] = [
  {
    nom: "véhicule",
    defauts: createDefaultInputs as never,
    extract: extractVehicleDraft as never,
    apply: applyVehicleDraft as never,
    exclus: CHAMPS_VEHICULE_NON_PERSISTES,
  },
  {
    nom: "domicile",
    defauts: createDefaultHomeOfficeInputs as never,
    extract: extractHomeOfficeDraft as never,
    apply: applyHomeOfficeDraft as never,
    exclus: CHAMPS_DOMICILE,
  },
  {
    nom: "matériel",
    defauts: createDefaultMaterielInputs as never,
    extract: extractMaterielDraft as never,
    apply: applyMaterielDraft as never,
    exclus: CHAMPS_MATERIEL_NON_PERSISTES,
  },
  {
    nom: "mutuelle",
    defauts: createDefaultMutuellePrevoyanceInputs as never,
    extract: extractMutuelleDraft as never,
    apply: applyMutuelleDraft as never,
    exclus: CHAMPS_MUTUELLE_NON_PERSISTES,
  },
  {
    nom: "retraite",
    defauts: createDefaultRetraiteInputs as never,
    extract: extractRetraiteDraft as never,
    apply: applyRetraiteDraft as never,
    exclus: CHAMPS_RETRAITE_NON_PERSISTES,
  },
  {
    nom: "holding",
    defauts: createDefaultHoldingInputs as never,
    extract: extractHoldingDraft as never,
    apply: applyHoldingDraft as never,
    exclus: CHAMPS_HOLDING_NON_PERSISTES,
  },
  {
    nom: "rémunération",
    defauts: createDefaultRemunerationInputs as never,
    extract: extractRemunerationDraft as never,
    apply: applyRemunerationDraft as never,
    exclus: CHAMPS_REMUNERATION_NON_PERSISTES,
  },
];

describe.each(SIMULATEURS)("persistance du simulateur $nom", (cas) => {
  it("persiste tout le formulaire sauf les exclusions déclarées", () => {
    const defauts = cas.defauts();
    const draft = cas.extract(defauts as never) as Record<string, unknown>;
    for (const cle of Object.keys(defauts)) {
      const attendu = !cas.exclus.includes(cle);
      expect(cle in draft, `${cle} devrait être ${attendu ? "persisté" : "exclu"}`).toBe(attendu);
    }
  });

  it("exclut au minimum les identifiants techniques et le profil fiscal transversal", () => {
    // Le profil fiscal est partagé entre simulateurs et persisté séparément : le dupliquer dans
    // chaque brouillon exposerait à ce qu'une valeur périmée en écrase une plus récente.
    for (const obligatoire of ["id", "createdAt", "personalTaxProfile"]) {
      expect(cas.exclus, obligatoire).toContain(obligatoire);
    }
  });

  it("un aller-retour restitue exactement les valeurs par défaut", () => {
    const defauts = cas.defauts();
    const relu = cas.apply({ ...defauts } as never, cas.extract(defauts as never));
    for (const cle of Object.keys(defauts)) {
      if (cas.exclus.includes(cle)) continue;
      expect(relu[cle], cle).toEqual(defauts[cle]);
    }
  });

  it("un brouillon absent ou d'un type inattendu laisse les défauts intacts", () => {
    // Les défauts portent un identifiant et une date de création régénérés à chaque appel : on
    // repart donc d'une seule instance, sans quoi la comparaison échouerait sur ces deux champs.
    const defauts = cas.defauts();
    for (const draft of [null, undefined, 0, "", "texte", [], true]) {
      expect(cas.apply({ ...defauts } as never, draft), String(draft)).toEqual(defauts);
    }
  });

  it("une clé inconnue du code ne s'introduit pas dans le formulaire", () => {
    const relu = cas.apply(cas.defauts() as never, { champInvente: 1 });
    expect(relu.champInvente).toBeUndefined();
  });

  it("le brouillon est sérialisable en JSON sans perte", () => {
    // Le stockage passe par JSON.stringify : une valeur non sérialisable y disparaîtrait
    // silencieusement, et le champ correspondant retomberait sur son défaut à la relecture.
    const defauts = cas.defauts();
    const draft = cas.extract(defauts as never);
    const relu = cas.apply({ ...defauts } as never, JSON.parse(JSON.stringify(draft)));
    expect(relu).toEqual(cas.apply({ ...defauts } as never, draft));
  });
});

describe("applyDraft — comportements génériques", () => {
  const defauts = { texte: "a", nombre: 10, drapeau: true, imbrique: { x: 1, y: "b" } };

  it("ne descend que dans les objets simples, pas dans les tableaux ni dans null", () => {
    expect(applyDraft(defauts, { imbrique: { x: 5 } }, { champsNonPersistes: [] }).imbrique).toEqual({ x: 5, y: "b" });
    expect(applyDraft(defauts, { imbrique: [1, 2] }, { champsNonPersistes: [] }).imbrique).toEqual(defauts.imbrique);
    expect(applyDraft(defauts, { imbrique: null }, { champsNonPersistes: [] }).imbrique).toEqual(defauts.imbrique);
  });

  it("une chaîne vide n'écrase pas un défaut renseigné : c'est une absence, pas un choix", () => {
    expect(applyDraft(defauts, { texte: "" }, { champsNonPersistes: [] }).texte).toBe("a");
    expect(applyDraft(defauts, { texte: "b" }, { champsNonPersistes: [] }).texte).toBe("b");
  });

  it("refuse un changement de type, dans les deux sens", () => {
    expect(applyDraft(defauts, { nombre: "10" }, { champsNonPersistes: [] }).nombre).toBe(10);
    expect(applyDraft(defauts, { texte: 10 }, { champsNonPersistes: [] }).texte).toBe("a");
    expect(applyDraft(defauts, { drapeau: "oui" }, { champsNonPersistes: [] }).drapeau).toBe(true);
  });

  it("extractDraft ne recopie pas les champs exclus, même imbriqués dans le même objet", () => {
    const draft = extractDraft(defauts, ["texte", "imbrique"]) as Record<string, unknown>;
    expect(Object.keys(draft).sort()).toEqual(["drapeau", "nombre"]);
  });
});
