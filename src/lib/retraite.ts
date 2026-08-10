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
//  - Aucun report des plafonds non utilisés des 3 années précédentes (« plafond disponible cumulé »),
//    alors qu'il existe réellement et peut sensiblement augmenter la capacité de déduction — chiffré
//    ici sur la seule année en cours, par simplification.
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
}

export function computeRetraite(inputs: RetraiteInputs): RetraiteResults {
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);
  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  const tauxIRUtilise = resolvedTax.tauxUtilise;
  const ctx: CompanyTaxContext = inputs;

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

    return {
      dirigeantStatus,
      plafondDeduction,
      versementDeductible,
      versementNonDeductible,
      economieImpotSociete,
      economieImpotDirigeant: 0,
      coutNetGlobal,
      tauxEconomieGlobal: inputs.versementAnnuel > 0 ? 1 - coutNetGlobal / inputs.versementAnnuel : 0,
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

  return {
    dirigeantStatus,
    plafondDeduction,
    versementDeductible,
    versementNonDeductible,
    economieImpotSociete: 0,
    economieImpotDirigeant,
    coutNetGlobal,
    tauxEconomieGlobal: inputs.versementAnnuel > 0 ? 1 - coutNetGlobal / inputs.versementAnnuel : 0,
  };
}
