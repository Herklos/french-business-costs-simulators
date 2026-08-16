// Simulateur : mutuelle santé & prévoyance complémentaire du dirigeant.
//
// Le traitement fiscal et social diffère radicalement selon le statut du dirigeant (déjà résolu par
// companyTypes.ts selon la forme juridique) :
//  - TNS (gérant majoritaire EURL/SARL) : cotisations dites « Madelin » (loi du 11 février 1994),
//    déductibles du bénéfice professionnel (ou du résultat de la société si elle les prend en
//    charge) dans une limite légale — au-delà, la fraction excédentaire n'ouvre droit à aucun
//    avantage fiscal. Pas de mutuelle collective obligatoire pour un TNS.
//  - Assimilé salarié (SASU/SAS) : mutuelle collective obligatoire pour tous les salariés y compris
//    le dirigeant (loi ANI du 11 janvier 2013, généralisée au 1er janvier 2016), prise en charge par
//    l'employeur à hauteur d'au moins 50%. La part patronale est exonérée de cotisations sociales et
//    d'impôt sur le revenu pour le salarié dans une limite légale — au-delà, l'excédent est réintégré
//    comme un complément de rémunération imposable et soumis à cotisations sociales.
//
// Extension de la couverture à la famille du dirigeant (conjoint, enfants) — la règle diffère,
// là encore, selon le statut :
//  - TNS : les cotisations versées pour les ayants droit affiliés au même régime de sécurité sociale
//    sont déductibles au titre de l'art. 154 bis CGI, mais dans le MÊME plafond que celles du
//    dirigeant — il n'existe pas d'enveloppe supplémentaire par personne couverte. Étendre à la
//    famille consomme donc le plafond plus vite, sans le relever.
//  - Assimilé salarié : l'obligation légale de couverture (art. L911-7 CSS) ne porte que sur le
//    salarié lui-même ; l'extension aux ayants droit est une faculté. Son traitement social dépend
//    entièrement de ce que prévoit l'acte fondateur (accord, référendum ou DUE) :
//      · extension OBLIGATOIRE pour tous les salariés de la catégorie → la contribution patronale
//        qui la finance garde le caractère collectif et obligatoire, et entre dans l'exclusion
//        d'assiette au même titre que celle du salarié (art. L242-1, II-4° CSS) ;
//      · extension FACULTATIVE (le salarié choisit d'y adhérer) → la part patronale qui la finance
//        est assujettie à cotisations dès le premier euro, indépendamment du plafond : elle ne
//        remplit pas la condition de caractère obligatoire (position URSSAF/BOSS).
//    C'est le seul paramètre qui change radicalement le coût d'une couverture familiale : le taux de
//    prise en charge, lui, est entièrement libre (aucun minimum légal sur les ayants droit, 100 %
//    patronal admis).
//
// Simplifications assumées (cf. taxRules.ts pour le détail sourcé) :
//  - Les plafonds Madelin et d'exonération collective sont appliqués sur l'année en cours, sans
//    tenir compte d'un éventuel report de plafond non utilisé les années précédentes.
//  - Le traitement à l'impôt sur le revenu de la part patronale n'est pas chiffré : depuis la loi
//    n°2013-1278 du 29 décembre 2013 (art. 83, 1° quater CGI), la contribution patronale finançant
//    les FRAIS DE SANTÉ est imposable pour le bénéficiaire dès le premier euro, tandis que celle qui
//    finance la prévoyance (incapacité, invalidité, décès) ne l'est pas, et que la part salariale
//    d'un contrat obligatoire reste déductible. Ces effets jouent en sens inverse et supposeraient
//    de ventiler le budget entre santé et prévoyance : ils sont signalés en clair côté UI plutôt
//    qu'approximés ici. Seule la fraction réintégrée dans l'assiette sociale est imposée, car elle
//    l'est en tant que complément de rémunération quelle que soit la garantie financée.

import { type DirigeantStatus, getCompanyType, resolveDirigeantStatus, type ImpositionSociete } from "./companyTypes";
import { type CompanyTaxContext, computeEconomieImpotSociete } from "./corporateTax";
import { type PersonalTaxProfile, createDefaultPersonalTaxProfile, resolvePersonalTaxProfile } from "./frenchIncomeTax";
import { PASS_2026 } from "./pass";

