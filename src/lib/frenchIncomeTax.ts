// Impôt sur le revenu français — barème progressif par tranches et quotient familial.
// Barème 2026 non encore publié au moment de l'écriture : on reconduit à titre indicatif
// le barème 2025 (revenus 2024), revalorisé de l'inflation estimée. À ajuster dès la
// publication officielle de la loi de finances 2026.
//
// Objectif : calculer le Taux Marginal d'Imposition (TMI) du foyer du gérant pour
// chiffrer précisément l'impôt supplémentaire généré par l'avantage en nature.

export interface TaxBracket {
  upTo: number | null; // borne supérieure de la tranche (par part), null = infini
  rate: number; // taux marginal de la tranche
}

export const IR_BAREME_2026: TaxBracket[] = [
  { upTo: 11497, rate: 0 },
  { upTo: 29315, rate: 0.11 },
  { upTo: 83823, rate: 0.3 },
  { upTo: 180294, rate: 0.41 },
  { upTo: null, rate: 0.45 },
];

export type SituationFamiliale = "seul" | "couple";

export const ABATTEMENT_10_MIN = 495; // plancher abattement forfaitaire 10% sur salaires (indicatif 2025)
export const ABATTEMENT_10_MAX = 14171; // plafond abattement forfaitaire 10% sur salaires (indicatif 2025)

// Décote 2026 (art. 197, I-4 CGI) : réduit voire annule l'impôt des foyers modestes.
export const DECOTE_SEUIL_SEUL = 1982;
export const DECOTE_SEUIL_COUPLE = 3277;
export const DECOTE_MONTANT_SEUL = 897;
export const DECOTE_MONTANT_COUPLE = 1483;
export const DECOTE_TAUX = 0.4525;

/** Applique la décote à l'impôt brut du foyer. */
export function applyDecote(impotBrut: number, situation: SituationFamiliale): number {
  const seuil = situation === "couple" ? DECOTE_SEUIL_COUPLE : DECOTE_SEUIL_SEUL;
  const montant = situation === "couple" ? DECOTE_MONTANT_COUPLE : DECOTE_MONTANT_SEUL;
  if (impotBrut >= seuil) return impotBrut;
  const decote = Math.max(0, montant - impotBrut * DECOTE_TAUX);
  return Math.max(0, impotBrut - decote);
}

/**
 * Taux marginal EFFECTIF sur un euro de revenu supplémentaire (ex. l'AEN), en tenant compte de la
 * dégressivité de la décote. Tant que l'impôt brut du foyer (hors ce revenu marginal) reste dans la
 * zone de décote (< seuil), chaque euro d'impôt brut supplémentaire réduit la décote de 0,4525 € en
 * plus de s'ajouter lui-même : le taux marginal réel est donc taux_tranche × (1 + 0,4525) = ×1,4525.
 * Au-delà du seuil, la décote est nulle (ou déjà épuisée) et le taux marginal effectif = taux_tranche.
 */
export function computeEffectiveMarginalRate(impotBrutAvant: number, tmiTranche: number, situation: SituationFamiliale): number {
  const seuil = situation === "couple" ? DECOTE_SEUIL_COUPLE : DECOTE_SEUIL_SEUL;
  if (impotBrutAvant < seuil) {
    return tmiTranche * (1 + DECOTE_TAUX);
  }
  return tmiTranche;
}

/** Nombre de parts fiscales selon la situation familiale et le nombre d'enfants à charge (règles simplifiées, hors cas particuliers : parent isolé, invalidité, garde alternée...). */
export function computeParts(situation: SituationFamiliale, nombreEnfants: number): number {
  let parts = situation === "couple" ? 2 : 1;
  const enfants = Math.max(0, Math.floor(nombreEnfants));
  if (enfants <= 2) {
    parts += enfants * 0.5;
  } else {
    parts += 1 + (enfants - 2) * 1;
  }
  return parts;
}

