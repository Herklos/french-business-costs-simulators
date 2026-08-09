// Simulateur : indemnité d'occupation du domicile personnel par la société
// (bureau professionnel installé chez le dirigeant, domicile non loué par la société).
//
// Principe : la société verse au dirigeant une indemnité d'occupation correspondant à la
// quote-part (surface bureau / surface totale) d'un loyer de marché + charges. Cette
// indemnité est déductible du résultat de la société et constitue un revenu foncier
// imposable pour le dirigeant (régime micro-foncier ou réel), soumis en outre aux
// prélèvements sociaux sur revenus du patrimoine (17,2 %).

import type { ImpositionSociete } from "./companyTypes";
import { type PersonalTaxProfile, createDefaultPersonalTaxProfile, resolvePersonalTaxProfile } from "./frenchIncomeTax";

export const PRELEVEMENTS_SOCIAUX_FONCIER = 0.172;
export const ABATTEMENT_MICRO_FONCIER = 0.3;
export const PLAFOND_MICRO_FONCIER = 15000;

export type RegimeFoncier = "micro" | "reel";
export type StatutOccupant = "locataire" | "proprietaire";

/**
 * Deux façons de formaliser la mise à disposition, avec le même traitement fiscal de fond (revenu
 * foncier pour le dirigeant, charge déductible pour la société) mais une robustesse juridique
 * différente :
 *  - "indemnite" : simple convention de mise à disposition / indemnité d'occupation — souple mais
 *    plus exposée en cas de contrôle si le montant ou la réalité de l'usage professionnel est mal
 *    documenté.
 *  - "bail_professionnel" : bail professionnel ou commercial réel entre le dirigeant (bailleur) et
 *    la société (preneuse) sur la pièce dédiée — plus robuste juridiquement (droits/obligations
 *    formalisés), au prix de frais de mise en place (rédaction, enregistrement).
 */
export type Formalisation = "indemnite" | "bail_professionnel";

export interface HomeOfficeInputs {
  id: string;
  name: string;
  createdAt: string;

  country: string;
  impositionSociete: ImpositionSociete;
  corporateTaxRate: number;

  statutOccupant: StatutOccupant;
  surfaceTotaleM2: number;
  surfaceBureauM2: number;

  // Si locataire : loyer réel payé. Si propriétaire : valeur locative de marché estimée.
  loyerOuValeurLocativeMensuel: number;
  chargesAnnuelles: number; // chauffage, électricité, assurance habitation, taxe foncière, entretien...

  regimeFoncier: RegimeFoncier; // micro-foncier (abattement 30%) ou réel (charges réelles déduites)
  autresRevenusFonciersFoyer: number; // pour vérifier le plafond micro-foncier (15 000 €)

  formalisation: Formalisation; // indemnité d'occupation (souple) ou bail professionnel réel (plus robuste)
  fraisMiseEnPlaceBail: number; // coût ponctuel (rédaction, enregistrement) si bail professionnel — 0 sinon

  personalTaxProfile: PersonalTaxProfile;

  // Comparaison : location d'un bureau externe équivalent
  loyerBureauExterneMensuel: number;
}

export function createDefaultHomeOfficeInputs(): HomeOfficeInputs {
  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation bureau",
    createdAt: new Date().toISOString(),
    country: "FR",
    impositionSociete: "IS",
    corporateTaxRate: 0.25,
    statutOccupant: "proprietaire",
    surfaceTotaleM2: 80,
    surfaceBureauM2: 12,
    loyerOuValeurLocativeMensuel: 900,
    chargesAnnuelles: 2400,
    regimeFoncier: "micro",
    autresRevenusFonciersFoyer: 0,
    formalisation: "indemnite",
    fraisMiseEnPlaceBail: 0,
    personalTaxProfile: createDefaultPersonalTaxProfile(),
    loyerBureauExterneMensuel: 350,
  };
}

export interface HomeOfficeResults {
  quotePartSurface: number;
  indemniteAnnuelleBrute: number;

