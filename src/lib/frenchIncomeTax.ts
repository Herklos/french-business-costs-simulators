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

/** Applique la décote à l'impôt brut du foyer. Ne modifie pas le TMI marginal (cf. note dans ResolvedTaxProfile). */
export function applyDecote(impotBrut: number, situation: SituationFamiliale): number {
  const seuil = situation === "couple" ? DECOTE_SEUIL_COUPLE : DECOTE_SEUIL_SEUL;
  const montant = situation === "couple" ? DECOTE_MONTANT_COUPLE : DECOTE_MONTANT_SEUL;
  if (impotBrut >= seuil) return impotBrut;
  const decote = Math.max(0, montant - impotBrut * DECOTE_TAUX);
  return Math.max(0, impotBrut - decote);
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
  };
}

export interface ResolvedTaxProfile extends IRResult {
  tauxUtilise: number; // taux marginal effectivement appliqué à l'AEN (manuel ou calculé)
  impotApresDecote: number; // impôt total du foyer après décote (indicatif — n'affecte pas tauxUtilise)
}

/**
 * Résout le taux marginal à utiliser pour chiffrer l'IR supplémentaire dû à l'AEN.
 * Note : la décote (art. 197, I-4 CGI) réduit l'impôt total du foyer et est reflétée dans
 * `impotApresDecote` à titre indicatif, mais n'est PAS répercutée dans `tauxUtilise` : dans la
 * zone de décote, le taux marginal réel est mécaniquement majoré (~1,45× le taux de la tranche)
 * du fait de la dégressivité de la décote elle-même, ce qui n'est pas modélisé ici par simplicité.
 */
export function resolvePersonalTaxProfile(profile: PersonalTaxProfile): ResolvedTaxProfile {
  const parts = computeParts(profile.situationFamiliale, profile.nombreEnfants);
  const salaireApresAbattement = applyAbattement10(profile.salaireNetImposableAnnuel);
  const conjointApresAbattement =
    profile.situationFamiliale === "couple" ? applyAbattement10(profile.conjointSalaireNetImposableAnnuel) : 0;
  const revenuImposable = salaireApresAbattement + conjointApresAbattement + profile.autresRevenusImposablesFoyer;
  const ir = computeIR(revenuImposable, parts);
  const impotApresDecote = applyDecote(ir.impotTotal, profile.situationFamiliale);

  const tauxUtilise = profile.mode === "manuel" ? profile.tauxManuel : ir.tmi;

  return { ...ir, tauxUtilise, impotApresDecote };
}
