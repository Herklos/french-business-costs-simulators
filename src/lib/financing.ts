// Comparateur des modes d'acquisition du véhicule : Comptant, Crédit, LOA, LDD (LLD).
// Chaque mode a ses propres paramètres et sa propre formule de coût total sur la durée choisie.
// Ce module est indépendant du calcul d'AEN : il sert à éclairer le choix de financement
// en amont (quel que soit le mode retenu, l'AEN se calcule ensuite sur la base retenue).

export type FinancingMode = "comptant" | "credit" | "loa" | "lld";

// Taux d'usure (taux maximum légal) applicable aux prêts personnels, par tranche de montant —
// Banque de France, 3e trimestre 2026 (juillet-septembre). Dépasser ce taux constitue un délit
// d'usure (art. L341-50 code de la consommation, jusqu'à 2 ans d'emprisonnement et 300 000€
// d'amende). Révisé chaque trimestre : valeurs à recontrôler sur banque-france.fr.
export const TAUX_USURE_PRETS_PERSONNELS = [
  { montantMax: 3000, taux: 0.2356 }, // valeur T1 2026, non republiée au T3 — à vérifier
  { montantMax: 6000, taux: 0.1587 }, // valeur T1 2026, non republiée au T3 — à vérifier
  { montantMax: Infinity, taux: 0.0856 }, // T3 2026 (à jour)
];

/** Taux d'usure applicable pour un montant emprunté donné (tranche la plus basse qui le couvre). */
export function getTauxUsureApplicable(montantEmprunte: number): number {
  const tranche = TAUX_USURE_PRETS_PERSONNELS.find((t) => montantEmprunte <= t.montantMax);
  return tranche ? tranche.taux : TAUX_USURE_PRETS_PERSONNELS[TAUX_USURE_PRETS_PERSONNELS.length - 1].taux;
}

export interface ComptantParams {
  prixTTC: number;
  dureeDetentionMois: number;
  tauxOpportunite: number; // rendement alternatif du capital immobilisé (0-1/an), pour chiffrer le coût d'opportunité
}

export interface CreditParams {
  prixTTC: number;
  apport: number;
  tauxAnnuel: number; // TAEG (0-1)
  dureeMois: number;
}

export interface LoaParams {
  prixTTC: number;
  premierLoyerMajore: number;
  loyerMensuel: number;
  dureeMois: number;
  valeurOptionAchat: number; // valeur résiduelle à payer si l'option est levée en fin de contrat
  leveeOption: boolean; // l'utilisateur compte-t-il lever l'option d'achat ?
}

export interface LldParams {
  premierLoyer: number;
  loyerMensuel: number; // loyer "tout compris" (entretien/assurance souvent inclus)
  dureeMois: number;
  kmInclusAnnuel: number;
  kmReelAnnuel: number;
  coutKmSupplementaire: number; // €/km au-delà du forfait
}

export interface FinancingInputs {
  comptant: ComptantParams;
  credit: CreditParams;
  loa: LoaParams;
  lld: LldParams;
}

// Estimation générique (% du prix TTC) utilisée par défaut pour tout véhicule. Pour les modèles
// disposant d'une offre LOA constructeur réelle connue (ex. Tesla Model Y — cf. vehicleModels.ts),
// c'est cette offre réelle qui est appliquée à la sélection du modèle (voir applyVehicleModel dans
// simulator.ts), en remplacement de l'estimation générique ci-dessous.
export function createDefaultFinancingInputs(prixTTC: number): FinancingInputs {
  return {
    comptant: { prixTTC, dureeDetentionMois: 60, tauxOpportunite: 0.03 },
    credit: { prixTTC, apport: prixTTC * 0.1, tauxAnnuel: 0.04, dureeMois: 60 },
    loa: {
      prixTTC,
      premierLoyerMajore: prixTTC * 0.2,
      loyerMensuel: Math.round(prixTTC * 0.018 * 100) / 100,
      dureeMois: 48,
      valeurOptionAchat: Math.round(prixTTC * 0.35 * 100) / 100,
      leveeOption: true,
    },
    lld: {
      premierLoyer: 0,
      loyerMensuel: Math.round((prixTTC * 0.022) * 100) / 100,
      dureeMois: 48,
      kmInclusAnnuel: 15000,
      kmReelAnnuel: 15000,
      coutKmSupplementaire: 0.08,
    },
  };
}

export interface FinancingResult {
  mode: FinancingMode;
  label: string;
  coutTotal: number; // coût total décaissé sur la durée du mode (y compris l'option d'achat si levée)
  coutMensuelEquivalent: number;
  // Coût de LOCATION annuel moyen, hors option d'achat/valeur résiduelle (qui est un achat de capital,
  // pas un loyer). Sert de base légale à l'AEN "véhicule loué" (30% du coût de location — cf.
  // BOI-RSA-BASE-30-50-30), qui ne doit pas être gonflée par un versement ponctuel d'acquisition.
  // Identique à coutMensuelEquivalent×12 pour le crédit, le comptant et la LLD (pas d'option d'achat).
  loyerAnnuelMoyen: number;
  detail: Record<string, number>;
  devientProprietaire: boolean;
}

