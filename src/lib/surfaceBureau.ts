// Lecture de la quote-part de surface d'un bureau à domicile : à partir de quelle proportion du
// logement une indemnité d'occupation cesse d'être banale, devient à documenter, puis risquée.
//
// AVERTISSEMENT DE FOND : aucun texte ne fixe de pourcentage. Ni le CGI, ni le BOFiP, ni la
// jurisprudence ne connaissent de « seuil des 30 % ». Ce chiffre est une tolérance de PRATIQUE,
// largement reprise par les experts-comptables, qui résume l'endroit où l'administration cesse de
// considérer la quote-part comme allant de soi. Les vrais tests, eux, sont qualitatifs :
//
//  1. La charge est-elle engagée dans l'intérêt de l'exploitation et non excessive (art. 39-1-1°
//     CGI) ? Une surface plus grande qu'utile rend la fraction excédentaire non déductible, et
//     imposable chez le dirigeant en revenus distribués (art. 109-1-2° CGI).
//  2. L'activité peut-elle légalement s'exercer là (art. L631-7-3 CCH) ? Elle doit être exercée par
//     les seuls occupants ayant leur résidence principale dans le logement, sans réception de
//     clientèle ni de marchandises, et sans clause contraire du bail ou du règlement de copropriété.
//  3. La pièce sert-elle RÉELLEMENT à cela, et peut-on le prouver ?
//
// Le pourcentage n'est donc qu'un indicateur de la charge de preuve à constituer : plus il monte,
// plus la démonstration doit être solide. Il ne rend jamais licite ce qui ne l'est pas, et ne rend
// jamais illicite ce qui est réellement justifié.

export type TonBande = "good" | "neutral" | "warn" | "bad";

export interface BandeSurface {
  id: string;
  /** Borne supérieure INCLUSE de la bande, en fraction de la surface totale. */
  max: number;
  /** Étiquette courte, affichée à côté de la quote-part. */
  label: string;
  ton: TonBande;
  /** Une phrase : ce que cette bande implique concrètement. */
  resume: string;
  /** Ce qui la caractérise, et ce qu'il faut être en mesure de produire. */
  detail: string;
}

/**
 * Bandes de lecture, de la plus banale à la plus exposée. La dernière borne est à 1 : la quote-part
 * étant plafonnée à 100 % par le simulateur, toute valeur trouve sa bande.
 */
export const BANDES_SURFACE_BUREAU: BandeSurface[] = [
  {
    id: "usuel",
    max: 0.15,
    label: "Usuel",
    ton: "good",
    resume: "La zone où se situe la majorité des bureaux à domicile — pratiquement jamais discutée.",
    detail:
      "Les exemples repris par la doctrine et par l'URSSAF pour illustrer la méthode réelle tombent tous ici ou juste au-dessus : 10 m² dans 70 m² (14 %), 10 m² dans 50 m² (20 %), 15 m² dans 100 m² (15 %). Un bureau représente rarement plus : c'est l'ordre de grandeur d'une pièce sur cinq ou six. À ce niveau, la quote-part se justifie par le simple plan du logement.",
  },
  {
    id: "courant",
    max: 0.3,
    label: "Courant",
    ton: "neutral",
    resume: "Une pièce entière dédiée dans un logement de taille moyenne. Admis, mais on entre dans la zone haute.",
    detail:
      "C'est le palier généralement recommandé comme plafond de confort pour un simple bureau : au-delà, la proportion cesse d'aller de soi pour une activité qui ne demande pas de surface particulière. Tenez à disposition un plan coté et des photos montrant que la pièce est aménagée en bureau et ne sert pas aussi de chambre d'amis ou de salon.",
  },
  {
    id: "a-documenter",
    max: 0.5,
    label: "À documenter",
    ton: "warn",
    resume: "Défendable uniquement si l'activité demande réellement cette surface. La preuve devient exigeante.",
    detail:
      "Cette tranche est admise pour les activités qui consomment de l'espace par nature — un cabinet avec salle d'attente et salle de soin, un atelier, un poste de travail avec matériel encombrant. Elle suppose une activité régulière et une occupation matériellement visible. Pour une activité de service exercée sur un ordinateur portable, elle sera difficile à soutenir. Attendez-vous à devoir produire un plan coté, des photos, et un lien explicite entre la surface et la nature de l'activité.",
  },
  {
    id: "risque",
    max: 0.99,
    label: "Risqué",
    ton: "bad",
    resume: "Au-delà de la moitié du logement : la qualification même de résidence principale est en jeu.",
    detail:
      "Aucun texte ne l'interdit, mais plus rien n'y est acquis : la fraction jugée excédentaire est réintégrée au résultat de la société ET imposée chez le dirigeant en revenus distribués (art. 109-1-2° CGI), et l'usage du logement bascule de fait vers le mixte. Vérifiez impérativement le bail et le règlement de copropriété, et interrogez-vous sur le changement d'usage (art. L631-7 et s. CCH) — d'autant que recevoir de la clientèle ou des marchandises sort déjà du cadre de l'art. L631-7-3.",
  },
  {
    id: "exclu",
    max: 1,
    label: "Exclu",
    ton: "bad",
    resume: "Louer l'intégralité de sa résidence principale à sa société n'est pas possible.",
    detail:
      "Le logement cesserait d'être à usage d'habitation : c'est un changement de destination, qui suppose une autorisation d'urbanisme et fait sortir le bien du régime de la résidence principale. Seule une PARTIE du logement peut faire l'objet d'un bail ou d'une convention d'occupation au profit de la société.",
  },
];

