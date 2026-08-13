// Moteur de calcul — Avantage en nature véhicule de société pour dirigeant d'entreprise.
// Règles France 2026 — méthode réelle obligatoire pour les TNS (le barème forfaitaire
// URSSAF ne s'applique pas aux gérants majoritaires TNS). L'architecture (pays, forme
// juridique, régime d'imposition) est prévue pour être étendue à d'autres juridictions.
//
// Approche "coût global" : on ne compare pas seulement ce que paie le dirigeant d'un côté et
// la société de l'autre, mais le coût total consolidé (société + dirigeant) pour CHAQUE
// combinaison possible {propriétaire du véhicule = société|dirigeant} × {mode de financement =
// comptant|crédit|LOA|LLD}, afin d'identifier l'option qui coûte le moins cher globalement,
// plutôt que d'opposer les deux pockets entre eux.

import { DEFAULT_COUNTRY } from "./countries";
import {
  type DirigeantStatus,
  type ImpositionSociete,
  getCompanyType,
  resolveDirigeantStatus,
} from "./companyTypes";
import {
  type PersonalTaxProfile,
  createDefaultPersonalTaxProfile,
  resolvePersonalTaxProfile,
} from "./frenchIncomeTax";
import {
  type FinancingInputs,
  type FinancingMode,
  type FinancingResult,
  compareFinancingModes,
  createDefaultFinancingInputs,
} from "./financing";
import { estimateAnnualVehicleTax, getPlafondAmortissementDeductible } from "./vehicleTaxes";
import { computeEconomieImpotIS } from "./corporateTax";
import { getVehicleModel } from "./vehicleModels";
import { DEFAULT_DEPRECIATION_RATE_ANNUAL, estimateResidualValue } from "./vehicleDepreciation";

/**
 * Modalités par lesquelles le dirigeant peut s'acquitter de sa participation financière. Toutes sont
 * admises comme contrepartie réelle par le rescrit BOI-RES-TVA-000161 (ce qui ne l'est PAS, c'est le
 * simple constat d'un avantage en nature sur le bulletin, sans appauvrissement du bénéficiaire).
 *
 * Elles se répartissent en deux familles économiques :
 *  - sur RESSOURCES DÉJÀ NETTES (paiement personnel, retenue sur le net à payer, imputation sur le
 *    compte courant d'associé) : le dirigeant y consacre de l'argent ayant déjà supporté cotisations
 *    et impôt sur le revenu. Son coût réel est le montant versé ;
 *  - sur RÉMUNÉRATION BRUTE (réduction de la rémunération elle-même) : le dirigeant renonce à une
 *    fraction de rémunération avant cotisations et avant IR. Le même montant de contrepartie lui
 *    coûte donc nettement moins cher en argent réellement disponible.
 */
export type ParticipationVersementMode =
  | "retenue_nette" // retenue sur le net à payer — pratique la plus courante
  | "paiement_personnel" // virement ou prélèvement depuis le compte personnel
  | "compte_courant" // imputation sur le compte courant d'associé
  | "retenue_brute"; // réduction de la rémunération brute elle-même

export const PARTICIPATION_VERSEMENT_MODES: ParticipationVersementMode[] = [
  "retenue_nette",
  "paiement_personnel",
  "compte_courant",
  "retenue_brute",
];

export const PARTICIPATION_VERSEMENT_LABELS: Record<ParticipationVersementMode, string> = {
  retenue_nette: "Retenue sur le net à payer",
  paiement_personnel: "Paiement personnel (virement / prélèvement)",
  compte_courant: "Imputation sur le compte courant d'associé",
  retenue_brute: "Réduction de la rémunération brute",
};

export interface SimulationInputs {
  id: string;
  name: string;
  createdAt: string;

  // Juridiction / structure
  country: string; // code pays (FR uniquement disponible actuellement)
  companyType: string; // code forme juridique (EURL, SARL, SASU, SAS...)
  gerantMajoritaire: boolean; // pertinent uniquement si la forme juridique le permet (ex. SARL)
  impositionSociete: ImpositionSociete; // IS ou IR

  // Véhicule
  vehicleModelId: string | null; // référence dans le registre vehicleModels.ts (null = saisie manuelle)
  vehiclePrice: number; // Prix d'achat TTC (malus écologique déjà inclus dans le prix facturé)
  vehicleOverFiveYears: boolean; // > 5 ans => amortissement 10%, sinon 20% (véhicule acheté uniquement)
  isElectric: boolean; // 100% électrique => électricité exclue du calcul, exonéré de taxes CO2/polluants
  isEcoScoreEligible: boolean; // éco-score >= 60 (liste ADEME) => abattement 50% (électrique uniquement)
  co2EmissionsGkm: number; // émissions CO2 WLTP (g/km) — détermine le plafond de déduction fiscale et la taxe annuelle
  annualVehicleTaxOverride: number | null; // surcharge manuelle de la taxe annuelle CO2+polluants (null = estimation automatique)
  tauxDeprecationAnnuel: number; // 0-1, taux de décote annuel estimé, pour chiffrer la valeur résiduelle en fin de période
  vehicleWeightKg: number; // poids en ordre de marche (kg) — pour l'estimation informative du malus au poids
  aideAchatVehicule: number; // bonus écologique / prime à la conversion perçus (€), informatif — cf. estimateMalusPoids/aide dans vehicleTaxes.ts

  // Usage
  privateUsePercent: number; // 0-100
  totalKmAnnual: number; // km totaux annuels (pour IK et information)

  // Charges annuelles réelles
  annualInsurance: number;
  annualMaintenance: number;
  annualFuelPrivateCost: number; // coût carburant usage privé (véhicules thermiques uniquement)

  // Taux
  tnsContributionRate: number; // 0-1, taux de charges sociales appliqué à l'AEN net
  corporateTaxRate: number; // 0-1, taux normal IS (tranche > 42 500€), défaut 0.25

  // Rentabilité prévisionnelle de la société — détermine l'économie d'impôt RÉELLE générée par les
  // charges déductibles liées au véhicule (barème IS progressif + plafonnement par le bénéfice réel).
  beneficeAvantChargePrevisionnel: number; // bénéfice imposable prévisionnel de la société, avant les charges liées au véhicule
  chiffreAffairesPrevisionnel: number; // CA prévisionnel — informatif, condition d'éligibilité au taux réduit (<10M€)
  eligibleTauxReduitPME: boolean; // conditions art. 219 I-b CGI : CA<10M€, capital détenu ≥75% par des personnes physiques

  // Situation personnelle du dirigeant (pour affiner le TMI utilisé sur l'AEN et les revenus fonciers)
  personalTaxProfile: PersonalTaxProfile;

  // Optimisations
  monthlyParticipation: number; // participation financière mensuelle du gérant
  modeVersementParticipation: ParticipationVersementMode; // comment le dirigeant s'acquitte de cette participation
  // Pendant, côté société, de `compenserMensualiteParAugmentationSalaire` : la société augmente la
  // rémunération du dirigeant à hauteur de ce qu'il lui reverse en participation, de sorte que ce
  // versement ne l'appauvrisse pas. Sans objet (et sans effet) si aucune participation n'est versée.
  compenserParticipationParAugmentationSalaire: boolean;
  ikRatePerKm: number; // barème IK €/km utilisé si achat perso + IK

  // Alternative "achat perso, mensualité compensée par une augmentation de salaire" : quand activée,
  // les options "Personnel + IK" ci-dessous reçoivent, EN PLUS du coût des IK, un coût société
  // supplémentaire correspondant à une augmentation de salaire brute annuelle égale à la mensualité
  // de financement — cf. detail de calcul dans computeSimulation.
  compenserMensualiteParAugmentationSalaire: boolean;

  // TVA déductible sur un véhicule de tourisme mis à disposition contre une participation financière
  // réelle du dirigeant (CJUE 20/01/2021 QM C-288/19 ; rescrit BOFiP du 30/04/2025) : la mise à
  // disposition devient une prestation de location taxable, ce qui lève l'exclusion du droit à
  // déduction de l'art. 206, IV-2-6° annexe II CGI. Ne concerne QUE le scénario "véhicule société".
  tvaRecuperableVehicule: boolean;
  tauxTVA: number; // taux normal, 20% en France
  // Le prix d'achat saisi contient-il de la TVA récupérable ? Faux pour un véhicule acquis auprès
  // d'un particulier ou sous le régime de la marge : le prix ne porte alors aucune TVA déductible.
  // Ne concerne que les modes comptant/crédit — les loyers LOA/LLD, facturés par un loueur
  // assujetti, portent toujours de la TVA.
  prixContientTvaRecuperable: boolean;

