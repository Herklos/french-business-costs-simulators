// Simulateur : matériel professionnel (informatique, mobilier) — achat par la société, LOA/leasing,
// ou achat personnel par le dirigeant remboursé (note de frais) ou non remboursé.
//
// Principe : une immobilisation (matériel informatique, mobilier de bureau) se déduit du résultat
// de la société soit immédiatement en charge (si son prix HT unitaire n'excède pas 500€, tolérance
// dite du « petit matériel », art. 39-1 3° CGI / BOI-BIC-CHG-20-30-10), soit par amortissement
// linéaire sur sa durée d'usage. Quatre montages sont comparés à coût d'achat identique :
//  - "societe" : la société achète directement le matériel — charge/amortissement déductible.
//  - "personnel_rembourse" : le dirigeant avance l'achat puis se fait rembourser via note de frais
//    — fiscalement IDENTIQUE au montage société (même charge déductible), simple différence de
//    circuit de paiement. Modélisé séparément pour lever une confusion fréquente : "le matériel
//    payé par le dirigeant n'est pas déductible" est FAUX tant qu'il est remboursé et affecté à
//    l'usage professionnel.
//  - "personnel_non_rembourse" : le dirigeant paie de sa poche, sans remboursement — aucune charge
//    déductible côté société, coût intégralement supporté par le dirigeant sur des revenus déjà
//    taxés (aucun avantage fiscal).
//  - "loa" : location avec option d'achat — les loyers sont intégralement déductibles en charge
//    (pas d'amortissement), sans plafond de déduction fiscale spécifique pour du matériel standard
//    (contrairement au véhicule de tourisme, art. 39-4 CGI, propre aux véhicules).
//
// Deux extensions supplémentaires, indépendantes du montage retenu :
//  - Plan de renouvellement périodique : projette le coût sur un horizon pluriannuel en répétant le
//    cycle d'acquisition (achat ou LOA) à son terme, avec une inflation du prix optionnelle.
//  - Usage mixte pro/privé : si le dirigeant utilise aussi le matériel à titre personnel, un
//    avantage en nature (AEN) est généré au prorata de l'usage privé — même logique que pour un
//    véhicule de société (BOI-RSA-BASE-30-50), mais sans abattement spécifique (propre au véhicule
//    électrique).

import { type CompanyTaxContext, computeEconomieImpotSociete } from "./corporateTax";
import { type PersonalTaxProfile, createDefaultPersonalTaxProfile, resolvePersonalTaxProfile } from "./frenchIncomeTax";
import type { ImpositionSociete } from "./companyTypes";

export const SEUIL_CHARGE_IMMEDIATE_HT = 500; // art. 39-1 3° CGI — petit matériel, non revalorisé depuis des décennies

export type CategorieMateriel = "informatique" | "mobilier" | "outillage" | "autre";
export type ModeAcquisitionMateriel =
  | "societe"
  | "personnel_rembourse"
  | "personnel_non_rembourse"
  | "loa_sans_option"
  | "loa_avec_option";

/** Vrai pour les deux variantes de LOA, qui partagent leur traitement pendant le contrat. */
export function estLoa(mode: ModeAcquisitionMateriel): boolean {
  return mode === "loa_sans_option" || mode === "loa_avec_option";
}

/**
 * Ramène un mode relu d'une simulation sauvegardée ou d'un lien de partage à un mode connu.
 * L'ancien mode unique « loa » ne disait pas si l'option était levée : il correspond donc au cas
 * où elle ne l'est pas, seul comportement que le simulateur chiffrait alors.
 */
export function normaliserModeAcquisition(mode: string): ModeAcquisitionMateriel {
  if (mode === "loa") return "loa_sans_option";
  return (MODES_ACQUISITION as readonly string[]).includes(mode)
    ? (mode as ModeAcquisitionMateriel)
    : "societe";
}

