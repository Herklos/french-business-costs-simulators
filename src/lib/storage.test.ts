import { beforeEach, describe, expect, it } from "vitest";
import { deleteSimulation, listSimulations, renameSimulation, saveSimulation } from "./storage";

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
