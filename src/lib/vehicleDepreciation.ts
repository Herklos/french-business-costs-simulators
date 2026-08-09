// Estimation de la valeur résiduelle (valeur de revente/marché) du véhicule à l'issue de la
// période engagée, selon le mode de financement retenu :
//  - Comptant / Crédit : le véhicule est acquis dès le départ → valeur résiduelle = valeur de
//    marché du véhicule après la durée de détention.
//  - LOA, option d'achat levée : le véhicule est acquis à l'issue du contrat → même chose, sur la
//    durée du contrat LOA (l'option d'achat elle-même est déjà comptée comme un coût séparé,
//    cf. simulator.ts — la valeur résiduelle est ce que vaut le véhicule UNE FOIS acheté).
//  - LOA sans option d'achat levée, et LLD : le véhicule est restitué en fin de contrat → aucune
//    valeur résiduelle pour le dirigeant/la société (comme le loyer d'un logement).
//
// Modèle de décote : simplifié, taux de dépréciation annuel constant (composé), éditable par
// l'utilisateur — les courbes réelles de décote automobile ne sont pas linéaires (plus fortes les
// 1-2 premières années) mais un taux composé constant reste une approximation raisonnable et
// transparente pour un ordre de grandeur.

export const DEFAULT_DEPRECIATION_RATE_ANNUAL = 0.16; // ~16%/an, ordre de grandeur marché de l'occasion en France

export function estimateResidualValue(
  prixTTC: number,
  ageAnnees: number,
  tauxDeprecationAnnuel: number = DEFAULT_DEPRECIATION_RATE_ANNUAL,
): number {
  if (prixTTC <= 0 || ageAnnees <= 0) return Math.max(0, prixTTC);
  const taux = Math.min(1, Math.max(0, tauxDeprecationAnnuel));
  return Math.max(0, prixTTC * Math.pow(1 - taux, ageAnnees));
}
