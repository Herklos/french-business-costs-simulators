// Persistance locale (localStorage) des simulations, tous simulateurs confondus.
// Permet de sauvegarder une simulation puis de la comparer plus tard à une autre,
// y compris entre deux sessions du navigateur.

import type { PersonalTaxProfile } from "./frenchIncomeTax";

export type SimulatorKind = "vehicle" | "homeOffice" | "remuneration" | "materiel" | "mutuelle" | "retraite";

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

// Revenu de référence du foyer fiscal (PersonalTaxProfile) : contrairement aux simulations
// ci-dessus (sauvegardées explicitement, une par une), ce profil est un réglage TRANSVERSAL —
// la situation personnelle du dirigeant ne change pas selon le simulateur utilisé. Il est donc
// persisté sous une clé dédiée, à part de la liste des simulations, et rechargé automatiquement
// à l'ouverture de n'importe quel simulateur qui en a besoin (véhicule, bureau à domicile,
// rémunération), sans action explicite de l'utilisateur.
const PERSONAL_TAX_PROFILE_KEY = "fbcs_personal_tax_profile_v1";

export function loadPersonalTaxProfile(): PersonalTaxProfile | null {
  try {
    const raw = localStorage.getItem(PERSONAL_TAX_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PersonalTaxProfile) : null;
  } catch {
    return null;
  }
}

export function savePersonalTaxProfile(profile: PersonalTaxProfile) {
  try {
    localStorage.setItem(PERSONAL_TAX_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // localStorage indisponible (mode privé, quota...) : on dégrade silencieusement, ce réglage
    // n'est qu'un confort (pré-remplissage), jamais requis pour utiliser les simulateurs.
  }
}

/** Applique le profil persisté (s'il existe) aux valeurs par défaut d'un simulateur, à l'ouverture de sa page. */
export function withPersistedPersonalTaxProfile<T extends { personalTaxProfile: PersonalTaxProfile }>(defaults: T): T {
  const saved = loadPersonalTaxProfile();
  return saved ? { ...defaults, personalTaxProfile: saved } : defaults;
}
