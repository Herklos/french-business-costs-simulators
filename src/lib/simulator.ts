// Moteur de calcul — Avantage en nature véhicule de société pour dirigeant d'entreprise.
// Règles France 2026 — méthode réelle obligatoire pour les TNS (le barème forfaitaire
// URSSAF ne s'applique pas aux gérants majoritaires TNS). L'architecture (pays, forme
// juridique, régime d'imposition) est prévue pour être étendue à d'autres juridictions.

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
import { type FinancingInputs, type FinancingMode, createDefaultFinancingInputs } from "./financing";

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
  vehicleOverFiveYears: boolean; // > 5 ans => amortissement 10%, sinon 20%
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

  // Situation personnelle du dirigeant (pour affiner le TMI utilisé sur l'AEN)
  personalTaxProfile: PersonalTaxProfile;

  // Optimisations
  monthlyParticipation: number; // participation financière mensuelle du gérant
  ikRatePerKm: number; // barème IK €/km utilisé si achat perso + IK

  // Comparaison
  personalLoanMonthly: number; // défaut 400 €/mois

  // Financement
  financingMode: FinancingMode;
  financing: FinancingInputs;

  // Projection
  projectionYears: number; // défaut 5
}

export const DEFAULT_ABATTEMENT_CAP = 2026.3; // plafond 2026 abattement véhicule électrique méthode réelle (50%)
export const DEFAULT_TNS_RATE = 0.43;
export const DEFAULT_CORPORATE_TAX_RATE = 0.25;
export const DEFAULT_PERSONAL_LOAN_MONTHLY = 400;
export const DEFAULT_IK_RATE = 0.5;

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

    personalLoanMonthly: DEFAULT_PERSONAL_LOAN_MONTHLY,

    financingMode: "credit",
    financing: createDefaultFinancingInputs(vehiclePrice),

    projectionYears: 5,
  };
}

export interface SimulationResults {
  dirigeantStatus: DirigeantStatus;

  amortRate: number;
  amortAnnual: number;
  baseAnnualCosts: number; // amort + assurance + entretien
  aenBrut: number;
  abattement: number;
  aenNetBeforeParticipation: number;
  participationAnnual: number;
  aenNet: number; // après abattement ET participation financière

  // Fiscalité personnelle du dirigeant
  tmiCalcule: number; // TMI calculé à partir de la situation personnelle
  tauxIRUtilise: number; // taux effectivement retenu (manuel ou calculé)
  revenuImposableFoyer: number;
  partsFiscales: number;

  cotisationsTNS: number;
  irEstimee: number;
  coutTotalGerantSociete: number; // cash réellement supporté par le gérant (cotisations + IR) dans le scénario société

  // Société
  quotePartProfessionnelleDeductible: number;
  quotePartPrivéeNonDeductible: number;
  economieImpotQuotePartPro: number; // économie d'IS (régime IS) ou d'IR foyer (régime IR, société translucide)
  coutNetSociete: number;

  // Scénario "achat personnel + IK"
  proKmAnnual: number;
  privateKmAnnual: number;
  ikReimbursement: number;
  personalLoanAnnual: number;
  coutScenarioPersonnel: number;

  // Comparaison
  difference: number; // coutTotalGerantSociete - coutScenarioPersonnel (positif = société plus cher pour le gérant)
  recommandation: "societe" | "personnel" | "equivalent";
  seuilPrivateUsePercent: number | null; // % usage privé à partir duquel le perso devient plus intéressant

  // Projection
  projection: { year: number; cumulSociete: number; cumulPersonnel: number }[];
}

function resolveEffectiveTauxIR(inputs: SimulationInputs) {
  const resolved = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  return resolved;
}

