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

import type { ImpositionSociete } from "./companyTypes";

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

/** Champs communs à tout simulateur ayant besoin de chiffrer l'économie d'impôt société d'une charge déductible. */
export interface CompanyTaxContext {
  impositionSociete: ImpositionSociete;
  beneficeAvantChargePrevisionnel: number;
  eligibleTauxReduitPME: boolean;
  corporateTaxRate: number;
}

/**
 * Économie d'impôt société générée par une charge déductible, quel que soit le régime : IS
 * (barème progressif + plafonnement par le bénéfice réel, cf. computeEconomieImpotIS) ou IR
 * (société translucide — le bénéfice est déjà intégré au revenu imposable du foyer, donc le taux
 * marginal du foyer, `tauxIRUtilise`, s'applique directement). Factorisé ici pour être partagé par
 * tous les simulateurs (véhicule, bureau à domicile, rémunération, matériel, mutuelle, retraite...).
 */
export function computeEconomieImpotSociete(ctx: CompanyTaxContext, chargeDeductible: number, tauxIRUtilise: number): number {
  if (ctx.impositionSociete === "IS") {
    return computeEconomieImpotIS(ctx.beneficeAvantChargePrevisionnel, chargeDeductible, ctx.eligibleTauxReduitPME, ctx.corporateTaxRate);
  }
  return chargeDeductible * tauxIRUtilise;
}

/**
 * Impôt dû sur un PRODUIT supplémentaire (produits financiers, subvention...), par différence sur le
 * barème progressif.
 *
 * Ce n'est pas le symétrique de `computeEconomieImpotIS` : une charge fait DESCENDRE le bénéfice et
 * s'impute donc sur les tranches situées SOUS lui, tandis qu'un produit le fait MONTER et se taxe
 * sur celles situées AU-DESSUS. Une société à 40 000 € de bénéfice économise 15 % sur une charge et
 * paie 25 % sur la fraction d'un produit qui la porte au-delà de 42 500 € : réutiliser la fonction
 * « charge » sous-estimerait l'impôt, et donc surestimerait le rendement net d'un placement.
 */
export function computeImpotSurProduitIS(
  beneficeAvantProduit: number,
  produit: number,
  eligibleTauxReduit: boolean,
  tauxNormal: number,
): number {
  const isAvant = computeIS(beneficeAvantProduit, eligibleTauxReduit, tauxNormal);
  const isApres = computeIS(beneficeAvantProduit + Math.max(0, produit), eligibleTauxReduit, tauxNormal);
  return Math.max(0, isApres - isAvant);
}

/** Idem, quel que soit le régime — IS au barème progressif, ou IR au taux marginal du foyer. */
export function computeImpotSurProduitSociete(ctx: CompanyTaxContext, produit: number, tauxIRUtilise: number): number {
  if (ctx.impositionSociete === "IS") {
    return computeImpotSurProduitIS(ctx.beneficeAvantChargePrevisionnel, produit, ctx.eligibleTauxReduitPME, ctx.corporateTaxRate);
  }
  return Math.max(0, produit) * tauxIRUtilise;
}