  // Aides à l'achat d'un véhicule électrique — réduisent le prix effectivement payé (cf.
  // applyPrixNetAchat dans computeSimulation). Ne s'appliquent qu'aux modes comptant/crédit : les
  // offres LOA/LLD sont des loyers constructeur publiés indépendants de ce paramètre.
  ceeSelectedAmount: number; // montant du palier de prime CEE "Coup de pouce véhicules particuliers électriques" sélectionné (0 = aucune) — RÉSERVÉ AUX PARTICULIERS (personnes physiques), jamais appliqué à un achat société, cf. taxRules "cee-coup-de-pouce-vehicule-electrique"
  bonusRepriseActif: boolean; // bonus de reprise commercial constructeur (état + reprise d'un ancien véhicule)
  bonusRepriseMontant: number; // pré-rempli depuis le modèle de véhicule sélectionné (cf. vehicleModels.ts), éditable
  bonusRepriseApplicableSociete: boolean; // l'offre de reprise est-elle aussi ouverte à un achat professionnel ? à confirmer au cas par cas avec le concessionnaire

  // Financement — mêmes paramètres, utilisés à la fois si la société achète le véhicule
  // et si le dirigeant l'achète à titre personnel (chacun retient le mode qui l'intéresse).
  financingMode: FinancingMode; // mode retenu côté société pour l'affichage détaillé
  personalFinancingMode: FinancingMode; // mode retenu côté personnel pour l'affichage détaillé
  financing: FinancingInputs;

  // Projection
  projectionYears: number; // défaut 5
}

export const DEFAULT_ABATTEMENT_CAP = 2026.3; // plafond 2026 abattement véhicule électrique méthode réelle (50%)
export const DEFAULT_TNS_RATE = 0.43;
export const DEFAULT_CORPORATE_TAX_RATE = 0.25;
export const DEFAULT_IK_RATE = 0.5;
export const DEFAULT_TVA_RATE = 0.2;
export const IK_MAJORATION_ELECTRIQUE = 0.2; // majoration légale de 20% du barème IK pour les véhicules électriques
export const ALL_FINANCING_MODES: FinancingMode[] = ["comptant", "credit", "loa", "lld"];

export function createDefaultInputs(): SimulationInputs {
  const country = DEFAULT_COUNTRY;
  const companyType = "EURL";
  const companyTypeConfig = getCompanyType(country, companyType);
  const vehiclePrice = 45000;

  const base: SimulationInputs = {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation",
    createdAt: new Date().toISOString(),

    country,
    companyType,
    gerantMajoritaire: true,
    impositionSociete: companyTypeConfig?.defaultImposition ?? "IS",

    vehicleModelId: null,
    vehiclePrice,
    vehicleOverFiveYears: false,
    isElectric: true,
    isEcoScoreEligible: true,
    co2EmissionsGkm: 0,
    annualVehicleTaxOverride: null,
    tauxDeprecationAnnuel: DEFAULT_DEPRECIATION_RATE_ANNUAL,
    vehicleWeightKg: 1980, // Tesla Model Y (modèle par défaut) — poids en ordre de marche
    aideAchatVehicule: 0,

    privateUsePercent: 50,
    totalKmAnnual: 15000,

    annualInsurance: 900,
    annualMaintenance: 600,
    annualFuelPrivateCost: 0,

    tnsContributionRate: companyTypeConfig?.defaultCotisationRate ?? DEFAULT_TNS_RATE,
    corporateTaxRate: DEFAULT_CORPORATE_TAX_RATE,

    beneficeAvantChargePrevisionnel: 40000,
    chiffreAffairesPrevisionnel: 150000,
    eligibleTauxReduitPME: true,

    personalTaxProfile: createDefaultPersonalTaxProfile(),

    monthlyParticipation: 0,
    modeVersementParticipation: "retenue_nette",
    compenserParticipationParAugmentationSalaire: false,
    ikRatePerKm: DEFAULT_IK_RATE,
    compenserMensualiteParAugmentationSalaire: false,
    tvaRecuperableVehicule: false,
    tauxTVA: DEFAULT_TVA_RATE,
    prixContientTvaRecuperable: true,
    ceeSelectedAmount: 0,
    bonusRepriseActif: false,
    bonusRepriseMontant: 0,
    bonusRepriseApplicableSociete: true,

    financingMode: "credit",
    personalFinancingMode: "credit",
    financing: createDefaultFinancingInputs(vehiclePrice),

    projectionYears: 5,
  };

  // Applique le modèle par défaut (Tesla Model Y) : reprend son prix de référence et son offre LOA
  // constructeur réelle plutôt que l'estimation générique définie ci-dessus.
  return applyVehicleModel(base, "tesla-model-y-berlin");
}

/**
 * Applique le modèle de véhicule sélectionné : motorisation/éligibilité éco-score, et — quand le
 * modèle dispose d'offres LOA/LLD constructeur réelles connues (ex. Tesla Model Y, cf.
 * vehicleModels.ts) — le prix TTC de référence et les paramètres de financement (« Mode
 * d'acquisition du véhicule ») sont eux aussi réappliqués pour rester cohérents avec l'offre
 * réelle plutôt que de garder une estimation générique ou un prix précédemment saisi. Comparer une
 * offre LOA réelle (souvent promotionnelle) à une LLD purement générique fausserait le comparatif
 * des modes de financement : les deux sont donc sourcées réellement quand c'est possible.
 */
export function applyVehicleModel(inputs: SimulationInputs, modelId: string): SimulationInputs {
  const model = getVehicleModel(modelId);
  if (!model) return { ...inputs, vehicleModelId: modelId };

  // Les aides (CEE, bonus de reprise) sont propres à chaque modèle/offre : on les réinitialise à
  // chaque changement de modèle plutôt que de laisser un montant obsolète d'un autre véhicule, et on
  // pré-remplit le bonus de reprise du nouveau modèle (désactivé par défaut : à l'utilisateur de
  // confirmer qu'il en bénéficie réellement).
  let next: SimulationInputs = {
    ...inputs,
    vehicleModelId: modelId,
    ceeSelectedAmount: 0,
    bonusRepriseActif: false,
    bonusRepriseMontant: model.bonusRepriseConstructeur ?? 0,
  };
  if (model.id !== "autre") {
    next = { ...next, isElectric: model.isElectric, isEcoScoreEligible: model.ecoScoreEligible };
  }
  if (model.defaultPrice) {
    const financing = createDefaultFinancingInputs(model.defaultPrice);
    if (model.defaultLoaOffer) {
      financing.loa = { prixTTC: model.defaultPrice, ...model.defaultLoaOffer, leveeOption: true };
    }
    if (model.defaultLldOffer) {
      financing.lld = {
        premierLoyer: model.defaultLldOffer.premierLoyer,
        loyerMensuel: model.defaultLldOffer.loyerMensuel,
        dureeMois: model.defaultLldOffer.dureeMois,
        kmInclusAnnuel: model.defaultLldOffer.kmInclusAnnuel,
        kmReelAnnuel: next.totalKmAnnual,
        coutKmSupplementaire: financing.lld.coutKmSupplementaire,
        // Reporté depuis l'offre constructeur : si le loyer est « tout compris », le simulateur
        // neutralisera assurance et entretien POUR LE SEUL MODE LLD, sans toucher aux montants
        // saisis, qui restent utilisés par les modes comptant/crédit/LOA.
        toutComprisEntretienAssurance: model.defaultLldOffer.toutComprisEntretienAssurance ?? false,
      };
    }
    next = { ...next, vehiclePrice: model.defaultPrice, financing };
  }
  return next;
}

/** Coût global annualisé d'une combinaison {propriétaire, mode de financement} donnée, avec le
 * détail de la répartition entre ce que supporte réellement la société et ce que supporte
 * réellement le dirigeant (les deux s'additionnent pour former globalCostAnnual). */
export interface GlobalOptionDetailLine {
  label: string;
  value: number;
}

export interface GlobalOption {
  owner: "societe" | "personnel";
  mode: FinancingMode;
  label: string;
  globalCostAnnual: number;
  partSociete: number; // coût net réellement supporté par la société (après économies d'impôt)
  partDirigeant: number; // coût net réellement supporté par le dirigeant (cash, après IK le cas échéant)
  devientProprietaire: boolean; // le véhicule est-il possédé à l'issue de la période (comptant/crédit, ou LOA option levée) ?
  valeurResiduelleEstimee: number; // valeur de marché estimée du véhicule en fin de période — 0 si jamais possédé (LLD, LOA sans option)
  detail: GlobalOptionDetailLine[]; // détail du calcul, affiché au dépliage de l'option dans l'UI
}

export interface SimulationResults {
  dirigeantStatus: DirigeantStatus;

  amortRate: number;
  amortAnnual: number;
  aenBaseAnnualCosts: number; // base réelle retenue pour l'AEN (amortissement si acheté, 30% du loyer si loué) + assurance + entretien
  aenBrut: number;
  abattement: number;
  aenNetBeforeParticipation: number;
  participationAnnual: number;
  aenNet: number; // après abattement ET participation financière

  // Fiscalité personnelle du dirigeant (foyer)
  tmiCalcule: number; // TMI calculé à partir de la situation personnelle
  tauxIRUtilise: number; // taux effectivement retenu (manuel ou calculé)
  revenuImposableFoyer: number;
  partsFiscales: number;
  quotientFamilial: number; // revenuImposableFoyer / partsFiscales — détermine seul la tranche/TMI applicable
  impotFoyerApresDecote: number; // impôt total du foyer après décote (indicatif)
  dansZoneDecote: boolean; // le foyer est-il dans la zone de dégressivité de la décote ?
  tauxMarginalEffectif: number; // taux marginal réel intégrant l'effet décote (utilisé si mode "calculé")

