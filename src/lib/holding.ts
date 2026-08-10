// Simulateur : holding / montage patrimonial (régime mère-fille).
//
// Principe : au lieu de faire remonter les dividendes de la société opérationnelle (« la fille »)
// directement au dirigeant personne physique, on interpose une société holding (« la mère ») qui
// détient les titres de la fille. Les dividendes remontent alors de la fille vers la holding, puis
// restent capitalisés dans la holding (réinvestissement, acquisition d'autres actifs...) sans
// frottement fiscal immédiat côté dirigeant — contrairement à une distribution directe, taxée au
// prélèvement forfaitaire unique (PFU) dès l'année de versement.
//
// Régime mère-fille (art. 145, 216 CGI) : si la holding détient ≥5% du capital de la fille depuis
// ≥2 ans, les dividendes reçus sont exonérés d'IS à 95% — seule une quote-part de frais et charges
// (QPFC) de 5% du dividende brut est réintégrée au résultat imposable de la holding et taxée à l'IS.
// Coût réel très faible (5% × taux d'IS, soit ≈1,25% du dividende à 25% d'IS) comparé à une taxation
// personnelle immédiate au PFU de 30%.
//
// Intégration fiscale (art. 223 A et suiv. CGI) : régime DISTINCT du mère-fille, optionnel, qui
// exige une détention ≥95% (vs ≥5%) et permet en plus de compenser les résultats (bénéfices et
// déficits) de toutes les sociétés du groupe au niveau de la holding tête de groupe — non modélisé
// ici (nécessiterait de chiffrer un déficit dans une autre filiale, hors du champ de ce simulateur
// à deux sociétés). Seul un effet directement chiffrable est repris : depuis la loi de finances pour
// 2016 (mise en conformité avec la jurisprudence Steria de la CJUE), les dividendes versés au sein
// d'un groupe intégré ne sont plus totalement neutralisés, mais bénéficient en compensation d'une
// QPFC réduite à 1% (au lieu de 5%) sur le régime mère-fille — art. 216, I CGI.
//
// Ce que ce simulateur compare, sur une durée de projection donnée, à dividende annuel identique
// versé par la fille :
//  - "Sans holding" : distribution directe au dirigeant, PFU 30% immédiat chaque année, puis
//    réinvestissement personnel du net (également taxé au PFU chaque année sur son propre rendement,
//    hypothèse symétrique).
//  - "Avec holding" : le dividende net de QPFC/IS reste capitalisé dans la holding, dont le rendement
//    de réinvestissement est lui-même soumis à l'IS chaque année (une holding est une société
//    normalement imposable à l'IS sur l'ensemble de ses revenus, y compris financiers) ; à la fin de
//    la projection, une distribution finale unique du capital accumulé au dirigeant est taxée au PFU.
//
// Simplifications majeures assumées (cf. taxRules.ts pour le détail sourcé) :
//  - Le PFU de 30% (12,8% IR + 17,2% PS) est retenu comme taux flat de sortie, sans option pour le
//    barème progressif + abattement de 40% (parfois plus avantageux pour un foyer faiblement imposé).
//  - Aucune stratégie de sortie optimisée n'est modélisée (apport-cession avec réinvestissement
//    remployé sous 2 ans — art. 150-0 B ter CGI —, transmission par donation avec purge de la
//    plus-value, ou conservation jusqu'au décès avec effacement de la plus-value latente). Ces
//    montages peuvent réduire drastiquement, voire annuler, le coût de sortie mais sont hors du champ
//    de ce simulateur pédagogique — se rapprocher d'un avocat fiscaliste pour une stratégie réelle.
//  - Frais de structure (comptabilité, gestion de la holding) non modélisés.

import { computeIS } from "./corporateTax";

export const QUOTE_PART_FRAIS_ET_CHARGES_MERE_FILLE = 0.05; // art. 216 CGI
export const SEUIL_DETENTION_MERE_FILLE_POURCENT = 5; // art. 145 CGI
export const DUREE_DETENTION_MINIMALE_MERE_FILLE_ANNEES = 2; // art. 145 CGI
export const PFU_TAUX_DIVIDENDES = 0.3; // 12,8% IR + 17,2% PS, art. 200 A CGI

export const QUOTE_PART_FRAIS_ET_CHARGES_INTEGRATION_FISCALE = 0.01; // art. 216, I CGI, depuis LF2016
export const SEUIL_DETENTION_INTEGRATION_FISCALE_POURCENT = 95; // art. 223 A CGI
export const DUREE_DETENTION_MINIMALE_INTEGRATION_FISCALE_ANNEES = 2; // même condition de durée que le régime mère-fille (simplification)

export interface HoldingInputs {
  id: string;
  name: string;
  createdAt: string;

  country: string;
  corporateTaxRateHolding: number;
  eligibleTauxReduitPMEHolding: boolean;

  dividendeAnnuelFiliale: number; // dividende annuel versé par la filiale opérationnelle
  tauxDetentionFilialePourcent: number; // 0-100, part du capital de la fille détenue par la holding
  dureeDetentionFilialeAnnees: number; // ancienneté de la détention des titres

  dureeProjectionAnnees: number;
  tauxRendementReinvestissement: number; // 0-1, rendement annuel du capital réinvesti dans la holding (ou par le dirigeant sans holding)
}