/** Applique l'abattement forfaitaire de 10% (frais professionnels) sur un salaire brut imposable. */
export function applyAbattement10(salaire: number): number {
  if (salaire <= 0) return 0;
  const abattement = Math.min(Math.max(salaire * 0.1, ABATTEMENT_10_MIN), ABATTEMENT_10_MAX);
  return Math.max(0, salaire - abattement);
}

export interface IRResult {
  revenuImposable: number;
  parts: number;
  quotient: number; // revenu imposable / parts
  impotParPart: number;
  impotTotal: number; // impôt du foyer avant décote/plafonnement (approximation)
  tmi: number; // taux marginal d'imposition (taux de la tranche du quotient)
}

/** Calcule l'impôt (méthode du quotient familial) et le TMI pour un revenu imposable donné. */
export function computeIR(
  revenuImposable: number,
  parts: number,
  bareme: TaxBracket[] = IR_BAREME_2026,
): IRResult {
  const quotient = Math.max(0, revenuImposable) / parts;

  let impotParPart = 0;
  let lower = 0;
  let tmi = 0;
  for (const bracket of bareme) {
    const upper = bracket.upTo ?? Infinity;
    if (quotient > lower) {
      const taxableInBracket = Math.min(quotient, upper) - lower;
      impotParPart += taxableInBracket * bracket.rate;
      if (quotient > lower) tmi = bracket.rate;
    }
    lower = upper;
    if (quotient <= upper) break;
  }

  const impotTotal = impotParPart * parts;

  return { revenuImposable, parts, quotient, impotParPart, impotTotal, tmi };
}

export interface PersonalTaxProfile {
  mode: "manuel" | "calcule";
  tauxManuel: number; // utilisé si mode === 'manuel'
  situationFamiliale: SituationFamiliale;
  nombreEnfants: number;
  salaireNetImposableAnnuel: number; // salaire du gérant (hors AEN), avant abattement 10%
  conjointSalaireNetImposableAnnuel: number; // salaire du conjoint (si couple), avant abattement 10% — 0 sinon
  autresRevenusImposablesFoyer: number; // autres revenus du foyer (revenus fonciers, dividendes, etc.), déjà nets imposables

  // Crédits d'impôt du foyer. Ils interviennent APRÈS le calcul de l'impôt — ils n'entrent pas dans
  // le revenu imposable et ne modifient donc NI la tranche, NI le taux marginal appliqué par les
  // simulateurs. Ils sont saisis en DÉPENSES engagées, pas en montant de crédit : c'est le plafond
  // applicable, souvent mal connu, qui fait la différence entre les deux.
  depensesServicesPersonne: number; // emploi à domicile : ménage, garde d'enfants au domicile, jardinage, soutien scolaire...
  depensesGardeEnfantsHorsDomicile: number; // crèche, halte-garderie, assistante maternelle agréée (enfants de moins de 6 ans)
  nombreEnfantsGardeHorsDomicile: number; // nombre d'enfants concernés — le plafond s'apprécie par enfant
  foyerInvalidite: boolean; // relève le plafond de l'emploi à domicile et supprime ses majorations
  // Deux natures à ne pas confondre, saisies en MONTANT et non en dépense, les taux variant d'un
  // dispositif à l'autre. Un CRÉDIT dont le montant excède l'impôt est remboursé ; une RÉDUCTION,
  // elle, ne peut que ramener l'impôt à zéro — son excédent est définitivement perdu. Cette
  // différence est la seule par laquelle un avantage fiscal peut modifier le coût réel d'un euro
  // de revenu supplémentaire, cf. `revenuAbsorbeParReductionPerdue`.
  autresCreditsImpot: number;
  autresReductionsImpot: number;
}

export function createDefaultPersonalTaxProfile(): PersonalTaxProfile {
  return {
    mode: "calcule",
    tauxManuel: 0.3,
    situationFamiliale: "seul",
    nombreEnfants: 0,
    salaireNetImposableAnnuel: 30000,
    conjointSalaireNetImposableAnnuel: 0,
    autresRevenusImposablesFoyer: 0,
    depensesServicesPersonne: 0,
    depensesGardeEnfantsHorsDomicile: 0,
    nombreEnfantsGardeHorsDomicile: 0,
    foyerInvalidite: false,
    autresCreditsImpot: 0,
    autresReductionsImpot: 0,
  };
}