  cotisationsTNS: number;
  irEstimee: number;
  coutTotalGerantSociete: number; // cash réellement supporté par le gérant (cotisations + IR) dans le scénario société

  // Société — mode de financement `financingMode`
  plafondAmortissementDeductible: number; // plafond fiscal (art. 39-4 CGI) selon les émissions de CO2
  fractionFiscalementDeductible: number; // part de l'amortissement/loyer effectivement déductible (0-1)
  reintegrationFiscaleCO2: number; // fraction de l'amortissement/loyer au-delà du plafond, non déductible
  annualVehicleTax: number; // taxes annuelles CO2 + polluants (ex-TVS), 0 si électrique
  financingAnnual: number; // coût annuel du financement seul (mensualités crédit, loyers LOA/LLD, ou coût comptant/opportunité)
  valeurResiduelleAnnualisee: number; // valeur résiduelle du véhicule possédé en fin de période (comptant, crédit, LOA option levée) lissée sur la durée, déduite du décaissement — 0 sinon
  optionAchatAnnualisee: number; // levée d'option d'achat LOA lissée sur la durée du contrat, ajoutée au décaissement — 0 hors LOA ou option non levée
  tvaDeductible: number; // TVA récupérée au total (récurrente + option d'achat) — 0 si l'option n'est pas activée
  tvaDeductibleRecurrente: number; // part récurrente : loyer LOA/LLD ou amortissement annuel, + entretien
  tvaOptionAchatAnnualisee: number; // part issue de la levée d'option d'achat LOA, lissée sur la durée du contrat
  tvaCollecteeSurParticipation: number; // TVA collectée sur la participation financière encaissée du dirigeant
  gainTvaNet: number; // indicateur : tvaDeductible − tvaCollecteeSurParticipation (le calcul du coût utilise les deux termes séparément)
  tvaEffectivementDeductible: boolean; // false si l'option est cochée sans contrepartie versée (mise à disposition gratuite = hors champ)
  coutParticipationDirigeant: number; // coût réel de la participation pour le dirigeant, selon la modalité de versement retenue
  modeVersementOptimal: ParticipationVersementMode; // modalité la moins coûteuse pour un même montant de participation
  economieModeVersementOptimal: number; // économie annuelle obtenue en basculant sur cette modalité (0 si déjà retenue)
  impotSurParticipation: number; // IS/IR généré par la participation encaissée (produit imposable)
  augmentationBruteParticipation: number; // coût chargé de l'augmentation compensant la participation — 0 si l'option est inactive
  coutNetAugmentationParticipation: number; // cette augmentation après économie d'impôt société, ajoutée au coût net société
  participationNetteSociete: number; // participation encaissée nette de l'impôt qu'elle génère, déduite du coût net société
  participationOptimaleMensuelle: number; // participation mensuelle ramenant exactement l'AEN à 0 — au-delà, plus aucun gain fiscal
  companyCashBaseAnnual: number; // décaissement réel annuel de la société pour le véhicule (financement + assurance + entretien + taxes − valeur résiduelle annualisée − gain net de TVA)
  quotePartProfessionnelleDeductible: number;
  quotePartPrivéeNonDeductible: number;
  economieImpotQuotePartPro: number; // économie d'IS (régime IS) ou d'IR foyer (régime IR, société translucide)
  coutNetSociete: number; // coût net société après économie d'impôt
  globalCostSociete: number; // coutNetSociete + coutTotalGerantSociete : coût consolidé du scénario société

  // Scénario "achat personnel + IK" — mode de financement `personalFinancingMode`
  proKmAnnual: number;
  privateKmAnnual: number;
  effectiveIkRatePerKm: number; // barème IK effectivement appliqué (majoré de 20% si électrique)
  ikReimbursement: number;
  personalFinancingAnnual: number;
  valeurResiduelleAnnualiseePersonnel: number; // valeur résiduelle du véhicule (comptant/crédit, scénario personnel) lissée sur la durée, déduite du coût — 0 sinon
  coutScenarioPersonnel: number; // coût net réellement supporté par le dirigeant (après réception des IK)
  economieImpotIK: number; // économie d'impôt société sur l'IK versée (déductible)
  globalCostPersonnel: number; // coût consolidé (société + dirigeant) du scénario personnel + IK

  // Toutes les combinaisons possibles {société|personnel} × {comptant|crédit|LOA|LLD}, triées par coût global croissant
  allOptions: GlobalOption[];
  bestOption: GlobalOption;

  // Comparaison des deux scénarios actuellement sélectionnés (financingMode / personalFinancingMode)
  difference: number; // globalCostSociete - globalCostPersonnel (positif = le scénario personnel coûte globalement moins cher)
  recommandation: "societe" | "personnel" | "equivalent";
  seuilPrivateUsePercent: number | null; // % usage privé à partir duquel le scénario personnel devient globalement moins cher

  // Projection (coûts globaux cumulés)
  anneeTransitionAmortissement: number | null; // année de la projection où l'amortissement passe de 20% à 10%/an (achat uniquement)
  projection: { year: number; cumulSociete: number; cumulPersonnel: number }[];

  // Aides à l'achat effectivement déduites du prix (cf. applyPrixNetAchat) — 0 si aucune aide activée.
  remiseSociete: number;
  remisePersonnel: number;
  prixNetSociete: number; // inputs.vehiclePrice − remiseSociete
  prixNetPersonnel: number; // inputs.vehiclePrice − remisePersonnel
}

function getFinancingAnnual(financingResults: FinancingResult[], mode: FinancingMode): number {
  const found = financingResults.find((f) => f.mode === mode);
  return found ? found.coutMensuelEquivalent * 12 : 0;
}

/** Coût de LOCATION annuel moyen (hors option d'achat/valeur résiduelle) — cf. FinancingResult.loyerAnnuelMoyen. */
function getLoyerAnnuelMoyen(financingResults: FinancingResult[], mode: FinancingMode): number {
  const found = financingResults.find((f) => f.mode === mode);
  return found ? found.loyerAnnuelMoyen : 0;
}

/** Durée (mois) du montage retenu pour un mode de financement donné (0 pour la LLD, jamais possédée). */
function getDureeMoisForMode(inputs: SimulationInputs, mode: FinancingMode): number {
  switch (mode) {
    case "comptant":
      return inputs.financing.comptant.dureeDetentionMois;
    case "credit":
      return inputs.financing.credit.dureeMois;
    case "loa":
      return inputs.financing.loa.dureeMois;
    case "lld":
      return 0;
  }
}

/**
 * Valeur résiduelle du véhicule en fin de période, pour un mode de financement donné — uniquement
 * si le véhicule est effectivement possédé à l'issue (comptant/crédit ; LOA avec option levée gérée
 * séparément dans allOptions, cf. plus bas), sinon 0 (LLD, LOA sans option : véhicule restitué).
 */
/** Le véhicule est-il possédé à l'issue de la période ? Comptant et crédit toujours ; LOA seulement
 *  si l'option d'achat est levée ; jamais en LLD (restitution). */
function vehiculePossedeEnFinDePeriode(inputs: SimulationInputs, mode: FinancingMode): boolean {
  if (mode === "comptant" || mode === "credit") return true;
  if (mode === "loa") return inputs.financing.loa.leveeOption;
  return false;
}

/** Versement unique d'acquisition en fin de contrat (levée de l'option d'achat LOA), ANNUALISÉ sur
 *  la durée du contrat. Comme la valeur résiduelle qui lui fait face, il est lissé pour que le coût
 *  annuel/mensuel comparé n'omette aucun flux — cf. commentaire de getResidualValueAnnualized. */
function getOptionAchatAnnualisee(inputs: SimulationInputs, mode: FinancingMode): number {
  if (mode !== "loa" || !inputs.financing.loa.leveeOption) return 0;
  const dureeAnnees = getDureeMoisForMode(inputs, mode) / 12;
  if (dureeAnnees <= 0) return 0;
  return inputs.financing.loa.valeurOptionAchat / dureeAnnees;
}

function getResidualValue(inputs: SimulationInputs, mode: FinancingMode): number {
  if (!vehiculePossedeEnFinDePeriode(inputs, mode)) return 0;
  const dureeAnnees = getDureeMoisForMode(inputs, mode) / 12;
  if (dureeAnnees <= 0) return 0;
  // En LOA, la valeur du véhicule se déduit du prix de référence du CONTRAT, et non du prix net
  // d'aides : les aides à l'achat ne s'appliquent qu'aux modes comptant/crédit (cf.
  // applyPrixNetAchat), et une offre LOA reste insensible à leur présence.
  const prixReference = mode === "loa" ? inputs.financing.loa.prixTTC : inputs.vehiclePrice;
  return estimateResidualValue(prixReference, dureeAnnees, inputs.tauxDeprecationAnnuel);
}