export const DUREE_AMORTISSEMENT_PAR_CATEGORIE: Record<CategorieMateriel, number> = {
  informatique: 3, // matériel informatique/bureautique : usage 3 ans (doctrine BOFiP courante)
  mobilier: 8, // mobilier de bureau : usage 8-10 ans, 8 retenu par défaut
  outillage: 7, // matériel et outillage industriels/d'atelier : usage 5 à 10 ans selon la nature, 7 retenu par défaut (doctrine BOFiP courante)
  autre: 5,
};

export const CATEGORIE_LABELS: Record<CategorieMateriel, string> = {
  informatique: "Matériel informatique / bureautique",
  mobilier: "Mobilier de bureau",
  outillage: "Outillage / matériel d'atelier professionnel",
  autre: "Autre matériel professionnel",
};

export interface MaterielInputs {
  id: string;
  name: string;
  createdAt: string;

  country: string;
  impositionSociete: ImpositionSociete;
  corporateTaxRate: number;
  eligibleTauxReduitPME: boolean;
  beneficeAvantChargePrevisionnel: number;

  categorie: CategorieMateriel;
  prixHT: number;
  dureeAmortissementAnnees: number; // pré-rempli selon la catégorie, éditable
  modeAcquisition: ModeAcquisitionMateriel;

  // LOA / leasing (utilisé si le mode retenu est l'une des deux variantes de LOA)
  loaLoyerMensuel: number;
  loaDureeMois: number;
  loaValeurOptionAchat: number; // prix de levée de l'option au terme du contrat

  // Plan de renouvellement périodique — indépendant du montage retenu.
  horizonRenouvellementAnnees: number; // durée totale de projection (plusieurs cycles d'achat/LOA successifs)
  tauxInflationMateriel: number; // 0-1, hausse de prix estimée entre deux cycles de renouvellement

  // Usage mixte pro/privé — génère un avantage en nature (AEN) au prorata de l'usage privé.
  usagePrivePercent: number; // 0-100
  tauxChargesSocialesAEN: number; // taux de charges sociales appliqué à l'AEN (TNS ou assimilé salarié)

  personalTaxProfile: PersonalTaxProfile;
}

export function createDefaultMaterielInputs(): MaterielInputs {
  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation matériel",
    createdAt: new Date().toISOString(),
    country: "FR",
    impositionSociete: "IS",
    corporateTaxRate: 0.25,
    eligibleTauxReduitPME: true,
    beneficeAvantChargePrevisionnel: 40000,
    categorie: "informatique",
    prixHT: 1800,
    dureeAmortissementAnnees: DUREE_AMORTISSEMENT_PAR_CATEGORIE.informatique,
    modeAcquisition: "societe",
    loaLoyerMensuel: 55,
    loaDureeMois: 36,
    loaValeurOptionAchat: 200,
    horizonRenouvellementAnnees: DUREE_AMORTISSEMENT_PAR_CATEGORIE.informatique,
    tauxInflationMateriel: 0,
    usagePrivePercent: 0,
    tauxChargesSocialesAEN: 0.43,
    personalTaxProfile: createDefaultPersonalTaxProfile(),
  };
}

export interface MaterielResults {
  eligibleChargeImmediate: boolean; // prixHT ≤ 500€ : déduction immédiate en charge plutôt qu'amortissement (jamais vrai en LOA)
  chargeAnnee1: number; // charge déductible la 1ère année (prix total si charge immédiate, sinon 1 annuité ou 1 an de loyers LOA)
  annuiteAmortissement: number; // annuité des années suivantes (0 si charge immédiate)
  economieImpotAnnee1: number;
  coutNetSocieteAnnee1: number;
  coutNetSocieteTotalSurDuree: number; // somme des coûts nets société sur toute la durée d'amortissement/LOA (ou année 1 seule si charge immédiate)
  coutDirigeantNonRembourse: number; // = prixHT si non remboursé, 0 sinon (aucun avantage fiscal, aucune récupération)
  economieVsNonRembourse: number; // gain total (société+dirigeant) à faire financer/rembourser le matériel par la société plutôt que de l'acheter sans remboursement

