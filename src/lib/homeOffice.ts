// Simulateur : indemnité d'occupation du domicile personnel par la société
// (bureau professionnel installé chez le dirigeant, domicile non loué par la société).
//
// Principe : la société verse au dirigeant une indemnité d'occupation correspondant à la
// quote-part (surface bureau / surface totale) d'un loyer de marché + charges réelles du
// logement (chacune activable/désactivable individuellement). Cette indemnité est déductible du
// résultat de la société et constitue un revenu foncier imposable pour le dirigeant (régime
// micro-foncier ou réel), soumis en outre aux prélèvements sociaux sur revenus du patrimoine
// (17,2 %).

import type { ImpositionSociete } from "./companyTypes";
import { type PersonalTaxProfile, createDefaultPersonalTaxProfile, resolvePersonalTaxProfile } from "./frenchIncomeTax";
import { computeEconomieImpotIS } from "./corporateTax";
import { loyerAnnuelLogement, prixM2Ville } from "./loyersVille";
import { montantReferenceCharge } from "./logementCharges";

export const PRELEVEMENTS_SOCIAUX_FONCIER = 0.172;
export const ABATTEMENT_MICRO_FONCIER = 0.3;
export const PLAFOND_MICRO_FONCIER = 15000;

/**
 * Plafond annuel d'imputation du déficit foncier sur le REVENU GLOBAL du foyer (art. 156, I-3° CGI).
 * Au-delà, et pour la fraction provenant des intérêts d'emprunt, le déficit n'est pas perdu mais
 * seulement reportable sur les revenus fonciers des 10 années suivantes.
 */
export const PLAFOND_DEFICIT_FONCIER_REVENU_GLOBAL = 10700;

/**
 * Part de la surface totale au-delà de laquelle un bureau à domicile appelle une justification
 * renforcée. Ce n'est PAS un plafond légal — aucun texte ne fixe de seuil — mais la tolérance
 * pratique généralement admise. Elle est paramétrable dans le simulateur : au-delà de 30 %, il
 * reste possible de justifier une surface plus grande, au prix d'un risque de requalification
 * croissant (cf. règle « domicile-surface-bureau-tolerance-30-pourcent »).
 */
export const TOLERANCE_SURFACE_BUREAU_DEFAUT = 0.3;

/**
 * Postes qui entrent dans l'assiette de l'indemnité — ce sont de vraies charges du logement — mais
 * que l'art. 31 CGI EXCLUT des charges déductibles du revenu foncier au régime réel.
 *
 * La TEOM en est le cas d'école : elle figure sur l'avis de taxe foncière, mais c'est une charge
 * récupérable auprès du locataire, donc non déductible (BOI-RFPI-BASE-20-50). La taxe foncière
 * elle-même reste déductible, TEOM déduite.
 */
export const CHARGES_NON_DEDUCTIBLES_FONCIER = new Set(["taxeOrduresMenageres"]);

export type RegimeFoncier = "micro" | "reel";
export type StatutOccupant = "locataire" | "proprietaire";

/**
 * Nature du logement. Elle déplace la structure des charges plus qu'elle n'en change le total :
 * en immeuble collectif l'essentiel de l'entretien passe par les charges de copropriété, en maison
 * individuelle ce poste disparaît au profit de l'entretien courant, plus élevé et à la charge
 * directe du propriétaire (chaudière, toiture, jardin).
 */
export type TypeLogement = "appartement" | "maison";

/**
 * Deux façons de formaliser la mise à disposition, avec le même traitement fiscal de fond (revenu
 * foncier pour le dirigeant, charge déductible pour la société) mais une robustesse juridique
 * différente :
 *  - "indemnite" : simple convention de mise à disposition / indemnité d'occupation — souple mais
 *    plus exposée en cas de contrôle si le montant ou la réalité de l'usage professionnel est mal
 *    documenté.
 *  - "bail_professionnel" : bail professionnel ou commercial réel entre le dirigeant (bailleur) et
 *    la société (preneuse) sur la pièce dédiée — plus robuste juridiquement (droits/obligations
 *    formalisés), au prix de frais de mise en place (rédaction, enregistrement).
 */
export type Formalisation = "indemnite" | "bail_professionnel";

/** Un poste de charge du logement, inclus ou non dans la base de calcul de l'indemnité. */
export interface ChargeLine {
  id: string;
  label: string;
  montantAnnuel: number;
  enabled: boolean;
}