/**
 * Valeur résiduelle ANNUALISÉE (lissée sur la durée de détention) du véhicule acquis comptant ou à
 * crédit — vient en déduction du décaissement annuel affiché.
 *
 * Pourquoi : le coût "comptant" immobilise tout le prix d'achat pendant la durée de détention (cf.
 * computeComptant dans financing.ts, coût d'opportunité linéaire sur le prix total), sans jamais
 * créditer le fait que le véhicule est finalement revendu/conservé avec une valeur résiduelle non
 * nulle. Sans cette déduction, comptant et crédit ne sont pas comparés à armes égales : un crédit à
 * un TAEG pourtant supérieur au taux d'opportunité du comptant peut apparaître — à tort — moins
 * coûteux, simplement parce que ses intérêts ne portent que sur un capital restant dû dégressif,
 * alors que le coût d'opportunité du comptant porte sur le prix plein pendant toute la période.
 * Netter la valeur résiduelle (identique pour les deux, à durée égale) rend la comparaison cohérente.
 */
function getResidualValueAnnualized(inputs: SimulationInputs, mode: FinancingMode): number {
  const dureeAnnees = getDureeMoisForMode(inputs, mode) / 12;
  if (dureeAnnees <= 0) return 0;
  return getResidualValue(inputs, mode) / dureeAnnees;
}

/** Base annuelle réelle retenue pour l'AEN : amortissement si le véhicule est acheté par la société,
 * 30% du coût de location si le véhicule est loué (LOA/LLD) — cf. BOI-RSA-BASE-30-50-30.
 * En LOA, si l'option d'achat est levée, sa valeur n'est PAS un loyer (c'est un versement
 * d'acquisition de capital) : elle est exclue de cette base, cf. `loyerAnnuelMoyen`. */
function computeAenBase(inputs: SimulationInputs, mode: FinancingMode, loyerAnnuelMoyen: number) {
  // En LLD « tout compris », entretien et assurance sont déjà dans le loyer : les rajouter ici
  // gonflerait la base de l'AEN d'un doublon.
  const { annualInsurance, annualMaintenance } = chargesHorsFinancement(inputs, mode);
  const isOwned = mode === "comptant" || mode === "credit";
  if (isOwned) {
    const amortRate = inputs.vehicleOverFiveYears ? 0.1 : 0.2;
    const amortAnnual = inputs.vehiclePrice * amortRate;
    return { amortRate, amortAnnual, aenBaseAnnualCosts: amortAnnual + annualInsurance + annualMaintenance };
  }
  const aenBaseAnnualCosts = (loyerAnnuelMoyen + annualInsurance + annualMaintenance) * 0.3;
  return { amortRate: 0, amortAnnual: 0, aenBaseAnnualCosts };
}

/**
 * Économie d'impôt réellement générée par une charge déductible donnée.
 * Régime IS : barème progressif (15%/25%) appliqué au bénéfice prévisionnel, plafonné par ce
 * bénéfice — une société déficitaire ou peu profitable ne récupère pas immédiatement tout le
 * gain théorique (cf. corporateTax.ts).
 * Régime IR (société translucide) : le bénéfice est déjà intégré au revenu imposable du foyer
 * (cf. computeSimulation), donc le taux marginal du foyer (tauxIRUtilise) s'applique directement.
 */
function computeEconomieImpot(inputs: SimulationInputs, chargeDeductible: number, tauxIRUtilise: number): number {
  if (inputs.impositionSociete === "IS") {
    return computeEconomieImpotIS(
      inputs.beneficeAvantChargePrevisionnel,
      chargeDeductible,
      inputs.eligibleTauxReduitPME,
      inputs.corporateTaxRate,
    );
  }
  return chargeDeductible * tauxIRUtilise;
}

/**
 * Assurance et entretien effectivement supportés EN PLUS du financement, pour un mode donné.
 * En LLD « tout compris », ces deux postes sont déjà compris dans le loyer : les additionner au
 * loyer les compterait deux fois, dans le coût comme dans la base de l'AEN et de la TVA.
 */
function chargesHorsFinancement(
  inputs: SimulationInputs,
  mode: FinancingMode,
): { annualInsurance: number; annualMaintenance: number } {
  if (mode === "lld" && inputs.financing.lld.toutComprisEntretienAssurance) {
    return { annualInsurance: 0, annualMaintenance: 0 };
  }
  return { annualInsurance: inputs.annualInsurance, annualMaintenance: inputs.annualMaintenance };
}

/**
 * Coût RÉEL, pour le dirigeant, d'une participation d'un montant donné, selon la modalité retenue.
 *
 * La contrepartie reçue par la société est la même dans tous les cas (elle encaisse le montant, ou
 * économise d'autant sa charge de rémunération — les deux se valent puisqu'un produit imposable et
 * une charge déductible en moins produisent le même résultat fiscal). Ce qui diffère, c'est ce que
 * le dirigeant doit sacrifier pour la fournir :
 *
 *  - sur ressources déjà nettes : il y consacre de l'argent ayant déjà supporté cotisations et IR.
 *    Une participation de 100 € lui coûte 100 € ;
 *  - sur rémunération brute : il renonce à 100 € de rémunération AVANT cotisations et AVANT IR. Il
 *    ne perd donc que le net correspondant (100 / (1 + taux de cotisations)), lui-même amputé de
 *    l'IR qu'il aurait supporté dessus. Le sacrifice réel est bien plus faible.
 *
 * D'où un écart de coût global qui n'est pas un artefact : verser avec de l'argent déjà taxé, dans
 * une société où la somme est imposée une seconde fois, revient à subir deux fois le prélèvement.
 */
function coutParticipationPourDirigeant(
  inputs: SimulationInputs,
  participationAnnual: number,
  tauxIRUtilise: number,
  mode: ParticipationVersementMode = inputs.modeVersementParticipation,
): number {
  if (participationAnnual <= 0) return 0;
  // Participation compensée par une augmentation de rémunération : la société relève la rémunération
  // du dirigeant de ce qu'il lui reverse, si bien qu'il ne supporte plus que l'impôt sur le revenu
  // dû sur cette augmentation — le reste lui est restitué avant d'être reversé. Le coût du montage
  // bascule alors sur la société (cf. coutNetAugmentationParticipation).
  if (inputs.compenserParticipationParAugmentationSalaire) {
    return participationAnnual * tauxIRUtilise;
  }
  if (mode === "retenue_brute") {
    const netAbandonne = participationAnnual / (1 + inputs.tnsContributionRate);
    return netAbandonne * (1 - tauxIRUtilise);
  }
  return participationAnnual;
}