  // Plan de renouvellement périodique
  dureeCycleAnnees: number; // durée d'un cycle (amortissement, LOA — contrat puis amortissement de l'option — ou durée d'usage)
  valeurOptionAchatRetenue: number; // prix de levée effectivement pris en compte (0 si l'option n'est pas levée)
  optionEnChargeImmediate: boolean; // le prix de levée est-il sous le seuil du petit matériel ?
  /** Taux annuel implicite du financement, quand la LOA en constitue un. `null` sinon. */
  tauxImpliciteLoaAnnuel: number | null;
  nombreCycles: number; // nombre de cycles de renouvellement sur l'horizon choisi
  coutTotalSurHorizon: number; // coût net société cumulé sur l'horizon, cycles successifs avec inflation éventuelle

  // Usage mixte pro/privé (avantage en nature)
  aenAnnuelle: number;
  cotisationsSocialesAEN: number;
  irSurAEN: number;
  coutDirigeantAEN: number; // cotisations sociales + IR sur l'AEN, à la charge du dirigeant

  coutNetGlobalAnnee1: number; // coût net société + coût dirigeant (non remboursé et/ou AEN), année 1 — cf. calcul dans computeMateriel
  coutNetGlobalSurDuree: number; // même périmètre, cumulé sur un cycle complet d'acquisition
  coutNetGlobalSurHorizon: number; // même périmètre, cumulé sur l'horizon de renouvellement (cycles successifs, inflation incluse)
}

/**
 * Taux annuel implicite d'une LOA dont l'option est levée.
 *
 * C'est la réponse à une question naturelle : pourquoi aucun champ ne demande le taux d'intérêt de
 * la LOA ? Parce qu'une offre de location ne s'exprime pas par un taux mais par des loyers, qui
 * l'incorporent déjà. Le renseigner en plus serait redondant, et le renseigner à la place des
 * loyers supposerait de reconstituer ceux-ci par une convention d'amortissement que le loueur ne
 * publie pas. Le simulateur fait donc l'inverse : il DÉDUIT le taux des flux réellement contractés,
 * ce qui permet de comparer l'offre à un crédit sur la seule dimension où les deux sont comparables.
 *
 * Le taux n'a de sens que si l'option est levée : la société acquiert alors le matériel en différé,
 * et l'écart entre son prix comptant et la somme actualisée des loyers puis du prix de levée est le
 * coût de ce différé. Sans levée d'option, rien n'est financé — c'est une location, et lui prêter
 * un taux d'intérêt n'aurait pas de sens.
 *
 * Résolution par dichotomie sur le taux mensuel : la valeur actuelle nette décroît continûment avec
 * le taux, une recherche par bissection converge donc sans risque d'osciller.
 */
export function tauxImpliciteLoa(prixHT: number, loyerMensuel: number, dureeMois: number, valeurOption: number): number | null {
  const n = Math.round(dureeMois);
  if (prixHT <= 0 || n <= 0 || loyerMensuel < 0) return null;
  const van = (tauxMensuel: number) => {
    let somme = 0;
    for (let t = 1; t <= n; t++) somme += loyerMensuel / Math.pow(1 + tauxMensuel, t);
    somme += valeurOption / Math.pow(1 + tauxMensuel, n);
    return prixHT - somme;
  };
  // Un total versé inférieur au prix comptant signifierait un taux négatif : l'offre serait plus
  // avantageuse que la gratuité, ce qui traduit une saisie incohérente plutôt qu'un financement.
  if (van(0) >= 0) return null;
  let bas = 0;
  let haut = 1; // 100 %/mois : très au-delà de toute offre réelle, borne haute sûre
  if (van(haut) < 0) return null;
  for (let i = 0; i < 200; i++) {
    const milieu = (bas + haut) / 2;
    if (van(milieu) < 0) bas = milieu;
    else haut = milieu;
  }
  const tauxMensuel = (bas + haut) / 2;
  return Math.pow(1 + tauxMensuel, 12) - 1;
}

