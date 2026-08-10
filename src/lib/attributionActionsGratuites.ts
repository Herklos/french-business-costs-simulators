// Attribution Gratuite d'Actions (AGA) — dispositif réservé aux sociétés par actions (SAS/SASU ;
// impossible en EURL/SARL). C'est l'un des régimes fiscaux français les plus complexes : le
// traitement exact dépend de la date d'attribution (régime "loi Macron" du 8 août 2015, modifié par
// la loi de finances 2018, puis la loi PACTE de 2019), du montant du gain, et d'options d'imposition
// multiples (PFU ou barème progressif, avec abattements pour durée de détention selon le cas).
//
// CE MODULE SIMPLIFIE VOLONTAIREMENT au cas le plus courant aujourd'hui pour une PME : régime post-
// 2018, imposition au Prélèvement Forfaitaire Unique (PFU 30%) sur le gain d'acquisition ET sur le
// gain de cession, exonération de contribution patronale spécifique pour les PME n'ayant jamais
// distribué de dividendes (cas fréquent d'une jeune SASU). D'AUTRES RÉGIMES D'IMPOSITION EXISTENT
// (option barème progressif avec abattements pour durée de détention, contribution salariale
// spécifique de 10% au-delà de 300 000€ de gain...) : ce calculateur donne un ORDRE DE GRANDEUR, pas
// un calcul définitif — l'avis d'un expert-comptable est fortement recommandé avant toute décision.

import { type CompanyTaxContext, computeEconomieImpotSociete } from "./corporateTax";

export const PFU_TAUX_GLOBAL_AGA = 0.3; // simplification : PFU appliqué au gain d'acquisition ET au gain de cession
export const CONTRIBUTION_PATRONALE_TAUX_STANDARD = 0.2; // hors exonération PME

export interface AttributionActionsGratuitesInputs {
  valeurActionsAttribution: number; // valeur des actions au jour de l'acquisition définitive (fin de période d'acquisition)
  prixCessionEstime: number; // valeur de revente estimée au jour de la cession
  pmeExonereeContributionPatronale: boolean; // PME n'ayant jamais distribué de dividendes depuis sa création : exonérée de la contribution patronale de 20%
}

export function createDefaultAttributionActionsGratuitesInputs(): AttributionActionsGratuitesInputs {
  return {
    valeurActionsAttribution: 20000,
    prixCessionEstime: 30000,
    pmeExonereeContributionPatronale: true,
  };
}

export interface AttributionActionsGratuitesResults {
  contributionPatronale: number;
  economieImpotSociete: number;
  coutNetSociete: number;
  gainAcquisition: number;
  impotGainAcquisition: number; // PFU simplifié
  gainCession: number;
  impotGainCession: number; // PFU simplifié
  netBeneficiaire: number;
}

export function computeAttributionActionsGratuites(
  inputs: AttributionActionsGratuitesInputs,
  ctx: CompanyTaxContext,
  tauxIRUtilise: number,
): AttributionActionsGratuitesResults {
  const valeurAttribution = Math.max(0, inputs.valeurActionsAttribution);
  const contributionPatronale = inputs.pmeExonereeContributionPatronale ? 0 : valeurAttribution * CONTRIBUTION_PATRONALE_TAUX_STANDARD;
  const economieImpotSociete = computeEconomieImpotSociete(ctx, contributionPatronale, tauxIRUtilise);
  const coutNetSociete = contributionPatronale - economieImpotSociete;

  const gainAcquisition = valeurAttribution;
  const impotGainAcquisition = gainAcquisition * PFU_TAUX_GLOBAL_AGA;

  const gainCession = Math.max(0, inputs.prixCessionEstime - valeurAttribution);
  const impotGainCession = gainCession * PFU_TAUX_GLOBAL_AGA;

  const netBeneficiaire = Math.max(0, inputs.prixCessionEstime - impotGainAcquisition - impotGainCession);

  return {
    contributionPatronale,
    economieImpotSociete,
    coutNetSociete,
    gainAcquisition,
    impotGainAcquisition,
    gainCession,
    impotGainCession,
    netBeneficiaire,
  };
}
