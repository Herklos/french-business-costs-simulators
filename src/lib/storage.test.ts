import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteSimulation,
  listSimulations,
  loadPersonalTaxProfile,
  renameSimulation,
  saveSimulation,
  savePersonalTaxProfile,
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
