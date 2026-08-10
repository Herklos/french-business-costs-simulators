// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

// @testing-library/react ne nettoie pas automatiquement le DOM entre les tests sans un setupFile
// global (non configuré ici, pour éviter d'affecter les tests de logique pure qui tournent en
// environnement Node) — nettoyage explicite à la place.
afterEach(cleanup);

function Boom(): never {
  throw new Error("Erreur de test délibérée");
}

describe("ErrorBoundary", () => {
  it("affiche ses enfants normalement quand rien ne plante", () => {
    render(
      <ErrorBoundary>
        <p>Contenu normal</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Contenu normal")).toBeTruthy();
  });

  it("affiche un message récupérable au lieu de faire planter toute la page quand un enfant lève une erreur", () => {
    // React logge l'erreur dans la console pendant le test — silencé ici pour un output propre.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      expect(screen.getByText(/erreur inattendue/i)).toBeTruthy();
      expect(screen.getByText("Erreur de test délibérée")).toBeTruthy();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("le bouton de retour appelle onReset et efface l'état d'erreur affiché", () => {
    const onReset = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary onReset={onReset}>
          <Boom />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole("button", { name: /retour à l'accueil/i }));
      expect(onReset).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
