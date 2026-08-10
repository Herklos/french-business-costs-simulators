import { beforeEach, describe, expect, it } from "vitest";
import {
  buildShareUrl,
  clearShareFromUrl,
  decodeSimulationFromUrl,
  encodeSimulationForUrl,
  mergeSharedInputs,
  readShareFromUrl,
} from "./urlShare";

// urlShare.ts s'appuie sur le `window` global du navigateur (location, history), absent de
// l'environnement Node de test : on fournit ici un mock minimal, réinitialisé avant chaque test —
// même approche que le mock localStorage de storage.test.ts.
class WindowMock {
  private _href = "http://localhost/";
  get location() {
    return { href: this._href, search: new URL(this._href).search };
  }
  history = {
    replaceState: (_state: unknown, _title: string, url: string) => {
      this._href = new URL(url, this._href).toString();
    },
  };
}

describe("encodeSimulationForUrl / decodeSimulationFromUrl", () => {
  it("un aller-retour encode/décode restitue l'objet d'origine", () => {
    const inputs = { id: "abc", name: "Ma simulation", prixHT: 1800, actif: true };
    const encoded = encodeSimulationForUrl(inputs);
    expect(decodeSimulationFromUrl(encoded)).toEqual(inputs);
  });

  it("l'encodage est sûr dans une URL (aucun caractère +, / ou = résiduel)", () => {
    const inputs = { id: "x".repeat(50), name: "??+/=test" };
    const encoded = encodeSimulationForUrl(inputs);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("supporte les accents et caractères spéciaux (UTF-8)", () => {
    const inputs = { name: "Véhicule électrique — coût réévalué à 50%" };
    const encoded = encodeSimulationForUrl(inputs);
    expect(decodeSimulationFromUrl(encoded)).toEqual(inputs);
  });

  it("decodeSimulationFromUrl retourne null pour une chaîne corrompue", () => {
    expect(decodeSimulationFromUrl("!!!pas du base64 valide!!!")).toBeNull();
  });

  it("decodeSimulationFromUrl retourne null pour une entrée vide/absente", () => {
    expect(decodeSimulationFromUrl(null)).toBeNull();
    expect(decodeSimulationFromUrl(undefined)).toBeNull();
    expect(decodeSimulationFromUrl("")).toBeNull();
  });

  it("gère correctement les tailles nécessitant un padding base64 (1, 2 ou 3 caractères manquants)", () => {
    for (const name of ["a", "ab", "abc", "abcd", "abcde"]) {
      const inputs = { name };
      expect(decodeSimulationFromUrl(encodeSimulationForUrl(inputs))).toEqual(inputs);
    }
  });

  it("rejette un JSON valide mais de forme inexploitable (tableau, primitive, null)", () => {
    const b64 = (v: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(v))));
    expect(decodeSimulationFromUrl(b64([1, 2, 3]))).toBeNull();
    expect(decodeSimulationFromUrl(b64(42))).toBeNull();
    expect(decodeSimulationFromUrl(b64("just a string"))).toBeNull();
    expect(decodeSimulationFromUrl(b64(null))).toBeNull();
  });
});

describe("mergeSharedInputs — robustesse face à un partage partiel/corrompu", () => {
  it("un partage complet remplace intégralement les valeurs par défaut", () => {
    const defaults = { id: "default-id", name: "Défaut", prixHT: 100 };
    const shared = encodeSimulationForUrl({ id: "shared-id", name: "Partagé", prixHT: 999 });
    expect(mergeSharedInputs(defaults, shared)).toEqual({ id: "shared-id", name: "Partagé", prixHT: 999 });
  });

  it("un partage PARTIEL (champ manquant) retombe sur la valeur par défaut pour ce champ", () => {
    const defaults = { id: "default-id", name: "Défaut", personalTaxProfile: { mode: "calcule" } };
    // Partage tronqué/ancien lien : ne contient pas `personalTaxProfile` — ne doit PAS produire
    // `undefined` (cause réelle d'un plantage constaté sur MaterielSimulatorPage en vérification
    // manuelle : computeMateriel plantait sur `resolvePersonalTaxProfile(undefined)`).
    const shared = encodeSimulationForUrl({ id: "shared-id", name: "Partagé" });
    expect(mergeSharedInputs(defaults, shared)).toEqual({
      id: "shared-id",
      name: "Partagé",
      personalTaxProfile: { mode: "calcule" },
    });
  });

  it("un payload corrompu (non décodable) retourne les valeurs par défaut telles quelles", () => {
    const defaults = { id: "default-id", name: "Défaut" };
    expect(mergeSharedInputs(defaults, "!!!corrompu!!!")).toEqual(defaults);
  });

  it("aucune donnée partagée (undefined) retourne les valeurs par défaut telles quelles", () => {
    const defaults = { id: "default-id", name: "Défaut" };
    expect(mergeSharedInputs(defaults, undefined)).toBe(defaults);
  });
});

describe("buildShareUrl / readShareFromUrl / clearShareFromUrl", () => {
  beforeEach(() => {
    (globalThis as unknown as { window: WindowMock }).window = new WindowMock();
  });

  it("buildShareUrl produit une URL avec page et data en query params", () => {
    const url = buildShareUrl("vehicle", { id: "a", name: "Test" });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page")).toBe("vehicle");
    expect(decodeSimulationFromUrl(parsed.searchParams.get("data"))).toEqual({ id: "a", name: "Test" });
  });

  it("readShareFromUrl relit ce que buildShareUrl a construit", () => {
    const inputs = { id: "a", name: "Test partagé" };
    const shareUrl = buildShareUrl("materiel", inputs);
    window.history.replaceState({}, "", shareUrl);
    const read = readShareFromUrl();
    expect(read?.page).toBe("materiel");
    expect(decodeSimulationFromUrl(read?.data)).toEqual(inputs);
  });

  it("readShareFromUrl retourne null si aucun paramètre page/data n'est présent", () => {
    window.history.replaceState({}, "", "/?foo=bar");
    expect(readShareFromUrl()).toBeNull();
  });

  it("readShareFromUrl retourne null si un seul des deux paramètres est présent", () => {
    window.history.replaceState({}, "", "/?page=vehicle");
    expect(readShareFromUrl()).toBeNull();
  });

  it("clearShareFromUrl retire page/data de la barre d'adresse sans toucher aux autres paramètres", () => {
    window.history.replaceState({}, "", "/?page=vehicle&data=xyz&keep=me");
    clearShareFromUrl();
    const params = new URLSearchParams(window.location.search);
    expect(params.get("page")).toBeNull();
    expect(params.get("data")).toBeNull();
    expect(params.get("keep")).toBe("me");
  });
});
