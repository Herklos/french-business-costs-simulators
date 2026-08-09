// Fiscalité additionnelle du véhicule de société, identifiée lors de l'audit du simulateur :
//  - Plafond de déduction fiscale de l'amortissement (ou des loyers LOA/LLD) selon les émissions
//    de CO2 — art. 39-4 CGI. La fraction excédentaire n'est pas déductible du résultat.
//  - Taxes annuelles sur l'affectation des véhicules de tourisme à des fins économiques
//    (ex-TVS, scindée depuis 2023 en taxe CO2 + taxe polluants), exonérées pour les véhicules
//    100% électriques/hydrogène.
// Le malus écologique (CO2 + poids) est un coût ponctuel intégré à la facture d'achat : on
// considère qu'il est déjà compris dans le "prix d'achat TTC" saisi par l'utilisateur, il n'est
// donc pas recalculé séparément ici (voir note dans le registre des règles fiscales).

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
