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
  vehiclePrice: number; // Prix d'achat TTC
  vehicleOverFiveYears: boolean; // > 5 ans => amortissement 10%, sinon 20% (véhicule acheté uniquement)
  isElectric: boolean; // 100% électrique => électricité exclue du calcul
  isEcoScoreEligible: boolean; // éco-score >= 60 (liste ADEME) => abattement 50% (électrique uniquement)

  // Usage
  privateUsePercent: number; // 0-100
  totalKmAnnual: number; // km totaux annuels (pour IK et information)

  // Charges annuelles réelles
  annualInsurance: number;
  annualMaintenance: number;
  annualFuelPrivateCost: number; // coût carburant usage privé (véhicules thermiques uniquement)

  // Taux
  tnsContributionRate: number; // 0-1, taux de charges sociales appliqué à l'AEN net
  corporateTaxRate: number; // 0-1, IS, défaut 0.25

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
export const ALL_FINANCING_MODES: FinancingMode[] = ["comptant", "credit", "loa", "lld"];

export function createDefaultInputs(): SimulationInputs {
  const country = DEFAULT_COUNTRY;
  const companyType = "EURL";
  const companyTypeConfig = getCompanyType(country, companyType);
  const vehiclePrice = 45000;

  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation",
    createdAt: new Date().toISOString(),

    country,
    companyType,
    gerantMajoritaire: true,
    impositionSociete: companyTypeConfig?.defaultImposition ?? "IR",

    vehiclePrice,
    vehicleOverFiveYears: false,
    isElectric: true,
    isEcoScoreEligible: true,

    privateUsePercent: 50,
    totalKmAnnual: 15000,

    annualInsurance: 900,
    annualMaintenance: 600,
    annualFuelPrivateCost: 0,

    tnsContributionRate: companyTypeConfig?.defaultCotisationRate ?? DEFAULT_TNS_RATE,
    corporateTaxRate: DEFAULT_CORPORATE_TAX_RATE,

    personalTaxProfile: createDefaultPersonalTaxProfile(),

    monthlyParticipation: 0,
    ikRatePerKm: DEFAULT_IK_RATE,

    financingMode: "credit",
    personalFinancingMode: "credit",
    financing: createDefaultFinancingInputs(vehiclePrice),

    projectionYears: 5,
  };
}

/** Coût global annualisé d'une combinaison {propriétaire, mode de financement} donnée. */
export interface GlobalOption {
  owner: "societe" | "personnel";
  mode: FinancingMode;
  label: string;
  globalCostAnnual: number;
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

  cotisationsTNS: number;
  irEstimee: number;
  coutTotalGerantSociete: number; // cash réellement supporté par le gérant (cotisations + IR) dans le scénario société

  // Société — mode de financement `financingMode`
  companyCashBaseAnnual: number; // décaissement réel annuel de la société pour le véhicule (financement + assurance + entretien)
  quotePartProfessionnelleDeductible: number;
  quotePartPrivéeNonDeductible: number;
  economieImpotQuotePartPro: number; // économie d'IS (régime IS) ou d'IR foyer (régime IR, société translucide)
  coutNetSociete: number; // coût net société après économie d'impôt
  globalCostSociete: number; // coutNetSociete + coutTotalGerantSociete : coût consolidé du scénario société

  // Scénario "achat personnel + IK" — mode de financement `personalFinancingMode`
  proKmAnnual: number;
  privateKmAnnual: number;
  ikReimbursement: number;
  personalFinancingAnnual: number;
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
  projection: { year: number; cumulSociete: number; cumulPersonnel: number }[];
}

function getFinancingAnnual(financingResults: FinancingResult[], mode: FinancingMode): number {
  const found = financingResults.find((f) => f.mode === mode);
  return found ? found.coutMensuelEquivalent * 12 : 0;
}

/** Base annuelle réelle retenue pour l'AEN : amortissement si le véhicule est acheté par la société,
 * 30% du coût de location si le véhicule est loué (LOA/LLD) — cf. BOI-RSA-BASE-30-50-30. */
