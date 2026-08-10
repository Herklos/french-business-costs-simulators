import { beforeEach, describe, expect, it } from "vitest";
import { computeConsolidatedView, isRecurringKind } from "./consolidated";
import { saveSimulation } from "./storage";
import { createDefaultInputs as createDefaultVehicleInputs, computeSimulation } from "./simulator";
import { createDefaultHomeOfficeInputs, computeHomeOffice } from "./homeOffice";
import { createDefaultMaterielInputs, computeMateriel } from "./materiel";
import { createDefaultMutuellePrevoyanceInputs, computeMutuellePrevoyance } from "./mutuellePrevoyance";
import { createDefaultRetraiteInputs, computeRetraite } from "./retraite";
import { createDefaultRemunerationInputs } from "./remuneration";
import { createDefaultHoldingInputs, computeHolding } from "./holding";

// consolidated.ts s'appuie sur storage.ts, lui-même sur le `localStorage` global du navigateur.
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

describe("computeConsolidatedView — aucune simulation sauvegardée", () => {
  it("retourne des listes vides et un total nul", () => {
    const v = computeConsolidatedView();
    expect(v.costLines).toEqual([]);
    expect(v.infoLines).toEqual([]);
    expect(v.totalCoutNetGlobalAnnuel).toBe(0);
  });
});

describe("computeConsolidatedView — simulateurs récurrents (coût agrégé)", () => {
  it("une simulation véhicule sauvegardée apparaît avec le coût de la meilleure option", () => {
    const inputs = createDefaultVehicleInputs();
    saveSimulation("vehicle", inputs);
    const v = computeConsolidatedView();
    expect(v.costLines).toHaveLength(1);
    expect(v.costLines[0].kind).toBe("vehicle");
    const expected = computeSimulation(inputs).bestOption.globalCostAnnual;
    expect(v.costLines[0].coutNetGlobalAnnuel).toBeCloseTo(expected, 6);
    expect(v.totalCoutNetGlobalAnnuel).toBeCloseTo(expected, 6);
  });

  it("agrège plusieurs simulateurs récurrents dans un total unique", () => {
    const vehicleInputs = createDefaultVehicleInputs();
    const homeOfficeInputs = createDefaultHomeOfficeInputs();
    const materielInputs = createDefaultMaterielInputs();
    const mutuelleInputs = createDefaultMutuellePrevoyanceInputs();
    const retraiteInputs = createDefaultRetraiteInputs();
    saveSimulation("vehicle", vehicleInputs);
    saveSimulation("homeOffice", homeOfficeInputs);
    saveSimulation("materiel", materielInputs);
    saveSimulation("mutuelle", mutuelleInputs);
    saveSimulation("retraite", retraiteInputs);

    const v = computeConsolidatedView();
    expect(v.costLines).toHaveLength(5);

    const expectedTotal =
      computeSimulation(vehicleInputs).bestOption.globalCostAnnual +
      computeHomeOffice(homeOfficeInputs).coutNetGlobal +
      computeMateriel(materielInputs).coutNetGlobalAnnee1 +
      computeMutuellePrevoyance(mutuelleInputs).coutNetGlobal +
      computeRetraite(retraiteInputs).coutNetGlobal;

    expect(v.totalCoutNetGlobalAnnuel).toBeCloseTo(expectedTotal, 6);
  });

  it("plusieurs simulations du même simulateur sont toutes agrégées séparément", () => {
    saveSimulation("materiel", { ...createDefaultMaterielInputs(), id: "m1", prixHT: 1000 });
    saveSimulation("materiel", { ...createDefaultMaterielInputs(), id: "m2", prixHT: 2000 });
    const v = computeConsolidatedView();
    expect(v.costLines.filter((l) => l.kind === "materiel")).toHaveLength(2);
  });
});

describe("computeConsolidatedView — rémunération et holding sont informatifs, hors total", () => {
  it("une simulation rémunération apparaît dans infoLines mais pas dans costLines ni le total", () => {
    saveSimulation("remuneration", createDefaultRemunerationInputs());
    const v = computeConsolidatedView();
    expect(v.costLines).toHaveLength(0);
    expect(v.infoLines).toHaveLength(1);
    expect(v.infoLines[0].kind).toBe("remuneration");
    expect(v.totalCoutNetGlobalAnnuel).toBe(0);
  });

  it("une simulation holding apparaît dans infoLines avec le coût IS année 1", () => {
    const inputs = createDefaultHoldingInputs();
    saveSimulation("holding", inputs);
    const v = computeConsolidatedView();
    expect(v.infoLines).toHaveLength(1);
    expect(v.infoLines[0].kind).toBe("holding");
    expect(v.infoLines[0].metricValue).toBeCloseTo(computeHolding(inputs).coutISAnnee1, 6);
    expect(v.totalCoutNetGlobalAnnuel).toBe(0);
  });
});

describe("isRecurringKind", () => {
  it("identifie les 5 simulateurs récurrents", () => {
    expect(isRecurringKind("vehicle")).toBe(true);
    expect(isRecurringKind("homeOffice")).toBe(true);
    expect(isRecurringKind("materiel")).toBe(true);
    expect(isRecurringKind("mutuelle")).toBe(true);
    expect(isRecurringKind("retraite")).toBe(true);
  });

  it("exclut rémunération et holding", () => {
    expect(isRecurringKind("remuneration")).toBe(false);
    expect(isRecurringKind("holding")).toBe(false);
  });
});