/** Résultat complet côté société pour un mode de financement et un % d'usage privé donnés. */
function computeSocieteForMode(
  inputs: SimulationInputs,
  mode: FinancingMode,
  privateUsePercent: number,
  financingResults: FinancingResult[],
  tauxIRUtilise: number,
) {
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);

  const financingAnnual = getFinancingAnnual(financingResults, mode);
  const loyerAnnuelMoyen = getLoyerAnnuelMoyen(financingResults, mode);
  // Offre LLD « tout compris » : entretien et assurance sont déjà dans le loyer. On les neutralise
  // POUR CE SEUL MODE — les champs de saisie sont communs aux quatre modes et restent indispensables
  // en comptant/crédit/LOA, où ces charges sont bien supportées en plus du financement.
  const { annualInsurance, annualMaintenance } = chargesHorsFinancement(inputs, mode);
  const { amortRate, amortAnnual, aenBaseAnnualCosts } = computeAenBase(inputs, mode, loyerAnnuelMoyen);

  const ratio = Math.min(Math.max(privateUsePercent, 0), 100) / 100;
  const aenBrutFromBase = aenBaseAnnualCosts * ratio;
  const fuelPrivate = inputs.isElectric ? 0 : inputs.annualFuelPrivateCost;
  const aenBrut = aenBrutFromBase + fuelPrivate;

  let abattement = 0;
  if (inputs.isElectric && inputs.isEcoScoreEligible) {
    abattement = Math.min(0.5 * aenBrut, DEFAULT_ABATTEMENT_CAP);
  }
  const aenNetBeforeParticipation = Math.max(0, aenBrut - abattement);

  const participationAnnual = inputs.monthlyParticipation * 12;
  const aenNet = Math.max(0, aenNetBeforeParticipation - participationAnnual);

  const cotisationsTNS = aenNet * inputs.tnsContributionRate;
  const irEstimee = aenNet * tauxIRUtilise;
  // La participation est un décaissement réel du dirigeant vers la société : elle s'ajoute à son coût
  // cash (ici) et vient en recette de la société (cf. companyCashBaseAnnual). Ce transfert est neutre
  // au niveau du coût global consolidé — seule la baisse d'AEN qu'il procure constitue un gain réel —
  // mais il doit apparaître de chaque côté pour que la répartition société/dirigeant soit exacte.
  // Le montant versé n'est pas plafonné par l'AEN : au-delà du point où l'AEN est ramené à 0, le
  // dirigeant continue de payer sans contrepartie fiscale (cf. participationOptimaleMensuelle).
  // Le coût retenu dépend de la modalité de versement — cf. coutParticipationPourDirigeant.
  const coutParticipationDirigeant = coutParticipationPourDirigeant(inputs, participationAnnual, tauxIRUtilise);
  const coutTotalGerantSociete = cotisationsTNS + irEstimee + coutParticipationDirigeant;

  // Plafond de déduction fiscale de l'amortissement (ou du loyer LOA/LLD au prorata) selon les
  // émissions de CO2 — art. 39-4 CGI. La fraction excédentaire doit être réintégrée au résultat
  // fiscal, y compris sur sa quote-part professionnelle.
  const plafondAmortissementDeductible = getPlafondAmortissementDeductible(inputs.co2EmissionsGkm, inputs.isElectric);
  const fractionFiscalementDeductible =
    inputs.vehiclePrice > 0 ? Math.min(1, plafondAmortissementDeductible / inputs.vehiclePrice) : 1;
  const composantPlafonnee = mode === "comptant" || mode === "credit" ? amortAnnual : loyerAnnuelMoyen;
  const reintegrationFiscaleCO2 = composantPlafonnee * (1 - fractionFiscalementDeductible);

  // Taxes annuelles sur l'affectation des véhicules de tourisme (ex-TVS : composante CO2 + polluants),
  // exonérées pour les véhicules 100% électriques/hydrogène.
  const annualVehicleTax =
    inputs.annualVehicleTaxOverride ?? estimateAnnualVehicleTax(inputs.co2EmissionsGkm, inputs.isElectric);

  // Valeur résiduelle annualisée (véhicule possédé en fin de période) : cf. getResidualValueAnnualized —
  // déduite du décaissement pour ne pas surestimer le coût réel d'un achat dont le véhicule garde
  // de la valeur à l'issue de la période, contrairement à un loyer (LOA/LLD) définitivement perdu.
  const valeurResiduelleAnnualisee = getResidualValueAnnualized(inputs, mode);
  // Levée de l'option d'achat en LOA : versement unique de fin de contrat, lissé sur la durée pour
  // qu'aucun flux ne reste hors du coût annuel/mensuel comparé. Sa contrepartie — la valeur
  // résiduelle du véhicule alors acquis — est lissée de la même façon juste au-dessus.
  const optionAchatAnnualisee = getOptionAchatAnnualisee(inputs, mode);

  // TVA déductible sur le véhicule (option "participation financière au prix de marché") — cf.
  // règle "tva-vehicule-fonction-participation-financiere". Périmètre retenu, volontairement
  // restreint aux postes dont l'assujettissement à la TVA est certain :
  //  - le véhicule lui-même : loyer annuel (LOA/LLD) ou amortissement annuel (comptant/crédit —
  //    étaler la TVA du prix d'achat sur la durée d'amortissement en restitue bien 100% au total) ;
  //  - l'entretien, qui suit le régime du véhicule auquel il se rattache.
  // Exclus : l'assurance (opération exonérée de TVA, art. 261 C CGI) et les taxes annuelles.
  // En contrepartie, la mise à disposition devient une prestation taxable : la société collecte
  // de la TVA sur la participation encaissée.
  //
  // CONDITION IMPÉRATIVE : sans contrepartie réelle versée par le dirigeant, la mise à disposition
  // reste une opération à titre gratuit — donc hors champ de la TVA, sans aucun droit à déduction
  // (rescrit BOI-RES-TVA-000161 : un avantage en nature constaté sur le bulletin, sans contrepartie
  // réelle, n'ouvre pas ce droit). L'option est donc neutralisée tant que la participation est nulle,
  // pour ne pas afficher un gain qui ne serait pas défendable.
  const coefTVA = inputs.tauxTVA / (1 + inputs.tauxTVA); // part de TVA contenue dans un montant TTC
  const tvaEffectivementDeductible = inputs.tvaRecuperableVehicule && participationAnnual > 0;
  // Un véhicule acheté à un particulier ou sous le régime de la marge ne porte aucune TVA
  // déductible : sa composante "véhicule" sort alors de la base. Sans objet en LOA/LLD, dont les
  // loyers sont facturés par un loueur assujetti.
  const vehiculePorteTva = mode === "comptant" || mode === "credit" ? inputs.prixContientTvaRecuperable : true;
  const baseTvaDeductibleTTC = tvaEffectivementDeductible
    ? (vehiculePorteTva ? composantPlafonnee : 0) + annualMaintenance
    : 0;
  // Levée de l'option d'achat en LOA : le rachat est facturé par le loueur, TVA comprise. Sa TVA
  // est récupérée et lissée sur la durée du contrat, exactement comme le sont le versement de
  // rachat lui-même (optionAchatAnnualisee) et la valeur résiduelle du véhicule alors acquis —
  // de sorte qu'aucune des trois composantes de cette opération de fin de contrat ne reste hors
  // du coût annuel comparé.
  const dureeAnneesMode = getDureeMoisForMode(inputs, mode) / 12;
  const optionAchatPayeeTTC =
    mode === "loa" ? (financingResults.find((f) => f.mode === "loa")?.detail.optionAchatPayee ?? 0) : 0;
  const tvaOptionAchatAnnualisee =
    tvaEffectivementDeductible && optionAchatPayeeTTC > 0 && dureeAnneesMode > 0
      ? (optionAchatPayeeTTC * coefTVA) / dureeAnneesMode
      : 0;
  const tvaDeductible = baseTvaDeductibleTTC * coefTVA + tvaOptionAchatAnnualisee;
  const tvaCollecteeSurParticipation = tvaEffectivementDeductible ? participationAnnual * coefTVA : 0;
  // Position nette de TVA, exposée à titre d'indicateur. Attention : ce n'est PAS le terme utilisé
  // dans le calcul du coût ci-dessous — la TVA collectée y est prise en compte via la participation
  // ramenée à son montant HT, pour éviter de la compter deux fois.
  const gainTvaNet = tvaDeductible - tvaCollecteeSurParticipation;

  // Décaissement réel de la société : financement + assurance + entretien + taxes − valeur résiduelle
  // annualisée (si véhicule possédé) − TVA récupérée (le coût réel des postes concernés devient HT).
  // La participation encaissée n'y figure pas : ce n'est pas une moindre charge mais un PRODUIT
  // imposable, traité séparément ci-dessous pour être taxé sur la totalité de son montant (et non
  // sur sa seule quote-part professionnelle, comme le serait une réduction de charge).
  const companyCashBaseAnnual =
    financingAnnual +
    optionAchatAnnualisee +
    annualInsurance +
    annualMaintenance +
    annualVehicleTax -
    valeurResiduelleAnnualisee -
    tvaDeductible;
  const quotePartPrivéeNonDeductible = companyCashBaseAnnual * ratio;
  const quotePartProfessionnelleBrute = companyCashBaseAnnual - quotePartPrivéeNonDeductible;
  const quotePartProfessionnelleDeductible = Math.max(0, quotePartProfessionnelleBrute - reintegrationFiscaleCO2);
  const economieImpotQuotePartPro = computeEconomieImpot(inputs, quotePartProfessionnelleDeductible, tauxIRUtilise);

  // Participation encaissée : produit imposable, mais sur son seul montant HORS TAXE — la TVA
  // collectée n'est pas un produit, elle est reversée au Trésor. L'impôt qu'elle génère se calcule
  // avec la même mécanique (barème IS progressif ou IR selon le régime) que l'économie d'impôt sur
  // une charge déductible de même montant — d'où la réutilisation de computeEconomieImpot.
  const participationHT = participationAnnual - tvaCollecteeSurParticipation;
  const impotSurParticipation = computeEconomieImpot(inputs, participationHT, tauxIRUtilise);
  const participationNetteSociete = participationHT - impotSurParticipation;

  // Augmentation de rémunération compensant la participation : la société verse au dirigeant, en
  // plus, de quoi financer son versement. Chargée comme toute rémunération (mêmes conventions que
  // compenserMensualiteParAugmentationSalaire : le taux de cotisations s'applique au net versé), et
  // déductible du résultat. Elle annule l'essentiel de l'effort du dirigeant en le reportant sur la
  // société — le montage n'est donc jamais gratuit, il change seulement de porteur.
  const augmentationBruteParticipation =
    inputs.compenserParticipationParAugmentationSalaire && participationAnnual > 0
      ? participationAnnual * (1 + inputs.tnsContributionRate)
      : 0;
  const economieImpotAugmentationParticipation = computeEconomieImpot(
    inputs,
    augmentationBruteParticipation,
    tauxIRUtilise,
  );
  const coutNetAugmentationParticipation = augmentationBruteParticipation - economieImpotAugmentationParticipation;

  const coutNetSociete =
    companyCashBaseAnnual - economieImpotQuotePartPro - participationNetteSociete + coutNetAugmentationParticipation;

  const globalCostSociete = coutNetSociete + coutTotalGerantSociete;

  return {
    dirigeantStatus,
    amortRate,
    amortAnnual,
    aenBaseAnnualCosts,
    aenBrut,
    abattement,
    aenNetBeforeParticipation,
    participationAnnual,
    aenNet,
    cotisationsTNS,
    irEstimee,
    coutTotalGerantSociete,
    plafondAmortissementDeductible,
    fractionFiscalementDeductible,
    reintegrationFiscaleCO2,
    annualVehicleTax,
    financingAnnual,
    valeurResiduelleAnnualisee,
    optionAchatAnnualisee,
    tvaDeductible,
    tvaDeductibleRecurrente: baseTvaDeductibleTTC * coefTVA,
    tvaOptionAchatAnnualisee,
    tvaCollecteeSurParticipation,
    gainTvaNet,
    tvaEffectivementDeductible,
    coutParticipationDirigeant,
    // Modalité de versement la moins coûteuse. La contrepartie encaissée par la société est
    // identique quelle que soit la modalité : minimiser le coût supporté par le dirigeant minimise
    // donc bien le coût global consolidé. On l'évalue en comparant les modalités entre elles plutôt
    // qu'en la postulant, pour que le cas dégénéré (aucune cotisation ni IR) donne bien une égalité.
    ...(() => {
      const couts = PARTICIPATION_VERSEMENT_MODES.map((m) => ({
        mode: m,
        cout: coutParticipationPourDirigeant(inputs, participationAnnual, tauxIRUtilise, m),
      }));
      const meilleur = couts.reduce((a, b) => (b.cout < a.cout - 1e-9 ? b : a));
      return {
        modeVersementOptimal: meilleur.mode,
        economieModeVersementOptimal: Math.max(0, coutParticipationDirigeant - meilleur.cout),
      };
    })(),
    impotSurParticipation,
    participationNetteSociete,
    augmentationBruteParticipation,
    coutNetAugmentationParticipation,
    // Participation mensuelle qui ramène exactement l'AEN à 0. En deçà, chaque euro versé économise
    // cotisations + IR sur l'AEN (soit bien plus que l'impôt qu'il génère côté société) ; au-delà, il
    // n'économise plus rien mais reste taxable chez la société — et coûte en plus la TVA collectée si
    // l'option TVA est activée. C'est donc un véritable optimum, pas un simple plafond.
    participationOptimaleMensuelle: aenNetBeforeParticipation / 12,
    companyCashBaseAnnual,
    quotePartProfessionnelleDeductible,
    quotePartPrivéeNonDeductible,
    economieImpotQuotePartPro,
    coutNetSociete,
    globalCostSociete,
  };
}

