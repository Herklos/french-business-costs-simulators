// Persistance locale (localStorage) des simulations, tous simulateurs confondus.
// Permet de sauvegarder une simulation puis de la comparer plus tard à une autre,
// y compris entre deux sessions du navigateur.

export type SimulatorKind = "vehicle" | "homeOffice";

export interface SavedSimulation<T = unknown> {
  kind: SimulatorKind;
  savedAt: string;
  inputs: T;
}

const STORAGE_KEY = "fbcs_simulations_v1";

function readAll(): SavedSimulation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: SavedSimulation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function listSimulations<T extends { id: string }>(kind: SimulatorKind): SavedSimulation<T>[] {
  return readAll()
    .filter((s): s is SavedSimulation<T> => s.kind === kind)
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

export function saveSimulation<T extends { id: string }>(kind: SimulatorKind, inputs: T) {
  const all = readAll();
  const idx = all.findIndex((s) => s.kind === kind && (s.inputs as T).id === inputs.id);
  const record: SavedSimulation<T> = { kind, savedAt: new Date().toISOString(), inputs };
  if (idx >= 0) {
    all[idx] = record;
  } else {
    all.push(record);
  }
  writeAll(all);
}

export function deleteSimulation(kind: SimulatorKind, id: string) {
  const all = readAll().filter((s) => !(s.kind === kind && (s.inputs as { id: string }).id === id));
  writeAll(all);
}

export function renameSimulation(kind: SimulatorKind, id: string, name: string) {
  const all = readAll();
  const item = all.find((s) => s.kind === kind && (s.inputs as { id: string }).id === id);
  if (item) {
    (item.inputs as { name: string }).name = name;
    writeAll(all);
  }
}