/** Mensualité d'un crédit amortissable classique (formule standard). */
export function computeMensualiteCredit(montantEmprunte: number, tauxAnnuel: number, dureeMois: number): number {
  if (dureeMois <= 0) return 0;
  const tauxMensuel = tauxAnnuel / 12;
  if (tauxMensuel === 0) return montantEmprunte / dureeMois;
  return (
    (montantEmprunte * tauxMensuel) / (1 - Math.pow(1 + tauxMensuel, -dureeMois))
  );
}

export function computeComptant(p: ComptantParams): FinancingResult {
  const coutOpportunite = p.prixTTC * p.tauxOpportunite * (p.dureeDetentionMois / 12);
  const coutTotal = p.prixTTC + coutOpportunite;
  const coutMensuelEquivalent = p.dureeDetentionMois > 0 ? coutTotal / p.dureeDetentionMois : 0;
  return {
    mode: "comptant",
    label: "Achat comptant",
    coutTotal,
    coutMensuelEquivalent,
    loyerAnnuelMoyen: coutMensuelEquivalent * 12,
    detail: { prixTTC: p.prixTTC, coutOpportunite },
    devientProprietaire: true,
  };
}

export function computeCredit(p: CreditParams): FinancingResult {
  const montantEmprunte = Math.max(0, p.prixTTC - p.apport);
  const mensualite = computeMensualiteCredit(montantEmprunte, p.tauxAnnuel, p.dureeMois);
  const totalMensualites = mensualite * p.dureeMois;
  const coutCredit = totalMensualites - montantEmprunte;
  const coutTotal = p.apport + totalMensualites;
  const coutMensuelEquivalent = p.dureeMois > 0 ? coutTotal / p.dureeMois : 0;
  return {
    mode: "credit",
    label: "Crédit classique",
    coutTotal,
    coutMensuelEquivalent,
    loyerAnnuelMoyen: coutMensuelEquivalent * 12,
    detail: { montantEmprunte, mensualite, totalMensualites, coutCredit, apport: p.apport },
    devientProprietaire: true,
  };
}

export function computeLoa(p: LoaParams): FinancingResult {
  const totalLoyers = p.loyerMensuel * p.dureeMois;
  const optionAchat = p.leveeOption ? p.valeurOptionAchat : 0;
  // Coût total "patrimonial" sur la durée, y compris l'option d'achat si levée : sert de référence
  // pour connaître le montant total engagé, mais NE DOIT PAS être lissé sur la durée du contrat
  // pour obtenir un coût mensuel/annuel récurrent (cf. coutMensuelEquivalent ci-dessous).
  const coutTotal = p.premierLoyerMajore + totalLoyers + optionAchat;
  const dureeAnnees = p.dureeMois / 12;
  // Coût de LOCATION annuel moyen (1er loyer majoré + loyers mensuels), hors option d'achat : c'est
  // à la fois la base légale de l'AEN "véhicule loué" (30% du coût de location) ET le coût
  // récurrent réellement décaissé pendant le contrat. L'option d'achat, si levée, est un versement
  // UNIQUE d'acquisition de capital en fin de contrat (comparable à un "balloon payment") : la
  // lisser sur toute la durée du contrat gonflerait artificiellement le coût mensuel affiché
  // pendant la location, très au-dessus du loyer réellement facturé chaque mois.
  const loyerAnnuelMoyen = dureeAnnees > 0 ? (p.premierLoyerMajore + totalLoyers) / dureeAnnees : 0;
  return {
    mode: "loa",
    label: "LOA (location avec option d'achat)",
    coutTotal,
    coutMensuelEquivalent: loyerAnnuelMoyen / 12,
    loyerAnnuelMoyen,
    detail: {
      premierLoyerMajore: p.premierLoyerMajore,
      totalLoyers,
      valeurOptionAchat: p.valeurOptionAchat,
      optionAchatPayee: optionAchat,
    },
    devientProprietaire: p.leveeOption,
  };
}

export function computeLld(p: LldParams): FinancingResult {
  const totalLoyers = p.loyerMensuel * p.dureeMois;
  const kmReelTotal = p.kmReelAnnuel * (p.dureeMois / 12);
  const kmInclusTotal = p.kmInclusAnnuel * (p.dureeMois / 12);
  const kmDepassement = Math.max(0, kmReelTotal - kmInclusTotal);
  const coutDepassement = kmDepassement * p.coutKmSupplementaire;
  const coutTotal = p.premierLoyer + totalLoyers + coutDepassement;
  const coutMensuelEquivalent = p.dureeMois > 0 ? coutTotal / p.dureeMois : 0;
  return {
    mode: "lld",
    label: "LLD (location longue durée)",
    coutTotal,
    coutMensuelEquivalent,
    loyerAnnuelMoyen: coutMensuelEquivalent * 12, // pas d'option d'achat en LLD : identique au coût total annualisé
    detail: { premierLoyer: p.premierLoyer, totalLoyers, kmDepassement, coutDepassement },
    devientProprietaire: false,
  };
}

export function compareFinancingModes(inputs: FinancingInputs): FinancingResult[] {
  return [
    computeComptant(inputs.comptant),
    computeCredit(inputs.credit),
    computeLoa(inputs.loa),
    computeLld(inputs.lld),
  ];
}
