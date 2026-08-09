// Calcul de l'IS avec barème progressif (taux réduit PME) et prise en compte du bénéfice
// prévisionnel de la société pour chiffrer l'économie d'impôt RÉELLE générée par une charge
// déductible (véhicule, indemnité d'occupation...), plutôt qu'un taux flat appliqué sans
// considération du niveau de rentabilité de l'entreprise.
//
// Deux effets pris en compte :
//  1. Barème progressif : 15% jusqu'à 42 500€ de bénéfice (sous conditions PME), 25% au-delà —
//     la charge déductible peut donc "économiser" à 15%, à 25%, ou à cheval sur les deux tranches
//     selon le niveau de bénéfice avant charge.
//  2. Plafonnement par le bénéfice réel : si le bénéfice prévisionnel avant charge est inférieur
//     à la charge déductible (voire déjà négatif), l'économie d'impôt immédiate est plafonnée à
//     l'IS qui aurait été dû sur ce bénéfice — le surplus de charge ne fait qu'accroître un
//     déficit reportable (avantage différé et incertain, non compté ici comme un gain immédiat).

export const IS_TAUX_REDUIT = 0.15;
export const IS_SEUIL_TAUX_REDUIT = 42500;

/** Calcule l'IS dû sur un bénéfice imposable donné (barème progressif si éligible au taux réduit PME). */
export function computeIS(beneficeImposable: number, eligibleTauxReduit: boolean, tauxNormal: number): number {
  const benefice = Math.max(0, beneficeImposable);
  if (!eligibleTauxReduit) {
    return benefice * tauxNormal;
  }
  const trancheReduite = Math.min(benefice, IS_SEUIL_TAUX_REDUIT);
  const trancheNormale = Math.max(0, benefice - IS_SEUIL_TAUX_REDUIT);
  return trancheReduite * IS_TAUX_REDUIT + trancheNormale * tauxNormal;
}

/**
 * Économie d'impôt réellement générée par une charge déductible supplémentaire, compte tenu du
 * bénéfice prévisionnel avant charge (barème progressif + plafonnement par le bénéfice réel).
 */
export function computeEconomieImpotIS(
  beneficeAvantCharge: number,
  chargeDeductible: number,
  eligibleTauxReduit: boolean,
  tauxNormal: number,
): number {
  const isAvant = computeIS(beneficeAvantCharge, eligibleTauxReduit, tauxNormal);
  const isApres = computeIS(beneficeAvantCharge - chargeDeductible, eligibleTauxReduit, tauxNormal);
  return Math.max(0, isAvant - isApres);
}
