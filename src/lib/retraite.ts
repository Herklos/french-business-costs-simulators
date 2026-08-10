// Simulateur : épargne retraite du dirigeant (PER individuel / Madelin retraite).
//
// Comme pour la mutuelle/prévoyance (cf. mutuellePrevoyance.ts), le statut du dirigeant change le
// plafond de déduction fiscale applicable :
//  - TNS (gérant majoritaire EURL/SARL) : plafond dit « Madelin retraite », porté depuis 2019 par le
//    PER individuel (compartiment 1) — formule spécifique aux indépendants, nettement plus généreuse
//    que celle des salariés, prenant en compte le bénéfice professionnel.
//  - Assimilé salarié (SASU/SAS) et, plus généralement, tout revenu salarié : plafond PER individuel
//    « classique », 10% du revenu professionnel net N-1 (plafonné à 8×PASS), avec un plancher de 10%
//    du PASS. Généralement financé sur les fonds propres du dirigeant (revenu net personnel), pas par
//    la société.
//
// Simplifications assumées (cf. taxRules.ts pour le détail sourcé) :
//  - Le report des plafonds non utilisés des 3 années précédentes (« plafond disponible cumulé ») est
//    modélisé via une saisie directe du montant cumulé non utilisé (plafondNonUtiliseAnneesPrecedentes),
//    sans reconstituer le détail année par année.
//  - Pour le TNS, le versement est modélisé comme pris en charge par la société (charge déductible du
//    résultat, à l'image de la cotisation Madelin retraite réellement payée par la société pour le
//    compte du gérant) ; pour l'assimilé salarié, le versement est modélisé comme financé
//    personnellement (déduit directement du revenu imposable du foyer), cas le plus courant pour un
//    PER individuel classique côté salarié.

import { type DirigeantStatus, getCompanyType, resolveDirigeantStatus, type ImpositionSociete } from "./companyTypes";
import { type CompanyTaxContext, computeEconomieImpotSociete } from "./corporateTax";
import { type PersonalTaxProfile, createDefaultPersonalTaxProfile, resolvePersonalTaxProfile } from "./frenchIncomeTax";
import { PASS_2026 } from "./pass";

export const RETRAITE_TNS_TAUX_BASE = 0.1; // 10% du bénéfice imposable (plafonné à 8×PASS)
export const RETRAITE_TNS_TAUX_COMPLEMENTAIRE = 0.15; // 15% additionnels sur la tranche 1×PASS à 8×PASS
export const RETRAITE_TNS_PLAFOND_PLANCHER_TAUX_PASS = 0.1; // plancher : 10% du PASS, même si bénéfice faible/nul
export const RETRAITE_TNS_MULTIPLE_PASS_MAX = 8;

export const RETRAITE_SALARIE_TAUX = 0.1; // 10% du revenu professionnel net N-1
export const RETRAITE_SALARIE_PLANCHER_TAUX_PASS = 0.1; // plancher : 10% du PASS
export const RETRAITE_SALARIE_MULTIPLE_PASS_MAX = 8; // plafond : 10% de 8×PASS

// Comparaison indicative PER vs assurance-vie : taux forfaitaire appliqué à la plus-value latente à la
// sortie. Simplification volontaire — l'assurance-vie bénéficie en réalité, après 8 ans de détention,
// d'un abattement annuel (4 600€ personne seule / 9 200€ couple) puis d'un taux réduit à 7,5% (+ 17,2%
// de prélèvements sociaux) sur les gains restants pour les encours <150k€ ; avant 8 ans ou au-delà de ce
// seuil, le PFU de 30% s'applique. Le PER, à la sortie en capital, taxe la part correspondant aux
// versements déduits au barème de l'IR (sans abattement) et la plus-value au PFU. Un flat 30% sur les
// gains est retenu ici comme approximation raisonnable pour comparer les deux enveloppes.
export const PFU_TAUX_GAINS = 0.3;