export function computeMateriel(inputs: MaterielInputs): MaterielResults {
  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  const tauxIRUtilise = resolvedTax.tauxUtilise;
  const ctx: CompanyTaxContext = inputs;

  const mode = normaliserModeAcquisition(inputs.modeAcquisition);
  const isLoa = estLoa(mode);
  const leveeOption = mode === "loa_avec_option";
  const eligibleChargeImmediate = !isLoa && inputs.prixHT > 0 && inputs.prixHT <= SEUIL_CHARGE_IMMEDIATE_HT;

  const dureeContratAnnees = Math.max(1, inputs.loaDureeMois) / 12;
  const dureeAmortissement = Math.max(1, inputs.dureeAmortissementAnnees);
  const valeurOptionAchat = leveeOption ? Math.max(0, inputs.loaValeurOptionAchat) : 0;
  // Le prix de levée n'est pas un loyer : c'est l'acquisition d'une immobilisation, qui s'amortit
  // à son tour sur la durée d'usage résiduelle du matériel. Le cycle s'allonge d'autant — c'est
  // précisément ce qui distingue les deux variantes de LOA : sans levée, il faut relouer au terme ;
  // avec levée, le matériel continue de servir sans nouveau décaissement.
  // Sous le seuil du petit matériel, l'option se déduit immédiatement plutôt que de s'amortir.
  const optionEnChargeImmediate = valeurOptionAchat > 0 && valeurOptionAchat <= SEUIL_CHARGE_IMMEDIATE_HT;
  const dureeAmortissementOption = valeurOptionAchat > 0 ? (optionEnChargeImmediate ? 1 : dureeAmortissement) : 0;

  const dureeCycleAnnees = isLoa ? dureeContratAnnees + dureeAmortissementOption : dureeAmortissement;

  const loyerAnnuel = Math.max(0, inputs.loaLoyerMensuel) * 12;
  const chargeAnnee1 = isLoa
    ? loyerAnnuel
    : eligibleChargeImmediate
      ? inputs.prixHT
      : inputs.prixHT / dureeCycleAnnees;
  const annuiteAmortissement = eligibleChargeImmediate ? 0 : chargeAnnee1;

  // Les montages "société", "personnel remboursé" et les deux LOA ont tous une charge déductible
  // côté société — seul le montage "non remboursé" en diffère, cf. note de module.
  const estFinanceParLaSociete = mode !== "personnel_non_rembourse";

  const economieImpotAnnee1 = estFinanceParLaSociete ? computeEconomieImpotSociete(ctx, chargeAnnee1, tauxIRUtilise) : 0;
  const coutNetSocieteAnnee1 = estFinanceParLaSociete ? chargeAnnee1 - economieImpotAnnee1 : 0;

  let coutNetSocieteTotalSurDuree = 0;
  if (estFinanceParLaSociete) {
    if (eligibleChargeImmediate) {
      coutNetSocieteTotalSurDuree = coutNetSocieteAnnee1;
    } else if (isLoa) {
      // Deux périodes successives, chacune avec sa propre charge annuelle : les loyers pendant le
      // contrat, puis l'amortissement du prix de levée. Les additionner sur un seul rythme
      // écraserait la différence entre les deux variantes.
      const economieParAnnuiteLoyer = computeEconomieImpotSociete(ctx, loyerAnnuel, tauxIRUtilise);
      coutNetSocieteTotalSurDuree = (loyerAnnuel - economieParAnnuiteLoyer) * dureeContratAnnees;
      if (valeurOptionAchat > 0) {
        const annuiteOption = valeurOptionAchat / dureeAmortissementOption;
        const economieParAnnuiteOption = computeEconomieImpotSociete(ctx, annuiteOption, tauxIRUtilise);
        coutNetSocieteTotalSurDuree += (annuiteOption - economieParAnnuiteOption) * dureeAmortissementOption;
      }
    } else {
      // Même économie d'impôt sur chaque annuité (bénéfice prévisionnel supposé stable sur la durée) —
      // simplification raisonnable pour une projection indicative.
      const economieImpotParAnnuite = computeEconomieImpotSociete(ctx, annuiteAmortissement, tauxIRUtilise);
      coutNetSocieteTotalSurDuree = (annuiteAmortissement - economieImpotParAnnuite) * dureeCycleAnnees;
    }
  }

  const coutDirigeantNonRembourse = mode === "personnel_non_rembourse" ? inputs.prixHT : 0;
  // Gain, tous montants confondus, du montage retenu par rapport à un achat personnel jamais
  // remboursé (coût plein prixHT, sans aucune déduction) : nul par construction pour ce dernier
  // montage lui-même (comparé à lui-même), positif pour les deux autres.
  const economieVsNonRembourse = inputs.prixHT - coutNetSocieteTotalSurDuree - coutDirigeantNonRembourse;

  // Plan de renouvellement périodique : répète le cycle d'acquisition sur l'horizon choisi, avec une
  // inflation optionnelle du prix (donc du coût net) à chaque nouveau cycle.
  const nombreCycles = Math.max(1, Math.round(Math.max(0, inputs.horizonRenouvellementAnnees) / dureeCycleAnnees));
  let coutTotalSurHorizon = 0;
  for (let cycle = 0; cycle < nombreCycles; cycle++) {
    coutTotalSurHorizon += coutNetSocieteTotalSurDuree * Math.pow(1 + inputs.tauxInflationMateriel, cycle);
  }

  // Usage mixte pro/privé : avantage en nature au prorata de l'usage privé, sur la même base que la
  // charge déductible annuelle — uniquement si le matériel est financé par la société (un dirigeant
  // qui paie sans être remboursé utilise déjà son propre bien, aucun avantage en nature à chiffrer).
  const usageRatio = Math.min(Math.max(inputs.usagePrivePercent, 0), 100) / 100;
  const aenAnnuelle = estFinanceParLaSociete ? chargeAnnee1 * usageRatio : 0;
  const cotisationsSocialesAEN = aenAnnuelle * inputs.tauxChargesSocialesAEN;
  const irSurAEN = aenAnnuelle * tauxIRUtilise;
  const coutDirigeantAEN = cotisationsSocialesAEN + irSurAEN;

  // Coût net GLOBAL année 1, pour le dirigeant et sa société pris ENSEMBLE (utilisé par la vue
  // consolidée multi-simulateurs) : coût net société + coût personnel non remboursé (payé cash par
  // le dirigeant, sans aucune charge société) + coût dirigeant lié à l'AEN d'usage mixte. Les deux
  // derniers termes sont mutuellement exclusifs par construction (l'AEN ne se déclenche que si le
  // matériel est financé par la société, donc jamais en même temps qu'un achat non remboursé).
  const coutNetGlobalAnnee1 = coutNetSocieteAnnee1 + coutDirigeantNonRembourse + coutDirigeantAEN;

  // Coût global d'un cycle complet, puis de l'horizon entier. C'est la seule base sur laquelle les
  // quatre montages sont comparables entre eux : un achat amorti sur 3 ans et une LOA de 48 mois ne
  // se comparent ni sur une annuité (les cycles n'ont pas la même longueur) ni sur un cycle (ils ne
  // couvrent pas la même durée d'usage) — seul un horizon commun les met à égalité.
  // L'achat non remboursé et l'AEN diffèrent de nature : le premier est décaissé une fois par cycle,
  // le second se répète chaque année tant que le matériel est mis à disposition.
  const coutNetGlobalSurDuree =
    coutNetSocieteTotalSurDuree + coutDirigeantNonRembourse + coutDirigeantAEN * dureeCycleAnnees;
  let coutNetGlobalSurHorizon = 0;
  for (let cycle = 0; cycle < nombreCycles; cycle++) {
    coutNetGlobalSurHorizon += coutNetGlobalSurDuree * Math.pow(1 + inputs.tauxInflationMateriel, cycle);
  }

  return {
    eligibleChargeImmediate,
    chargeAnnee1,
    annuiteAmortissement,
    economieImpotAnnee1,
    coutNetSocieteAnnee1,
    coutNetSocieteTotalSurDuree,
    coutDirigeantNonRembourse,
    economieVsNonRembourse,
    dureeCycleAnnees,
    valeurOptionAchatRetenue: valeurOptionAchat,
    optionEnChargeImmediate: valeurOptionAchat > 0 && optionEnChargeImmediate,
    tauxImpliciteLoaAnnuel: leveeOption
      ? tauxImpliciteLoa(inputs.prixHT, Math.max(0, inputs.loaLoyerMensuel), inputs.loaDureeMois, valeurOptionAchat)
      : null,
    nombreCycles,
    coutTotalSurHorizon,
    aenAnnuelle,
    cotisationsSocialesAEN,
    irSurAEN,
    coutDirigeantAEN,
    coutNetGlobalAnnee1,
    coutNetGlobalSurDuree,
    coutNetGlobalSurHorizon,
  };
}

