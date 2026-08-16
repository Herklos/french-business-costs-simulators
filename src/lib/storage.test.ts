import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHomeOfficeDraft,
  deleteSimulation,
  listSimulations,
  loadHomeOfficeDraft,
  loadPersonalTaxProfile,
  renameSimulation,
  saveSimulation,
  savePersonalTaxProfile,
  saveHomeOfficeDraft,
  withPersistedPersonalTaxProfile,
} from "./storage";
import { createDefaultPersonalTaxProfile } from "./frenchIncomeTax";

// storage.ts s'appuie sur le `localStorage` global du navigateur, absent de l'environnement Node
// de test : on fournit ici un mock minimal en mémoire, réinitialisé avant chaque test.
class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: LocalStorageMock }).localStorage = new LocalStorageMock();
});

interface FakeInputs {
  id: string;
  name: string;
}

describe("storage — sauvegarde, liste, suppression, renommage", () => {
  it("liste vide au départ", () => {
    expect(listSimulations<FakeInputs>("vehicle")).toEqual([]);
  });

  it("sauvegarde puis retrouve une simulation", () => {
    saveSimulation<FakeInputs>("vehicle", { id: "a", name: "Ma simulation" });
    const items = listSimulations<FakeInputs>("vehicle");
    expect(items).toHaveLength(1);
    expect(items[0].inputs.name).toBe("Ma simulation");
  });

  it("met à jour une simulation existante plutôt que d'en créer une nouvelle (même id)", () => {
    saveSimulation<FakeInputs>("vehicle", { id: "a", name: "V1" });
    saveSimulation<FakeInputs>("vehicle", { id: "a", name: "V2" });
    const items = listSimulations<FakeInputs>("vehicle");
    expect(items).toHaveLength(1);
    expect(items[0].inputs.name).toBe("V2");
  });

  it("isole les simulations par type de simulateur (kind)", () => {
    saveSimulation<FakeInputs>("vehicle", { id: "a", name: "Véhicule" });
    saveSimulation<FakeInputs>("homeOffice", { id: "a", name: "Bureau" });
    expect(listSimulations<FakeInputs>("vehicle")).toHaveLength(1);
    expect(listSimulations<FakeInputs>("homeOffice")).toHaveLength(1);
    expect(listSimulations<FakeInputs>("vehicle")[0].inputs.name).toBe("Véhicule");
  });

  it("liste les simulations par date de sauvegarde décroissante (la plus récente en premier)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      saveSimulation<FakeInputs>("vehicle", { id: "a", name: "Première" });
      vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
      saveSimulation<FakeInputs>("vehicle", { id: "b", name: "Deuxième" });
      vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
      saveSimulation<FakeInputs>("vehicle", { id: "c", name: "Troisième" });
      const items = listSimulations<FakeInputs>("vehicle");
      expect(items.map((i) => i.inputs.name)).toEqual(["Troisième", "Deuxième", "Première"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un contenu corrompu en localStorage ne fait pas planter la lecture (liste vide)", () => {
    localStorage.setItem("fbcs_simulations_v1", "{ceci n'est pas du json");
    expect(listSimulations<FakeInputs>("vehicle")).toEqual([]);
  });

  it("un contenu JSON valide mais de forme inattendue (pas un tableau) donne une liste vide", () => {
    localStorage.setItem("fbcs_simulations_v1", JSON.stringify({ not: "an array" }));
    expect(listSimulations<FakeInputs>("vehicle")).toEqual([]);
  });

  it("supprime une simulation par id", () => {
    saveSimulation<FakeInputs>("vehicle", { id: "a", name: "A" });
    saveSimulation<FakeInputs>("vehicle", { id: "b", name: "B" });
    deleteSimulation("vehicle", "a");
    const items = listSimulations<FakeInputs>("vehicle");
    expect(items).toHaveLength(1);
    expect(items[0].inputs.id).toBe("b");
  });

  it("renomme une simulation existante", () => {
    saveSimulation<FakeInputs>("vehicle", { id: "a", name: "Ancien nom" });
    renameSimulation("vehicle", "a", "Nouveau nom");
    expect(listSimulations<FakeInputs>("vehicle")[0].inputs.name).toBe("Nouveau nom");
  });

  it("renommer un id inexistant ne fait rien (pas d'erreur)", () => {
    expect(() => renameSimulation("vehicle", "inexistant", "X")).not.toThrow();
    expect(listSimulations<FakeInputs>("vehicle")).toEqual([]);
  });

  it("supprimer un id inexistant ne fait rien (pas d'erreur)", () => {
    saveSimulation<FakeInputs>("vehicle", { id: "a", name: "A" });
    expect(() => deleteSimulation("vehicle", "inexistant")).not.toThrow();
    expect(listSimulations<FakeInputs>("vehicle")).toHaveLength(1);
  });
});

describe("storage — revenu de référence du foyer fiscal (profil transversal)", () => {
  it("aucun profil sauvegardé au départ", () => {
    expect(loadPersonalTaxProfile()).toBeNull();
  });

  it("sauvegarde puis recharge le profil tel quel", () => {
    const profile = { ...createDefaultPersonalTaxProfile(), situationFamiliale: "couple" as const, nombreEnfants: 2 };
    savePersonalTaxProfile(profile);
    expect(loadPersonalTaxProfile()).toEqual(profile);
  });

  it("une sauvegarde ultérieure remplace la précédente (dernier profil utilisé)", () => {
    savePersonalTaxProfile({ ...createDefaultPersonalTaxProfile(), nombreEnfants: 1 });
    savePersonalTaxProfile({ ...createDefaultPersonalTaxProfile(), nombreEnfants: 3 });
    expect(loadPersonalTaxProfile()?.nombreEnfants).toBe(3);
  });

  it("un contenu corrompu en localStorage ne fait pas planter le chargement (retourne null)", () => {
    localStorage.setItem("fbcs_personal_tax_profile_v1", "{ceci n'est pas du json");
    expect(loadPersonalTaxProfile()).toBeNull();
  });

  it("un contenu JSON valide mais de forme inattendue (pas un objet) donne null", () => {
    localStorage.setItem("fbcs_personal_tax_profile_v1", JSON.stringify(42));
    expect(loadPersonalTaxProfile()).toBeNull();
  });

  it("withPersistedPersonalTaxProfile renvoie les valeurs par défaut telles quelles si rien n'est sauvegardé", () => {
    const defaults = { id: "x", personalTaxProfile: createDefaultPersonalTaxProfile() };
    expect(withPersistedPersonalTaxProfile(defaults)).toEqual(defaults);
  });

  it("withPersistedPersonalTaxProfile remplace le profil par défaut par celui sauvegardé, sans toucher au reste", () => {
    const saved = { ...createDefaultPersonalTaxProfile(), nombreEnfants: 4 };
    savePersonalTaxProfile(saved);
    const defaults = { id: "x", personalTaxProfile: createDefaultPersonalTaxProfile() };
    const result = withPersistedPersonalTaxProfile(defaults);
    expect(result.id).toBe("x");
    expect(result.personalTaxProfile.nombreEnfants).toBe(4);
  });
});

describe("storage — brouillon du simulateur bureau à domicile", () => {
  it("retourne null quand rien n'a été mémorisé", () => {
    expect(loadHomeOfficeDraft()).toBeNull();
  });

  it("relit ce qui a été mémorisé", () => {
    saveHomeOfficeDraft({ surfaceTotaleM2: 95, ville: "lille" });
    expect(loadHomeOfficeDraft()).toEqual({ surfaceTotaleM2: 95, ville: "lille" });
  });

  it("écrase le profil précédent plutôt que d'en empiler plusieurs", () => {
    saveHomeOfficeDraft({ surfaceTotaleM2: 95 });
    saveHomeOfficeDraft({ surfaceTotaleM2: 40 });
    expect(loadHomeOfficeDraft()).toEqual({ surfaceTotaleM2: 40 });
  });

  it("un contenu corrompu ne fait pas planter le chargement (retourne null)", () => {
    localStorage.setItem("fbcs_home_office_draft_v1", "{ceci n'est pas du json");
    expect(loadHomeOfficeDraft()).toBeNull();
  });

  it("un contenu valide mais non-objet est ignoré", () => {
    localStorage.setItem("fbcs_home_office_draft_v1", JSON.stringify(42));
    expect(loadHomeOfficeDraft()).toBeNull();
  });

  it("clearHomeOfficeDraft oublie le logement mémorisé", () => {
    saveHomeOfficeDraft({ surfaceTotaleM2: 95 });
    clearHomeOfficeDraft();
    expect(loadHomeOfficeDraft()).toBeNull();
  });

  it("oublier un logement inexistant ne lève pas", () => {
    expect(() => clearHomeOfficeDraft()).not.toThrow();
  });

  it("n'interfère pas avec les simulations sauvegardées ni avec le profil fiscal", () => {
    saveSimulation("homeOffice", { id: "sim-1", name: "Bureau" });
    savePersonalTaxProfile({ mode: "manuel", tauxManuel: 0.3 } as never);
    saveHomeOfficeDraft({ surfaceTotaleM2: 95 });
    clearHomeOfficeDraft();
    expect(listSimulations("homeOffice")).toHaveLength(1);
    expect(loadPersonalTaxProfile()).not.toBeNull();
  });
});