// Estimation de rente viagère : table de conversion indicative (taux de conversion annuel du capital),
// fonction de l'âge de départ. Les taux réels varient fortement selon l'assureur, la table de mortalité
// utilisée, le sexe et les options choisies (réversion, annuités garanties) — à ne considérer que comme
// un ordre de grandeur.
export const RENTE_VIAGERE_TABLE_CONVERSION: { ageMin: number; tauxAnnuel: number }[] = [
  { ageMin: 60, tauxAnnuel: 0.035 },
  { ageMin: 62, tauxAnnuel: 0.038 },
  { ageMin: 64, tauxAnnuel: 0.041 },
  { ageMin: 65, tauxAnnuel: 0.043 },
  { ageMin: 67, tauxAnnuel: 0.046 },
  { ageMin: 70, tauxAnnuel: 0.052 },
  { ageMin: 75, tauxAnnuel: 0.062 },
];

export function tauxConversionRenteViagere(age: number): number {
  let taux = RENTE_VIAGERE_TABLE_CONVERSION[0].tauxAnnuel;
  for (const palier of RENTE_VIAGERE_TABLE_CONVERSION) {
    if (age >= palier.ageMin) taux = palier.tauxAnnuel;
  }
  return taux;
}

export interface RetraiteInputs {
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

  versementAnnuel: number; // montant versé sur le PER individuel / Madelin retraite

  // Assimilé salarié uniquement : revenu professionnel net N-1, base du plafond PER classique.
  revenuNetImposableN1: number;

  // Report des plafonds non utilisés des 3 années précédentes (somme cumulée saisie directement,
  // par simplification — le détail année par année n'est pas reconstitué ici).
  plafondNonUtiliseAnneesPrecedentes: number;

  // Projection du capital & rente viagère.
  ageActuel: number;
  ageDepartRetraite: number;
  tauxRendementAnnuelProjection: number; // 0-1, hypothèse de rendement net de frais de gestion

  personalTaxProfile: PersonalTaxProfile;
}

export function createDefaultRetraiteInputs(): RetraiteInputs {
  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation retraite",
    createdAt: new Date().toISOString(),
    country: "FR",
    companyType: "EURL",
    gerantMajoritaire: true,
    impositionSociete: "IS",
    corporateTaxRate: 0.25,
    eligibleTauxReduitPME: true,
    beneficeAvantChargePrevisionnel: 40000,
    versementAnnuel: 4000,
    revenuNetImposableN1: 40000,
    plafondNonUtiliseAnneesPrecedentes: 0,
    ageActuel: 45,
    ageDepartRetraite: 64,
    tauxRendementAnnuelProjection: 0.03,
    personalTaxProfile: createDefaultPersonalTaxProfile(),
  };
}

export interface RetraiteResults {
  dirigeantStatus: DirigeantStatus;
  plafondDeduction: number;
  versementDeductible: number;
  versementNonDeductible: number;
  economieImpotSociete: number; // TNS uniquement (versement pris en charge par la société)
  economieImpotDirigeant: number; // assimilé salarié uniquement (versement personnel)
  coutNetGlobal: number; // versementAnnuel − (economieImpotSociete + economieImpotDirigeant)
  tauxEconomieGlobal: number; // 1 − coutNetGlobal / versementAnnuel
  /** Détail du calcul, dans l'ordre d'affichage — qui paie quoi et où se réalise l'économie
   * d'impôt (société pour un TNS, dirigeant/IR pour un assimilé salarié). */
  detail: { label: string; value: number }[];

  // Report des plafonds non utilisés des 3 années précédentes.
  plafondDeductionAvecReport: number;
  versementDeductibleAvecReport: number;
  economieSupplementaireGraceAuReport: number; // gain d'économie d'impôt permis par le report, à versement identique

  // Projection du capital sur la durée jusqu'au départ à la retraite (versement annuel constant,
  // rendement composé constant — hypothèses simplificatrices, cf. note de module).
  dureeProjectionAnnees: number;
  projectionCapital: { year: number; age: number; versementsCumules: number; capitalBrut: number }[];
  capitalBrutFinalProjete: number;
  versementsCumulesFinal: number;
  plusValueLatenteFinale: number;

  // Comparaison PER vs assurance-vie, à effort d'épargne brut identique sur la même durée.
  comparaisonAssuranceVie: {
    perCapitalNetApresImpot: number;
    assuranceVieCapitalNetApresImpot: number;
    ecartEnFaveurPER: number; // positif = le PER est plus avantageux net d'impôt
  };