/** Bande correspondant à une quote-part donnée. Les valeurs hors [0, 1] sont ramenées aux bornes. */
export function bandeSurfaceBureau(quotePart: number): BandeSurface {
  const valeur = Math.min(1, Math.max(0, quotePart));
  return BANDES_SURFACE_BUREAU.find((b) => valeur <= b.max) ?? BANDES_SURFACE_BUREAU[BANDES_SURFACE_BUREAU.length - 1];
}

/**
 * Repère de montant, indépendant de la surface : au-delà, c'est le caractère non excessif de la
 * charge (art. 39-1-1° CGI) qui devient le point de friction, quelle que soit la quote-part.
 */
export const LOYER_ANNUEL_M2_PRUDENT = 200;

/**
 * Plafond mensuel de l'allocation forfaitaire de télétravail exonérée sans justificatif, en
 * l'absence d'accord collectif (2,70 €/jour, 22 jours). Sert de point de comparaison : en dessous,
 * un salarié n'a rien à prouver ; une indemnité d'occupation très supérieure relève de la méthode
 * réelle et de ses justificatifs.
 */
export const FORFAIT_TELETRAVAIL_MENSUEL_SANS_ACCORD = 59.4;

/** Même plafond en présence d'un accord collectif (3,30 €/jour, 22 jours). */
export const FORFAIT_TELETRAVAIL_MENSUEL_AVEC_ACCORD = 72.6;

export const SOURCES_SEUIL_SURFACE: { label: string; url: string; note: string }[] = [
  {
    label: "Art. L631-7-3 CCH — exercice d'une activité dans une partie de la résidence principale",
    url: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006825855/2002-02-28",
    note: "Autorise l'activité, y compris commerciale, dans une partie du logement, à trois conditions : exercée par les seuls occupants qui y ont leur résidence principale, sans réception de clientèle ni de marchandises, et sans clause contraire du bail ou du règlement de copropriété.",
  },
  {
    label: "URSSAF — frais professionnels et méthode réelle",
    url: "https://www.urssaf.fr/accueil/employeur/beneficier-exonerations/frais-professionnels.html",
    note: "La quote-part professionnelle se calcule au prorata de la surface de l'espace de travail sur la surface totale du logement, sur justificatifs. C'est exactement le calcul retenu ici.",
  },
  {
    label: "Barème de remboursement des frais de télétravail",
    url: "https://www.legisocial.fr/reperes-sociaux/evaluation-frais-engages-salarie-teletravail-2026.html",
    note: "Allocation forfaitaire exonérée sans justificatif : 2,70 €/jour (59,40 €/mois) sans accord collectif, 3,30 €/jour (72,60 €/mois) avec accord. Repère utile : au-delà, il faut passer à la méthode réelle et produire les pièces.",
  },
  {
    label: "Déduction du bureau ou cabinet en profession libérale",
    url: "https://optigestplus.org/2025/10/08/profession-liberale-location-deduction-bureau-cabinet/",
    note: "Source des paliers de pratique : ne pas dépasser 30 % pour un simple bureau, jusqu'à 50 % admis pour une activité qui demande réellement de la surface (cabinet avec salle d'attente et salle de soin).",
  },
  {
    label: "Louer une partie de son domicile à sa société",
    url: "https://www.bailfacile.fr/guides/louer-partie-domicile-a-sa-societe",
    note: "Rappelle qu'il n'existe pas de seuil légal, que dépasser la tolérance reste possible si l'occupation professionnelle est solidement justifiée, et qu'on ne peut pas louer l'intégralité d'un logement d'habitation à sa société.",
  },
];