export const DEFAULT_CHARGE_LINES: Omit<ChargeLine, "montantAnnuel">[] = [
  { id: "loyer", label: "Loyer du logement", enabled: true },
  { id: "electricite", label: "Électricité", enabled: true },
  { id: "chauffage", label: "Chauffage", enabled: true },
  { id: "eau", label: "Eau", enabled: true },
  { id: "assuranceHabitation", label: "Assurance habitation", enabled: true },
  { id: "taxeFonciere", label: "Taxe foncière", enabled: true },
  // Désactivée par défaut : la TEOM figure déjà sur l'avis de taxe foncière, donc dans la ligne
  // ci-dessus. Ne l'activer qu'en cas de saisie hors TEOM, ou en tant que locataire.
  { id: "taxeOrduresMenageres", label: "Taxe d'enlèvement des ordures ménagères (TEOM)", enabled: false },
  { id: "entretienCopropriete", label: "Charges de copropriété", enabled: true },
  { id: "travauxEntretien", label: "Entretien courant et petites réparations", enabled: true },
  // Désactivés par défaut : ces travaux sont épisodiques et se constatent l'année du paiement.
  { id: "travauxAmelioration", label: "Gros travaux et amélioration (ravalement, toiture, isolation)", enabled: false },
  // Laissé à 0 : seuls ceux qui emploient réellement une aide ménagère ont ce poste à déclarer.
  { id: "menageNettoyage", label: "Ménage / nettoyage", enabled: true },
  { id: "internetTelephone", label: "Internet / téléphone", enabled: true },
];

/**
 * Pièce d'usage MIXTE dont une fraction seulement sert à l'activité : entrée, couloir de desserte du
 * bureau, WC, part de salle d'eau. Elles s'ajoutent au numérateur de la quote-part, pondérées par un
 * coefficient d'usage professionnel.
 *
 * FONDEMENT : le BOFiP distingue le local EXCLUSIVEMENT professionnel — charges déductibles en
 * totalité — de la pièce servant aussi à autre chose, qui donne lieu à une ventilation au prorata de
 * l'usage professionnel (BOI-RSA-BASE-30-50-30-30). Aucun texte ne fixe de coefficient : les 50 %
 * proposés ici sont une convention de pratique des associations de gestion, pas une règle. C'est
 * l'utilisateur qui devra la défendre, plan coté et surfaces à l'appui.
 *
 * LIMITE : cette logique vaut pour les ANNEXES DE CIRCULATION et les sanitaires, pas pour le séjour,
 * les chambres ou la cuisine. Soutenir que le logement entier est d'usage mixte ne passe pas.
 */
export interface SurfaceAnnexe {
  id: string;
  label: string;
  /** Surface totale de la pièce, en m². */
  surfaceM2: number;
  /** Fraction d'usage professionnel retenue, entre 0 et 1. */
  coefficientPro: number;
  enabled: boolean;
}

/**
 * Toutes à 0 m² par défaut : le simulateur ne gonfle jamais la quote-part tout seul. C'est à
 * l'utilisateur de mesurer ses annexes s'il souhaite les faire valoir.
 */
export const DEFAULT_SURFACES_ANNEXES: SurfaceAnnexe[] = [
  { id: "entree", label: "Entrée / vestibule", surfaceM2: 0, coefficientPro: 0.5, enabled: true },
  { id: "couloir", label: "Couloir de desserte du bureau", surfaceM2: 0, coefficientPro: 0.5, enabled: true },
  { id: "wc", label: "WC", surfaceM2: 0, coefficientPro: 0.5, enabled: true },
  { id: "salleEau", label: "Salle d'eau — part attribuable (~1 m²)", surfaceM2: 0, coefficientPro: 0.5, enabled: true },
];

export interface HomeOfficeInputs {
  id: string;
  name: string;
  createdAt: string;

  // Identification des parties et du bien. Sans effet sur les calculs : ces champs ne servent qu'à
  // produire une note justificative nominative, opposable en cas de contrôle URSSAF ou fiscal.
  nomDirigeant: string;
  denominationSociete: string;
  adresseLogement: string;
  /** Date de prise d'effet de la convention ou du bail (AAAA-MM-JJ). */
  dateEffet: string;

  country: string;
  impositionSociete: ImpositionSociete;
  corporateTaxRate: number;
  beneficeAvantChargePrevisionnel: number; // bénéfice imposable prévisionnel de la société avant l'indemnité
  eligibleTauxReduitPME: boolean; // conditions art. 219 I-b CGI : CA<10M€, capital détenu ≥75% par des personnes physiques

  statutOccupant: StatutOccupant;
  typeLogement: TypeLogement;
  surfaceTotaleM2: number;
  surfaceBureauM2: number;
  /**
   * Annexes d'usage mixte comptées en plus du bureau, pondérées par leur coefficient professionnel.
   * Vides par défaut : elles n'ont d'effet que si l'utilisateur les mesure et les renseigne.
   */
  surfacesAnnexes: SurfaceAnnexe[];
  /** Seuil d'alerte sur la quote-part de surface, en fraction de la surface totale (0,3 = 30 %). */
  toleranceSurfaceBureau: number;