export const MADELIN_TAUX_PASS = 0.07; // 7% du PASS
export const MADELIN_TAUX_BENEFICE = 0.0375; // 3,75% du bénéfice imposable
export const MADELIN_PLAFOND_MAX_TAUX_PASS = 0.03; // plafond absolu : 3% de 8×PASS
export const MADELIN_PLAFOND_MAX_MULTIPLE_PASS = 8;

export const EXONERATION_COLLECTIVE_TAUX_PASS = 0.06; // 6% du PASS
export const EXONERATION_COLLECTIVE_TAUX_BRUT = 0.015; // 1,5% du salaire brut annuel
export const EXONERATION_COLLECTIVE_PLAFOND_MAX_TAUX_PASS = 0.12; // plafond absolu : 12% du PASS

export const PART_PATRONALE_MINIMALE_POURCENT = 50; // obligation légale ANI (art. L911-7, II CSS) — sur le seul salarié
export const PART_PATRONALE_MAXIMALE_POURCENT = 100; // aucun plafond légal : l'employeur peut financer la totalité
export const PART_PATRONALE_FAMILLE_MINIMALE_POURCENT = 0; // aucun minimum légal sur les ayants droit

// CSG/CRDS due par le bénéficiaire sur la contribution patronale de prévoyance/santé, y compris sur
// sa fraction exonérée de cotisations : 9,2 % + 0,5 %, sans l'abattement d'assiette de 1,75 %.
export const TAUX_CSG_CRDS_PART_PATRONALE = 0.097;

// Forfait social sur la part patronale exonérée — dû par l'employeur à partir de 11 salariés
// seulement (art. L137-15 CSS) : une société dont le dirigeant est le seul « salarié » n'en doit pas.
export const TAUX_FORFAIT_SOCIAL_PREVOYANCE = 0.08;
export const EFFECTIF_ASSUJETTI_FORFAIT_SOCIAL = 11;

// Hypothèses de charges sociales sur la fraction réintégrée dans l'assiette : elle y est traitée
// comme un complément de rémunération ordinaire, donc supporte les cotisations des deux côtés.
export const TAUX_CHARGES_PATRONALES_REINTEGRATION_DEFAUT = 0.42;
export const TAUX_CHARGES_SALARIALES_REINTEGRATION_DEFAUT = 0.22;

export interface MutuellePrevoyanceInputs {
  id: string;
  name: string;
  createdAt: string;

  country: string;
  companyType: string;
  gerantMajoritaire: boolean;

  impositionSociete: ImpositionSociete;
  corporateTaxRate: number;
  eligibleTauxReduitPME: boolean;
  beneficeAvantChargePrevisionnel: number;

  cotisationAnnuelle: number; // budget santé + prévoyance du dirigeant SEUL, tous statuts confondus

  // Extension de la couverture à la famille — le surcoût est saisi par tête, comme le facturent les
  // contrats (« isolé / duo / famille »), plutôt qu'en pourcentage de la cotisation du dirigeant.
  couvertureConjoint: boolean;
  surcoutConjointAnnuel: number;
  nombreEnfantsCouverts: number;
  surcoutParEnfantAnnuel: number;
  /**
   * Assimilé salarié uniquement : l'acte fondateur rend-il l'affiliation des ayants droit
   * obligatoire ? Détermine à lui seul si la part patronale finançant la famille est exonérée ou
   * assujettie dès le premier euro.
   */
  extensionFamilleObligatoire: boolean;

  // TNS uniquement : qui paie les cotisations Madelin ?
  priseEnChargeParLaSociete: boolean;

  // Assimilé salarié uniquement :
  partPatronalePourcent: number; // % de la cotisation du dirigeant pris en charge par l'employeur (≥ 50 %)
  partPatronaleFamillePourcent: number; // % du surcoût famille pris en charge par l'employeur (0 à 100 %, libre)
  salaireBrutAnnuelReference: number; // pour le plafond d'exonération collectif (6%PASS + 1,5%brut)
  effectifAuMoins11Salaries: boolean; // assujettissement au forfait social de 8 %
  tauxChargesPatronalesReintegration: number;
  tauxChargesSalarialesReintegration: number;