/** Calcule l'AEN et le coût total pour un % d'usage privé donné, toutes choses égales par ailleurs. */
function computeCoutSocieteForPercent(inputs: SimulationInputs, privateUsePercent: number) {
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);

  const amortRate = inputs.vehicleOverFiveYears ? 0.1 : 0.2;
  const amortAnnual = inputs.vehiclePrice * amortRate;
  const baseAnnualCosts = amortAnnual + inputs.annualInsurance + inputs.annualMaintenance;

  const ratio = Math.min(Math.max(privateUsePercent, 0), 100) / 100;
  const aenBrutFromBase = baseAnnualCosts * ratio;
  const fuelPrivate = inputs.isElectric ? 0 : inputs.annualFuelPrivateCost;
  const aenBrut = aenBrutFromBase + fuelPrivate;

  let abattement = 0;
  if (inputs.isElectric && inputs.isEcoScoreEligible) {
    abattement = Math.min(0.5 * aenBrut, DEFAULT_ABATTEMENT_CAP);
  }
  const aenNetBeforeParticipation = Math.max(0, aenBrut - abattement);

  const participationAnnual = inputs.monthlyParticipation * 12;
  const aenNet = Math.max(0, aenNetBeforeParticipation - participationAnnual);

  const resolvedTax = resolveEffectiveTauxIR(inputs);

  const cotisationsTNS = aenNet * inputs.tnsContributionRate;
  const irEstimee = aenNet * resolvedTax.tauxUtilise;
  const coutTotalGerantSociete = cotisationsTNS + irEstimee;

  return {
    dirigeantStatus,
    amortRate,
    amortAnnual,
    baseAnnualCosts,
    aenBrut,
    abattement,
    aenNetBeforeParticipation,
    participationAnnual,
    aenNet,
    tmiCalcule: resolvedTax.tmi,
    tauxIRUtilise: resolvedTax.tauxUtilise,
    revenuImposableFoyer: resolvedTax.revenuImposable,
    partsFiscales: resolvedTax.parts,
    cotisationsTNS,
    irEstimee,
    coutTotalGerantSociete,
  };
}

function computeCoutPersonnelForPercent(inputs: SimulationInputs, privateUsePercent: number) {
  const ratio = Math.min(Math.max(privateUsePercent, 0), 100) / 100;
  const privateKmAnnual = inputs.totalKmAnnual * ratio;
  const proKmAnnual = inputs.totalKmAnnual - privateKmAnnual;
  const ikReimbursement = proKmAnnual * inputs.ikRatePerKm;
  const personalLoanAnnual = inputs.personalLoanMonthly * 12;
  const coutScenarioPersonnel = Math.max(
    0,
    personalLoanAnnual + inputs.annualInsurance + inputs.annualMaintenance - ikReimbursement,
  );
  return { privateKmAnnual, proKmAnnual, ikReimbursement, personalLoanAnnual, coutScenarioPersonnel };
}

/** Recherche du seuil de % d'usage privé où société == personnel, par dichotomie (fonctions monotones). */
function findBreakevenPercent(inputs: SimulationInputs): number | null {
  const diffAt = (p: number) =>
    computeCoutSocieteForPercent(inputs, p).coutTotalGerantSociete -
    computeCoutPersonnelForPercent(inputs, p).coutScenarioPersonnel;

  const d0 = diffAt(0);
  const d100 = diffAt(100);

  // Pas de changement de signe => pas de seuil dans [0,100]
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

export function computeSimulation(inputs: SimulationInputs): SimulationResults {
  const societe = computeCoutSocieteForPercent(inputs, inputs.privateUsePercent);
  const personnel = computeCoutPersonnelForPercent(inputs, inputs.privateUsePercent);

  const quotePartPrivéeNonDeductible = societe.baseAnnualCosts * (inputs.privateUsePercent / 100);
  const quotePartProfessionnelleDeductible = societe.baseAnnualCosts - quotePartPrivéeNonDeductible;
  // Régime IS : l'économie provient de l'IS sur la quote-part déductible.
  // Régime IR (société translucide) : le résultat remonte directement au foyer, imposé au TMI du dirigeant.
  const tauxEconomie = inputs.impositionSociete === "IS" ? inputs.corporateTaxRate : societe.tauxIRUtilise;
  const economieImpotQuotePartPro = quotePartProfessionnelleDeductible * tauxEconomie;
  const coutNetSociete = societe.baseAnnualCosts - economieImpotQuotePartPro;

  const difference = societe.coutTotalGerantSociete - personnel.coutScenarioPersonnel;
  const recommandation: SimulationResults["recommandation"] =
    Math.abs(difference) < 1 ? "equivalent" : difference > 0 ? "personnel" : "societe";

  const seuilPrivateUsePercent = findBreakevenPercent(inputs);

  const projection: SimulationResults["projection"] = [];
  let cumulSociete = 0;
  let cumulPersonnel = 0;
  for (let year = 1; year <= inputs.projectionYears; year++) {
    cumulSociete += societe.coutTotalGerantSociete;
    cumulPersonnel += personnel.coutScenarioPersonnel;
    projection.push({ year, cumulSociete, cumulPersonnel });
  }

  return {
    ...societe,
    quotePartProfessionnelleDeductible,
    quotePartPrivéeNonDeductible,
    economieImpotQuotePartPro,
    coutNetSociete,
    ...personnel,
    difference,
    recommandation,
    seuilPrivateUsePercent,
    projection,
  };
}
