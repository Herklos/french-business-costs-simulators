import { describe, expect, it } from "vitest";
import {
  IRVE_PLAFOND_CREDIT_IMPOT,
  IRVE_TAUX_CREDIT_IMPOT,
  type BorneRechargeInputs,
  computeBorneRecharge,
  createDefaultBorneRechargeInputs,
} from "./borneRecharge";
import type { CompanyTaxContext } from "./corporateTax";

const ctxIS: CompanyTaxContext = {
  impositionSociete: "IS",
  beneficeAvantChargePrevisionnel: 40000,
  eligibleTauxReduitPME: true,
  corporateTaxRate: 0.25,
};

function withPatch(patch: Partial<BorneRechargeInputs> = {}): BorneRechargeInputs {
  return { ...createDefaultBorneRechargeInputs(), ...patch };
}

describe("computeBorneRecharge — crédit d'impôt IRVE", () => {
  it("75% du coût d'installation, sous le plafond", () => {
    const r = computeBorneRecharge(withPatch({ coutInstallationTTC: 2000 }), ctxIS, 0.3);
    expect(r.creditImpotIRVE).toBeCloseTo(2000 * IRVE_TAUX_CREDIT_IMPOT, 6);
  });

  it("plafonné à 20 000€ par système de charge", () => {
    const r = computeBorneRecharge(withPatch({ coutInstallationTTC: 100000 }), ctxIS, 0.3);
    expect(r.creditImpotIRVE).toBe(IRVE_PLAFOND_CREDIT_IMPOT);
  });

  it("le solde restant à amortir est net du crédit d'impôt", () => {
    const r = computeBorneRecharge(withPatch({ coutInstallationTTC: 2000 }), ctxIS, 0.3);
    expect(r.coutNetApresCreditImpot).toBeCloseTo(2000 - r.creditImpotIRVE, 6);
  });
});

describe("computeBorneRecharge — amortissement", () => {
  it("annuité = coût net après crédit / durée", () => {
    const r = computeBorneRecharge(withPatch({ coutInstallationTTC: 2000, dureeAmortissementAnnees: 5 }), ctxIS, 0.3);
    expect(r.annuiteAmortissement).toBeCloseTo(r.coutNetApresCreditImpot / 5, 6);
  });

  it("le coût net société année 1 inclut le crédit d'impôt, les années suivantes non", () => {
    const r = computeBorneRecharge(withPatch({ coutInstallationTTC: 2000 }), ctxIS, 0.3);
    expect(r.coutNetSocieteAnnee1).toBeLessThan(r.coutNetSocieteAnneesSuivantes);
    expect(r.coutNetSocieteAnneesSuivantes - r.coutNetSocieteAnnee1).toBeCloseTo(r.creditImpotIRVE, 6);
  });
});

describe("computeBorneRecharge — indemnité de recharge à domicile", () => {
  it("indemnité annuelle = mensuelle × 12", () => {
    const r = computeBorneRecharge(withPatch({ indemniteRechargeDomicileMensuelle: 30 }), ctxIS, 0.3);
    expect(r.indemniteRechargeAnnuelle).toBeCloseTo(360, 6);
  });

  it("coût net = indemnité − économie d'impôt société", () => {
    const r = computeBorneRecharge(withPatch({ indemniteRechargeDomicileMensuelle: 30 }), ctxIS, 0.3);
    expect(r.coutNetIndemniteRecharge).toBeCloseTo(r.indemniteRechargeAnnuelle - r.economieImpotIndemniteRecharge, 6);
  });

  it("une indemnité négative saisie par erreur est ramenée à zéro", () => {
    const r = computeBorneRecharge(withPatch({ indemniteRechargeDomicileMensuelle: -10 }), ctxIS, 0.3);
    expect(r.indemniteRechargeAnnuelle).toBe(0);
  });
});

describe("computeBorneRecharge — régime IR (société translucide)", () => {
  it("utilise le taux marginal du foyer plutôt que le barème IS", () => {
    const ctxIR: CompanyTaxContext = { ...ctxIS, impositionSociete: "IR" };
    const r = computeBorneRecharge(withPatch({ coutInstallationTTC: 2000 }), ctxIR, 0.3);
    expect(r.economieImpotAnnuelleAmortissement).toBeCloseTo(r.annuiteAmortissement * 0.3, 6);
  });
});
