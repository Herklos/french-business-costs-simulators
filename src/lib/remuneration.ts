// Simulateur de rémunération du dirigeant — arbitrage salaire / dividendes / mixte.
//
// Principe : à COÛT TOTAL ÉGAL pour l'entreprise (l'« enveloppe » `budgetAnnuelDisponible`), on
// compare le net réellement perçu par le dirigeant selon que cette enveloppe est versée sous forme
// de rémunération (charge déductible, réduit d'autant le bénéfice imposable), de dividendes
// (l'enveloppe reste un bénéfice, soumis à l'IS, puis distribuée), ou d'un mixte des deux.
//
// Le statut du dirigeant (TNS ou assimilé salarié), déjà résolu par companyTypes.ts selon la forme
// juridique (EURL/SARL gérant majoritaire → TNS ; SASU/SAS, ou SARL gérant minoritaire → assimilé
// salarié), change radicalement l'arbitrage :
//  - Assimilé salarié (SASU/SAS) : charges patronales+salariales élevées sur le salaire (~55-75%
//    cumulées), mais les dividendes échappent ENTIÈREMENT aux cotisations sociales (seul le PFU/
//    flat tax de 30% s'applique) — d'où l'optimisation classique « SASU + gros dividendes ».
//  - TNS gérant majoritaire (EURL/SARL) : charges sociales plus modérées sur la rémunération
//    (~41-45% du net), MAIS les dividendes qui excèdent 10% du capital social (+ primes d'émission
//    + apports en compte courant d'associé) sont eux aussi soumis aux cotisations sociales TNS
//    (art. L131-6 CSS, réforme LFSS 2013) — l'arbitrage « tout en dividendes » y est donc bien
//    moins favorable qu'en SASU, sauf capital social élevé.
//
// Simplifications assumées (cf. taxRules.ts pour le détail sourcé) :
//  - Taux de charges sociales retenus comme des taux moyens forfaitaires (pas de barème détaillé par
//    tranche/plafond de sécurité sociale).
//  - Le taux marginal d'IR retenu (foyer) est le taux EFFECTIF (intégrant la décote), déjà utilisé
//    ailleurs dans l'application (cf. frenchIncomeTax.ts) — approximation marginale, pas un calcul
//    exact par différence d'impôt avant/après.
//  - Régime IR (société translucide) : le bénéfice est déjà taxé au barème IR du foyer quelle que
//    soit son affectation ; la distinction salaire/dividende y est nettement moins pertinente que
//    sous IS (pas d'IS, pas de PFU) — le simulateur reste utilisable mais un avertissement est
//    affiché côté UI.

import { type DirigeantStatus, type ImpositionSociete, getCompanyType, resolveDirigeantStatus } from "./companyTypes";
import {
  type PersonalTaxProfile,
  applyAbattement10,
  createDefaultPersonalTaxProfile,
  resolvePersonalTaxProfile,
} from "./frenchIncomeTax";
import { computeIS } from "./corporateTax";

export const DEFAULT_TAUX_CHARGES_TNS = 0.43; // cf. taxRules "cotisations-tns-taux-global" — cotisations calculées sur la rémunération nette
export const DEFAULT_TAUX_CHARGES_PATRONALES = 0.42; // ordre de grandeur cadre assimilé salarié, régime général, sur le brut
export const DEFAULT_TAUX_CHARGES_SALARIALES = 0.22; // ordre de grandeur cadre assimilé salarié, régime général, sur le brut

export const PFU_TAUX_IR = 0.128; // fraction IR du prélèvement forfaitaire unique (flat tax) sur les dividendes
export const PFU_TAUX_PS = 0.172; // fraction prélèvements sociaux (CSG/CRDS...) du PFU — due que l'IR soit au PFU ou au barème
export const PFU_TAUX_GLOBAL = PFU_TAUX_IR + PFU_TAUX_PS; // 30%
export const ABATTEMENT_DIVIDENDES_BAREME = 0.4; // abattement de 40% sur l'assiette IR (pas sur les prélèvements sociaux) en cas d'option barème progressif
export const SEUIL_DIVIDENDES_TNS_RATIO = 0.1; // 10% de (capital social + primes d'émission + CCA) — art. L131-6 CSS

export type ModeRemuneration = "salaire" | "dividendes" | "mixte";

export interface RemunerationInputs {
  id: string;
  name: string;
  createdAt: string;