export interface ResolvedTaxProfile extends IRResult {
  tauxUtilise: number; // taux marginal effectivement appliqué à l'AEN (manuel, ou calculé + effet décote)
  impotApresDecote: number; // impôt total du foyer après décote (hors AEN), AVANT crédits d'impôt
  tauxMarginalEffectif: number; // tmi × 1,4525 si le foyer est dans la zone de décote, sinon tmi
  dansZoneDecote: boolean;

  // Crédits d'impôt — calculés à titre informatif, sans effet sur `tauxUtilise` (cf. note ci-dessous).
  plafondServicesPersonne: number;
  creditServicesPersonne: number;
  plafondAtteintServicesPersonne: boolean;
  plafondGardeEnfants: number;
  creditGardeEnfants: number;
  plafondAtteintGardeEnfants: boolean;
  creditsImpotTotal: number;
  reductionsImpotTotal: number;
  impotApresCreditsImpot: number; // impôt réellement dû, 0 si crédits et réductions l'absorbent
  restitutionAttendue: number; // excédent de CRÉDIT, remboursé par l'administration
  reductionPerdue: number; // excédent de RÉDUCTION, définitivement perdu faute d'impôt à effacer
  /**
   * Montant de revenu imposable supplémentaire qui n'engendrerait aucun impôt réel, parce qu'il ne
   * ferait qu'absorber une réduction aujourd'hui perdue. C'est le seul cas où un avantage fiscal
   * déjà acquis rend gratuit un euro de rémunération, d'avantage en nature ou d'indemnité de plus.
   */
  revenuAbsorbeParReductionPerdue: number;
}

/**
 * Résout le taux marginal à utiliser pour chiffrer l'IR supplémentaire dû à l'AEN.
 * En mode calculé, le taux retenu intègre l'effet de dégressivité de la décote (cf.
 * computeEffectiveMarginalRate) : un euro d'AEN supplémentaire coûte plus cher en IR pour un foyer
 * situé dans la zone de décote que ne le suggère le seul taux de la tranche.
 */
export const TAUX_CREDIT_SERVICES_PERSONNE = 0.5; // art. 199 sexdecies CGI
export const PLAFOND_SERVICES_PERSONNE_BASE = 12000;
export const MAJORATION_SERVICES_PERSONNE_PAR_ENFANT = 1500;
export const PLAFOND_SERVICES_PERSONNE_MAJORE_MAX = 15000;
export const PLAFOND_SERVICES_PERSONNE_INVALIDITE = 20000; // sans majoration possible

export const TAUX_CREDIT_GARDE_ENFANTS = 0.5; // art. 200 quater B CGI
export const PLAFOND_GARDE_ENFANTS_PAR_ENFANT = 3500;

/**
 * Crédits d'impôt du foyer, à partir des dépenses engagées.
 *
 * Le plafond de l'emploi à domicile est majoré de 1 500 € par enfant à charge, sans pouvoir excéder
 * 15 000 € — sauf situation d'invalidité, qui le porte à 20 000 € et supprime en contrepartie toute
 * majoration. C'est ce plafond, bien plus que le taux de 50 %, qui détermine l'avantage réel.
 */
