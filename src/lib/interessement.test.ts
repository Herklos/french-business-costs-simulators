import { describe, expect, it } from "vitest";
import {
  CSG_CRDS_TAUX,
  FORFAIT_SOCIAL_TAUX_STANDARD,
  type InteressementInputs,
  computeInteressement,
  createDefaultInteressementInputs,
} from "./interessement";
import type { CompanyTaxContext } from "./corporateTax";

const ctxIS: CompanyTaxContext = {
  impositionSociete: "IS",
  beneficeAvantChargePrevisionnel: 40000,
  eligibleTauxReduitPME: true,
  corporateTaxRate: 0.25,
};

function withPatch(patch: Partial<InteressementInputs> = {}): InteressementInputs {
  return { ...createDefaultInteressementInputs(), ...patch };
}

describe("computeInteressement — forfait social (loi PACTE)", () => {
  it("exonéré de forfait social pour une entreprise de moins de 250 salariés", () => {
    const r = computeInteressement(withPatch({ entrepriseMoinsDe250Salaries: true, montantAnnuel: 5000 }), ctxIS, 0.3);
    expect(r.forfaitSocial).toBe(0);
  });

  it("forfait social à 20% au-delà de 250 salariés", () => {
    const r = computeInteressement(withPatch({ entrepriseMoinsDe250Salaries: false, montantAnnuel: 5000 }), ctxIS, 0.3);
    expect(r.forfaitSocial).toBeCloseTo(5000 * FORFAIT_SOCIAL_TAUX_STANDARD, 6);
  });
});

describe("computeInteressement — CSG-CRDS et IR", () => {
  it("la CSG-CRDS (9,7%) est toujours due, quel que soit le placement", () => {
    const place = computeInteressement(withPatch({ montantAnnuel: 5000, placeSurPlanEpargneSalariale: true }), ctxIS, 0.3);
    const nonPlace = computeInteressement(withPatch({ montantAnnuel: 5000, placeSurPlanEpargneSalariale: false }), ctxIS, 0.3);
    expect(place.csgCrds).toBeCloseTo(5000 * CSG_CRDS_TAUX, 6);
    expect(nonPlace.csgCrds).toBeCloseTo(5000 * CSG_CRDS_TAUX, 6);
  });

  it("placé sur un plan d'épargne salariale : exonéré d'IR", () => {
    const r = computeInteressement(withPatch({ montantAnnuel: 5000, placeSurPlanEpargneSalariale: true }), ctxIS, 0.3);
    expect(r.irSurInteressement).toBe(0);
  });

  it("non placé : soumis à l'IR au taux marginal du foyer", () => {
    const r = computeInteressement(withPatch({ montantAnnuel: 5000, placeSurPlanEpargneSalariale: false }), ctxIS, 0.3);
    expect(r.irSurInteressement).toBeCloseTo(5000 * 0.3, 6);
  });

  it("le net dirigeant = montant − CSG-CRDS − IR éventuel", () => {
    const r = computeInteressement(withPatch({ montantAnnuel: 5000, placeSurPlanEpargneSalariale: false }), ctxIS, 0.3);
    expect(r.netDirigeant).toBeCloseTo(5000 - r.csgCrds - r.irSurInteressement, 6);
  });
});

describe("computeInteressement — coût société", () => {
  it("le coût net société = (montant + forfait social) − économie d'impôt", () => {
    const r = computeInteressement(withPatch({ montantAnnuel: 5000, entrepriseMoinsDe250Salaries: false }), ctxIS, 0.3);
    expect(r.coutNetSociete).toBeCloseTo(5000 + r.forfaitSocial - r.economieImpotSociete, 6);
  });

  it("montant nul : tous les résultats à zéro", () => {
    const r = computeInteressement(withPatch({ montantAnnuel: 0 }), ctxIS, 0.3);
    expect(r.coutNetSociete).toBe(0);
    expect(r.netDirigeant).toBe(0);
  });

  it("un montant négatif saisi par erreur est ramené à zéro", () => {
    const r = computeInteressement(withPatch({ montantAnnuel: -1000 }), ctxIS, 0.3);
    expect(r.netDirigeant).toBe(0);
  });
});