/** Résultat complet côté "achat personnel + IK" pour un mode de financement et un % d'usage privé donnés. */
function computePersonnelForMode(
  inputs: SimulationInputs,
  mode: FinancingMode,
  privateUsePercent: number,
  financingResults: FinancingResult[],
  tauxIRUtilise: number,
) {
  const ratio = Math.min(Math.max(privateUsePercent, 0), 100) / 100;
  const privateKmAnnual = inputs.totalKmAnnual * ratio;
  const proKmAnnual = inputs.totalKmAnnual - privateKmAnnual;
  // Majoration légale de 20% du barème IK pour les véhicules 100% électriques, appliquée automatiquement.
  const effectiveIkRatePerKm = inputs.ikRatePerKm * (inputs.isElectric ? 1 + IK_MAJORATION_ELECTRIQUE : 1);
  const ikReimbursement = proKmAnnual * effectiveIkRatePerKm;

  const personalFinancingAnnual = getFinancingAnnual(financingResults, mode);
  // Valeur résiduelle annualisée (véhicule possédé en fin de période) — cf. getResidualValueAnnualized :
  // le dirigeant reste propriétaire du véhicule, sa revente future doit venir en déduction du coût.
  // Nommée différemment de son équivalent côté société (cf. computeSocieteForMode) pour éviter toute
  // collision lors de l'aplatissement final de `{ ...societe, ...personnel }` dans computeSimulation.
  const valeurResiduelleAnnualiseePersonnel = getResidualValueAnnualized(inputs, mode);
  // Même neutralisation qu'en scénario société : en LLD « tout compris », assurance et entretien
  // sont déjà payés dans le loyer, quel que soit celui qui souscrit le contrat.
  const chargesPersonnel = chargesHorsFinancement(inputs, mode);
  // Même lissage que côté société : la levée d'option en LOA est un versement unique, réparti sur la
  // durée du contrat pour qu'il apparaisse dans le coût annuel/mensuel comparé.
  const optionAchatAnnualiseePersonnel = getOptionAchatAnnualisee(inputs, mode);
  const grossCost = Math.max(
    0,
    personalFinancingAnnual +
      optionAchatAnnualiseePersonnel +
      chargesPersonnel.annualInsurance +
      chargesPersonnel.annualMaintenance -
      valeurResiduelleAnnualiseePersonnel,
  );
  const coutScenarioPersonnel = Math.max(0, grossCost - ikReimbursement);

  // L'IK versée par la société est une charge déductible : elle génère une économie d'impôt côté société.
  const economieImpotIK = computeEconomieImpot(inputs, ikReimbursement, tauxIRUtilise);
  const globalCostPersonnel = Math.max(0, grossCost - economieImpotIK);

  return {
    privateKmAnnual,
    proKmAnnual,
    effectiveIkRatePerKm,
    ikReimbursement,
    valeurResiduelleAnnualiseePersonnel,
    personalFinancingAnnual,
    coutScenarioPersonnel,
    economieImpotIK,
    globalCostPersonnel,
  };
}

/**
 * Réduit le prix effectivement payé (comptant/crédit uniquement — cf. note de SimulationInputs) d'un
 * montant d'aide donné : aussi bien la base d'amortissement AEN/valeur résiduelle (`vehiclePrice`)
 * que le montant réellement financé (`financing.comptant/credit.prixTTC`). Les offres LOA/LLD
 * (loyers constructeur publiés) ne sont volontairement pas modifiées : les aides s'appliquent en
 * pratique à une acquisition comptant/crédit, pas à un contrat de location déjà négocié.
 */
function applyPrixNetAchat(inputs: SimulationInputs, remise: number): SimulationInputs {
  if (remise <= 0) return inputs;
  return {
    ...inputs,
    vehiclePrice: Math.max(0, inputs.vehiclePrice - remise),
    financing: {
      ...inputs.financing,
      comptant: { ...inputs.financing.comptant, prixTTC: Math.max(0, inputs.financing.comptant.prixTTC - remise) },
      credit: { ...inputs.financing.credit, prixTTC: Math.max(0, inputs.financing.credit.prixTTC - remise) },
    },
  };
}