  country: string;
  companyType: string; // EURL / SARL / SASU / SAS (cf. companyTypes.ts)
  gerantMajoritaire: boolean; // pertinent uniquement si la forme juridique le permet (SARL)

  budgetAnnuelDisponible: number; // enveloppe totale que la société peut consacrer à la rémunération du dirigeant, avant IS/charges — base de comparaison à coût égal entre scénarios
  modeRemuneration: ModeRemuneration; // scénario mis en avant dans l'UI (les 3 sont toujours calculés)
  partSalaireSurBudgetMixte: number; // 0-100, part de l'enveloppe allouée en salaire dans le scénario "mixte"

  tauxChargesTNS: number;
  tauxChargesPatronales: number;
  tauxChargesSalariales: number;

  capitalSocial: number;
  primesEmissionEtCCA: number; // primes d'émission + apports en compte courant d'associé, entrent dans la base des 10% (TNS)
  optionBaremeProgressifDividendes: boolean; // sinon PFU 30% par défaut, pour la fraction non soumise d'office au barème (excédent TNS)

  impositionSociete: ImpositionSociete;
  corporateTaxRate: number;
  eligibleTauxReduitPME: boolean;

  personalTaxProfile: PersonalTaxProfile;
}

export function createDefaultRemunerationInputs(): RemunerationInputs {
  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation rémunération",
    createdAt: new Date().toISOString(),
    country: "FR",
    companyType: "EURL",
    gerantMajoritaire: true,
    budgetAnnuelDisponible: 60000,
    modeRemuneration: "mixte",
    partSalaireSurBudgetMixte: 50,
    tauxChargesTNS: DEFAULT_TAUX_CHARGES_TNS,
    tauxChargesPatronales: DEFAULT_TAUX_CHARGES_PATRONALES,
    tauxChargesSalariales: DEFAULT_TAUX_CHARGES_SALARIALES,
    capitalSocial: 1000,
    primesEmissionEtCCA: 0,
    optionBaremeProgressifDividendes: false,
    impositionSociete: "IS",
    corporateTaxRate: 0.25,
    eligibleTauxReduitPME: true,
    personalTaxProfile: createDefaultPersonalTaxProfile(),
  };
}

export interface ScenarioResult {
  key: ModeRemuneration | "mixte";
  label: string;
  partSalairePourcent: number; // 0 / 100 / valeur choisie pour le mixte

  coutTotalEntreprise: number; // = budgetAnnuelDisponible, identique pour tous les scénarios
  coutSalaireEntreprise: number;
  beneficeSoumisIS: number;
  isDue: number;
  dividendeBrutDistribuable: number;

  salaireBrutAnnuel: number;
  cotisationsSalariales: number;
  cotisationsPatronales: number;
  cotisationsTNS: number;
  salaireNetSocialAnnuel: number;
  irSurSalaire: number;
  salaireNetApresImpotAnnuel: number;

  dividendeSousSeuilTNS: number;
  dividendeAuDessusSeuilTNS: number;
  cotisationsTNSSurDividendeExcedentaire: number;
  prelevementsSociauxSurDividendes: number;
  irSurDividendes: number;
  dividendeNetAnnuel: number;

  bruteTotalAnnuel: number;
  netTotalAnnuel: number;
  netTotalMensuel: number;
  bruteTotalMensuel: number;
  tauxPrelevementGlobal: number; // 1 − net / coût total : part de l'enveloppe perdue en charges + impôts
  coutPour1EuroNet: number; // coût total entreprise / net dirigeant : ce qu'il faut décaisser pour que le dirigeant perçoive 1€ net — plus c'est bas, plus le mode est efficace ; Infinity si net nul
}

export interface RemunerationResults {
  dirigeantStatus: DirigeantStatus;
  seuilDividendesTNS: number; // montant annuel de dividendes exonéré de cotisations sociales TNS (10% du capital+primes+CCA) — Infinity affiché comme tel pour assimilé salarié
  scenarioSalaire: ScenarioResult;
  scenarioDividendes: ScenarioResult;
  scenarioMixte: ScenarioResult;
  scenarios: ScenarioResult[]; // les 3 ci-dessus, triés par net total annuel décroissant
  meilleurScenario: ScenarioResult;
}

