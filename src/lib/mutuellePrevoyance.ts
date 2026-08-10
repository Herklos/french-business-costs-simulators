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
// Simplifications assumées (cf. taxRules.ts pour le détail sourcé) :
//  - Les plafonds Madelin et d'exonération collective sont appliqués sur l'année en cours, sans
//    tenir compte d'un éventuel report de plafond non utilisé les années précédentes.
//  - Pour l'assimilé salarié, la fraction excédentaire réintégrée est simplifiée à son seul coût IR
//    (au taux marginal du foyer) : les cotisations sociales salariales/patronales supplémentaires
//    qu'elle générerait en réalité (comme pour un complément de salaire) ne sont pas chiffrées ici —
//    un avertissement est affiché côté UI en cas de dépassement.

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

export const PART_PATRONALE_MINIMALE_POURCENT = 50; // obligation légale ANI

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

  cotisationAnnuelle: number; // budget santé + prévoyance envisagé, tous statuts confondus

  // TNS uniquement : qui paie les cotisations Madelin ?
  priseEnChargeParLaSociete: boolean;

  // Assimilé salarié uniquement :
  partPatronalePourcent: number; // % de cotisationAnnuelle pris en charge par l'employeur
  salaireBrutAnnuelReference: number; // pour le plafond d'exonération collectif (6%PASS + 1,5%brut)

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
    priseEnChargeParLaSociete: true,
    partPatronalePourcent: PART_PATRONALE_MINIMALE_POURCENT,
    salaireBrutAnnuelReference: 45000,
    personalTaxProfile: createDefaultPersonalTaxProfile(),
  };
}

export interface MutuellePrevoyanceResults {
  dirigeantStatus: DirigeantStatus;

  // TNS
  plafondMadelin: number; // 0 si assimilé salarié
  cotisationDeductibleTNS: number;
  cotisationNonDeductibleTNS: number;

  // Assimilé salarié
  partPatronale: number;
  partSalariale: number;
  plafondExonerationSociale: number; // 0 si TNS
  montantExonere: number;
  montantExcedentaire: number;

  // Communs
  economieImpotSociete: number;
  coutNetSociete: number;
  economieImpotDirigeant: number;
  coutNetDirigeant: number;
  coutNetGlobal: number; // = coutNetSociete + coutNetDirigeant
  tauxEconomieGlobal: number; // 1 − coutNetGlobal/cotisationAnnuelle
}

export function computeMutuellePrevoyance(inputs: MutuellePrevoyanceInputs): MutuellePrevoyanceResults {
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);
  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  const tauxIRUtilise = resolvedTax.tauxUtilise;
  const ctx: CompanyTaxContext = inputs;

  if (dirigeantStatus === "TNS") {
    const plafondMadelin = Math.min(
      MADELIN_TAUX_PASS * PASS_2026 + MADELIN_TAUX_BENEFICE * Math.max(0, inputs.beneficeAvantChargePrevisionnel),
      MADELIN_PLAFOND_MAX_TAUX_PASS * MADELIN_PLAFOND_MAX_MULTIPLE_PASS * PASS_2026,
    );
    const cotisationDeductibleTNS = Math.min(inputs.cotisationAnnuelle, plafondMadelin);
    const cotisationNonDeductibleTNS = inputs.cotisationAnnuelle - cotisationDeductibleTNS;

    const economieImpotSociete = inputs.priseEnChargeParLaSociete
      ? computeEconomieImpotSociete(ctx, cotisationDeductibleTNS, tauxIRUtilise)
      : 0;
    const economieImpotDirigeant = inputs.priseEnChargeParLaSociete ? 0 : cotisationDeductibleTNS * tauxIRUtilise;
    const coutNetSociete = inputs.priseEnChargeParLaSociete ? inputs.cotisationAnnuelle - economieImpotSociete : 0;
    const coutNetDirigeant = inputs.priseEnChargeParLaSociete ? 0 : inputs.cotisationAnnuelle - economieImpotDirigeant;
    const coutNetGlobal = coutNetSociete + coutNetDirigeant;

    return {
      dirigeantStatus,
      plafondMadelin,
      cotisationDeductibleTNS,
      cotisationNonDeductibleTNS,
      partPatronale: 0,
      partSalariale: 0,
      plafondExonerationSociale: 0,
      montantExonere: 0,
      montantExcedentaire: 0,
      economieImpotSociete,
      coutNetSociete,
      economieImpotDirigeant,
      coutNetDirigeant,
      coutNetGlobal,
      tauxEconomieGlobal: inputs.cotisationAnnuelle > 0 ? 1 - coutNetGlobal / inputs.cotisationAnnuelle : 0,
    };
  }

  // Assimilé salarié
  const ratioPatronal = Math.min(Math.max(inputs.partPatronalePourcent, 0), 100) / 100;
  const partPatronale = inputs.cotisationAnnuelle * ratioPatronal;
  const partSalariale = inputs.cotisationAnnuelle - partPatronale;

  const plafondExonerationSociale = Math.min(
    EXONERATION_COLLECTIVE_TAUX_PASS * PASS_2026 + EXONERATION_COLLECTIVE_TAUX_BRUT * Math.max(0, inputs.salaireBrutAnnuelReference),
    EXONERATION_COLLECTIVE_PLAFOND_MAX_TAUX_PASS * PASS_2026,
  );
  const montantExonere = Math.min(inputs.cotisationAnnuelle, plafondExonerationSociale);
  const montantExcedentaire = Math.max(0, inputs.cotisationAnnuelle - montantExonere);

  // La part patronale reste toujours déductible du résultat société (charge sociale), quel que soit
  // le dépassement du plafond d'exonération (qui ne concerne que le traitement social/IR côté salarié).
  const economieImpotSociete = computeEconomieImpotSociete(ctx, partPatronale, tauxIRUtilise);
  const coutNetSociete = partPatronale - economieImpotSociete;

  const irSurExcedent = montantExcedentaire * tauxIRUtilise;
  const economieImpotDirigeant = 0; // aucune déduction personnelle ; l'excédent est au contraire imposé (irSurExcedent)
  const coutNetDirigeant = partSalariale + irSurExcedent;
  const coutNetGlobal = coutNetSociete + coutNetDirigeant;

  return {
    dirigeantStatus,
    plafondMadelin: 0,
    cotisationDeductibleTNS: 0,
    cotisationNonDeductibleTNS: 0,
    partPatronale,
    partSalariale,
    plafondExonerationSociale,
    montantExonere,
    montantExcedentaire,
    economieImpotSociete,
    coutNetSociete,
    economieImpotDirigeant,
    coutNetDirigeant,
    coutNetGlobal,
    tauxEconomieGlobal: inputs.cotisationAnnuelle > 0 ? 1 - coutNetGlobal / inputs.cotisationAnnuelle : 0,
  };
}
