// Intéressement du dirigeant — depuis la loi PACTE (2019), un dirigeant de société de moins de 250
// salariés peut bénéficier du dispositif d'intéressement au même titre que ses salariés (auparavant
// réservé aux seuls salariés). Calculateur autonome, non intégré au moteur salaire/dividendes
// principal (montage optionnel, non exclusif des deux autres canaux).

import { type CompanyTaxContext, computeEconomieImpotSociete } from "./corporateTax";

export const FORFAIT_SOCIAL_TAUX_STANDARD = 0.2; // taux de droit commun
export const CSG_CRDS_TAUX = 0.097; // dû dans tous les cas sur les revenus d'activité, y compris intéressement

export interface InteressementInputs {
  montantAnnuel: number;
  entrepriseMoinsDe250Salaries: boolean; // loi PACTE : exonération de forfait social si vrai
  placeSurPlanEpargneSalariale: boolean; // PEE/PERCO : exonère l'IR (mais pas la CSG-CRDS), sinon soumis au barème
}

export function createDefaultInteressementInputs(): InteressementInputs {
  return {
    montantAnnuel: 5000,
    entrepriseMoinsDe250Salaries: true,
    placeSurPlanEpargneSalariale: false,
  };
}

export interface InteressementResults {
  forfaitSocial: number;
  economieImpotSociete: number;
  coutNetSociete: number;
  csgCrds: number;
  irSurInteressement: number;
  netDirigeant: number;
}

export function computeInteressement(
  inputs: InteressementInputs,
  ctx: CompanyTaxContext,
  tauxIRUtilise: number,
): InteressementResults {
  const montant = Math.max(0, inputs.montantAnnuel);
  const forfaitSocial = inputs.entrepriseMoinsDe250Salaries ? 0 : montant * FORFAIT_SOCIAL_TAUX_STANDARD;
  const chargeTotaleSociete = montant + forfaitSocial;
  const economieImpotSociete = computeEconomieImpotSociete(ctx, chargeTotaleSociete, tauxIRUtilise);
  const coutNetSociete = chargeTotaleSociete - economieImpotSociete;

  const csgCrds = montant * CSG_CRDS_TAUX;
  const irSurInteressement = inputs.placeSurPlanEpargneSalariale ? 0 : montant * tauxIRUtilise;
  const netDirigeant = montant - csgCrds - irSurInteressement;

  return { forfaitSocial, economieImpotSociete, coutNetSociete, csgCrds, irSurInteressement, netDirigeant };
}