  eligibleMicroFoncier: boolean;
  baseImposableFonciere: number;
  abattementApplique: number;

  tauxIRUtilise: number;
  irDu: number;
  prelevementsSociaux: number;
  coutFiscalGerant: number;
  gainNetGerant: number; // gain annuel récurrent (hors frais ponctuels de mise en place)
  gainNetGerantAnnee1: number; // gain de la 1ère année, net des frais ponctuels de mise en place du bail le cas échéant

  economieImpotSociete: number; // économie d'IS (ou d'IR foyer en régime translucide) sur la charge déductible
  coutNetSociete: number;

  coutBureauExterneAnnuel: number;
  economieVsBureauExterne: number; // positif = le bureau à domicile coûte moins cher à la société
}

export function computeHomeOffice(inputs: HomeOfficeInputs): HomeOfficeResults {
  const quotePartSurface =
    inputs.surfaceTotaleM2 > 0 ? Math.min(1, inputs.surfaceBureauM2 / inputs.surfaceTotaleM2) : 0;

  const baseAnnuelle = inputs.loyerOuValeurLocativeMensuel * 12 + inputs.chargesAnnuelles;
  const indemniteAnnuelleBrute = baseAnnuelle * quotePartSurface;

  const totalRevenusFonciers = indemniteAnnuelleBrute + inputs.autresRevenusFonciersFoyer;
  const eligibleMicroFoncier = totalRevenusFonciers <= PLAFOND_MICRO_FONCIER;

  const regimeEffectif = inputs.regimeFoncier === "micro" && !eligibleMicroFoncier ? "reel" : inputs.regimeFoncier;

  let baseImposableFonciere: number;
  let abattementApplique = 0;
  if (regimeEffectif === "micro") {
    abattementApplique = indemniteAnnuelleBrute * ABATTEMENT_MICRO_FONCIER;
    baseImposableFonciere = indemniteAnnuelleBrute - abattementApplique;
  } else {
    // Régime réel : les charges (déjà intégrées dans l'indemnité au prorata) sont déduites explicitement.
    const chargesDeductibles = inputs.chargesAnnuelles * quotePartSurface;
    abattementApplique = chargesDeductibles;
    baseImposableFonciere = Math.max(0, indemniteAnnuelleBrute - chargesDeductibles);
  }

  const resolvedTax = resolvePersonalTaxProfile(inputs.personalTaxProfile);
  const tauxIRUtilise = resolvedTax.tauxUtilise;

  const irDu = baseImposableFonciere * tauxIRUtilise;
  const prelevementsSociaux = baseImposableFonciere * PRELEVEMENTS_SOCIAUX_FONCIER;
  const coutFiscalGerant = irDu + prelevementsSociaux;
  const gainNetGerant = indemniteAnnuelleBrute - coutFiscalGerant;
  const fraisMiseEnPlace = inputs.formalisation === "bail_professionnel" ? inputs.fraisMiseEnPlaceBail : 0;
  const gainNetGerantAnnee1 = gainNetGerant - fraisMiseEnPlace;

  const tauxEconomie = inputs.impositionSociete === "IS" ? inputs.corporateTaxRate : tauxIRUtilise;
  const economieImpotSociete = indemniteAnnuelleBrute * tauxEconomie;
  const coutNetSociete = indemniteAnnuelleBrute - economieImpotSociete;

  const coutBureauExterneAnnuel = inputs.loyerBureauExterneMensuel * 12;
  const economieVsBureauExterne = coutBureauExterneAnnuel - coutNetSociete;

  return {
    quotePartSurface,
    indemniteAnnuelleBrute,
    eligibleMicroFoncier,
    baseImposableFonciere,
    abattementApplique,
    tauxIRUtilise,
    irDu,
    prelevementsSociaux,
    coutFiscalGerant,
    gainNetGerant,
    gainNetGerantAnnee1,
    economieImpotSociete,
    coutNetSociete,
    coutBureauExterneAnnuel,
    economieVsBureauExterne,
  };
}