function computeAenBase(inputs: SimulationInputs, mode: FinancingMode, financingAnnual: number) {
  const isOwned = mode === "comptant" || mode === "credit";
  if (isOwned) {
    const amortRate = inputs.vehicleOverFiveYears ? 0.1 : 0.2;
    const amortAnnual = inputs.vehiclePrice * amortRate;
    return { amortRate, amortAnnual, aenBaseAnnualCosts: amortAnnual + inputs.annualInsurance + inputs.annualMaintenance };
  }
  const aenBaseAnnualCosts = (financingAnnual + inputs.annualInsurance + inputs.annualMaintenance) * 0.3;
  return { amortRate: 0, amortAnnual: 0, aenBaseAnnualCosts };
}

function computeTauxEconomie(inputs: SimulationInputs, tauxIRUtilise: number): number {
  return inputs.impositionSociete === "IS" ? inputs.corporateTaxRate : tauxIRUtilise;
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
  const { amortRate, amortAnnual, aenBaseAnnualCosts } = computeAenBase(inputs, mode, financingAnnual);

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

  // Décaissement réel de la société (indépendant du montage retenu pour l'AEN) : financement + assurance + entretien.
  const companyCashBaseAnnual = financingAnnual + inputs.annualInsurance + inputs.annualMaintenance;
  const quotePartPrivéeNonDeductible = companyCashBaseAnnual * ratio;
  const quotePartProfessionnelleDeductible = companyCashBaseAnnual - quotePartPrivéeNonDeductible;
  const tauxEconomie = computeTauxEconomie(inputs, tauxIRUtilise);
  const economieImpotQuotePartPro = quotePartProfessionnelleDeductible * tauxEconomie;
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
  const ikReimbursement = proKmAnnual * inputs.ikRatePerKm;

  const personalFinancingAnnual = getFinancingAnnual(financingResults, mode);
  const grossCost = personalFinancingAnnual + inputs.annualInsurance + inputs.annualMaintenance;
  const coutScenarioPersonnel = Math.max(0, grossCost - ikReimbursement);

  // L'IK versée par la société est une charge déductible : elle génère une économie d'impôt côté société.
  const tauxEconomie = computeTauxEconomie(inputs, tauxIRUtilise);
  const economieImpotIK = ikReimbursement * tauxEconomie;
  const globalCostPersonnel = Math.max(0, grossCost - economieImpotIK);

  return {
    privateKmAnnual,
    proKmAnnual,
    ikReimbursement,
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
  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
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
  const allOptions: GlobalOption[] = ALL_FINANCING_MODES.flatMap((mode) => [
    {
      owner: "societe" as const,
      mode,
      label: `Société — ${FINANCING_LABELS[mode]}`,
      globalCostAnnual: computeSocieteForMode(inputs, mode, inputs.privateUsePercent, financingResults, tauxIRUtilise)
        .globalCostSociete,
    },
    {
      owner: "personnel" as const,
      mode,
      label: `Personnel + IK — ${FINANCING_LABELS[mode]}`,
      globalCostAnnual: computePersonnelForMode(
        inputs,
        mode,
        inputs.privateUsePercent,
        financingResults,
        tauxIRUtilise,
      ).globalCostPersonnel,
    },
  ]).sort((a, b) => a.globalCostAnnual - b.globalCostAnnual);

  const bestOption = allOptions[0];

  const difference = societe.globalCostSociete - personnel.globalCostPersonnel;
  const recommandation: SimulationResults["recommandation"] =
    Math.abs(difference) < 1 ? "equivalent" : difference > 0 ? "personnel" : "societe";

  const seuilPrivateUsePercent = findBreakevenPercent(inputs, financingResults, tauxIRUtilise);

  const projection: SimulationResults["projection"] = [];
  let cumulSociete = 0;
  let cumulPersonnel = 0;
  for (let year = 1; year <= inputs.projectionYears; year++) {
    cumulSociete += societe.globalCostSociete;
    cumulPersonnel += personnel.globalCostPersonnel;
    projection.push({ year, cumulSociete, cumulPersonnel });
  }

  return {
    ...societe,
    tmiCalcule: resolvedTax.tmi,
    tauxIRUtilise,
    revenuImposableFoyer: resolvedTax.revenuImposable,
    partsFiscales: resolvedTax.parts,
    ...personnel,
    allOptions,
    bestOption,
    difference,
    recommandation,
    seuilPrivateUsePercent,
    projection,
  };
}