  /**
   * Le logement fait-il l'objet d'un emprunt immobilier non soldé ? Uniquement pertinent pour un
   * propriétaire. Ce n'est pas un simple affichage : les intérêts, l'assurance et les frais
   * d'emprunt ne sont déductibles qu'au régime réel, et le déficit qu'ils engendrent obéit à des
   * règles d'imputation distinctes de celles des autres charges (art. 156, I-3° CGI).
   */
  empruntEnCours: boolean;

  /** Ville du logement (cf. LOYERS_VILLES), ou VILLE_AUTRE pour saisir le prix au m² à la main. */
  ville: string;
  /** Loyer de marché retenu, en €/m²/mois hors charges. */
  loyerMarcheM2Mensuel: number;
  /**
   * Si vrai, la ligne de charge « loyer » est calculée automatiquement à partir du prix au m² et
   * des surfaces, au lieu d'être saisie. Le montant saisi est alors conservé mais ignoré, pour être
   * retrouvé intact en cas de retour au mode manuel.
   */
  loyerAutoDepuisPrixM2: boolean;

  // Postes de charge du logement, chacun activable/désactivable (le loyer/valeur locative en fait
  // partie et peut lui aussi être exclu si l'on souhaite ne rembourser que les charges réelles).
  chargeLines: ChargeLine[];

  regimeFoncier: RegimeFoncier; // micro-foncier (abattement 30%) ou réel (charges réelles déduites)
  autresRevenusFonciersFoyer: number; // pour vérifier le plafond micro-foncier (15 000 €)

  /**
   * Intérêts annuels de l'emprunt immobilier du logement (propriétaire). Ils ne font PAS partie de
   * la base de l'indemnité — le loyer de marché rémunère déjà la mise à disposition du bien, les y
   * ajouter compterait deux fois le coût du capital. En revanche, ils sont déductibles du revenu
   * foncier au régime réel, au prorata de la surface professionnelle (art. 31, I-1°-d CGI).
   */
  interetsEmpruntAnnuels: number;

  /**
   * Cotisations annuelles d'assurance emprunteur (décès, invalidité, incapacité) adossées à ce prêt.
   * Même régime que les intérêts : hors assiette de l'indemnité, déductibles du revenu foncier au
   * seul régime réel, au prorata de la surface professionnelle. Elles se déclarent d'ailleurs sur la
   * même ligne 250 de la 2044 que les intérêts (BOI-RFPI-BASE-20-60).
   */
  assuranceEmpruntAnnuelle: number;

  formalisation: Formalisation; // indemnité d'occupation (souple) ou bail professionnel réel (plus robuste)
  fraisMiseEnPlaceBail: number; // coût ponctuel (rédaction, enregistrement) si bail professionnel — 0 sinon

  personalTaxProfile: PersonalTaxProfile;

  // Comparaison : location d'un bureau externe équivalent — bail classique (loyer mensuel fixe) ou
  // espace de coworking (tarification à la journée, usage flexible).
  typeComparaisonExterne: "location" | "coworking";
  loyerBureauExterneMensuel: number; // utilisé si typeComparaisonExterne === "location"
  coworkingTarifJournalier: number; // utilisé si typeComparaisonExterne === "coworking"
  coworkingJoursParMois: number; // utilisé si typeComparaisonExterne === "coworking"
}

/**
 * Recalcule chaque poste de charge à partir des valeurs de référence 2025-2026 (cf.
 * `logementCharges.ts`), pour la surface et le statut d'occupation donnés. Le loyer est laissé au
 * calcul automatique depuis le prix au m² de la ville et n'est donc pas repris ici.
 *
 * Les états activé/désactivé choisis par l'utilisateur sont préservés : seuls les montants changent.
 */
export function chargeLinesDeReference(
  surfaceTotaleM2: number,
  statutOccupant: StatutOccupant,
  typeLogement: TypeLogement,
  lignesActuelles: ChargeLine[] = DEFAULT_CHARGE_LINES.map((c) => ({ ...c, montantAnnuel: 0 })),
): ChargeLine[] {
  return lignesActuelles.map((c) => {
    const reference = montantReferenceCharge(c.id, surfaceTotaleM2, statutOccupant, typeLogement);
    return reference === undefined ? c : { ...c, montantAnnuel: reference };
  });
}

