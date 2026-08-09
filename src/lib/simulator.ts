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
  ikRatePerKm: number; // barème IK €/km utilisé si achat perso + IK

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
    ikRatePerKm: DEFAULT_IK_RATE,

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

  let next: SimulationInputs = { ...inputs, vehicleModelId: modelId };
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
  valeurResiduelleAnnualisee: number; // valeur résiduelle du véhicule (comptant/crédit) lissée sur la durée, déduite du décaissement — 0 sinon
  companyCashBaseAnnual: number; // décaissement réel annuel de la société pour le véhicule (financement + assurance + entretien + taxes − valeur résiduelle annualisée)
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
function getResidualValue(inputs: SimulationInputs, mode: FinancingMode): number {
  if (mode !== "comptant" && mode !== "credit") return 0;
  const dureeAnnees = getDureeMoisForMode(inputs, mode) / 12;
  if (dureeAnnees <= 0) return 0;
  return estimateResidualValue(inputs.vehiclePrice, dureeAnnees, inputs.tauxDeprecationAnnuel);
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
  const isOwned = mode === "comptant" || mode === "credit";
  if (isOwned) {
    const amortRate = inputs.vehicleOverFiveYears ? 0.1 : 0.2;
    const amortAnnual = inputs.vehiclePrice * amortRate;
    return { amortRate, amortAnnual, aenBaseAnnualCosts: amortAnnual + inputs.annualInsurance + inputs.annualMaintenance };
  }
  const aenBaseAnnualCosts = (loyerAnnuelMoyen + inputs.annualInsurance + inputs.annualMaintenance) * 0.3;
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
  const coutTotalGerantSociete = cotisationsTNS + irEstimee;

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

  // Valeur résiduelle annualisée (comptant/crédit uniquement) : cf. getResidualValueAnnualized —
  // déduite du décaissement pour ne pas surestimer le coût réel d'un achat dont le véhicule garde
  // de la valeur à l'issue de la période, contrairement à un loyer (LOA/LLD) définitivement perdu.
  const valeurResiduelleAnnualisee = getResidualValueAnnualized(inputs, mode);

  // Décaissement réel de la société (indépendant du montage retenu pour l'AEN) : financement + assurance + entretien + taxes − valeur résiduelle annualisée (si véhicule possédé).
  const companyCashBaseAnnual =
    financingAnnual + inputs.annualInsurance + inputs.annualMaintenance + annualVehicleTax - valeurResiduelleAnnualisee;
  const quotePartPrivéeNonDeductible = companyCashBaseAnnual * ratio;
  const quotePartProfessionnelleBrute = companyCashBaseAnnual - quotePartPrivéeNonDeductible;
  const quotePartProfessionnelleDeductible = Math.max(0, quotePartProfessionnelleBrute - reintegrationFiscaleCO2);
  const economieImpotQuotePartPro = computeEconomieImpot(inputs, quotePartProfessionnelleDeductible, tauxIRUtilise);
  const coutNetSociete = companyCashBaseAnnual - economieImpotQuotePartPro;

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
  // Valeur résiduelle annualisée (comptant/crédit uniquement) — cf. getResidualValueAnnualized :
  // le dirigeant reste propriétaire du véhicule, sa revente future doit venir en déduction du coût.
  // Nommée différemment de son équivalent côté société (cf. computeSocieteForMode) pour éviter toute
  // collision lors de l'aplatissement final de `{ ...societe, ...personnel }` dans computeSimulation.
  const valeurResiduelleAnnualiseePersonnel = getResidualValueAnnualized(inputs, mode);
  const grossCost = Math.max(
    0,
    personalFinancingAnnual + inputs.annualInsurance + inputs.annualMaintenance - valeurResiduelleAnnualiseePersonnel,
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

/** Recherche du seuil de % d'usage privé où les deux scénarios sélectionnés s'équivalent (coût global), par dichotomie. */
function findBreakevenPercent(
  inputs: SimulationInputs,
  financingResults: FinancingResult[],
  tauxIRUtilise: number,
): number | null {
  const diffAt = (p: number) =>
    computeSocieteForMode(inputs, inputs.financingMode, p, financingResults, tauxIRUtilise).globalCostSociete -
    computePersonnelForMode(inputs, inputs.personalFinancingMode, p, financingResults, tauxIRUtilise)
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
  const financingResults = compareFinancingModes(inputs.financing);
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
    inputs,
    inputs.financingMode,
    inputs.privateUsePercent,
    financingResults,
    tauxIRUtilise,
  );
  const personnel = computePersonnelForMode(
    inputs,
    inputs.personalFinancingMode,
    inputs.privateUsePercent,
    financingResults,
    tauxIRUtilise,
  );

  // Toutes les combinaisons possibles, pour trouver l'option la moins coûteuse globalement — sans opposer
  // par principe société et personnel : on compare le coût total consolidé de chaque option entre elles.
  const allOptions: GlobalOption[] = ALL_FINANCING_MODES.flatMap((mode) => {
    const s = computeSocieteForMode(inputs, mode, inputs.privateUsePercent, financingResults, tauxIRUtilise);
    const p = computePersonnelForMode(inputs, mode, inputs.privateUsePercent, financingResults, tauxIRUtilise);
    // Coût de l'option d'achat LOA, si levée : un versement UNIQUE en fin de contrat (achat de
    // capital), volontairement exclu du coût annuel récurrent ci-dessus (cf. computeLoa) — affiché
    // séparément pour rester visible sans gonfler artificiellement le coût mensuel/annuel affiché.
    const optionAchatUnique = mode === "loa" ? (financingResults.find((f) => f.mode === "loa")?.detail.optionAchatPayee ?? 0) : 0;
    const optionAchatDetail: { label: string; value: number }[] =
      optionAchatUnique > 0
        ? [{ label: "Option d'achat LOA en fin de contrat (paiement unique, hors coût annuel ci-dessus)", value: optionAchatUnique }]
        : [];

    // Valeur résiduelle : uniquement si le véhicule est effectivement possédé en fin de période
    // (comptant, crédit, ou LOA avec option d'achat levée). En LLD, ou en LOA sans option levée,
    // le véhicule est restitué : aucune valeur résiduelle (comme un loyer de logement).
    const financingResult = financingResults.find((f) => f.mode === mode);
    const devientProprietaire = financingResult?.devientProprietaire ?? false;
    const dureeAnneesPourMode = getDureeMoisForMode(inputs, mode) / 12;
    // Valeur résiduelle "brute" (fin de période), affichée à titre informatif pour toute option
    // possédée (comptant, crédit, LOA avec option levée). Pour comptant/crédit uniquement, sa
    // contrepartie ANNUALISÉE est en outre déjà déduite du décaissement ci-dessus (cf.
    // getResidualValueAnnualized) — pour la LOA elle reste purement informative, cf. le
    // commentaire sur loyerAnnuelMoyen dans financing.ts.
    const valeurResiduelleEstimee = devientProprietaire
      ? mode === "comptant" || mode === "credit"
        ? getResidualValue(inputs, mode)
        : estimateResidualValue(inputs.vehiclePrice, dureeAnneesPourMode, inputs.tauxDeprecationAnnuel)
      : 0;
    const valeurResiduelleDetail: { label: string; value: number }[] = devientProprietaire
      ? [
          {
            label: `Valeur résiduelle estimée du véhicule (possédé, ${dureeAnneesPourMode.toFixed(1)} ans, décote ${(inputs.tauxDeprecationAnnuel * 100).toFixed(0)}%/an)`,
            value: valeurResiduelleEstimee,
          },
        ]
      : [{ label: "Valeur résiduelle en fin de contrat (véhicule restitué, non possédé)", value: 0 }];

    return [
      {
        owner: "societe" as const,
        mode,
        label: `Société — ${FINANCING_LABELS[mode]}`,
        globalCostAnnual: s.globalCostSociete,
        partSociete: s.coutNetSociete,
        partDirigeant: s.coutTotalGerantSociete,
        devientProprietaire,
        valeurResiduelleEstimee,
        detail: [
          { label: "AEN brut", value: s.aenBrut },
          { label: "Abattement électrique", value: s.abattement },
          { label: "AEN net", value: s.aenNet },
          { label: "Cotisations sociales dirigeant", value: s.cotisationsTNS },
          { label: "IR dirigeant sur l'AEN", value: s.irEstimee },
          { label: `Financement du véhicule (${FINANCING_LABELS[mode]}, loyers/mensualités uniquement)`, value: s.financingAnnual },
          { label: "Assurance annuelle", value: inputs.annualInsurance },
          { label: "Entretien annuel", value: inputs.annualMaintenance },
          { label: "Taxes annuelles CO2 + polluants (ex-TVS)", value: s.annualVehicleTax },
          ...(s.valeurResiduelleAnnualisee > 0
            ? [{ label: "− Valeur résiduelle annualisée du véhicule (comptant/crédit, revente lissée sur la durée)", value: s.valeurResiduelleAnnualisee }]
            : []),
          { label: "= Décaissement réel société (total annuel)", value: s.companyCashBaseAnnual },
          ...optionAchatDetail,
          { label: "Réintégration fiscale CO2 (plafond amortissement)", value: s.reintegrationFiscaleCO2 },
          { label: "Quote-part professionnelle déductible", value: s.quotePartProfessionnelleDeductible },
          { label: "Économie d'impôt société", value: s.economieImpotQuotePartPro },
          { label: "Coût net société", value: s.coutNetSociete },
          { label: "Coût cash dirigeant", value: s.coutTotalGerantSociete },
          ...valeurResiduelleDetail,
        ],
      },
      {
        owner: "personnel" as const,
        mode,
        label: `Personnel + IK — ${FINANCING_LABELS[mode]}`,
        globalCostAnnual: p.globalCostPersonnel,
        partSociete: p.ikReimbursement - p.economieImpotIK,
        partDirigeant: p.coutScenarioPersonnel,
        devientProprietaire,
        valeurResiduelleEstimee,
        detail: [
          { label: "Km professionnels/an", value: p.proKmAnnual },
          { label: "Km privés/an", value: p.privateKmAnnual },
          { label: "Barème IK effectif (€/km)", value: p.effectiveIkRatePerKm },
          { label: "Remboursement IK perçu par le dirigeant", value: p.ikReimbursement },
          {
            label: `Financement du véhicule (${FINANCING_LABELS[mode]}, loyers/mensualités uniquement, dirigeant)`,
            value: p.personalFinancingAnnual,
          },
          { label: "Assurance annuelle (dirigeant)", value: inputs.annualInsurance },
          { label: "Entretien annuel (dirigeant)", value: inputs.annualMaintenance },
          ...(p.valeurResiduelleAnnualiseePersonnel > 0
            ? [{ label: "− Valeur résiduelle annualisée du véhicule (comptant/crédit, revente lissée sur la durée)", value: p.valeurResiduelleAnnualiseePersonnel }]
            : []),
          ...optionAchatDetail,
          ...valeurResiduelleDetail,
          {
            label: "= Coût brut avant IK (dirigeant)",
            value: Math.max(
              0,
              p.personalFinancingAnnual + inputs.annualInsurance + inputs.annualMaintenance - p.valeurResiduelleAnnualiseePersonnel,
            ),
          },
          { label: "Coût net dirigeant (après IK)", value: p.coutScenarioPersonnel },
          { label: "Économie d'impôt société sur l'IK versée", value: p.economieImpotIK },
          { label: "Coût net société sur l'IK", value: p.ikReimbursement - p.economieImpotIK },
        ],
      },
    ];
  }).sort((a, b) => a.globalCostAnnual - b.globalCostAnnual);

  const bestOption = allOptions[0];

  const difference = societe.globalCostSociete - personnel.globalCostPersonnel;
  const recommandation: SimulationResults["recommandation"] =
    Math.abs(difference) < 1 ? "equivalent" : difference > 0 ? "personnel" : "societe";

  const seuilPrivateUsePercent = findBreakevenPercent(inputs, financingResults, tauxIRUtilise);

  // Projection : le taux d'amortissement passe de 20% à 10%/an après 5 ans de détention (véhicule
  // acheté). Si le véhicule est neuf (≤5 ans) au démarrage de la simulation, ce basculement est
  // anticipé à partir de l'année 6 de la projection ; s'il est déjà >5 ans, le taux 10% s'applique
  // dès l'année 1. Cela n'affecte que les modes "achetés" (comptant/crédit) : en LOA/LLD, la base
  // AEN dépend du loyer, indépendant de l'âge du véhicule.
  const anneeTransitionAmortissement = inputs.vehicleOverFiveYears ? null : 6;
  const societeApresTransition = inputs.vehicleOverFiveYears
    ? societe
    : computeSocieteForMode(
        { ...inputs, vehicleOverFiveYears: true },
        inputs.financingMode,
        inputs.privateUsePercent,
        financingResults,
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
  };
}
