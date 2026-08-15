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
  // Laissé à 0 : seuls ceux qui emploient réellement une aide ménagère ont ce poste à déclarer.
  { id: "menageNettoyage", label: "Ménage / nettoyage", enabled: true },
  { id: "internetTelephone", label: "Internet / téléphone", enabled: true },
];

export interface HomeOfficeInputs {
  id: string;
  name: string;
  createdAt: string;

  country: string;
  impositionSociete: ImpositionSociete;
  corporateTaxRate: number;
  beneficeAvantChargePrevisionnel: number; // bénéfice imposable prévisionnel de la société avant l'indemnité
  eligibleTauxReduitPME: boolean; // conditions art. 219 I-b CGI : CA<10M€, capital détenu ≥75% par des personnes physiques

  statutOccupant: StatutOccupant;
  typeLogement: TypeLogement;
  surfaceTotaleM2: number;
  surfaceBureauM2: number;

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
    impositionSociete: "IS",
    corporateTaxRate: 0.25,
    beneficeAvantChargePrevisionnel: 40000,
    eligibleTauxReduitPME: true,
    statutOccupant,
    typeLogement,
    surfaceTotaleM2,
    surfaceBureauM2: 12,
    ville,
    loyerMarcheM2Mensuel: prixM2Ville(ville),
    loyerAutoDepuisPrixM2: true,
    chargeLines: chargeLinesDeReference(surfaceTotaleM2, statutOccupant, typeLogement),
    regimeFoncier: "micro",
    autresRevenusFonciersFoyer: 0,
    interetsEmpruntAnnuels: 0,
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
  baseImposableFonciere: number;
  abattementApplique: number;
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
  const quotePartSurface =
    inputs.surfaceTotaleM2 > 0 ? Math.min(1, inputs.surfaceBureauM2 / inputs.surfaceTotaleM2) : 0;

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

  const totalChargesRetenuesAnnuel = chargeLinesEffectives
    .filter((c) => c.enabled)
    .reduce((sum, c) => sum + c.montantAnnuel, 0);
  const indemniteAnnuelleBrute = totalChargesRetenuesAnnuel * quotePartSurface;

  const totalRevenusFonciers = indemniteAnnuelleBrute + inputs.autresRevenusFonciersFoyer;
  const eligibleMicroFoncier = totalRevenusFonciers <= PLAFOND_MICRO_FONCIER;

  const regimeEffectif = inputs.regimeFoncier === "micro" && !eligibleMicroFoncier ? "reel" : inputs.regimeFoncier;

  let baseImposableFonciere: number;
  let abattementApplique = 0;
  let interetsEmpruntDeduits = 0;
  if (regimeEffectif === "micro") {
    abattementApplique = indemniteAnnuelleBrute * ABATTEMENT_MICRO_FONCIER;
    baseImposableFonciere = indemniteAnnuelleBrute - abattementApplique;
  } else {
    // Régime réel : les charges hors loyer (déjà intégrées dans l'indemnité au prorata) sont
    // déduites explicitement — le loyer/valeur locative lui-même reste imposable.
    const chargesHorsLoyer = chargeLinesEffectives
      .filter((c) => c.enabled && c.id !== "loyer")
      .reduce((sum, c) => sum + c.montantAnnuel, 0);
    // Les intérêts d'emprunt ne sont pas dans la base de l'indemnité (cf. `interetsEmpruntAnnuels`)
    // mais sont déductibles du revenu foncier au réel, au prorata de la surface professionnelle.
    interetsEmpruntDeduits = Math.max(0, inputs.interetsEmpruntAnnuels) * quotePartSurface;
    const chargesDeductibles = chargesHorsLoyer * quotePartSurface + interetsEmpruntDeduits;
    abattementApplique = chargesDeductibles;
    baseImposableFonciere = Math.max(0, indemniteAnnuelleBrute - chargesDeductibles);
  }

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

  const irDu = baseImposableFonciere * tauxIRUtilise;
  const prelevementsSociaux = baseImposableFonciere * PRELEVEMENTS_SOCIAUX_FONCIER;
  const coutFiscalGerant = irDu + prelevementsSociaux;
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
    chargeLinesEffectives,
    loyerAnnuelLogementRetenu,
    loyerAnnuelBureauRetenu,
    totalChargesRetenuesAnnuel,
    indemniteAnnuelleBrute,
    eligibleMicroFoncier,
    baseImposableFonciere,
    abattementApplique,
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