/**
 * Champs volontairement EXCLUS de la persistance automatique.
 *
 *  - `id` et `createdAt` identifient le brouillon en cours ; les figer ferait écraser la même
 *    simulation sauvegardée à chaque session au lieu d'en créer de nouvelles.
 *  - `personalTaxProfile` est persisté à part, sous sa propre clé, car il est TRANSVERSAL à tous les
 *    simulateurs : le dupliquer ici ferait diverger les deux copies.
 *
 * Tout le reste — y compris les hypothèses de simulation — est mémorisé : c'est de la saisie
 * utilisateur, et la reperdre à chaque visite n'a aucun intérêt.
 */
export const CHAMPS_NON_PERSISTES = ["id", "createdAt", "personalTaxProfile"] as const;

export type HomeOfficeDraft = Omit<HomeOfficeInputs, (typeof CHAMPS_NON_PERSISTES)[number]>;

/** Extrait du formulaire tout ce que l'utilisateur a pu modifier, hors champs exclus ci-dessus. */
export function extractHomeOfficeDraft(inputs: HomeOfficeInputs): HomeOfficeDraft {
  // Déstructuration plutôt qu'une liste à maintenir : un champ ajouté à HomeOfficeInputs est
  // automatiquement persisté, sans qu'on ait à y penser.
  const { id: _id, createdAt: _createdAt, personalTaxProfile: _profile, ...draft } = inputs;
  return draft;
}

/** Valeurs admises pour les champs à choix fermé, vérifiées à la relecture. */
const VALEURS_ADMISES: Partial<Record<keyof HomeOfficeDraft, readonly string[]>> = {
  statutOccupant: ["locataire", "proprietaire"],
  typeLogement: ["appartement", "maison"],
  regimeFoncier: ["micro", "reel"],
  formalisation: ["indemnite", "bail_professionnel"],
  impositionSociete: ["IS", "IR"],
  typeComparaisonExterne: ["location", "coworking"],
};

/** Champs bornés à l'intervalle [0, 1] : un taux relu hors bornes produirait des montants absurdes. */
const CHAMPS_TAUX: readonly (keyof HomeOfficeDraft)[] = ["toleranceSurfaceBureau", "corporateTaxRate"];

function nombreValide(valeur: unknown, defaut: number): number {
  return typeof valeur === "number" && Number.isFinite(valeur) && valeur >= 0 ? valeur : defaut;
}

/**
 * Fusionne une liste persistée sur la liste courante, PAR IDENTIFIANT. Un élément ajouté depuis la
 * dernière visite garde sa valeur par défaut, un élément supprimé du code n'est pas ressuscité, et
 * l'ordre comme les libellés viennent du code et non du stockage.
 */
function fusionnerParId<T extends { id: string }>(
  courants: T[],
  persistes: unknown,
  champs: (persistee: Record<string, unknown>, courant: T) => Partial<T>,
): T[] {
  if (!Array.isArray(persistes)) return courants;
  return courants.map((courant) => {
    const persistee = persistes.find((p) => p && typeof p === "object" && p.id === courant.id);
    return persistee ? { ...courant, ...champs(persistee as Record<string, unknown>, courant) } : courant;
  });
}

/**
 * Applique un brouillon relu du stockage aux valeurs par défaut.
 *
 * Chaque champ est validé individuellement : une donnée écrite par une version antérieure, tronquée
 * ou trafiquée à la main retombe sur son défaut sans emporter les autres. La validation est générique
 * — même type que le défaut, nombres finis et positifs — avec des règles spécifiques pour les champs
 * à choix fermé, les taux et les listes.
 */
export function applyHomeOfficeDraft(defaults: HomeOfficeInputs, draft: unknown): HomeOfficeInputs {
  if (!draft || typeof draft !== "object") return defaults;
  const persiste = draft as Record<string, unknown>;
  const resultat: HomeOfficeInputs = { ...defaults };

  for (const cle of Object.keys(defaults) as (keyof HomeOfficeInputs)[]) {
    if ((CHAMPS_NON_PERSISTES as readonly string[]).includes(cle)) continue;
    if (!(cle in persiste)) continue;
    const valeur = persiste[cle];
    const defaut = defaults[cle];

    if (cle === "chargeLines") {
      resultat.chargeLines = fusionnerParId(defaults.chargeLines, valeur, (p, c) => ({
        montantAnnuel: nombreValide(p.montantAnnuel, c.montantAnnuel),
        enabled: typeof p.enabled === "boolean" ? p.enabled : c.enabled,
      }));
      continue;
    }
    if (cle === "surfacesAnnexes") {
      resultat.surfacesAnnexes = fusionnerParId(defaults.surfacesAnnexes, valeur, (p, c) => ({
        surfaceM2: nombreValide(p.surfaceM2, c.surfaceM2),
        coefficientPro:
          typeof p.coefficientPro === "number" && Number.isFinite(p.coefficientPro)
            ? Math.min(1, Math.max(0, p.coefficientPro))
            : c.coefficientPro,
        enabled: typeof p.enabled === "boolean" ? p.enabled : c.enabled,
      }));
      continue;
    }

    const admises = VALEURS_ADMISES[cle as keyof HomeOfficeDraft];
    if (admises) {
      if (typeof valeur === "string" && admises.includes(valeur)) {
        (resultat as unknown as Record<string, unknown>)[cle] = valeur;
      }
      continue;
    }
    if (typeof defaut === "number") {
      const nombre = nombreValide(valeur, defaut);
      // Un taux hors [0, 1] est aussi absurde écrêté que brut : on préfère retomber sur le défaut.
      const horsBornes = CHAMPS_TAUX.includes(cle as keyof HomeOfficeDraft) && nombre > 1;
      (resultat as unknown as Record<string, unknown>)[cle] = horsBornes ? defaut : nombre;
      continue;
    }
    if (typeof valeur === typeof defaut && (typeof defaut === "boolean" || typeof defaut === "string")) {
      if (typeof defaut === "string" && (valeur as string).length === 0) continue;
      (resultat as unknown as Record<string, unknown>)[cle] = valeur;
    }
  }

  return resultat;
}

