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

import type { StatutOccupant, TypeLogement } from "./homeOffice";

export interface ChargeReference {
  id: string;
  /** Base de calcul : montant au m²/an, ou forfait annuel. */
  base: "surface" | "forfait";
  /** €/m²/an si base === "surface", €/an si base === "forfait" — propriétaire, en immeuble collectif. */
  montant: number;
  /**
   * Montant retenu en maison individuelle quand il diffère : pas de copropriété, mais davantage
   * d'entretien à sa charge, plus de déperditions thermiques et une taxe foncière plus élevée.
   */
  montantMaison?: number;
  /** Montant retenu pour un locataire quand il diffère (taxe foncière non due, MRH moins chère). */
  montantLocataire?: number;
  /** Fourchette observée, affichée en aide de saisie. */
  fourchette: [number, number];
  /** Source de l'ordre de grandeur, citée dans l'interface. */
  source: string;
  /** Lien vers la source, pour que le chiffre soit vérifiable et non pas à croire sur parole. */
  sourceUrl: string;
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
    source: "Hello Watt — facture d'électricité moyenne par type de logement (2025-2026)",
    sourceUrl: "https://www.hellowatt.fr/suivi-consommation-energie/consommation-electrique/facture-moyenne-par-mois",
    note:
      "Électricité hors chauffage : éclairage, électroménager, eau chaude, informatique. Une famille de 4 personnes dépense 110 à 150 €/mois hors chauffage. Si le logement est chauffé à l'électricité, saisir 0 ici et tout porter sur la ligne « Chauffage ».",
  },
  {
    id: "chauffage",
    base: "surface",
    montant: 18,
    montantMaison: 24,
    fourchette: [12, 30],
    source: "ekWateur — facture moyenne de gaz (2025) : 1 000 à 2 400 €/an selon l'énergie et le DPE",
    sourceUrl: "https://ekwateur.fr/blog/ma-consommation-d-energie/facture-moyenne-gaz/",
    note:
      "Un T4 de 80 m² classé D consomme ~12 MWh de gaz, soit ~1 320 €/an hors abonnement (~13 €/m²/an). Le tout-électrique monte à 20-30 €/m²/an, une bonne isolation (DPE A-B) descend sous 10 €/m²/an.",
  },
  {
    id: "eau",
    base: "forfait",
    montant: 560,
    montantMaison: 680,
    fourchette: [400, 750],
    source:
      "Ministère de la Transition écologique — prix de l'eau : 4,89 €/m³ au 01/01/2025 (eau potable + assainissement)",
    sourceUrl:
      "https://www.ecologie.gouv.fr/sites/default/files/publications/document_travail_73_prix_eau_aout20258.pdf",
    note:
      "Facture type de référence : 120 m³/an → ~587 €. Dépend du nombre d'occupants (≈53 m³/personne/an) bien plus que de la surface. En copropriété avec eau au forfait, ce poste est souvent déjà inclus dans les charges.",
  },
  {
    id: "assuranceHabitation",
    base: "forfait",
    montant: 330,
    montantMaison: 400,
    montantLocataire: 190,
    fourchette: [150, 420],
    source: "Mes Allocs — prix moyen de l'assurance habitation (2025)",
    sourceUrl:
      "https://www.mes-allocs.fr/guides/assurance-habitation/prix-assurance-habitation/assurance-habitation-prix-moyen/",
    note:
      "Un propriétaire d'un 4 pièces paie 250 à 350 €/an (moyenne ~280-330 €), un locataire nettement moins (garanties réduites). Fort écart régional : ~155 €/an en Bretagne contre ~250 €/an et plus en Île-de-France et PACA, avec des majorations jusqu'à +25 % en zone à risque.",
  },
  {
    id: "taxeFonciere",
    base: "forfait",
    montant: 1000,
    montantMaison: 1250,
    montantLocataire: 0,
    fourchette: [600, 1600],
    source: "UNPI / DGFiP — taxe foncière 2025 : 1 117 €/contribuable en moyenne, 865 € pour un appartement",
    sourceUrl: "https://unpi.org/fr/1/164/1204/Taxe-fonciere-pres-de-40-d-augmentation-en-dix-ans.html",
    note:
      "Due par le seul propriétaire — nulle pour un locataire. En hausse de +2,8 % en 2025 et de près de 40 % en dix ans, avec de très forts écarts entre communes. Reprendre le montant de l'avis d'imposition plutôt que cette moyenne.",
  },
  {
    id: "entretienCopropriete",
    base: "surface",
    montant: 26,
    montantMaison: 0,
    fourchette: [15, 45],
    source: "Foncia — charges de copropriété 2025 : ~1 488 €/lot/an, soit ~25-26 €/m²/an",
    sourceUrl: "https://actus.foncia.com/copropriete/charges/charges-copropriete-moyenne",
    note:
      "Moyenne nationale ~26 €/m²/an ; ~26 €/m²/an à Lyon et Toulouse, 25 à Nantes, 33 à Bordeaux, 44-45 à Paris (2 251 €/lot/an). Île-de-France ~2 041 €/lot contre ~1 010 € en Bretagne. En maison individuelle, remplacer par l'entretien réel (ramonage, chaudière, jardin).",
  },
  {
    id: "internetTelephone",
    base: "forfait",
    montant: 540,
    fourchette: [360, 780],
    source: "Arcep — observatoire des marchés : facture moyenne de 37 €HT/mois par abonnement internet THD (T4 2025)",
    sourceUrl:
      "https://www.arcep.fr/cartes-et-donnees/nos-publications-chiffrees/observatoire-des-marches-des-communications-electroniques-en-france/t4-2025.html",
    note:
      "37 €HT/mois pour la box, soit ~44 €TTC, ~530 €/an ; ajouter un forfait mobile porte le poste plus haut. ATTENTION au double compte : si la box est déjà refacturée directement à la société comme frais professionnel, désactiver ce poste — sinon la même dépense est prise en charge deux fois.",
  },
  {
    id: "travauxEntretien",
    base: "surface",
    montant: 7,
    montantMaison: 14,
    fourchette: [4, 20],
    source:
      "Provision d'entretien courant usuellement retenue : 300 à 800 €/an pour un appartement, 500 à 1 500 €/an pour une maison",
    sourceUrl: "https://www.infos-habitation.fr/budget-entretien-maison/",
    note:
      "Entretien courant et petites réparations NON couverts par la copropriété : contrat d'entretien de chaudière, ramonage, plomberie, serrurerie, peinture. Poste principal en maison individuelle, où il remplace les charges de copropriété. En copropriété, ne retenir ici que ce qui reste à votre charge dans les parties privatives.",
  },
  {
    id: "taxeOrduresMenageres",
    base: "forfait",
    montant: 150,
    fourchette: [80, 350],
    source: "BOFiP — TEOM (art. 1520 CGI) ; ~144 €/ménage en 2025 selon l'UFC-Que Choisir, +20 % en cinq ans",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/3650-PGP.html/identifiant=BOI-IF-AUT-90-10-20211220",
    note:
      "Poste désactivé par défaut pour éviter un DOUBLE COMPTE : la TEOM figure déjà sur l'avis de taxe foncière, donc dans le montant que vous avez saisi sur cette ligne. Ne l'activer que si le poste « Taxe foncière » a été renseigné hors TEOM, ou si vous êtes locataire — auquel cas votre bailleur vous la refacture en charges récupérables et vous la supportez réellement.",
  },
  {
    id: "menageNettoyage",
    base: "forfait",
    montant: 0,
    fourchette: [0, 2400],
    source: "Coût horaire d'un service de ménage à domicile : 20 à 30 €/h avant crédit d'impôt",
    sourceUrl: "https://www.service-public.gouv.fr/particuliers/vosdroits/F12",
    note:
      "Frais de ménage et de nettoyage du logement, admis au prorata de la surface professionnelle. Laissé à 0 : ne le renseigner que si vous employez réellement une aide ménagère, factures ou attestation fiscale du prestataire à l'appui. ATTENTION : la fraction refacturée à la société ne peut pas ouvrir droit, pour la même dépense, au crédit d'impôt services à la personne (art. 199 sexdecies CGI).",
  },
];