export const MODE_ACQUISITION_LABELS: Record<ModeAcquisitionMateriel, string> = {
  societe: "Achat par la société",
  personnel_rembourse: "Achat personnel remboursé (note de frais)",
  personnel_non_rembourse: "Achat personnel non remboursé",
  loa_sans_option: "LOA — option non levée (matériel restitué)",
  loa_avec_option: "LOA — option levée (matériel conservé)",
};

export const MODE_ACQUISITION_RESUMES: Record<ModeAcquisitionMateriel, string> = {
  societe: "La société achète et immobilise le matériel. Charge ou amortissement déductibles, matériel à l'actif.",
  personnel_rembourse:
    "Le dirigeant avance l'achat, la société le rembourse sur note de frais. Fiscalement identique à l'achat société.",
  personnel_non_rembourse:
    "Le dirigeant paie de sa poche et ne se fait pas rembourser. Aucune charge déductible, aucun avantage fiscal.",
  loa_sans_option:
    "Loyers déductibles, rien à l'actif. Le matériel est restitué au terme : il faut le remplacer pour continuer.",
  loa_avec_option:
    "Loyers déductibles, puis rachat au terme. Le matériel reste acquis et le prix de l'option s'amortit à son tour.",
};

export const MODES_ACQUISITION: ModeAcquisitionMateriel[] = [
  "societe",
  "personnel_rembourse",
  "personnel_non_rembourse",
  "loa_sans_option",
  "loa_avec_option",
];