  personalTaxProfile: PersonalTaxProfile;
}

export function createDefaultMutuellePrevoyanceInputs(): MutuellePrevoyanceInputs {
  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation mutuelle",
    createdAt: new Date().toISOString(),
    country: "FR",
    companyType: "EURL",
    gerantMajoritaire: true,
    impositionSociete: "IS",
    corporateTaxRate: 0.25,
    eligibleTauxReduitPME: true,
    beneficeAvantChargePrevisionnel: 40000,
    cotisationAnnuelle: 1500,
    couvertureConjoint: false,
    surcoutConjointAnnuel: 900,
    nombreEnfantsCouverts: 0,
    surcoutParEnfantAnnuel: 400,
    extensionFamilleObligatoire: false,
    priseEnChargeParLaSociete: true,
    partPatronalePourcent: PART_PATRONALE_MINIMALE_POURCENT,
    partPatronaleFamillePourcent: PART_PATRONALE_FAMILLE_MINIMALE_POURCENT,
    salaireBrutAnnuelReference: 45000,
    effectifAuMoins11Salaries: false,
    tauxChargesPatronalesReintegration: TAUX_CHARGES_PATRONALES_REINTEGRATION_DEFAUT,
    tauxChargesSalarialesReintegration: TAUX_CHARGES_SALARIALES_REINTEGRATION_DEFAUT,
    personalTaxProfile: createDefaultPersonalTaxProfile(),
  };
}

export interface MutuellePrevoyanceResults {
  dirigeantStatus: DirigeantStatus;

  // Périmètre couvert
  nombrePersonnesCouvertes: number; // dirigeant + conjoint + enfants
  cotisationDirigeantSeul: number;
  cotisationFamille: number; // surcoût conjoint + enfants
  cotisationTotale: number; // = dirigeant seul + famille, assiette de tous les calculs

  // TNS
  plafondMadelin: number; // 0 si assimilé salarié
  cotisationDeductibleTNS: number;
  cotisationNonDeductibleTNS: number;

  // Assimilé salarié
  partPatronale: number;
  partPatronaleDirigeant: number;
  partPatronaleFamille: number;
  partSalariale: number;
  plafondExonerationSociale: number; // 0 si TNS
  montantExonere: number;
  montantExcedentaire: number; // fraction réintégrée : dépassement de plafond + famille facultative
  excedentPlafond: number; // dont : dépassement du plafond d'exonération
  partFamilleAssujettie: number; // dont : part patronale d'une extension famille facultative
  csgCrdsSurPartPatronale: number;
  forfaitSocial: number;
  chargesPatronalesReintegration: number;
  chargesSalarialesReintegration: number;
  irSurExcedent: number;

  // Communs
  economieImpotSociete: number;
  coutNetSociete: number;
  economieImpotDirigeant: number;
  coutNetDirigeant: number;
  coutNetGlobal: number; // = coutNetSociete + coutNetDirigeant
  tauxEconomieGlobal: number; // 1 − coutNetGlobal/cotisationTotale
  /**
   * Écart avec la même couverture souscrite à titre individuel hors cadre professionnel : celle-ci
   * n'ouvre droit à aucune déduction, et coûte donc son prix plein prélevé sur un revenu déjà taxé.
   * C'est le gain réel du passage par la société, famille comprise.
   */
  coutContratIndividuelEquivalent: number;
  economieVsContratIndividuel: number;
}

