// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { HoldingSimulatorPage } from "./HoldingSimulatorPage";

afterEach(cleanup);

describe("HoldingSimulatorPage — rendu et interaction de base", () => {
  it("s'affiche sans planter avec les valeurs par défaut, et affiche des résultats chiffrés", () => {
    render(<HoldingSimulatorPage />);
    expect(screen.getByRole("heading", { name: /Holding \/ montage patrimonial/ })).toBeTruthy();
    // Une des stat-cards doit afficher un montant en euros (résultat calculé, pas juste le formulaire vide).
    expect(screen.getAllByText(/€/).length).toBeGreaterThan(0);
  });

  it("change le dividende annuel dans le formulaire recalcule les résultats affichés", () => {
    render(<HoldingSimulatorPage />);
    const dividendeInput = screen.getByLabelText(/Dividende annuel versé par la filiale/i) as HTMLInputElement;
    fireEvent.change(dividendeInput, { target: { value: "200000" } });
    expect(dividendeInput.value).toBe("200000");
    // Le coût IS de la remontée doit maintenant être bien supérieur au montant par défaut (50 000€ → 375€ à 1%).
    expect(screen.queryByText("375 €")).toBeNull();
  });

  it("pré-remplit le formulaire à partir d'un lien de partage (initialShareData)", () => {
    const shared = { id: "shared-1", name: "Simulation partagée", dividendeAnnuelFiliale: 77000 };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shared))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    render(<HoldingSimulatorPage initialShareData={encoded} />);
    expect((screen.getByLabelText(/Nom de la simulation/i) as HTMLInputElement).value).toBe("Simulation partagée");
    expect((screen.getByLabelText(/Dividende annuel versé par la filiale/i) as HTMLInputElement).value).toBe("77000");
  });
});
