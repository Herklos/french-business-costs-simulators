// Simulateur : matériel professionnel (informatique, mobilier) — achat par la société, LOA/leasing,
// ou achat personnel par le dirigeant remboursé (note de frais) ou non remboursé.
//
// Principe : une immobilisation (matériel informatique, mobilier de bureau) se déduit du résultat
// de la société soit immédiatement en charge (si son prix HT unitaire n'excède pas 500€, tolérance
// dite du « petit matériel », art. 39-1 3° CGI / BOI-BIC-CHG-20-30-10), soit par amortissement
// linéaire sur sa durée d'usage. Quatre montages sont comparés à coût d'achat identique :
//  - "societe" : la société achète directement le matériel — charge/amortissement déductible.
//  - "personnel_rembourse" : le dirigeant avance l'achat puis se fait rembourser via note de frais
//    — fiscalement IDENTIQUE au montage société (même charge déductible), simple différence de
//    circuit de paiement. Modélisé séparément pour lever une confusion fréquente : "le matériel
//    payé par le dirigeant n'est pas déductible" est FAUX tant qu'il est remboursé et affecté à
//    l'usage professionnel.
//  - "personnel_non_rembourse" : le dirigeant paie de sa poche, sans remboursement — aucune charge
//    déductible côté société, coût intégralement supporté par le dirigeant sur des revenus déjà
//    taxés (aucun avantage fiscal).
//  - "loa" : location avec option d'achat — les loyers sont intégralement déductibles en charge
//    (pas d'amortissement), sans plafond de déduction fiscale spécifique pour du matériel standard
//    (contrairement au véhicule de tourisme, art. 39-4 CGI, propre aux véhicules).
//
// Deux extensions supplémentaires, indépendantes du montage retenu :
//  - Plan de renouvellement périodique : projette le coût sur un horizon pluriannuel en répétant le
//    cycle d'acquisition (achat ou LOA) à son terme, avec une inflation du prix optionnelle.
//  - Usage mixte pro/privé : si le dirigeant utilise aussi le matériel à titre personnel, un
//    avantage en nature (AEN) est généré au prorata de l'usage privé — même logique que pour un
//    véhicule de société (BOI-RSA-BASE-30-50), mais sans abattement spécifique (propre au véhicule
//    électrique).

import { type CompanyTaxContext, computeEconomieImpotSociete } from "./corporateTax";
import { type PersonalTaxProfile, createDefaultPersonalTaxProfile, resolvePersonalTaxProfile } from "./frenchIncomeTax";
import type { ImpositionSociete } from "./companyTypes";

export const SEUIL_CHARGE_IMMEDIATE_HT = 500; // art. 39-1 3° CGI — petit matériel, non revalorisé depuis des décennies

export type CategorieMateriel = "informatique" | "mobilier" | "outillage" | "autre";
export type ModeAcquisitionMateriel = "societe" | "personnel_rembourse" | "personnel_non_rembourse" | "loa";

export const DUREE_AMORTISSEMENT_PAR_CATEGORIE: Record<CategorieMateriel, number> = {
  informatique: 3, // matériel informatique/bureautique : usage 3 ans (doctrine BOFiP courante)
  mobilier: 8, // mobilier de bureau : usage 8-10 ans, 8 retenu par défaut
  outillage: 7, // matériel et outillage industriels/d'atelier : usage 5 à 10 ans selon la nature, 7 retenu par défaut (doctrine BOFiP courante)
  autre: 5,
};

export const CATEGORIE_LABELS: Record<CategorieMateriel, string> = {
  informatique: "Matériel informatique / bureautique",
  mobilier: "Mobilier de bureau",
  outillage: "Outillage / matériel d'atelier professionnel",
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

  // LOA / leasing (utilisé si modeAcquisition === "loa")
  loaLoyerMensuel: number;
  loaDureeMois: number;

  // Plan de renouvellement périodique — indépendant du montage retenu.
  horizonRenouvellementAnnees: number; // durée totale de projection (plusieurs cycles d'achat/LOA successifs)
  tauxInflationMateriel: number; // 0-1, hausse de prix estimée entre deux cycles de renouvellement

  // Usage mixte pro/privé — génère un avantage en nature (AEN) au prorata de l'usage privé.
  usagePrivePercent: number; // 0-100
  tauxChargesSocialesAEN: number; // taux de charges sociales appliqué à l'AEN (TNS ou assimilé salarié)

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
    loaLoyerMensuel: 55,
    loaDureeMois: 36,
    horizonRenouvellementAnnees: DUREE_AMORTISSEMENT_PAR_CATEGORIE.informatique,
    tauxInflationMateriel: 0,
    usagePrivePercent: 0,
    tauxChargesSocialesAEN: 0.43,
    personalTaxProfile: createDefaultPersonalTaxProfile(),
  };
}

export interface MaterielResults {
  eligibleChargeImmediate: boolean; // prixHT ≤ 500€ : déduction immédiate en charge plutôt qu'amortissement (jamais vrai en LOA)
  chargeAnnee1: number; // charge déductible la 1ère année (prix total si charge immédiate, sinon 1 annuité ou 1 an de loyers LOA)
  annuiteAmortissement: number; // annuité des années suivantes (0 si charge immédiate)
  economieImpotAnnee1: number;
  coutNetSocieteAnnee1: number;
  coutNetSocieteTotalSurDuree: number; // somme des coûts nets société sur toute la durée d'amortissement/LOA (ou année 1 seule si charge immédiate)
  coutDirigeantNonRembourse: number; // = prixHT si non remboursé, 0 sinon (aucun avantage fiscal, aucune récupération)
  economieVsNonRembourse: number; // gain total (société+dirigeant) à faire financer/rembourser le matériel par la société plutôt que de l'acheter sans remboursement

