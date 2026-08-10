import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_PATRONALE_TAUX_STANDARD,
  PFU_TAUX_GLOBAL_AGA,
  type AttributionActionsGratuitesInputs,
  computeAttributionActionsGratuites,
  createDefaultAttributionActionsGratuitesInputs,
} from "./attributionActionsGratuites";
import type { CompanyTaxContext } from "./corporateTax";

const ctxIS: CompanyTaxContext = {
  impositionSociete: "IS",
  beneficeAvantChargePrevisionnel: 40000,
  eligibleTauxReduitPME: true,
  corporateTaxRate: 0.25,
};

function withPatch(patch: Partial<AttributionActionsGratuitesInputs> = {}): AttributionActionsGratuitesInputs {
  return { ...createDefaultAttributionActionsGratuitesInputs(), ...patch };
}

describe("computeAttributionActionsGratuites — contribution patronale", () => {
  it("exonérée pour une PME n'ayant jamais distribué de dividendes", () => {
    const r = computeAttributionActionsGratuites(
      withPatch({ pmeExonereeContributionPatronale: true, valeurActionsAttribution: 20000 }),
      ctxIS,
      0.3,
    );
    expect(r.contributionPatronale).toBe(0);
  });

  it("20% de la valeur d'attribution hors exonération", () => {
    const r = computeAttributionActionsGratuites(
      withPatch({ pmeExonereeContributionPatronale: false, valeurActionsAttribution: 20000 }),
      ctxIS,
      0.3,
    );
    expect(r.contributionPatronale).toBeCloseTo(20000 * CONTRIBUTION_PATRONALE_TAUX_STANDARD, 6);
  });
});

describe("computeAttributionActionsGratuites — gains et imposition (PFU simplifié)", () => {
  it("le gain d'acquisition = valeur des actions à l'attribution", () => {
    const r = computeAttributionActionsGratuites(withPatch({ valeurActionsAttribution: 20000 }), ctxIS, 0.3);
    expect(r.gainAcquisition).toBeCloseTo(20000, 6);
    expect(r.impotGainAcquisition).toBeCloseTo(20000 * PFU_TAUX_GLOBAL_AGA, 6);
  });

  it("le gain de cession = prix de cession − valeur d'attribution, jamais négatif", () => {
    const gagnant = computeAttributionActionsGratuites(
      withPatch({ valeurActionsAttribution: 20000, prixCessionEstime: 30000 }),
      ctxIS,
      0.3,
    );
    expect(gagnant.gainCession).toBeCloseTo(10000, 6);

    const perdant = computeAttributionActionsGratuites(
      withPatch({ valeurActionsAttribution: 20000, prixCessionEstime: 15000 }),
      ctxIS,
      0.3,
    );
    expect(perdant.gainCession).toBe(0);
  });

  it("le net bénéficiaire = prix de cession − impôts sur les deux gains", () => {
    const r = computeAttributionActionsGratuites(
      withPatch({ valeurActionsAttribution: 20000, prixCessionEstime: 30000 }),
      ctxIS,
      0.3,
    );
    expect(r.netBeneficiaire).toBeCloseTo(30000 - r.impotGainAcquisition - r.impotGainCession, 6);
  });
});

describe("computeAttributionActionsGratuites — coût société", () => {
  it("le coût net société = contribution patronale − économie d'impôt", () => {
    const r = computeAttributionActionsGratuites(
      withPatch({ pmeExonereeContributionPatronale: false, valeurActionsAttribution: 20000 }),
      ctxIS,
      0.3,
    );
    expect(r.coutNetSociete).toBeCloseTo(r.contributionPatronale - r.economieImpotSociete, 6);
  });

  it("valeur d'attribution nulle : tous les résultats à zéro ou nuls", () => {
    const r = computeAttributionActionsGratuites(
      withPatch({ valeurActionsAttribution: 0, prixCessionEstime: 0 }),
      ctxIS,
      0.3,
    );
    expect(r.contributionPatronale).toBe(0);
    expect(r.gainAcquisition).toBe(0);
    expect(r.netBeneficiaire).toBe(0);
  });
});