/** Recherche du seuil de % d'usage privé où les deux scénarios sélectionnés s'équivalent (coût global), par dichotomie. */
function findBreakevenPercent(
  inputsSociete: SimulationInputs,
  inputsPersonnel: SimulationInputs,
  financingResultsSociete: FinancingResult[],
  financingResultsPersonnel: FinancingResult[],
  tauxIRUtilise: number,
): number | null {
  const diffAt = (p: number) =>
    computeSocieteForMode(inputsSociete, inputsSociete.financingMode, p, financingResultsSociete, tauxIRUtilise)
      .globalCostSociete -
    computePersonnelForMode(inputsPersonnel, inputsPersonnel.personalFinancingMode, p, financingResultsPersonnel, tauxIRUtilise)
      .globalCostPersonnel;

  const d0 = diffAt(0);
  const d100 = diffAt(100);

  if ((d0 <= 0 && d100 <= 0) || (d0 >= 0 && d100 >= 0)) {
    return null;
  }

  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const dMid = diffAt(mid);
    if ((dMid >= 0) === (d0 >= 0)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

const FINANCING_LABELS: Record<FinancingMode, string> = {
  comptant: "Comptant",
  credit: "Crédit",
  loa: "LOA",
  lld: "LLD",
};

export function computeSimulation(inputs: SimulationInputs): SimulationResults {
  // Aides à l'achat, distinctes selon l'acheteur (cf. notes de SimulationInputs/applyPrixNetAchat) :
  //  - Bonus de reprise constructeur : réduit le prix des deux côtés si applicable à un achat
  //    société (inputs.bonusRepriseApplicableSociete), sinon seulement côté personnel.
  //  - Prime CEE "Coup de pouce véhicules particuliers électriques" : réservée aux personnes
  //    physiques par la réglementation — ne réduit JAMAIS le prix côté société.
  const bonusReprise = inputs.bonusRepriseActif ? Math.max(0, inputs.bonusRepriseMontant) : 0;
  const remiseSociete = inputs.bonusRepriseApplicableSociete ? bonusReprise : 0;
  const remisePersonnel = bonusReprise + Math.max(0, inputs.ceeSelectedAmount);

  const inputsSociete = applyPrixNetAchat(inputs, remiseSociete);
  const inputsPersonnel = applyPrixNetAchat(inputs, remisePersonnel);
  const financingResultsSociete = compareFinancingModes(inputsSociete.financing);
  const financingResultsPersonnel = compareFinancingModes(inputsPersonnel.financing);
  // Régime IR (société translucide) : le bénéfice de la société est directement imposé entre les
  // mains du dirigeant (BIC/BNC) — il doit donc être intégré au revenu imposable du foyer pour
  // déterminer le TMI réel, y compris celui appliqué à l'AEN elle-même.
  const personalTaxProfileForCalc =
    inputs.impositionSociete === "IR"
      ? {
          ...inputs.personalTaxProfile,
          autresRevenusImposablesFoyer:
            inputs.personalTaxProfile.autresRevenusImposablesFoyer + inputs.beneficeAvantChargePrevisionnel,
        }
      : inputs.personalTaxProfile;
  const resolvedTax = resolvePersonalTaxProfile(personalTaxProfileForCalc);
  const tauxIRUtilise = resolvedTax.tauxUtilise;

  const societe = computeSocieteForMode(
    inputsSociete,
    inputsSociete.financingMode,
    inputsSociete.privateUsePercent,
    financingResultsSociete,
    tauxIRUtilise,
  );
  const personnel = computePersonnelForMode(
    inputsPersonnel,
    inputsPersonnel.personalFinancingMode,
    inputsPersonnel.privateUsePercent,
    financingResultsPersonnel,
    tauxIRUtilise,
  );

  // Toutes les combinaisons possibles, pour trouver l'option la moins coûteuse globalement — sans opposer
  // par principe société et personnel : on compare le coût total consolidé de chaque option entre elles.
  const allOptions: GlobalOption[] = ALL_FINANCING_MODES.flatMap((mode) => {
    const s = computeSocieteForMode(inputsSociete, mode, inputs.privateUsePercent, financingResultsSociete, tauxIRUtilise);
    const p = computePersonnelForMode(inputsPersonnel, mode, inputs.privateUsePercent, financingResultsPersonnel, tauxIRUtilise);
    // Coût de l'option d'achat LOA, si levée : un versement UNIQUE en fin de contrat (achat de
    // capital), volontairement exclu du coût annuel récurrent ci-dessus (cf. computeLoa) — affiché
    // séparément pour rester visible sans gonfler artificiellement le coût mensuel/annuel affiché.
    // Le prix de la LOA n'étant pas affecté par les aides (cf. applyPrixNetAchat), société et
    // personnel partagent la même offre LOA — le détail est donc identique des deux côtés.
    // LLD « tout compris » : assurance et entretien sont déjà dans le loyer, donc neutralisés dans
    // le calcul (cf. chargesHorsFinancement) — le détail affiché doit le refléter plutôt que de
    // montrer des montants qui ne sont pas comptés.
    const chargesIncluses = mode === "lld" && inputs.financing.lld.toutComprisEntretienAssurance;
    const optionAchatUnique =
      mode === "loa" ? (financingResultsSociete.find((f) => f.mode === "loa")?.detail.optionAchatPayee ?? 0) : 0;
    const dureeAnneesLoa = getDureeMoisForMode(inputs, "loa") / 12;
    const optionAchatDetail: { label: string; value: number }[] =
      optionAchatUnique > 0
        ? [
            {
              label: `Levée de l'option d'achat LOA, lissée sur ${dureeAnneesLoa.toFixed(1)} ans (versement unique de ${Math.round(optionAchatUnique)} € en fin de contrat)`,
              value: dureeAnneesLoa > 0 ? optionAchatUnique / dureeAnneesLoa : 0,
            },
          ]
        : [];

    // Valeur résiduelle : uniquement si le véhicule est effectivement possédé en fin de période
    // (comptant, crédit, ou LOA avec option d'achat levée). En LLD, ou en LOA sans option levée,
    // le véhicule est restitué : aucune valeur résiduelle (comme un loyer de logement).
    // devientProprietaire ne dépend que de la structure du montage (mode + option d'achat), pas du
    // prix : identique société/personnel, peu importe le côté d'où on le lit.
    const financingResult = financingResultsSociete.find((f) => f.mode === mode);
    const devientProprietaire = financingResult?.devientProprietaire ?? false;
    const dureeAnneesPourMode = getDureeMoisForMode(inputs, mode) / 12;
    // Valeur résiduelle "brute" (fin de période), affichée à titre informatif pour toute option
    // possédée (comptant, crédit, LOA avec option levée). Pour comptant/crédit uniquement, sa
    // contrepartie ANNUALISÉE est en outre déjà déduite du décaissement ci-dessus (cf.
    // getResidualValueAnnualized) — pour la LOA elle reste purement informative, cf. le
    // commentaire sur loyerAnnuelMoyen dans financing.ts. Calculée séparément société/personnel :
    // les aides à l'achat (cf. applyPrixNetAchat) peuvent réduire le prix différemment des deux
    // côtés pour comptant/crédit (jamais pour la LOA, dont le prix n'est pas affecté).
    function estimerValeurResiduelle(inputsCote: SimulationInputs): number {
      // getResidualValue couvre désormais les trois cas de possession (comptant, crédit, LOA option
      // levée) et retient pour la LOA le prix de référence du contrat plutôt que le prix net d'aides.
      return getResidualValue(inputsCote, mode);
    }
    function buildValeurResiduelleDetail(valeur: number): { label: string; value: number }[] {
      return devientProprietaire
        ? [
            {
              label: `Valeur résiduelle estimée du véhicule (possédé, ${dureeAnneesPourMode.toFixed(1)} ans, décote ${(inputs.tauxDeprecationAnnuel * 100).toFixed(0)}%/an)`,
              value: valeur,
            },
          ]
        : [{ label: "Valeur résiduelle en fin de contrat (véhicule restitué, non possédé)", value: 0 }];
    }
    const valeurResiduelleEstimeeSociete = estimerValeurResiduelle(inputsSociete);
    const valeurResiduelleEstimeePersonnel = estimerValeurResiduelle(inputsPersonnel);
    const valeurResiduelleDetailSociete = buildValeurResiduelleDetail(valeurResiduelleEstimeeSociete);
    const valeurResiduelleDetailPersonnel = buildValeurResiduelleDetail(valeurResiduelleEstimeePersonnel);

    // Alternative "mensualité compensée par une augmentation de salaire" (optionnelle) : la
    // société verse, en plus des IK, une augmentation de salaire brute annuelle égale à la
    // mensualité de financement — charge déductible comme toute rémunération, donc chargée des
    // cotisations sociales (au même taux global que celui déjà utilisé pour l'AEN dans ce
    // simulateur, cf. inputs.tnsContributionRate) puis nette de l'économie d'impôt société
    // correspondante. Le net réellement perçu par le dirigeant sur cette augmentation (après ses
    // propres cotisations/IR) n'est PAS déduit de son coût personnel ci-dessous : ce montage
    // s'ajoute au calcul existant sans le modifier, par simplicité et pour rester lisible.
    const augmentationSalaireBrute = inputs.compenserMensualiteParAugmentationSalaire ? p.personalFinancingAnnual : 0;
    const chargesSurAugmentation = augmentationSalaireBrute * inputs.tnsContributionRate;
    const coutBrutAugmentation = augmentationSalaireBrute + chargesSurAugmentation;
    const economieImpotAugmentation = computeEconomieImpot(inputs, coutBrutAugmentation, tauxIRUtilise);
    const coutNetSocieteAugmentation = coutBrutAugmentation - economieImpotAugmentation;

    const remiseSocieteDetail: { label: string; value: number }[] =
      (mode === "comptant" || mode === "credit") && remiseSociete > 0
        ? [{ label: "Aides à l'achat déduites du prix (bonus de reprise)", value: remiseSociete }]
        : [];
    const remisePersonnelDetail: { label: string; value: number }[] =
      (mode === "comptant" || mode === "credit") && remisePersonnel > 0
        ? [
            {
              label: "Aides à l'achat déduites du prix (prime CEE + bonus de reprise)",
              value: remisePersonnel,
            },
          ]
        : [];

    return [
      {
        owner: "societe" as const,
        mode,
        label: `Société — ${FINANCING_LABELS[mode]}`,
        globalCostAnnual: s.globalCostSociete,
        partSociete: s.coutNetSociete,
        partDirigeant: s.coutTotalGerantSociete,
        devientProprietaire,
        valeurResiduelleEstimee: valeurResiduelleEstimeeSociete,
        detail: [
          ...remiseSocieteDetail,
          { label: "AEN brut", value: s.aenBrut },
          { label: "Abattement électrique", value: s.abattement },
          { label: "AEN net", value: s.aenNet },
          { label: "Cotisations sociales dirigeant", value: s.cotisationsTNS },
          { label: "IR dirigeant sur l'AEN", value: s.irEstimee },
          { label: `Financement du véhicule (${FINANCING_LABELS[mode]}, loyers/mensualités uniquement)`, value: s.financingAnnual },
          ...optionAchatDetail,
          {
            label: chargesIncluses ? "Assurance annuelle (incluse dans le loyer LLD)" : "Assurance annuelle",
            value: chargesIncluses ? 0 : inputs.annualInsurance,
          },
          {
            label: chargesIncluses ? "Entretien annuel (inclus dans le loyer LLD)" : "Entretien annuel",
            value: chargesIncluses ? 0 : inputs.annualMaintenance,
          },
          { label: "Taxes annuelles CO2 + polluants (ex-TVS)", value: s.annualVehicleTax },
          ...(s.valeurResiduelleAnnualisee > 0
            ? [{ label: "− Valeur résiduelle annualisée du véhicule (revente lissée sur la durée de détention)", value: s.valeurResiduelleAnnualisee }]
            : []),
          ...(s.tvaEffectivementDeductible
            ? [
                {
                  label:
                    mode === "comptant" || mode === "credit"
                      ? "− TVA déductible récupérée (amortissement annuel du prix + entretien)"
                      : `− TVA déductible récupérée (${FINANCING_LABELS[mode]} : loyers + entretien)`,
                  value: s.tvaDeductibleRecurrente,
                },
                ...(s.tvaOptionAchatAnnualisee > 0
                  ? [
                      {
                        label: "− TVA déductible récupérée sur la levée d'option d'achat, lissée sur la durée",
                        value: s.tvaOptionAchatAnnualisee,
                      },
                    ]
                  : []),
              ]
            : []),
          { label: "= Décaissement réel société (total annuel)", value: s.companyCashBaseAnnual },
          { label: "Réintégration fiscale CO2 (plafond amortissement)", value: s.reintegrationFiscaleCO2 },
          { label: "Quote-part professionnelle déductible", value: s.quotePartProfessionnelleDeductible },
          { label: "Économie d'impôt société", value: s.economieImpotQuotePartPro },
          ...(s.participationAnnual > 0
            ? [
                { label: "− Participation encaissée du dirigeant", value: s.participationAnnual },
                ...(s.tvaEffectivementDeductible
                  ? [{ label: "+ TVA collectée sur cette participation (reversée au Trésor)", value: s.tvaCollecteeSurParticipation }]
                  : []),
                { label: "+ Impôt société sur cette participation (produit imposable, base HT)", value: s.impotSurParticipation },
                ...(s.augmentationBruteParticipation > 0
                  ? [
                      {
                        label: "+ Augmentation de rémunération compensant la participation (coût chargé)",
                        value: s.augmentationBruteParticipation,
                      },
                      {
                        label: "  ↳ après économie d'impôt société",
                        value: s.coutNetAugmentationParticipation,
                      },
                    ]
                  : []),
              ]
            : []),
          { label: "Coût net société", value: s.coutNetSociete },
          { label: "Coût cash dirigeant", value: s.coutTotalGerantSociete },
          ...(s.participationAnnual > 0
            ? [
                {
                  label: `dont participation (${PARTICIPATION_VERSEMENT_LABELS[inputs.modeVersementParticipation]}), coût réel pour le dirigeant`,
                  value: s.coutParticipationDirigeant,
                },
                ...(inputs.modeVersementParticipation === "retenue_brute"
                  ? [
                      {
                        label: "  ↳ rémunération brute abandonnée (avant cotisations et IR)",
                        value: s.participationAnnual,
                      },
                    ]
                  : []),
              ]
            : []),
          ...valeurResiduelleDetailSociete,
        ],
      },
      {
        owner: "personnel" as const,
        mode,
        label: `Personnel + IK${inputs.compenserMensualiteParAugmentationSalaire ? " + augmentation salaire" : ""} — ${FINANCING_LABELS[mode]}`,
        globalCostAnnual: p.globalCostPersonnel + coutNetSocieteAugmentation,
        partSociete: p.ikReimbursement - p.economieImpotIK + coutNetSocieteAugmentation,
        partDirigeant: p.coutScenarioPersonnel,
        devientProprietaire,
        valeurResiduelleEstimee: valeurResiduelleEstimeePersonnel,
        detail: [
          ...remisePersonnelDetail,
          { label: "Km professionnels/an", value: p.proKmAnnual },
          { label: "Km privés/an", value: p.privateKmAnnual },
          { label: "Barème IK effectif (€/km)", value: p.effectiveIkRatePerKm },
          { label: "Remboursement IK perçu par le dirigeant", value: p.ikReimbursement },
          {
            label: `Financement du véhicule (${FINANCING_LABELS[mode]}, loyers/mensualités uniquement, dirigeant)`,
            value: p.personalFinancingAnnual,
          },
          ...optionAchatDetail,
          {
            label: chargesIncluses ? "Assurance annuelle (incluse dans le loyer LLD)" : "Assurance annuelle (dirigeant)",
            value: chargesIncluses ? 0 : inputs.annualInsurance,
          },
          {
            label: chargesIncluses ? "Entretien annuel (inclus dans le loyer LLD)" : "Entretien annuel (dirigeant)",
            value: chargesIncluses ? 0 : inputs.annualMaintenance,
          },
          ...(p.valeurResiduelleAnnualiseePersonnel > 0
            ? [{ label: "− Valeur résiduelle annualisée du véhicule (revente lissée sur la durée de détention)", value: p.valeurResiduelleAnnualiseePersonnel }]
            : []),
          ...valeurResiduelleDetailPersonnel,
          {
            label: "= Coût brut avant IK (dirigeant)",
            value: Math.max(
              0,
              p.personalFinancingAnnual +
                (chargesIncluses ? 0 : inputs.annualInsurance + inputs.annualMaintenance) -
                p.valeurResiduelleAnnualiseePersonnel,
            ),
          },
          { label: "Coût net dirigeant (après IK)", value: p.coutScenarioPersonnel },
          { label: "Économie d'impôt société sur l'IK versée", value: p.economieImpotIK },
          { label: "Coût net société sur l'IK", value: p.ikReimbursement - p.economieImpotIK },
          ...(inputs.compenserMensualiteParAugmentationSalaire
            ? [
                { label: "Augmentation de salaire brute (= mensualité de financement)", value: augmentationSalaireBrute },
                { label: "Charges sociales sur cette augmentation", value: chargesSurAugmentation },
                { label: "= Coût brut société de l'augmentation", value: coutBrutAugmentation },
                { label: "− Économie d'impôt société sur l'augmentation", value: -economieImpotAugmentation },
                { label: "= Coût net société de l'augmentation (en plus du coût des IK)", value: coutNetSocieteAugmentation },
              ]
            : []),
        ],
      },
    ];
  }).sort((a, b) => a.globalCostAnnual - b.globalCostAnnual);

  const bestOption = allOptions[0];

  const difference = societe.globalCostSociete - personnel.globalCostPersonnel;
  const recommandation: SimulationResults["recommandation"] =
    Math.abs(difference) < 1 ? "equivalent" : difference > 0 ? "personnel" : "societe";

  const seuilPrivateUsePercent = findBreakevenPercent(
    inputsSociete,
    inputsPersonnel,
    financingResultsSociete,
    financingResultsPersonnel,
    tauxIRUtilise,
  );

  // Projection : le taux d'amortissement passe de 20% à 10%/an après 5 ans de détention (véhicule
  // acheté). Si le véhicule est neuf (≤5 ans) au démarrage de la simulation, ce basculement est
  // anticipé à partir de l'année 6 de la projection ; s'il est déjà >5 ans, le taux 10% s'applique
  // dès l'année 1. Cela n'affecte que les modes "achetés" (comptant/crédit) : en LOA/LLD, la base
  // AEN dépend du loyer, indépendant de l'âge du véhicule.
  const anneeTransitionAmortissement = inputs.vehicleOverFiveYears ? null : 6;
  const societeApresTransition = inputs.vehicleOverFiveYears
    ? societe
    : computeSocieteForMode(
        { ...inputsSociete, vehicleOverFiveYears: true },
        inputsSociete.financingMode,
        inputsSociete.privateUsePercent,
        financingResultsSociete,
        tauxIRUtilise,
      );

  const projection: SimulationResults["projection"] = [];
  let cumulSociete = 0;
  let cumulPersonnel = 0;
  for (let year = 1; year <= inputs.projectionYears; year++) {
    const societeYear = anneeTransitionAmortissement !== null && year >= anneeTransitionAmortissement ? societeApresTransition : societe;
    cumulSociete += societeYear.globalCostSociete;
    cumulPersonnel += personnel.globalCostPersonnel;
    projection.push({ year, cumulSociete, cumulPersonnel });
  }

  return {
    ...societe,
    tmiCalcule: resolvedTax.tmi,
    tauxIRUtilise,
    revenuImposableFoyer: resolvedTax.revenuImposable,
    partsFiscales: resolvedTax.parts,
    quotientFamilial: resolvedTax.quotient,
    impotFoyerApresDecote: resolvedTax.impotApresDecote,
    dansZoneDecote: resolvedTax.dansZoneDecote,
    tauxMarginalEffectif: resolvedTax.tauxMarginalEffectif,
    ...personnel,
    allOptions,
    bestOption,
    difference,
    recommandation,
    seuilPrivateUsePercent,
    anneeTransitionAmortissement,
    projection,
    remiseSociete,
    remisePersonnel,
    prixNetSociete: inputsSociete.vehiclePrice,
    prixNetPersonnel: inputsPersonnel.vehiclePrice,
  };
}
