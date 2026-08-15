// Loyers de marché indicatifs par ville, exprimés en €/m²/mois HORS CHARGES pour un appartement.
//
// Usage : estimer la valeur locative d'un bureau installé au domicile du dirigeant, afin de fixer
// une indemnité d'occupation « cohérente avec le marché » — condition de déductibilité côté société
// (art. 39-1-1° CGI : charge engagée dans l'intérêt de l'exploitation et non excessive) et de
// non-requalification en revenus distribués côté dirigeant (art. 109-1-2° CGI).
//
// Ces valeurs sont des ORDRES DE GRANDEUR de médianes d'agglomération (barèmes de loyers 2025-2026,
// observatoires locaux des loyers et carte des loyers ANIL/data.gouv). Elles ne remplacent pas la
// preuve à constituer en cas de contrôle : 2 ou 3 annonces comparables (même ville, même quartier,
// même surface), datées et archivées, restent la justification de référence.
//
// ATTENTION : les indicateurs de la « carte des loyers » ANIL sont publiés CHARGES COMPRISES. Les
// valeurs ci-dessous sont ramenées hors charges, puisque les charges du logement (électricité,
// chauffage, eau, copropriété...) font l'objet de lignes distinctes dans le simulateur — les
// compter deux fois gonflerait artificiellement l'indemnité.

export interface LoyerVille {
  /** Identifiant stable, utilisé comme valeur du <select> et persisté dans les simulations. */
  id: string;
  label: string;
  /** Loyer de marché indicatif, en €/m²/mois hors charges. */
  prixM2Mensuel: number;
}

/** Valeur retenue quand la ville n'est pas dans la liste (saisie manuelle du €/m²). */
export const VILLE_AUTRE = "autre";

/**
 * Liste triée par prix décroissant : la lecture du <select> donne immédiatement le positionnement
 * relatif de sa ville, ce qu'un classement alphabétique ne montre pas.
 */
export const LOYERS_VILLES: LoyerVille[] = [
  { id: "paris", label: "Paris", prixM2Mensuel: 32 },
  { id: "aix-en-provence", label: "Aix-en-Provence", prixM2Mensuel: 18 },
  { id: "lyon", label: "Lyon", prixM2Mensuel: 16 },
  { id: "annecy", label: "Annecy", prixM2Mensuel: 16 },
  { id: "nice", label: "Nice", prixM2Mensuel: 15 },
  { id: "bordeaux", label: "Bordeaux", prixM2Mensuel: 14.5 },
  { id: "montpellier", label: "Montpellier", prixM2Mensuel: 13.5 },
  { id: "marseille", label: "Marseille", prixM2Mensuel: 13 },
  { id: "nantes", label: "Nantes", prixM2Mensuel: 12.5 },
  { id: "toulouse", label: "Toulouse", prixM2Mensuel: 12 },
  { id: "lille", label: "Lille", prixM2Mensuel: 12 },
  { id: "strasbourg", label: "Strasbourg", prixM2Mensuel: 12 },
  { id: "rennes", label: "Rennes", prixM2Mensuel: 11.5 },
  { id: "grenoble", label: "Grenoble", prixM2Mensuel: 11.5 },
  { id: "tours", label: "Tours", prixM2Mensuel: 11 },
  { id: "angers", label: "Angers", prixM2Mensuel: 10.5 },
  { id: "rouen", label: "Rouen", prixM2Mensuel: 10.5 },
  { id: "dijon", label: "Dijon", prixM2Mensuel: 10.5 },
  { id: "reims", label: "Reims", prixM2Mensuel: 10.5 },
  { id: "clermont-ferrand", label: "Clermont-Ferrand", prixM2Mensuel: 10 },
  { id: "le-havre", label: "Le Havre", prixM2Mensuel: 9.5 },
  { id: "saint-etienne", label: "Saint-Étienne", prixM2Mensuel: 8.5 },
];

/** Loyer de marché retenu par défaut hors des villes référencées (moyenne nationale approchée). */
export const LOYER_M2_DEFAUT_AUTRE = 11;

export function findLoyerVille(id: string): LoyerVille | undefined {
  return LOYERS_VILLES.find((v) => v.id === id);
}

/**
 * Loyer de marché d'une ville, ou la valeur nationale par défaut si la ville n'est pas référencée
 * (cas « Autre / saisie manuelle »).
 */
export function prixM2Ville(id: string): number {
  return findLoyerVille(id)?.prixM2Mensuel ?? LOYER_M2_DEFAUT_AUTRE;
}

/**
 * Loyer annuel de marché du LOGEMENT ENTIER déduit du prix au m².
 *
 * On raisonne sur la surface totale et non sur celle du bureau, car la ligne « loyer » du simulateur
 * représente une charge du logement, ensuite proratisée par la quote-part (surface bureau / surface
 * totale) comme tous les autres postes. Le résultat après quote-part vaut exactement
 * `prixM2Mensuel × surfaceBureauM2 × 12` : appliquer directement le prix au m² à la surface du
 * bureau proratiserait deux fois.
 */
export function loyerAnnuelLogement(prixM2Mensuel: number, surfaceTotaleM2: number): number {
  return Math.max(0, prixM2Mensuel) * Math.max(0, surfaceTotaleM2) * 12;
}