export function computeCreditsImpot(profile: PersonalTaxProfile) {
  const enfants = Math.max(0, Math.floor(profile.nombreEnfants));
  const plafondServicesPersonne = profile.foyerInvalidite
    ? PLAFOND_SERVICES_PERSONNE_INVALIDITE
    : Math.min(
        PLAFOND_SERVICES_PERSONNE_BASE + MAJORATION_SERVICES_PERSONNE_PAR_ENFANT * enfants,
        PLAFOND_SERVICES_PERSONNE_MAJORE_MAX,
      );
  const depensesSAP = Math.max(0, profile.depensesServicesPersonne);
  const retenuSAP = Math.min(depensesSAP, plafondServicesPersonne);

  const enfantsGardes = Math.max(0, Math.floor(profile.nombreEnfantsGardeHorsDomicile));
  const plafondGardeEnfants = PLAFOND_GARDE_ENFANTS_PAR_ENFANT * enfantsGardes;
  const depensesGarde = Math.max(0, profile.depensesGardeEnfantsHorsDomicile);
  const retenuGarde = Math.min(depensesGarde, plafondGardeEnfants);

  const creditServicesPersonne = retenuSAP * TAUX_CREDIT_SERVICES_PERSONNE;
  const creditGardeEnfants = retenuGarde * TAUX_CREDIT_GARDE_ENFANTS;
  return {
    plafondServicesPersonne,
    creditServicesPersonne,
    plafondAtteintServicesPersonne: depensesSAP > plafondServicesPersonne,
    plafondGardeEnfants,
    creditGardeEnfants,
    plafondAtteintGardeEnfants: depensesGarde > plafondGardeEnfants,
    creditsImpotTotal: creditServicesPersonne + creditGardeEnfants + Math.max(0, profile.autresCreditsImpot),
    reductionsImpotTotal: Math.max(0, profile.autresReductionsImpot),
  };
}

export function resolvePersonalTaxProfile(profile: PersonalTaxProfile): ResolvedTaxProfile {
  const parts = computeParts(profile.situationFamiliale, profile.nombreEnfants);
  const salaireApresAbattement = applyAbattement10(profile.salaireNetImposableAnnuel);
  const conjointApresAbattement =
    profile.situationFamiliale === "couple" ? applyAbattement10(profile.conjointSalaireNetImposableAnnuel) : 0;
  const revenuImposable = salaireApresAbattement + conjointApresAbattement + profile.autresRevenusImposablesFoyer;
  const ir = computeIR(revenuImposable, parts);
  const impotApresDecote = applyDecote(ir.impotTotal, profile.situationFamiliale);

  const seuilDecote = profile.situationFamiliale === "couple" ? DECOTE_SEUIL_COUPLE : DECOTE_SEUIL_SEUL;
  const dansZoneDecote = ir.impotTotal < seuilDecote;
  const tauxMarginalEffectif = computeEffectiveMarginalRate(ir.impotTotal, ir.tmi, profile.situationFamiliale);

  const tauxUtilise = profile.mode === "manuel" ? profile.tauxManuel : tauxMarginalEffectif;

  // Les crédits d'impôt s'imputent sur l'impôt DÛ, pas sur le revenu imposable : ils ne déplacent
  // aucune tranche et ne modifient donc pas `tauxUtilise`. Un euro de revenu supplémentaire reste
  // taxé au même taux marginal, que le foyer ait ou non des crédits — et c'est précisément la
  // confusion que la présence de ces champs risque d'induire, donc celle que l'interface corrige.
  const credits = computeCreditsImpot(profile);
  // Ordre d'imputation : les réductions d'abord, plafonnées par l'impôt dû ; les crédits ensuite,
  // qui peuvent le rendre négatif — c'est-à-dire donner lieu à restitution.
  const impotApresReductions = Math.max(0, impotApresDecote - credits.reductionsImpotTotal);
  const reductionPerdue = Math.max(0, credits.reductionsImpotTotal - impotApresDecote);
  const impotApresCreditsImpot = Math.max(0, impotApresReductions - credits.creditsImpotTotal);
  const restitutionAttendue = Math.max(0, credits.creditsImpotTotal - impotApresReductions);
  // Tant qu'une réduction reste perdue, chaque euro d'impôt supplémentaire ne fait que l'absorber :
  // le revenu qui le génère ne coûte donc rien. Au-delà, le taux marginal reprend ses droits.
  const revenuAbsorbeParReductionPerdue = tauxMarginalEffectif > 0 ? reductionPerdue / tauxMarginalEffectif : 0;

  return {
    ...ir,
    tauxUtilise,
    impotApresDecote,
    tauxMarginalEffectif,
    dansZoneDecote,
    ...credits,
    impotApresCreditsImpot,
    restitutionAttendue,
    reductionPerdue,
    revenuAbsorbeParReductionPerdue,
  };
}