  // Estimation de rente viagère à partir du capital brut final projeté.
  renteViagereTauxConversion: number;
  renteViagereAnnuelleEstimee: number;
  renteViagereMensuelleEstimee: number;
}

export function computeRetraite(inputs: RetraiteInputs): RetraiteResults {
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);
  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  const tauxIRUtilise = resolvedTax.tauxUtilise;
  const ctx: CompanyTaxContext = inputs;

  // --- Projection du capital jusqu'au départ à la retraite (versement annuel constant, rendement
  // composé constant) — commune aux deux statuts, ne dépend que du montant versé et des hypothèses de
  // durée/rendement.
  const dureeProjectionAnnees = Math.max(0, Math.round(inputs.ageDepartRetraite - inputs.ageActuel));
  const versementAnnuel = Math.max(0, inputs.versementAnnuel);
  const projectionCapital: RetraiteResults["projectionCapital"] = [];
  let capitalBrut = 0;
  let versementsCumules = 0;
  for (let year = 1; year <= dureeProjectionAnnees; year++) {
    capitalBrut = capitalBrut * (1 + inputs.tauxRendementAnnuelProjection) + versementAnnuel;
    versementsCumules += versementAnnuel;
    projectionCapital.push({ year, age: inputs.ageActuel + year, versementsCumules, capitalBrut });
  }
  const capitalBrutFinalProjete = capitalBrut;
  const versementsCumulesFinal = versementsCumules;
  const plusValueLatenteFinale = Math.max(0, capitalBrutFinalProjete - versementsCumulesFinal);

  // --- Comparaison PER vs assurance-vie : même effort d'épargne brut annuel, exit taxation
  // approximée (cf. note de constante PFU_TAUX_GAINS pour les simplifications assumées).
  const perCapitalNetApresImpot =
    capitalBrutFinalProjete - versementsCumulesFinal * tauxIRUtilise - plusValueLatenteFinale * PFU_TAUX_GAINS;
  const assuranceVieCapitalNetApresImpot = capitalBrutFinalProjete - plusValueLatenteFinale * PFU_TAUX_GAINS;
  const comparaisonAssuranceVie = {
    perCapitalNetApresImpot,
    assuranceVieCapitalNetApresImpot,
    ecartEnFaveurPER: perCapitalNetApresImpot - assuranceVieCapitalNetApresImpot,
  };

  // --- Estimation de rente viagère à partir du capital brut final projeté.
  const renteViagereTauxConversion = tauxConversionRenteViagere(inputs.ageDepartRetraite);
  const renteViagereAnnuelleEstimee = capitalBrutFinalProjete * renteViagereTauxConversion;
  const renteViagereMensuelleEstimee = renteViagereAnnuelleEstimee / 12;

  const projectionExtras = {
    dureeProjectionAnnees,
    projectionCapital,
    capitalBrutFinalProjete,
    versementsCumulesFinal,
    plusValueLatenteFinale,
    comparaisonAssuranceVie,
    renteViagereTauxConversion,
    renteViagereAnnuelleEstimee,
    renteViagereMensuelleEstimee,
  };

  if (dirigeantStatus === "TNS") {
    const beneficePlafonne = Math.min(
      Math.max(0, inputs.beneficeAvantChargePrevisionnel),
      RETRAITE_TNS_MULTIPLE_PASS_MAX * PASS_2026,
    );
    const trancheComplementaire = Math.max(0, beneficePlafonne - PASS_2026);
    const plafondDeduction = Math.max(
      RETRAITE_TNS_PLAFOND_PLANCHER_TAUX_PASS * PASS_2026,
      RETRAITE_TNS_TAUX_BASE * beneficePlafonne + RETRAITE_TNS_TAUX_COMPLEMENTAIRE * trancheComplementaire,
    );
    const versementDeductible = Math.min(inputs.versementAnnuel, plafondDeduction);
    const versementNonDeductible = inputs.versementAnnuel - versementDeductible;

    // Modélisé comme pris en charge par la société (cf. note de module).
    const economieImpotSociete = computeEconomieImpotSociete(ctx, versementDeductible, tauxIRUtilise);
    const coutNetGlobal = inputs.versementAnnuel - economieImpotSociete;

    const plafondDeductionAvecReport = plafondDeduction + Math.max(0, inputs.plafondNonUtiliseAnneesPrecedentes);
    const versementDeductibleAvecReport = Math.min(inputs.versementAnnuel, plafondDeductionAvecReport);
    const economieSupplementaireGraceAuReport = computeEconomieImpotSociete(
      ctx,
      versementDeductibleAvecReport - versementDeductible,
      tauxIRUtilise,
    );

    return {
      dirigeantStatus,
      plafondDeduction,
      versementDeductible,
      versementNonDeductible,
      economieImpotSociete,
      economieImpotDirigeant: 0,
      coutNetGlobal,
      tauxEconomieGlobal: inputs.versementAnnuel > 0 ? 1 - coutNetGlobal / inputs.versementAnnuel : 0,
      detail: [
        { label: "Versement annuel (pris en charge par la société)", value: inputs.versementAnnuel },
        { label: "dont déductible du résultat société (plafond Madelin)", value: versementDeductible },
        ...(versementNonDeductible > 0
          ? [{ label: "dont NON déductible (au-delà du plafond)", value: versementNonDeductible }]
          : []),
        { label: "− Économie d'impôt société (sur la part déductible)", value: -economieImpotSociete },
        { label: "= Coût net société", value: coutNetGlobal },
        { label: "Coût net dirigeant (aucun décaissement personnel)", value: 0 },
        { label: "= Coût net global", value: coutNetGlobal },
      ],
      plafondDeductionAvecReport,
      versementDeductibleAvecReport,
      economieSupplementaireGraceAuReport,
      ...projectionExtras,
    };
  }

  // Assimilé salarié : plafond PER individuel classique.
  const revenuPlafonne = Math.min(Math.max(0, inputs.revenuNetImposableN1), RETRAITE_SALARIE_MULTIPLE_PASS_MAX * PASS_2026);
  const plafondDeduction = Math.max(
    RETRAITE_SALARIE_PLANCHER_TAUX_PASS * PASS_2026,
    RETRAITE_SALARIE_TAUX * revenuPlafonne,
  );
  const versementDeductible = Math.min(inputs.versementAnnuel, plafondDeduction);
  const versementNonDeductible = inputs.versementAnnuel - versementDeductible;

  // Modélisé comme financé personnellement (cf. note de module) : déduit directement du revenu
  // imposable du foyer, pas de charge société.
  const economieImpotDirigeant = versementDeductible * tauxIRUtilise;
  const coutNetGlobal = inputs.versementAnnuel - economieImpotDirigeant;

  const plafondDeductionAvecReport = plafondDeduction + Math.max(0, inputs.plafondNonUtiliseAnneesPrecedentes);
  const versementDeductibleAvecReport = Math.min(inputs.versementAnnuel, plafondDeductionAvecReport);
  const economieSupplementaireGraceAuReport = (versementDeductibleAvecReport - versementDeductible) * tauxIRUtilise;

  return {
    dirigeantStatus,
    plafondDeduction,
    versementDeductible,
    versementNonDeductible,
    economieImpotSociete: 0,
    economieImpotDirigeant,
    coutNetGlobal,
    tauxEconomieGlobal: inputs.versementAnnuel > 0 ? 1 - coutNetGlobal / inputs.versementAnnuel : 0,
    detail: [
      { label: "Versement annuel (financé personnellement par le dirigeant)", value: inputs.versementAnnuel },
      { label: "dont déductible du revenu imposable (plafond PER)", value: versementDeductible },
      ...(versementNonDeductible > 0
        ? [{ label: "dont NON déductible (au-delà du plafond)", value: versementNonDeductible }]
        : []),
      { label: "− Économie d'impôt (IR) sur la part déductible", value: -economieImpotDirigeant },
      { label: "= Coût net dirigeant", value: coutNetGlobal },
      { label: "Coût net société (aucune charge société)", value: 0 },
      { label: "= Coût net global", value: coutNetGlobal },
    ],
    plafondDeductionAvecReport,
    versementDeductibleAvecReport,
    economieSupplementaireGraceAuReport,
    ...projectionExtras,
  };
}