export function createDefaultHomeOfficeInputs(): HomeOfficeInputs {
  const surfaceTotaleM2 = 80;
  const statutOccupant: StatutOccupant = "proprietaire";
  const typeLogement: TypeLogement = "appartement";
  const ville = "paris";

  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation bureau",
    createdAt: new Date().toISOString(),
    country: "FR",
    nomDirigeant: "",
    denominationSociete: "",
    adresseLogement: "",
    dateEffet: "",
    impositionSociete: "IS",
    corporateTaxRate: 0.25,
    beneficeAvantChargePrevisionnel: 40000,
    eligibleTauxReduitPME: true,
    statutOccupant,
    typeLogement,
    surfaceTotaleM2,
    surfaceBureauM2: 12,
    surfacesAnnexes: DEFAULT_SURFACES_ANNEXES.map((a) => ({ ...a })),
    toleranceSurfaceBureau: TOLERANCE_SURFACE_BUREAU_DEFAUT,
    empruntEnCours: false,
    ville,
    loyerMarcheM2Mensuel: prixM2Ville(ville),
    loyerAutoDepuisPrixM2: true,
    chargeLines: chargeLinesDeReference(surfaceTotaleM2, statutOccupant, typeLogement),
    regimeFoncier: "micro",
    autresRevenusFonciersFoyer: 0,
    interetsEmpruntAnnuels: 0,
    assuranceEmpruntAnnuelle: 0,
    formalisation: "indemnite",
    fraisMiseEnPlaceBail: 0,
    personalTaxProfile: createDefaultPersonalTaxProfile(),
    typeComparaisonExterne: "location",
    loyerBureauExterneMensuel: 350,
    coworkingTarifJournalier: 25,
    coworkingJoursParMois: 20,
  };
}

export interface HomeOfficeResults {
  quotePartSurface: number;
  /** Fraction de surface retenue au titre des annexes d'usage mixte, en m². */
  surfaceAnnexeRetenue: number;
  /** Surface professionnelle totale servant de numérateur : bureau + annexes pondérées, en m². */
  surfaceProfessionnelleTotale: number;
  /** Surface de bureau qui atteindrait exactement le seuil de tolérance retenu, en m². */
  surfaceBureauTolerance: number;
  /** Vrai si la quote-part dépasse le seuil de tolérance retenu. */
  depasseToleranceSurface: boolean;
  /** Lignes de charge après substitution du loyer calculé automatiquement le cas échéant. */
  chargeLinesEffectives: ChargeLine[];
  /**
   * Loyer de marché annuel du logement entier (calculé ou saisi). Renseigné même si la ligne
   * « loyer » est désactivée, afin que l'interface puisse afficher ce que coûterait sa réactivation.
   */
  loyerAnnuelLogementRetenu: number;
  /** Part de ce loyer imputable au bureau (= prix au m² × surface bureau × 12). */
  loyerAnnuelBureauRetenu: number;
  totalChargesRetenuesAnnuel: number; // somme des postes activés
  indemniteAnnuelleBrute: number;

  eligibleMicroFoncier: boolean;
  /** Régime réellement appliqué : le micro bascule d'office au réel au-delà du plafond. */
  regimeEffectif: RegimeFoncier;
  baseImposableFonciere: number;
  abattementApplique: number;

