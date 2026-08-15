// Valeurs de référence des charges d'un logement en France (2025-2026), servant de placeholders
// réalistes au simulateur de bureau à domicile.
//
// Ces montants ne sont PAS des règles fiscales : ce sont des ordres de grandeur statistiques,
// destinés à éviter de sous-évaluer l'indemnité d'occupation par des valeurs par défaut trop
// basses. Le dirigeant doit les remplacer par ses charges RÉELLES (factures, avis d'imposition,
// appels de fonds de copropriété) — seules ces dernières sont opposables en cas de contrôle.
//
// Deux natures de postes :
//  - « surface » : montant proportionnel à la surface du logement (€/m²/an) — énergie, copropriété ;
//  - « forfait » : montant globalement indépendant de la surface (€/an) — eau, assurance, taxe
//    foncière, abonnement internet. Les faire varier avec les m² produirait des valeurs absurdes.

import type { StatutOccupant } from "./homeOffice";

export interface ChargeReference {
  id: string;
  /** Base de calcul : montant au m²/an, ou forfait annuel. */
  base: "surface" | "forfait";
  /** €/m²/an si base === "surface", €/an si base === "forfait" (propriétaire). */
  montant: number;
  /** Montant retenu pour un locataire quand il diffère (taxe foncière non due, MRH moins chère). */
  montantLocataire?: number;
  /** Fourchette observée, affichée en aide de saisie. */
  fourchette: [number, number];
  /** Source de l'ordre de grandeur, citée dans l'interface. */
  source: string;
  note: string;
}

/**
 * Références 2025-2026. Sources : bilans de fournisseurs d'énergie et comparateurs (électricité,
 * chauffage), rapport SISPEA / observatoire du prix de l'eau, baromètres d'assurance habitation,
 * statistiques DGFiP-UNPI de taxe foncière, baromètres de charges de copropriété.
 */
export const CHARGES_REFERENCES: ChargeReference[] = [
  {
    id: "electricite",
    base: "surface",
    montant: 14,
    fourchette: [10, 20],
    source: "Comparateurs énergie 2025-2026 (hors chauffage électrique)",
    note:
      "Électricité hors chauffage : éclairage, électroménager, eau chaude, informatique. Une famille de 4 personnes dépense 110 à 150 €/mois hors chauffage. Si le logement est chauffé à l'électricité, saisir 0 ici et tout porter sur la ligne « Chauffage ».",
  },
  {
    id: "chauffage",
    base: "surface",
    montant: 18,
    fourchette: [12, 30],
    source: "Coût du chauffage 2025 : 1 000 à 2 400 €/an selon l'énergie et le DPE",
    note:
      "Un T4 de 80 m² classé D consomme ~12 MWh de gaz, soit ~1 320 €/an hors abonnement (~13 €/m²/an). Le tout-électrique monte à 20-30 €/m²/an, une bonne isolation (DPE A-B) descend sous 10 €/m²/an.",
  },
  {
    id: "eau",
    base: "forfait",
    montant: 560,
    fourchette: [400, 750],
    source: "Prix moyen de l'eau 4,89 €/m³ au 01/01/2025 (eau potable + assainissement)",
    note:
      "Facture type de référence : 120 m³/an → ~587 €. Dépend du nombre d'occupants (≈53 m³/personne/an) bien plus que de la surface. En copropriété avec eau au forfait, ce poste est souvent déjà inclus dans les charges.",
  },
  {
    id: "assuranceHabitation",
    base: "forfait",
    montant: 330,
    montantLocataire: 190,
    fourchette: [150, 420],
    source: "Baromètres assurance habitation 2025-2026",
    note:
      "Un propriétaire d'un 4 pièces paie 250 à 350 €/an (moyenne ~280-330 €), un locataire nettement moins (garanties réduites). Fort écart régional : ~155 €/an en Bretagne contre ~250 €/an et plus en Île-de-France et PACA, avec des majorations jusqu'à +25 % en zone à risque.",
  },
  {
    id: "taxeFonciere",
    base: "forfait",
    montant: 1000,
    montantLocataire: 0,
    fourchette: [600, 1600],
    source: "Taxe foncière 2025 : 1 117 €/contribuable en moyenne, 865 € pour un appartement",
    note:
      "Due par le seul propriétaire — nulle pour un locataire. En hausse de +2,8 % en 2025 et de près de 40 % en dix ans, avec de très forts écarts entre communes. Reprendre le montant de l'avis d'imposition plutôt que cette moyenne.",
  },
  {
    id: "entretienCopropriete",
    base: "surface",
    montant: 26,
    fourchette: [15, 45],
    source: "Charges de copropriété 2025 : ~1 488 €/lot/an, soit ~25-26 €/m²/an",
    note:
      "Moyenne nationale ~26 €/m²/an ; ~26 €/m²/an à Lyon et Toulouse, 25 à Nantes, 33 à Bordeaux, 44-45 à Paris (2 251 €/lot/an). Île-de-France ~2 041 €/lot contre ~1 010 € en Bretagne. En maison individuelle, remplacer par l'entretien réel (ramonage, chaudière, jardin).",
  },
  {
    id: "internetTelephone",
    base: "forfait",
    montant: 480,
    fourchette: [300, 700],
    source: "Abonnement fibre + mobile 2025-2026 (~40 €/mois)",
    note:
      "Poste désactivé par défaut : une box internet est le plus souvent refacturée directement à la société comme frais professionnel, auquel cas l'inclure ici la compterait deux fois.",
  },
];

export function findChargeReference(id: string): ChargeReference | undefined {
  return CHARGES_REFERENCES.find((c) => c.id === id);
}

/**
 * Montant annuel de référence d'un poste de charge, pour une surface et un statut d'occupation
 * donnés. Retourne `undefined` pour un poste sans référence (le loyer, calculé à part depuis le
 * prix au m² de la ville).
 */
export function montantReferenceCharge(
  id: string,
  surfaceTotaleM2: number,
  statutOccupant: StatutOccupant,
): number | undefined {
  const ref = findChargeReference(id);
  if (!ref) return undefined;
  const montant = statutOccupant === "locataire" && ref.montantLocataire !== undefined ? ref.montantLocataire : ref.montant;
  return ref.base === "surface" ? Math.round(montant * Math.max(0, surfaceTotaleM2)) : montant;
}

/**
 * Fourchette annuelle de référence d'un poste, mise à l'échelle de la surface pour les postes
 * proportionnels et du statut d'occupation pour les postes qui en dépendent. Sert à signaler une
 * saisie manifestement sous-évaluée.
 *
 * Pour un locataire, la fourchette est réduite dans le même rapport que le montant de référence :
 * elle tombe ainsi à [0, 0] pour la taxe foncière, qu'il n'acquitte pas.
 */
export function fourchetteReferenceCharge(
  id: string,
  surfaceTotaleM2: number,
  statutOccupant: StatutOccupant = "proprietaire",
): [number, number] | undefined {
  const ref = findChargeReference(id);
  if (!ref) return undefined;
  const ratioStatut =
    statutOccupant === "locataire" && ref.montantLocataire !== undefined && ref.montant > 0
      ? ref.montantLocataire / ref.montant
      : 1;
  const echelle = (ref.base === "surface" ? Math.max(0, surfaceTotaleM2) : 1) * ratioStatut;
  return [Math.round(ref.fourchette[0] * echelle), Math.round(ref.fourchette[1] * echelle)];
}
