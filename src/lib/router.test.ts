import { beforeEach, describe, expect, it } from "vitest";
import { VALID_PAGES, pushPageToUrl, readPageFromUrl, replacePageInUrl } from "./router";

// router.ts s'appuie sur le `window` global du navigateur (location, history), absent de
// l'environnement Node de test : même mock minimal que urlShare.test.ts.
class WindowMock {
  private _href = "http://localhost/";
  get location() {
    return { href: this._href, search: new URL(this._href).search };
  }
  history = {
    pushState: (_state: unknown, _title: string, url: string) => {
      this._href = new URL(url, this._href).toString();
    },
    replaceState: (_state: unknown, _title: string, url: string) => {
      this._href = new URL(url, this._href).toString();
    },
  };
}

beforeEach(() => {
  (globalThis as unknown as { window: WindowMock }).window = new WindowMock();
});

describe("readPageFromUrl", () => {
  it("retourne 'home' quand aucun paramètre page n'est présent", () => {
    expect(readPageFromUrl()).toBe("home");
  });

  it("retourne 'home' pour une valeur invalide/inconnue (protection contre une URL manipulée)", () => {
    window.history.replaceState({}, "", "/?page=n-importe-quoi");
    expect(readPageFromUrl()).toBe("home");
  });

  it("lit chaque page valide correctement", () => {
    for (const page of VALID_PAGES.filter((p) => p !== "home")) {
      window.history.replaceState({}, "", `/?page=${page}`);
      expect(readPageFromUrl()).toBe(page);
    }
  });
});

describe("pushPageToUrl", () => {
  it("ajoute ?page=... à l'URL pour une page non-home", () => {
    pushPageToUrl("holding");
    expect(new URL(window.location.href).searchParams.get("page")).toBe("holding");
  });

  it("retire le paramètre page pour 'home' (URL propre à l'accueil)", () => {
    pushPageToUrl("holding");
    pushPageToUrl("home");
    expect(new URL(window.location.href).searchParams.get("page")).toBeNull();
  });

  it("retire toujours le paramètre data (un partage en cours ne doit pas persister au-delà de sa première consommation)", () => {
    window.history.replaceState({}, "", "/?page=materiel&data=xyz");
    pushPageToUrl("holding");
    expect(new URL(window.location.href).searchParams.get("data")).toBeNull();
  });
});

describe("replacePageInUrl", () => {
  it("met à jour ?page=... sans empiler d'entrée d'historique supplémentaire (même mécanisme observable)", () => {
    replacePageInUrl("retraite");
    expect(new URL(window.location.href).searchParams.get("page")).toBe("retraite");
  });

  it("retire aussi le paramètre data", () => {
    window.history.replaceState({}, "", "/?page=vehicle&data=xyz");
    replacePageInUrl("vehicle");
    expect(new URL(window.location.href).searchParams.get("data")).toBeNull();
  });
});