  // --- Comparaison des deux régimes, pour recommander le plus favorable ---
  /** Charges réellement déductibles au réel (hors loyer et hors postes exclus par l'art. 31 CGI). */
  chargesDeductiblesReel: number;
  baseMicro: number;
  baseReel: number;
  coutFiscalMicro: number;
  coutFiscalReel: number;
  regimeOptimal: RegimeFoncier;
  /** Économie annuelle d'impôt et de prélèvements sociaux procurée par le régime optimal. */
  gainRegimeOptimal: number;
  /** Montant de charges déductibles à partir duquel le réel devient plus favorable (= abattement). */
  seuilBasculeReel: number;

  // --- Déficit foncier (régime réel), art. 156, I-3° CGI ---
  /** Déficit total constaté au régime réel : charges déductibles au-delà de l'indemnité. */
  deficitFoncierTotal: number;
  /** Fraction imputable sur le revenu global du foyer, plafonnée à 10 700 €/an. */
  deficitImputableRevenuGlobal: number;
  /** Reste, reportable 10 ans sur les seuls revenus fonciers (dont toute la part « emprunt »). */
  deficitReportableFoncier: number;
  /** Économie d'IR procurée par la fraction imputable — nulle hors régime réel. */
  economieIRDeficitFoncier: number;
  /** Quote-part professionnelle des intérêts d'emprunt déduite — nulle hors régime réel. */
  interetsEmpruntDeduits: number;

  tauxIRUtilise: number;
  irDu: number;
  prelevementsSociaux: number;
  coutFiscalGerant: number;
  gainNetGerant: number; // gain annuel récurrent (hors frais ponctuels de mise en place)
  gainNetGerantAnnee1: number; // gain de la 1ère année, net des frais ponctuels de mise en place du bail le cas échéant

  economieImpotSociete: number; // économie d'IS (ou d'IR foyer en régime translucide) sur la charge déductible
  coutNetSociete: number;
  coutNetGlobal: number; // coût (ou gain si négatif) net pour société+dirigeant ENSEMBLE, cf. calcul dans computeHomeOffice

  coutBureauExterneAnnuel: number;
  economieVsBureauExterne: number; // positif = le bureau à domicile coûte moins cher à la société
}