export function findChargeReference(id: string): ChargeReference | undefined {
  return CHARGES_REFERENCES.find((c) => c.id === id);
}

/**
 * Montant unitaire d'une référence après application du type de logement puis du statut
 * d'occupation. Le statut s'applique en RAPPORT et non en valeur absolue, pour que l'écart
 * propriétaire/locataire se combine correctement avec l'écart appartement/maison : une taxe
 * foncière reste nulle pour un locataire en maison, une assurance de locataire reste
 * proportionnellement moins chère qu'en appartement.
 */
function montantUnitaire(ref: ChargeReference, statutOccupant: StatutOccupant, typeLogement: TypeLogement): number {
  const base = typeLogement === "maison" && ref.montantMaison !== undefined ? ref.montantMaison : ref.montant;
  const ratioStatut =
    statutOccupant === "locataire" && ref.montantLocataire !== undefined && ref.montant > 0
      ? ref.montantLocataire / ref.montant
      : 1;
  return base * ratioStatut;
}

/**
 * Montant annuel de référence d'un poste de charge, pour une surface, un statut d'occupation et un
 * type de logement donnés. Retourne `undefined` pour un poste sans référence (le loyer, calculé à
 * part depuis le prix au m² de la ville).
 */
export function montantReferenceCharge(
  id: string,
  surfaceTotaleM2: number,
  statutOccupant: StatutOccupant,
  typeLogement: TypeLogement = "appartement",
): number | undefined {
  const ref = findChargeReference(id);
  if (!ref) return undefined;
  const unitaire = montantUnitaire(ref, statutOccupant, typeLogement);
  return ref.base === "surface" ? Math.round(unitaire * Math.max(0, surfaceTotaleM2)) : Math.round(unitaire);
}

/**
 * Fourchette annuelle de référence d'un poste, mise à l'échelle de la surface pour les postes
 * proportionnels, et du type de logement et du statut d'occupation pour les postes qui en
 * dépendent. Sert à signaler une saisie manifestement sous-évaluée.
 *
 * La fourchette suit le même rapport que le montant de référence : elle tombe donc à [0, 0] pour la
 * taxe foncière d'un locataire et pour les charges de copropriété d'une maison individuelle, où
 * aucune saisie ne peut être « sous-évaluée ».
 */
export function fourchetteReferenceCharge(
  id: string,
  surfaceTotaleM2: number,
  statutOccupant: StatutOccupant = "proprietaire",
  typeLogement: TypeLogement = "appartement",
): [number, number] | undefined {
  const ref = findChargeReference(id);
  if (!ref) return undefined;
  const ratio = ref.montant > 0 ? montantUnitaire(ref, statutOccupant, typeLogement) / ref.montant : 1;
  const echelle = (ref.base === "surface" ? Math.max(0, surfaceTotaleM2) : 1) * ratio;
  return [Math.round(ref.fourchette[0] * echelle), Math.round(ref.fourchette[1] * echelle)];
}