export function computeMutuellePrevoyance(inputs: MutuellePrevoyanceInputs): MutuellePrevoyanceResults {
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);
  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  const tauxIRUtilise = resolvedTax.tauxUtilise;
  const ctx: CompanyTaxContext = inputs;

  // Périmètre couvert — commun aux deux statuts. Le surcoût par tête est ce que facturent les
  // contrats ; il s'ajoute à la cotisation du dirigeant pour former l'assiette de tous les calculs.
  const cotisationDirigeantSeul = Math.max(0, inputs.cotisationAnnuelle);
  const nombreEnfantsCouverts = Math.max(0, Math.floor(inputs.nombreEnfantsCouverts));
  const cotisationFamille =
    (inputs.couvertureConjoint ? Math.max(0, inputs.surcoutConjointAnnuel) : 0) +
    nombreEnfantsCouverts * Math.max(0, inputs.surcoutParEnfantAnnuel);
  const cotisationTotale = cotisationDirigeantSeul + cotisationFamille;
  const nombrePersonnesCouvertes = 1 + (inputs.couvertureConjoint ? 1 : 0) + nombreEnfantsCouverts;

  const perimetre = { nombrePersonnesCouvertes, cotisationDirigeantSeul, cotisationFamille, cotisationTotale };
  // Référence commune : la même couverture souscrite à titre individuel, hors cadre professionnel,
  // est payée sur un revenu déjà taxé et n'ouvre droit à aucune déduction — son coût est son prix.
  const coutContratIndividuelEquivalent = cotisationTotale;

  if (dirigeantStatus === "TNS") {
    // Plafond UNIQUE : les cotisations versées pour les ayants droit s'y imputent sans le relever
    // (art. 154 bis CGI). Couvrir la famille sature donc l'enveloppe plus vite.
    const plafondMadelin = Math.min(
      MADELIN_TAUX_PASS * PASS_2026 + MADELIN_TAUX_BENEFICE * Math.max(0, inputs.beneficeAvantChargePrevisionnel),
      MADELIN_PLAFOND_MAX_TAUX_PASS * MADELIN_PLAFOND_MAX_MULTIPLE_PASS * PASS_2026,
    );
    const cotisationDeductibleTNS = Math.min(cotisationTotale, plafondMadelin);
    const cotisationNonDeductibleTNS = cotisationTotale - cotisationDeductibleTNS;

    const economieImpotSociete = inputs.priseEnChargeParLaSociete
      ? computeEconomieImpotSociete(ctx, cotisationDeductibleTNS, tauxIRUtilise)
      : 0;
    const economieImpotDirigeant = inputs.priseEnChargeParLaSociete ? 0 : cotisationDeductibleTNS * tauxIRUtilise;
    const coutNetSociete = inputs.priseEnChargeParLaSociete ? cotisationTotale - economieImpotSociete : 0;
    const coutNetDirigeant = inputs.priseEnChargeParLaSociete ? 0 : cotisationTotale - economieImpotDirigeant;
    const coutNetGlobal = coutNetSociete + coutNetDirigeant;

    return {
      dirigeantStatus,
      ...perimetre,
      plafondMadelin,
      cotisationDeductibleTNS,
      cotisationNonDeductibleTNS,
      partPatronale: 0,
      partPatronaleDirigeant: 0,
      partPatronaleFamille: 0,
      partSalariale: 0,
      plafondExonerationSociale: 0,
      montantExonere: 0,
      montantExcedentaire: 0,
      excedentPlafond: 0,
      partFamilleAssujettie: 0,
      csgCrdsSurPartPatronale: 0,
      forfaitSocial: 0,
      chargesPatronalesReintegration: 0,
      chargesSalarialesReintegration: 0,
      irSurExcedent: 0,
      economieImpotSociete,
      coutNetSociete,
      economieImpotDirigeant,
      coutNetDirigeant,
      coutNetGlobal,
      tauxEconomieGlobal: cotisationTotale > 0 ? 1 - coutNetGlobal / cotisationTotale : 0,
      coutContratIndividuelEquivalent,
      economieVsContratIndividuel: coutContratIndividuelEquivalent - coutNetGlobal,
    };
  }

  // Assimilé salarié — deux taux de prise en charge distincts : celui du dirigeant, encadré par le
  // minimum légal de 50 %, et celui des ayants droit, entièrement libre (0 à 100 %).
  const ratioPatronal = Math.min(Math.max(inputs.partPatronalePourcent, 0), 100) / 100;
  const ratioPatronalFamille = Math.min(Math.max(inputs.partPatronaleFamillePourcent, 0), 100) / 100;
  const partPatronaleDirigeant = cotisationDirigeantSeul * ratioPatronal;
  const partPatronaleFamille = cotisationFamille * ratioPatronalFamille;
  const partPatronale = partPatronaleDirigeant + partPatronaleFamille;
  const partSalariale = cotisationTotale - partPatronale;

  const plafondExonerationSociale = Math.min(
    EXONERATION_COLLECTIVE_TAUX_PASS * PASS_2026 + EXONERATION_COLLECTIVE_TAUX_BRUT * Math.max(0, inputs.salaireBrutAnnuelReference),
    EXONERATION_COLLECTIVE_PLAFOND_MAX_TAUX_PASS * PASS_2026,
  );

  // Le plafond s'apprécie sur la seule CONTRIBUTION PATRONALE (art. L242-1, II-4° et D242-1 CSS) :
  // ce que le salarié finance lui-même n'a jamais eu à être exclu d'une assiette.
  // Et la part patronale finançant une extension famille facultative en est exclue d'emblée : faute
  // de caractère obligatoire, elle est assujettie dès le premier euro sans consommer le plafond.
  const partPatronaleEligibleExoneration = inputs.extensionFamilleObligatoire
    ? partPatronale
    : partPatronaleDirigeant;
  const partFamilleAssujettie = inputs.extensionFamilleObligatoire ? 0 : partPatronaleFamille;
  const montantExonere = Math.min(partPatronaleEligibleExoneration, plafondExonerationSociale);
  const excedentPlafond = Math.max(0, partPatronaleEligibleExoneration - plafondExonerationSociale);
  const montantExcedentaire = excedentPlafond + partFamilleAssujettie;

  // Coûts sociaux : la fraction exonérée n'échappe pas à tout — elle supporte la CSG/CRDS (à la
  // charge du bénéficiaire) et, au-delà de 11 salariés, le forfait social (à la charge de la société).
  const csgCrdsSurPartPatronale = montantExonere * TAUX_CSG_CRDS_PART_PATRONALE;
  const forfaitSocial = inputs.effectifAuMoins11Salaries ? montantExonere * TAUX_FORFAIT_SOCIAL_PREVOYANCE : 0;
  const chargesPatronalesReintegration = montantExcedentaire * Math.max(0, inputs.tauxChargesPatronalesReintegration);
  const chargesSalarialesReintegration = montantExcedentaire * Math.max(0, inputs.tauxChargesSalarialesReintegration);

  // La part patronale reste toujours déductible du résultat société (charge sociale), quel que soit
  // le dépassement du plafond d'exonération, de même que les charges qu'elle déclenche.
  const chargeDeductibleSociete = partPatronale + forfaitSocial + chargesPatronalesReintegration;
  const economieImpotSociete = computeEconomieImpotSociete(ctx, chargeDeductibleSociete, tauxIRUtilise);
  const coutNetSociete = chargeDeductibleSociete - economieImpotSociete;

  const irSurExcedent = montantExcedentaire * tauxIRUtilise;
  const economieImpotDirigeant = 0; // aucune déduction personnelle ; l'excédent est au contraire imposé (irSurExcedent)
  const coutNetDirigeant =
    partSalariale + csgCrdsSurPartPatronale + chargesSalarialesReintegration + irSurExcedent;
  const coutNetGlobal = coutNetSociete + coutNetDirigeant;

  return {
    dirigeantStatus,
    ...perimetre,
    plafondMadelin: 0,
    cotisationDeductibleTNS: 0,
    cotisationNonDeductibleTNS: 0,
    partPatronale,
    partPatronaleDirigeant,
    partPatronaleFamille,
    partSalariale,
    plafondExonerationSociale,
    montantExonere,
    montantExcedentaire,
    excedentPlafond,
    partFamilleAssujettie,
    csgCrdsSurPartPatronale,
    forfaitSocial,
    chargesPatronalesReintegration,
    chargesSalarialesReintegration,
    irSurExcedent,
    economieImpotSociete,
    coutNetSociete,
    economieImpotDirigeant,
    coutNetDirigeant,
    coutNetGlobal,
    tauxEconomieGlobal: cotisationTotale > 0 ? 1 - coutNetGlobal / cotisationTotale : 0,
    coutContratIndividuelEquivalent,
    economieVsContratIndividuel: coutContratIndividuelEquivalent - coutNetGlobal,
  };
}
