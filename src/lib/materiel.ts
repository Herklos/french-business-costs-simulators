// Simulateur : matériel professionnel (informatique, mobilier) — achat par la société, ou achat
// personnel par le dirigeant remboursé (note de frais) ou non remboursé.
//
// Principe : une immobilisation (matériel informatique, mobilier de bureau) se déduit du résultat
// de la société soit immédiatement en charge (si son prix HT unitaire n'excède pas 500€, tolérance
// dite du « petit matériel », art. 39-1 3° CGI / BOI-BIC-CHG-20-30-10), soit par amortissement
// linéaire sur sa durée d'usage. Trois montages sont comparés à coût d'achat identique :
//  - "societe" : la société achète directement le matériel — charge/amortissement déductible.
//  - "personnel_rembourse" : le dirigeant avance l'achat puis se fait rembourser via note de frais
//    — fiscalement IDENTIQUE au montage société (même charge déductible), simple différence de
//    circuit de paiement. Modélisé séparément pour lever une confusion fréquente : "le matériel
//    payé par le dirigeant n'est pas déductible" est FAUX tant qu'il est remboursé et affecté à
//    l'usage professionnel.
//  - "personnel_non_rembourse" : le dirigeant paie de sa poche, sans remboursement — aucune charge
//    déductible côté société, coût intégralement supporté par le dirigeant sur des revenus déjà
//    taxés (aucun avantage fiscal).

import { type CompanyTaxContext, computeEconomieImpotSociete } from "./corporateTax";
import { type PersonalTaxProfile, createDefaultPersonalTaxProfile, resolvePersonalTaxProfile } from "./frenchIncomeTax";
import type { ImpositionSociete } from "./companyTypes";

export const SEUIL_CHARGE_IMMEDIATE_HT = 500; // art. 39-1 3° CGI — petit matériel, non revalorisé depuis des décennies

export type CategorieMateriel = "informatique" | "mobilier" | "autre";
export type ModeAcquisitionMateriel = "societe" | "personnel_rembourse" | "personnel_non_rembourse";

export const DUREE_AMORTISSEMENT_PAR_CATEGORIE: Record<CategorieMateriel, number> = {
  informatique: 3, // matériel informatique/bureautique : usage 3 ans (doctrine BOFiP courante)
  mobilier: 8, // mobilier de bureau : usage 8-10 ans, 8 retenu par défaut
  autre: 5,
};

export const CATEGORIE_LABELS: Record<CategorieMateriel, string> = {
  informatique: "Matériel informatique / bureautique",
  mobilier: "Mobilier de bureau",
  autre: "Autre matériel professionnel",
};

export interface MaterielInputs {
  id: string;
  name: string;
  createdAt: string;

  country: string;
  impositionSociete: ImpositionSociete;
  corporateTaxRate: number;
  eligibleTauxReduitPME: boolean;
  beneficeAvantChargePrevisionnel: number;

  categorie: CategorieMateriel;
  prixHT: number;
  dureeAmortissementAnnees: number; // pré-rempli selon la catégorie, éditable
  modeAcquisition: ModeAcquisitionMateriel;

  personalTaxProfile: PersonalTaxProfile;
}

export function createDefaultMaterielInputs(): MaterielInputs {
  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation matériel",
    createdAt: new Date().toISOString(),
    country: "FR",
    impositionSociete: "IS",
    corporateTaxRate: 0.25,
    eligibleTauxReduitPME: true,
    beneficeAvantChargePrevisionnel: 40000,
    categorie: "informatique",
    prixHT: 1800,
    dureeAmortissementAnnees: DUREE_AMORTISSEMENT_PAR_CATEGORIE.informatique,
    modeAcquisition: "societe",
    personalTaxProfile: createDefaultPersonalTaxProfile(),
  };
}

export interface MaterielResults {
  eligibleChargeImmediate: boolean; // prixHT ≤ 500€ : déduction immédiate en charge plutôt qu'amortissement
  chargeAnnee1: number; // charge déductible la 1ère année (prix total si charge immédiate, sinon 1 annuité)
  annuiteAmortissement: number; // annuité des années suivantes (0 si charge immédiate)
  economieImpotAnnee1: number;
  coutNetSocieteAnnee1: number;
  coutNetSocieteTotalSurDuree: number; // somme des coûts nets société sur toute la durée d'amortissement (ou année 1 seule si charge immédiate)
  coutDirigeantNonRembourse: number; // = prixHT si non remboursé, 0 sinon (aucun avantage fiscal, aucune récupération)
  economieVsNonRembourse: number; // gain total (société+dirigeant) à faire financer/rembourser le matériel par la société plutôt que de l'acheter sans remboursement
}

export function computeMateriel(inputs: MaterielInputs): MaterielResults {
  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  const tauxIRUtilise = resolvedTax.tauxUtilise;
  const ctx: CompanyTaxContext = inputs;

  const eligibleChargeImmediate = inputs.prixHT > 0 && inputs.prixHT <= SEUIL_CHARGE_IMMEDIATE_HT;
  const dureeAmortissement = Math.max(1, inputs.dureeAmortissementAnnees);

  const chargeAnnee1 = eligibleChargeImmediate ? inputs.prixHT : inputs.prixHT / dureeAmortissement;
  const annuiteAmortissement = eligibleChargeImmediate ? 0 : chargeAnnee1;

  // Les deux montages "société" et "personnel remboursé" ont exactement le même traitement fiscal
  // (charge déductible identique) — seul le montage "non remboursé" en diffère, cf. note de module.
  const estFinanceParLaSociete = inputs.modeAcquisition !== "personnel_non_rembourse";

  const economieImpotAnnee1 = estFinanceParLaSociete ? computeEconomieImpotSociete(ctx, chargeAnnee1, tauxIRUtilise) : 0;
  const coutNetSocieteAnnee1 = estFinanceParLaSociete ? chargeAnnee1 - economieImpotAnnee1 : 0;

  let coutNetSocieteTotalSurDuree = 0;
  if (estFinanceParLaSociete) {
    if (eligibleChargeImmediate) {
      coutNetSocieteTotalSurDuree = coutNetSocieteAnnee1;
    } else {
      // Même économie d'impôt sur chaque annuité (bénéfice prévisionnel supposé stable sur la durée) —
      // simplification raisonnable pour une projection indicative.
      const economieImpotParAnnuite = computeEconomieImpotSociete(ctx, annuiteAmortissement, tauxIRUtilise);
      coutNetSocieteTotalSurDuree = (annuiteAmortissement - economieImpotParAnnuite) * dureeAmortissement;
    }
  }

  const coutDirigeantNonRembourse = inputs.modeAcquisition === "personnel_non_rembourse" ? inputs.prixHT : 0;
  // Gain, tous montants confondus, du montage retenu par rapport à un achat personnel jamais
  // remboursé (coût plein prixHT, sans aucune déduction) : nul par construction pour ce dernier
  // montage lui-même (comparé à lui-même), positif pour les deux autres.
  const economieVsNonRembourse = inputs.prixHT - coutNetSocieteTotalSurDuree - coutDirigeantNonRembourse;

  return {
    eligibleChargeImmediate,
    chargeAnnee1,
    annuiteAmortissement,
    economieImpotAnnee1,
    coutNetSocieteAnnee1,
    coutNetSocieteTotalSurDuree,
    coutDirigeantNonRembourse,
    economieVsNonRembourse,
  };
}
