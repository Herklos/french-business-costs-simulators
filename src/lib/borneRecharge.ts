// Borne de recharge professionnelle (IRVE — Installation de Recharge pour Véhicules Électriques) et
// indemnité de recharge à domicile, pour un véhicule de société 100% électrique.
//
// Deux dispositifs distincts, cumulables :
//  - Crédit d'impôt IRVE (art. 200 quater C CGI) : 75% du prix de revient TTC de l'achat et de la
//    pose d'un système de charge sur un lieu de travail, plafonné à 20 000€ par système de charge —
//    un CRÉDIT d'impôt s'impute directement sur l'IS dû (pas une simple déduction de charge). Le
//    solde non couvert par le crédit reste immobilisé et amorti normalement.
//  - Indemnité de recharge à domicile : lorsque le dirigeant recharge le véhicule de fonction à son
//    domicile personnel, la société peut lui rembourser ce coût d'électricité via une indemnité
//    forfaitaire, déductible du résultat société et non imposable pour le dirigeant dans la limite
//    du forfait URSSAF.

import { type CompanyTaxContext, computeEconomieImpotSociete } from "./corporateTax";

export const IRVE_TAUX_CREDIT_IMPOT = 0.75;
export const IRVE_PLAFOND_CREDIT_IMPOT = 20000; // par système de charge
export const IRVE_DUREE_AMORTISSEMENT_DEFAUT = 5; // années, matériel électrique/électronique

export const INDEMNITE_RECHARGE_DOMICILE_MENSUELLE_DEFAUT = 30; // €/mois, ordre de grandeur du forfait URSSAF

export interface BorneRechargeInputs {
  coutInstallationTTC: number; // achat + pose de la borne
  dureeAmortissementAnnees: number;
  indemniteRechargeDomicileMensuelle: number;
}

export function createDefaultBorneRechargeInputs(): BorneRechargeInputs {
  return {
    coutInstallationTTC: 1500,
    dureeAmortissementAnnees: IRVE_DUREE_AMORTISSEMENT_DEFAUT,
    indemniteRechargeDomicileMensuelle: INDEMNITE_RECHARGE_DOMICILE_MENSUELLE_DEFAUT,
  };
}

export interface BorneRechargeResults {
  creditImpotIRVE: number;
  coutNetApresCreditImpot: number; // base restant à amortir après imputation du crédit d'impôt
  annuiteAmortissement: number;
  economieImpotAnnuelleAmortissement: number;
  coutNetSocieteAnnee1: number; // annuité − économie d'impôt − crédit d'impôt (année d'installation uniquement)
  coutNetSocieteAnneesSuivantes: number; // annuité − économie d'impôt (années suivantes, sans le crédit)
  indemniteRechargeAnnuelle: number;
  economieImpotIndemniteRecharge: number;
  coutNetIndemniteRecharge: number;
}

/** Calcule le coût net de l'installation d'une borne de recharge professionnelle et de l'indemnité de recharge à domicile. */
export function computeBorneRecharge(inputs: BorneRechargeInputs, ctx: CompanyTaxContext, tauxIRUtilise: number): BorneRechargeResults {
  const creditImpotIRVE = Math.min(inputs.coutInstallationTTC * IRVE_TAUX_CREDIT_IMPOT, IRVE_PLAFOND_CREDIT_IMPOT);
  const coutNetApresCreditImpot = Math.max(0, inputs.coutInstallationTTC - creditImpotIRVE);
  const dureeAmortissement = Math.max(1, inputs.dureeAmortissementAnnees);
  const annuiteAmortissement = coutNetApresCreditImpot / dureeAmortissement;
  const economieImpotAnnuelleAmortissement = computeEconomieImpotSociete(ctx, annuiteAmortissement, tauxIRUtilise);

  const coutNetSocieteAnnee1 = annuiteAmortissement - economieImpotAnnuelleAmortissement - creditImpotIRVE;
  const coutNetSocieteAnneesSuivantes = annuiteAmortissement - economieImpotAnnuelleAmortissement;

  const indemniteRechargeAnnuelle = Math.max(0, inputs.indemniteRechargeDomicileMensuelle) * 12;
  const economieImpotIndemniteRecharge = computeEconomieImpotSociete(ctx, indemniteRechargeAnnuelle, tauxIRUtilise);
  const coutNetIndemniteRecharge = indemniteRechargeAnnuelle - economieImpotIndemniteRecharge;

  return {
    creditImpotIRVE,
    coutNetApresCreditImpot,
    annuiteAmortissement,
    economieImpotAnnuelleAmortissement,
    coutNetSocieteAnnee1,
    coutNetSocieteAnneesSuivantes,
    indemniteRechargeAnnuelle,
    economieImpotIndemniteRecharge,
    coutNetIndemniteRecharge,
  };
}
