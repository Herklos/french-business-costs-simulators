// Fiscalité additionnelle du véhicule de société, identifiée lors de l'audit du simulateur :
//  - Plafond de déduction fiscale de l'amortissement (ou des loyers LOA/LLD) selon les émissions
//    de CO2 — art. 39-4 CGI. La fraction excédentaire n'est pas déductible du résultat.
//  - Taxes annuelles sur l'affectation des véhicules de tourisme à des fins économiques
//    (ex-TVS, scindée depuis 2023 en taxe CO2 + taxe polluants), exonérées pour les véhicules
//    100% électriques/hydrogène.
// Le malus écologique CO2 est un coût ponctuel intégré à la facture d'achat : on considère qu'il
// est déjà compris dans le "prix d'achat TTC" saisi par l'utilisateur, il n'est donc pas recalculé
// séparément ici. Le malus au poids, en revanche, est estimé ci-dessous à titre INFORMATIF — pour
// aider à vérifier/expliquer un prix catalogue, sans être soustrait automatiquement du prix saisi
// (qui reste, comme le malus CO2, censé déjà l'inclure).

/** Plafond de déduction fiscale de l'amortissement/loyer selon les émissions de CO2 (art. 39-4 CGI). */
export function getPlafondAmortissementDeductible(co2EmissionsGkm: number, isElectric: boolean): number {
  if (isElectric || co2EmissionsGkm < 20) return 30000;
  if (co2EmissionsGkm <= 49) return 20300;
  if (co2EmissionsGkm <= 160) return 18300;
  return 9900;
}

/**
 * Estimation simplifiée de la taxe annuelle CO2 + polluants atmosphériques (ex-TVS) pour un
 * véhicule thermique/hybride. Barème officiel progressif par gramme non intégralement repris ici :
 * approximation par paliers calibrée sur les ordres de grandeur publiés (ex. 100 g/km ≈ 213 €/an).
 * À ajuster/vérifier avec le barème officiel de l'année avant application stricte — modifiable
 * manuellement dans le simulateur (champ de surcharge).
 */
export function estimateAnnualVehicleTax(co2EmissionsGkm: number, isElectric: boolean): number {
  if (isElectric) return 0;
  const co2 = Math.max(0, co2EmissionsGkm);
  if (co2 <= 20) return 0;
  if (co2 <= 100) return ((co2 - 20) / (100 - 20)) * 213;
  if (co2 <= 130) return 213 + ((co2 - 100) / (130 - 100)) * (500 - 213);
  if (co2 <= 160) return 500 + ((co2 - 130) / (160 - 130)) * (1000 - 500);
  return Math.min(3000, 1000 + ((co2 - 160) / (250 - 160)) * (3000 - 1000));
}

export const MALUS_POIDS_SEUIL_KG = 1500; // seuil 2026 (cf. règle "malus-ecologique" du registre taxRules.ts)
export const MALUS_POIDS_TAUX_PAR_KG = 10; // €/kg au-delà du seuil — approximation linéaire (barème réel progressif par tranches de 100kg)
export const MALUS_POIDS_PLAFOND = 30000; // plafonné, ne peut excéder 50% du prix d'achat TTC (plafond additionnel non modélisé ici)

/**
 * Estimation simplifiée du malus au poids (taxe sur la masse en ordre de marche), à titre
 * INFORMATIF — ce montant est déjà supposé inclus dans le prix d'achat TTC saisi par ailleurs (au
 * même titre que le malus CO2), il n'est pas soustrait automatiquement. Exonéré pour les véhicules
 * 100% électriques/hydrogène, ainsi que pour certaines familles nombreuses (non modélisé).
 */
export function estimateMalusPoids(weightKg: number, isElectric: boolean): number {
  if (isElectric) return 0;
  const excedent = Math.max(0, weightKg - MALUS_POIDS_SEUIL_KG);
  return Math.min(MALUS_POIDS_PLAFOND, excedent * MALUS_POIDS_TAUX_PAR_KG);
}