export interface MontageMateriel {
  mode: ModeAcquisitionMateriel;
  label: string;
  resume: string;
  results: MaterielResults;
  /** Base de classement : coût net global (société + dirigeant) sur l'horizon de renouvellement. */
  coutHorizon: number;
  /** Surcoût par rapport au montage le moins cher — 0 pour le meilleur. */
  ecartVsMeilleur: number;
  /** Vrai pour le (ou les) montage(s) au coût le plus bas. */
  meilleur: boolean;
}

/**
 * Chiffre les quatre montages sur les mêmes hypothèses et les classe du moins cher au plus cher.
 *
 * L'utilisateur n'a plus à choisir un montage pour en connaître le coût : il les voit tous, et le
 * choix devient une conclusion plutôt qu'un préalable. Le mode porté par `inputs` ne sert donc plus
 * qu'à désigner celui dont le détail est affiché.
 */
export function compareMontagesMateriel(inputs: MaterielInputs): {
  montages: MontageMateriel[];
  meilleur: MontageMateriel;
} {
  const chiffres = MODES_ACQUISITION.map((mode) => {
    const results = computeMateriel({ ...inputs, modeAcquisition: mode });
    return {
      mode,
      label: MODE_ACQUISITION_LABELS[mode],
      resume: MODE_ACQUISITION_RESUMES[mode],
      results,
      coutHorizon: results.coutNetGlobalSurHorizon,
    };
  }).sort((a, b) => a.coutHorizon - b.coutHorizon);

  const coutMinimal = chiffres[0].coutHorizon;
  const montages = chiffres.map((m) => ({
    ...m,
    ecartVsMeilleur: m.coutHorizon - coutMinimal,
    // Égalité stricte plutôt qu'approchée : achat société et achat remboursé sont identiques au
    // centime près par construction, et méritent tous deux le trophée.
    meilleur: m.coutHorizon === coutMinimal,
  }));

  return { montages, meilleur: montages[0] };
}