  // Plan de renouvellement périodique
  dureeCycleAnnees: number; // durée d'un cycle (amortissement, LOA, ou simple durée d'usage si charge immédiate)
  nombreCycles: number; // nombre de cycles de renouvellement sur l'horizon choisi
  coutTotalSurHorizon: number; // coût net société cumulé sur l'horizon, cycles successifs avec inflation éventuelle

  // Usage mixte pro/privé (avantage en nature)
  aenAnnuelle: number;
  cotisationsSocialesAEN: number;
  irSurAEN: number;
  coutDirigeantAEN: number; // cotisations sociales + IR sur l'AEN, à la charge du dirigeant

  coutNetGlobalAnnee1: number; // coût net société + coût dirigeant (non remboursé et/ou AEN), année 1 — cf. calcul dans computeMateriel
}

export function computeMateriel(inputs: MaterielInputs): MaterielResults {
  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  const tauxIRUtilise = resolvedTax.tauxUtilise;
  const ctx: CompanyTaxContext = inputs;

  const isLoa = inputs.modeAcquisition === "loa";
  const eligibleChargeImmediate = !isLoa && inputs.prixHT > 0 && inputs.prixHT <= SEUIL_CHARGE_IMMEDIATE_HT;
  const dureeCycleAnnees = isLoa ? Math.max(1, inputs.loaDureeMois) / 12 : Math.max(1, inputs.dureeAmortissementAnnees);

  const chargeAnnee1 = isLoa
    ? Math.max(0, inputs.loaLoyerMensuel) * 12
    : eligibleChargeImmediate
      ? inputs.prixHT
      : inputs.prixHT / dureeCycleAnnees;
  const annuiteAmortissement = eligibleChargeImmediate ? 0 : chargeAnnee1;

  // Les montages "société", "personnel remboursé" et "loa" ont tous une charge déductible côté
  // société — seul le montage "non remboursé" en diffère, cf. note de module.
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
      coutNetSocieteTotalSurDuree = (annuiteAmortissement - economieImpotParAnnuite) * dureeCycleAnnees;
    }
  }

  const coutDirigeantNonRembourse = inputs.modeAcquisition === "personnel_non_rembourse" ? inputs.prixHT : 0;
  // Gain, tous montants confondus, du montage retenu par rapport à un achat personnel jamais
  // remboursé (coût plein prixHT, sans aucune déduction) : nul par construction pour ce dernier
  // montage lui-même (comparé à lui-même), positif pour les deux autres.
  const economieVsNonRembourse = inputs.prixHT - coutNetSocieteTotalSurDuree - coutDirigeantNonRembourse;

  // Plan de renouvellement périodique : répète le cycle d'acquisition sur l'horizon choisi, avec une
  // inflation optionnelle du prix (donc du coût net) à chaque nouveau cycle.
  const nombreCycles = Math.max(1, Math.round(Math.max(0, inputs.horizonRenouvellementAnnees) / dureeCycleAnnees));
  let coutTotalSurHorizon = 0;
  for (let cycle = 0; cycle < nombreCycles; cycle++) {
    coutTotalSurHorizon += coutNetSocieteTotalSurDuree * Math.pow(1 + inputs.tauxInflationMateriel, cycle);
  }

  // Usage mixte pro/privé : avantage en nature au prorata de l'usage privé, sur la même base que la
  // charge déductible annuelle — uniquement si le matériel est financé par la société (un dirigeant
  // qui paie sans être remboursé utilise déjà son propre bien, aucun avantage en nature à chiffrer).
  const usageRatio = Math.min(Math.max(inputs.usagePrivePercent, 0), 100) / 100;
  const aenAnnuelle = estFinanceParLaSociete ? chargeAnnee1 * usageRatio : 0;
  const cotisationsSocialesAEN = aenAnnuelle * inputs.tauxChargesSocialesAEN;
  const irSurAEN = aenAnnuelle * tauxIRUtilise;
  const coutDirigeantAEN = cotisationsSocialesAEN + irSurAEN;

  // Coût net GLOBAL année 1, pour le dirigeant et sa société pris ENSEMBLE (utilisé par la vue
  // consolidée multi-simulateurs) : coût net société + coût personnel non remboursé (payé cash par
  // le dirigeant, sans aucune charge société) + coût dirigeant lié à l'AEN d'usage mixte. Les deux
  // derniers termes sont mutuellement exclusifs par construction (l'AEN ne se déclenche que si le
  // matériel est financé par la société, donc jamais en même temps qu'un achat non remboursé).
  const coutNetGlobalAnnee1 = coutNetSocieteAnnee1 + coutDirigeantNonRembourse + coutDirigeantAEN;

  return {
    eligibleChargeImmediate,
    chargeAnnee1,
    annuiteAmortissement,
    economieImpotAnnee1,
    coutNetSocieteAnnee1,
    coutNetSocieteTotalSurDuree,
    coutDirigeantNonRembourse,
    economieVsNonRembourse,
    dureeCycleAnnees,
    nombreCycles,
    coutTotalSurHorizon,
    aenAnnuelle,
    cotisationsSocialesAEN,
    irSurAEN,
    coutDirigeantAEN,
    coutNetGlobalAnnee1,
  };
}
