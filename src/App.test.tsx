// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";

// L'URL (window.location) est partagée par tous les tests de ce fichier (un seul jsdom pour le
// fichier entier) : on la remet à zéro avant chaque test pour éviter qu'un `?page=...` laissé par
// un test précédent ne fausse le suivant.
beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
afterEach(cleanup);

describe("App — navigation & routage par URL", () => {
  it("affiche la page d'accueil par défaut (aucun ?page= dans l'URL)", () => {
    render(<App />);
    expect(screen.getByText("Simulateurs de coûts pour entrepreneurs français")).toBeTruthy();
  });

  it("cliquer sur un lien de navigation affiche le simulateur correspondant et met à jour l'URL", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "🏛️ Holding" }));
    expect(screen.getByRole("heading", { name: /Holding \/ montage patrimonial/ })).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get("page")).toBe("holding");
  });

  it("revenir en arrière (popstate) resynchronise la page affichée avec l'URL", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "🏛️ Holding" }));
    expect(screen.getByRole("heading", { name: /Holding \/ montage patrimonial/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "🏦 Retraite" }));
    expect(screen.getByRole("heading", { name: /Épargne retraite du dirigeant/ })).toBeTruthy();

    // Simule le navigateur revenant en arrière : l'URL change sous nos pieds (history.back() est
    // asynchrone dans jsdom, donc on la met à jour directement plutôt que d'attendre sa résolution)
    // et un évènement popstate natif est émis — l'app doit se resynchroniser dessus plutôt que
    // garder l'ancien état affiché.
    act(() => {
      window.history.replaceState({}, "", "/?page=holding");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("heading", { name: /Holding \/ montage patrimonial/ })).toBeTruthy();
  });

  it("naviguer vers l'accueil retire ?page= de l'URL (URL propre)", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "🏛️ Holding" }));
    fireEvent.click(screen.getByText("🇫🇷 Simulateurs de coûts d'entreprise"));
    expect(new URL(window.location.href).searchParams.get("page")).toBeNull();
  });
});