function computeScenario(
  inputs: RemunerationInputs,
  partSalairePourcent: number,
  key: ModeRemuneration | "mixte",
  label: string,
  dirigeantStatus: DirigeantStatus,
): ScenarioResult {
  const isTNS = dirigeantStatus === "TNS";
  const ratio = Math.min(Math.max(partSalairePourcent, 0), 100) / 100;
  const coutTotalEntreprise = inputs.budgetAnnuelDisponible;
  const coutSalaireEntreprise = coutTotalEntreprise * ratio;
  const beneficeSoumisIS = coutTotalEntreprise - coutSalaireEntreprise;

  // --- Rémunération (salaire) ---
  let salaireBrutAnnuel = 0;
  let cotisationsSalariales = 0;
  let cotisationsPatronales = 0;
  let cotisationsTNS = 0;
  let salaireNetSocialAnnuel = 0;

  if (coutSalaireEntreprise > 0) {
    if (isTNS) {
      // Convention retenue dans toute l'application (cf. simulator.ts, AEN) : les cotisations TNS
      // sont calculées sur la rémunération NETTE, pas sur un "brut" distinct (qui n'existe pas
      // vraiment pour un TNS). coût alloué = net + cotisations = net × (1 + taux).
      salaireNetSocialAnnuel = coutSalaireEntreprise / (1 + inputs.tauxChargesTNS);
      cotisationsTNS = coutSalaireEntreprise - salaireNetSocialAnnuel;
      salaireBrutAnnuel = salaireNetSocialAnnuel; // affiché comme "brut" faute d'un brut distinct côté TNS
    } else {
      // Assimilé salarié : charges patronales sur le brut, charges salariales sur ce même brut.
      salaireBrutAnnuel = coutSalaireEntreprise / (1 + inputs.tauxChargesPatronales);
      cotisationsPatronales = coutSalaireEntreprise - salaireBrutAnnuel;
      cotisationsSalariales = salaireBrutAnnuel * inputs.tauxChargesSalariales;
      salaireNetSocialAnnuel = salaireBrutAnnuel - cotisationsSalariales;
    }
  }

  // --- Dividendes ---
  const isDue =
    beneficeSoumisIS > 0 && inputs.impositionSociete === "IS"
      ? computeIS(beneficeSoumisIS, inputs.eligibleTauxReduitPME, inputs.corporateTaxRate)
      : 0; // régime IR (translucide) : le bénéfice est déjà taxé au barème IR du foyer, pas d'IS distinct — cf. note de module
  const dividendeBrutDistribuable = Math.max(0, beneficeSoumisIS - isDue);

  const seuilDividendesTNS = isTNS ? SEUIL_DIVIDENDES_TNS_RATIO * (inputs.capitalSocial + inputs.primesEmissionEtCCA) : Infinity;
  const dividendeSousSeuilTNS = Math.min(dividendeBrutDistribuable, seuilDividendesTNS);
  const dividendeAuDessusSeuilTNS = Math.max(0, dividendeBrutDistribuable - seuilDividendesTNS);

  // Fraction excédentaire (TNS uniquement) : soumise aux cotisations sociales TNS (comme un revenu
  // professionnel), qui REMPLACENT les prélèvements sociaux de 17,2% (pas de double charge sociale),
  // et reste obligatoirement imposée au barème progressif (pas d'option PFU pour cette fraction).
  const cotisationsTNSSurDividendeExcedentaire = dividendeAuDessusSeuilTNS * inputs.tauxChargesTNS;
  const dividendeImposableBaremeExcedent = dividendeAuDessusSeuilTNS * (1 - ABATTEMENT_DIVIDENDES_BAREME);

  // Fraction sous le seuil (ou totalité pour un assimilé salarié) : prélèvements sociaux 17,2% dus
  // sur le brut dans tous les cas ; IR au PFU (12,8% sur le brut) par défaut, ou au barème progressif
  // avec abattement de 40% sur option.
  const prelevementsSociauxSurDividendes = dividendeSousSeuilTNS * PFU_TAUX_PS;
  const dividendeImposableBaremeOption = inputs.optionBaremeProgressifDividendes
    ? dividendeSousSeuilTNS * (1 - ABATTEMENT_DIVIDENDES_BAREME)
    : 0;
  const irSurDividendeSousSeuilPFU = inputs.optionBaremeProgressifDividendes ? 0 : dividendeSousSeuilTNS * PFU_TAUX_IR;

  // Taux marginal d'IR du foyer : intègre salaire (après abattement 10%) + fractions de dividendes
  // imposées au barème (excédent TNS, toujours ; fraction sous le seuil, si option barème choisie) +
  // bénéfice de la société si régime IR translucide — cf. convention déjà utilisée dans
  // simulator.ts/homeOffice.ts pour le régime IR.
  const dividendeImposableBaremeTotal = dividendeImposableBaremeExcedent + dividendeImposableBaremeOption;
  const profilFoyer: PersonalTaxProfile = {
    ...inputs.personalTaxProfile,
    salaireNetImposableAnnuel: salaireNetSocialAnnuel,
    autresRevenusImposablesFoyer:
      inputs.personalTaxProfile.autresRevenusImposablesFoyer +
      dividendeImposableBaremeTotal +
      (inputs.impositionSociete === "IR" ? beneficeSoumisIS : 0),
  };
  const resolvedTax = resolvePersonalTaxProfile(profilFoyer);
  const tauxIRFoyer = resolvedTax.tauxUtilise;

  const irSurSalaire = applyAbattement10(salaireNetSocialAnnuel) * tauxIRFoyer;
  const salaireNetApresImpotAnnuel = Math.max(0, salaireNetSocialAnnuel - irSurSalaire);

  const irSurDividendeBaremeExcedent = dividendeImposableBaremeExcedent * tauxIRFoyer;
  const irSurDividendeBaremeOption = dividendeImposableBaremeOption * tauxIRFoyer;
  const irSurDividendes = irSurDividendeSousSeuilPFU + irSurDividendeBaremeExcedent + irSurDividendeBaremeOption;

  const dividendeNetAnnuel = Math.max(
    0,
    dividendeBrutDistribuable - prelevementsSociauxSurDividendes - cotisationsTNSSurDividendeExcedentaire - irSurDividendes,
  );

  const bruteTotalAnnuel = salaireBrutAnnuel + dividendeBrutDistribuable;
  const netTotalAnnuel = salaireNetApresImpotAnnuel + dividendeNetAnnuel;
  const tauxPrelevementGlobal = coutTotalEntreprise > 0 ? 1 - netTotalAnnuel / coutTotalEntreprise : 0;
  const coutPour1EuroNet = netTotalAnnuel > 0 ? coutTotalEntreprise / netTotalAnnuel : Infinity;

  return {
    key,
    label,
    partSalairePourcent,
    coutTotalEntreprise,
    coutSalaireEntreprise,
    beneficeSoumisIS,
    isDue,
    dividendeBrutDistribuable,
    salaireBrutAnnuel,
    cotisationsSalariales,
    cotisationsPatronales,
    cotisationsTNS,
    salaireNetSocialAnnuel,
    irSurSalaire,
    salaireNetApresImpotAnnuel,
    dividendeSousSeuilTNS,
    dividendeAuDessusSeuilTNS,
    cotisationsTNSSurDividendeExcedentaire,
    prelevementsSociauxSurDividendes,
    irSurDividendes,
    dividendeNetAnnuel,
    bruteTotalAnnuel,
    netTotalAnnuel,
    netTotalMensuel: netTotalAnnuel / 12,
    bruteTotalMensuel: bruteTotalAnnuel / 12,
    tauxPrelevementGlobal,
    coutPour1EuroNet,
  };
}

export function computeRemuneration(inputs: RemunerationInputs): RemunerationResults {
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);

  const scenarioSalaire = computeScenario(inputs, 100, "salaire", "100% Salaire", dirigeantStatus);
  const scenarioDividendes = computeScenario(inputs, 0, "dividendes", "100% Dividendes", dirigeantStatus);
  const scenarioMixte = computeScenario(
    inputs,
    inputs.partSalaireSurBudgetMixte,
    "mixte",
    `Mixte (${Math.round(inputs.partSalaireSurBudgetMixte)}% salaire)`,
    dirigeantStatus,
  );

  const scenarios = [scenarioSalaire, scenarioDividendes, scenarioMixte].sort((a, b) => b.netTotalAnnuel - a.netTotalAnnuel);
  const meilleurScenario = scenarios[0];

  const isTNS = dirigeantStatus === "TNS";
  const seuilDividendesTNS = isTNS ? SEUIL_DIVIDENDES_TNS_RATIO * (inputs.capitalSocial + inputs.primesEmissionEtCCA) : Infinity;

  return {
    dirigeantStatus,
    seuilDividendesTNS,
    scenarioSalaire,
    scenarioDividendes,
    scenarioMixte,
    scenarios,
    meilleurScenario,
  };
}