export function createDefaultHoldingInputs(): HoldingInputs {
  return {
    id: crypto.randomUUID(),
    name: "Nouvelle simulation holding",
    createdAt: new Date().toISOString(),
    country: "FR",
    corporateTaxRateHolding: 0.25,
    eligibleTauxReduitPMEHolding: true,
    dividendeAnnuelFiliale: 50000,
    tauxDetentionFilialePourcent: 100,
    dureeDetentionFilialeAnnees: 3,
    dureeProjectionAnnees: 10,
    tauxRendementReinvestissement: 0.04,
  };
}

export interface HoldingResults {
  eligibleRegimeMereFille: boolean;
  eligibleIntegrationFiscale: boolean; // détention ≥95% : QPFC réduite à 1% au lieu de 5%

  // Coût du régime mère-fille sur le dividende de l'année 1 (indicatif, avant capitalisation).
  baseImposableIS: number; // QPFC (1% si intégration fiscale, 5% si mère-fille) si éligible, dividende brut entier sinon
  coutISAnnee1: number;
  netCapitaliseHoldingAnnee1: number;
  netDistributionDirecteAnnee1: number; // sans holding : dividende net de PFU, versé directement

  // Projection sur la durée choisie.
  dureeProjectionAnnees: number;
  projection: { year: number; capitalHolding: number; capitalDirectPersonnel: number }[];
  capitalHoldingFinalBrut: number;
  capitalDirectPersonnelFinal: number;

  // Sortie finale : distribution en une fois du capital accumulé dans la holding au dirigeant.
  coutSortieFinaleHolding: number;
  capitalHoldingFinalNetApresSortie: number;

  ecartEnFaveurHolding: number; // capitalHoldingFinalNetApresSortie − capitalDirectPersonnelFinal
}

export function computeHolding(inputs: HoldingInputs): HoldingResults {
  const eligibleRegimeMereFille =
    inputs.tauxDetentionFilialePourcent >= SEUIL_DETENTION_MERE_FILLE_POURCENT &&
    inputs.dureeDetentionFilialeAnnees >= DUREE_DETENTION_MINIMALE_MERE_FILLE_ANNEES;
  const eligibleIntegrationFiscale =
    inputs.tauxDetentionFilialePourcent >= SEUIL_DETENTION_INTEGRATION_FISCALE_POURCENT &&
    inputs.dureeDetentionFilialeAnnees >= DUREE_DETENTION_MINIMALE_INTEGRATION_FISCALE_ANNEES;

  const dividendeAnnuel = Math.max(0, inputs.dividendeAnnuelFiliale);
  const quotePartApplicable = eligibleIntegrationFiscale
    ? QUOTE_PART_FRAIS_ET_CHARGES_INTEGRATION_FISCALE
    : QUOTE_PART_FRAIS_ET_CHARGES_MERE_FILLE;
  const baseImposableIS = eligibleRegimeMereFille ? dividendeAnnuel * quotePartApplicable : dividendeAnnuel;
  const coutISAnnee1 = computeIS(baseImposableIS, inputs.eligibleTauxReduitPMEHolding, inputs.corporateTaxRateHolding);
  const netCapitaliseHoldingAnnee1 = dividendeAnnuel - coutISAnnee1;
  const netDistributionDirecteAnnee1 = dividendeAnnuel * (1 - PFU_TAUX_DIVIDENDES);

  const dureeProjectionAnnees = Math.max(0, Math.round(inputs.dureeProjectionAnnees));
  const r = inputs.tauxRendementReinvestissement;
  const projection: HoldingResults["projection"] = [];
  let capitalHolding = 0;
  let capitalDirectPersonnel = 0;
  for (let year = 1; year <= dureeProjectionAnnees; year++) {
    const yieldHolding = capitalHolding * r;
    const isSurYield = computeIS(yieldHolding, inputs.eligibleTauxReduitPMEHolding, inputs.corporateTaxRateHolding);
    capitalHolding = capitalHolding + yieldHolding - isSurYield + netCapitaliseHoldingAnnee1;

    const yieldPersonnel = capitalDirectPersonnel * r;
    const pfuSurYield = yieldPersonnel * PFU_TAUX_DIVIDENDES;
    capitalDirectPersonnel = capitalDirectPersonnel + yieldPersonnel - pfuSurYield + netDistributionDirecteAnnee1;

    projection.push({ year, capitalHolding, capitalDirectPersonnel });
  }
  const capitalHoldingFinalBrut = capitalHolding;
  const capitalDirectPersonnelFinal = capitalDirectPersonnel;

  const coutSortieFinaleHolding = capitalHoldingFinalBrut * PFU_TAUX_DIVIDENDES;
  const capitalHoldingFinalNetApresSortie = capitalHoldingFinalBrut - coutSortieFinaleHolding;

  return {
    eligibleRegimeMereFille,
    eligibleIntegrationFiscale,
    baseImposableIS,
    coutISAnnee1,
    netCapitaliseHoldingAnnee1,
    netDistributionDirecteAnnee1,
    dureeProjectionAnnees,
    projection,
    capitalHoldingFinalBrut,
    capitalDirectPersonnelFinal,
    coutSortieFinaleHolding,
    capitalHoldingFinalNetApresSortie,
    ecartEnFaveurHolding: capitalHoldingFinalNetApresSortie - capitalDirectPersonnelFinal,
  };
}