export function computeHomeOffice(inputs: HomeOfficeInputs): HomeOfficeResults {
  // Surface professionnelle = pièce dédiée + fraction retenue des annexes d'usage mixte.
  const surfaceAnnexeRetenue = inputs.surfacesAnnexes
    .filter((a) => a.enabled)
    .reduce((sum, a) => sum + Math.max(0, a.surfaceM2) * Math.min(1, Math.max(0, a.coefficientPro)), 0);
  const surfaceProfessionnelleTotale = Math.max(0, inputs.surfaceBureauM2) + surfaceAnnexeRetenue;

  const quotePartSurface =
    inputs.surfaceTotaleM2 > 0 ? Math.min(1, surfaceProfessionnelleTotale / inputs.surfaceTotaleM2) : 0;

  // Le loyer de marché est déduit du prix au m² de la ville. On le porte sur le LOGEMENT ENTIER
  // (prix au m² × surface totale) et non sur le seul bureau : la ligne « loyer » est une charge du
  // logement comme les autres, proratisée ensuite par la quote-part de surface. Après cette
  // proratisation, la part imputée au bureau vaut exactement prix au m² × surface du bureau × 12 —
  // l'appliquer directement au bureau reviendrait à le proratiser deux fois.
  const loyerAnnuelLogementRetenu = inputs.loyerAutoDepuisPrixM2
    ? loyerAnnuelLogement(inputs.loyerMarcheM2Mensuel, inputs.surfaceTotaleM2)
    : (inputs.chargeLines.find((c) => c.id === "loyer")?.montantAnnuel ?? 0);
  const loyerAnnuelBureauRetenu = loyerAnnuelLogementRetenu * quotePartSurface;

  const chargeLinesEffectives = inputs.chargeLines.map((c) =>
    c.id === "loyer" ? { ...c, montantAnnuel: loyerAnnuelLogementRetenu } : c,
  );

  const toleranceSurfaceBureau = Math.min(1, Math.max(0, inputs.toleranceSurfaceBureau));
  const surfaceBureauTolerance = Math.max(0, inputs.surfaceTotaleM2) * toleranceSurfaceBureau;
  const depasseToleranceSurface = quotePartSurface > toleranceSurfaceBureau;

  const totalChargesRetenuesAnnuel = chargeLinesEffectives
    .filter((c) => c.enabled)
    .reduce((sum, c) => sum + c.montantAnnuel, 0);
  const indemniteAnnuelleBrute = totalChargesRetenuesAnnuel * quotePartSurface;

  const totalRevenusFonciers = indemniteAnnuelleBrute + inputs.autresRevenusFonciersFoyer;
  const eligibleMicroFoncier = totalRevenusFonciers <= PLAFOND_MICRO_FONCIER;

  const regimeEffectif = inputs.regimeFoncier === "micro" && !eligibleMicroFoncier ? "reel" : inputs.regimeFoncier;

  // Abattement forfaitaire du micro-foncier : 30 % de l'indemnité brute, qui REMPLACE toute
  // déduction — les charges réelles et les intérêts d'emprunt y sont réputés inclus.
  const abattementMicro = indemniteAnnuelleBrute * ABATTEMENT_MICRO_FONCIER;

  // Régime réel : les charges hors loyer (déjà intégrées dans l'indemnité au prorata) sont déduites
  // explicitement — le loyer/valeur locative lui-même reste imposable. Les postes que l'art. 31 CGI
  // exclut (TEOM) restent dans l'assiette de l'indemnité mais pas dans la déduction.
  const chargesHorsLoyerDeductibles = chargeLinesEffectives
    .filter((c) => c.enabled && c.id !== "loyer" && !CHARGES_NON_DEDUCTIBLES_FONCIER.has(c.id))
    .reduce((sum, c) => sum + c.montantAnnuel, 0);
  // Les intérêts, l'assurance et les frais d'emprunt ne sont pas dans l'assiette de l'indemnité (cf.
  // `interetsEmpruntAnnuels`) mais sont déductibles au réel, au prorata de la surface pro. Ils ne
  // comptent que si un emprunt est effectivement en cours et que le dirigeant est propriétaire.
  const empruntDeductible =
    inputs.empruntEnCours && inputs.statutOccupant === "proprietaire"
      ? (Math.max(0, inputs.interetsEmpruntAnnuels) + Math.max(0, inputs.assuranceEmpruntAnnuelle)) * quotePartSurface
      : 0;
  const autresChargesDeductibles = chargesHorsLoyerDeductibles * quotePartSurface;
  const chargesDeductiblesReel = autresChargesDeductibles + empruntDeductible;

  const baseMicro = Math.max(0, indemniteAnnuelleBrute - abattementMicro);

  // Déficit foncier (art. 156, I-3° CGI) : l'ordre d'imputation n'est pas neutre. Les intérêts et
  // frais d'emprunt s'imputent D'ABORD sur le revenu foncier brut ; le déficit qu'ils créent n'est
  // reportable que sur les revenus fonciers des 10 années suivantes. Le déficit provenant des
  // AUTRES charges s'impute, lui, sur le revenu global du foyer, dans la limite de 10 700 €/an.
  // Sans cette distinction, un gros emprunt donnerait une économie d'impôt immédiate qu'il ne
  // procure pas en réalité.
  const apresEmprunt = indemniteAnnuelleBrute - empruntDeductible;
  const deficitEmprunt = Math.max(0, -apresEmprunt);
  const resultatReel = Math.max(0, apresEmprunt) - autresChargesDeductibles;
  const deficitAutresCharges = Math.max(0, -resultatReel);
  const baseReel = Math.max(0, resultatReel);

  const deficitFoncierTotal = deficitEmprunt + deficitAutresCharges;
  const deficitImputableRevenuGlobal = Math.min(deficitAutresCharges, PLAFOND_DEFICIT_FONCIER_REVENU_GLOBAL);
  const deficitReportableFoncier = deficitFoncierTotal - deficitImputableRevenuGlobal;

  const baseImposableFonciere = regimeEffectif === "micro" ? baseMicro : baseReel;
  const abattementApplique = regimeEffectif === "micro" ? abattementMicro : chargesDeductiblesReel;
  const interetsEmpruntDeduits = regimeEffectif === "micro" ? 0 : empruntDeductible;

  const resolvedTax = resolvePersonalTaxProfile(
    inputs.impositionSociete === "IR"
      ? {
          ...inputs.personalTaxProfile,
          autresRevenusImposablesFoyer:
            inputs.personalTaxProfile.autresRevenusImposablesFoyer + inputs.beneficeAvantChargePrevisionnel,
        }
      : inputs.personalTaxProfile,
  );
  const tauxIRUtilise = resolvedTax.tauxUtilise;

  // Le déficit imputé sur le revenu global fait baisser l'IR du foyer au taux marginal. Il n'ouvre
  // en revanche aucune économie de prélèvements sociaux : ceux-ci ne frappent qu'un revenu positif.
  // Le déficit seulement REPORTABLE n'est pas compté : c'est un avantage futur et conditionnel,
  // comme le déficit reportable d'IS côté société.
  const economieIRDeficitFoncier = deficitImputableRevenuGlobal * tauxIRUtilise;
  const economieIRDeficitFoncierAppliquee = regimeEffectif === "reel" ? economieIRDeficitFoncier : 0;

  const irDu = baseImposableFonciere * tauxIRUtilise;
  const prelevementsSociaux = baseImposableFonciere * PRELEVEMENTS_SOCIAUX_FONCIER;
  const coutFiscalGerant = irDu + prelevementsSociaux - economieIRDeficitFoncierAppliquee;

  // Comparaison des deux régimes à situation identique, pour recommander le plus favorable. Le taux
  // d'imposition étant le même dans les deux cas, comparer les bases suffirait ; on chiffre quand
  // même le coût fiscal, plus parlant qu'un écart d'assiette.
  const tauxImpositionFoncier = tauxIRUtilise + PRELEVEMENTS_SOCIAUX_FONCIER;
  const coutFiscalMicro = baseMicro * tauxImpositionFoncier;
  const coutFiscalReel = baseReel * tauxImpositionFoncier - economieIRDeficitFoncier;
  // Le micro n'est ouvert que sous le plafond : hors plafond, le réel n'est pas un choix.
  const regimeOptimal: RegimeFoncier =
    eligibleMicroFoncier && coutFiscalMicro <= coutFiscalReel ? "micro" : "reel";
  const gainRegimeOptimal = eligibleMicroFoncier
    ? Math.abs(coutFiscalMicro - coutFiscalReel)
    : Math.max(0, coutFiscalMicro - coutFiscalReel);
  // Point de bascule : le réel devient plus favorable dès que les charges déductibles dépassent
  // l'abattement forfaitaire, soit 30 % de l'indemnité brute.
  const seuilBasculeReel = abattementMicro;
  const gainNetGerant = indemniteAnnuelleBrute - coutFiscalGerant;
  const fraisMiseEnPlace = inputs.formalisation === "bail_professionnel" ? inputs.fraisMiseEnPlaceBail : 0;
  const gainNetGerantAnnee1 = gainNetGerant - fraisMiseEnPlace;

  const economieImpotSociete =
    inputs.impositionSociete === "IS"
      ? computeEconomieImpotIS(
          inputs.beneficeAvantChargePrevisionnel,
          indemniteAnnuelleBrute,
          inputs.eligibleTauxReduitPME,
          inputs.corporateTaxRate,
        )
      : indemniteAnnuelleBrute * tauxIRUtilise;
  const coutNetSociete = indemniteAnnuelleBrute - economieImpotSociete;

  const coutBureauExterneAnnuel =
    inputs.typeComparaisonExterne === "coworking"
      ? inputs.coworkingTarifJournalier * inputs.coworkingJoursParMois * 12
      : inputs.loyerBureauExterneMensuel * 12;
  const economieVsBureauExterne = coutBureauExterneAnnuel - coutNetSociete;

  // Coût net GLOBAL de la décision, pour le dirigeant et sa société pris ENSEMBLE (utilisé par la
  // vue consolidée multi-simulateurs). L'indemnité elle-même n'est qu'un transfert interne entre la
  // société et le dirigeant (ni gain ni perte pour l'ensemble) : seule la fiscalité de part et
  // d'autre représente un coût (ou un gain) réel pour le groupe. D'où :
  //   coutNetGlobal = coutNetSociete − gainNetGerant
  //                 = (indemnité − économie IS société) − (indemnité − coût fiscal dirigeant)
  //                 = coût fiscal dirigeant − économie IS société
  // Peut être NÉGATIF (gain net pour le groupe) : c'est précisément l'intérêt de ce montage quand
  // l'économie d'IS société dépasse l'impôt foncier du dirigeant.
  const coutNetGlobal = coutFiscalGerant - economieImpotSociete;

  return {
    quotePartSurface,
    surfaceAnnexeRetenue,
    surfaceProfessionnelleTotale,
    surfaceBureauTolerance,
    depasseToleranceSurface,
    chargeLinesEffectives,
    loyerAnnuelLogementRetenu,
    loyerAnnuelBureauRetenu,
    totalChargesRetenuesAnnuel,
    indemniteAnnuelleBrute,
    eligibleMicroFoncier,
    regimeEffectif,
    baseImposableFonciere,
    abattementApplique,
    chargesDeductiblesReel,
    baseMicro,
    baseReel,
    coutFiscalMicro,
    coutFiscalReel,
    regimeOptimal,
    gainRegimeOptimal,
    seuilBasculeReel,
    deficitFoncierTotal,
    deficitImputableRevenuGlobal,
    deficitReportableFoncier,
    economieIRDeficitFoncier: economieIRDeficitFoncierAppliquee,
    interetsEmpruntDeduits,
    tauxIRUtilise,
    irDu,
    prelevementsSociaux,
    coutFiscalGerant,
    gainNetGerant,
    gainNetGerantAnnee1,
    economieImpotSociete,
    coutNetSociete,
    coutNetGlobal,
    coutBureauExterneAnnuel,
    economieVsBureauExterne,
  };
}
