// Sélection indicative de modèles électriques et de leur éligibilité à l'éco-score renforcé
// (liste ADEME des véhicules électriques dont le score environnemental est ≥ 60 points,
// conditionnant l'abattement de 50% sur l'AEN — cf. règle "aen-abattement-vehicule-electrique-taux").
// Liste non exhaustive et non officielle : la liste ADEME à jour doit être vérifiée au cas par
// cas (elle évolue avec chaque nouvelle homologation/production), notamment pour les véhicules
// assemblés hors Union Européenne dont le score dépend fortement du site de production et de la
// filière batterie utilisés à un instant donné.

/** Offre LOA constructeur réelle associée à un modèle, réappliquée automatiquement à la sélection du modèle. */
export interface VehicleLoaOffer {
  premierLoyerMajore: number;
  loyerMensuel: number;
  dureeMois: number;
  valeurOptionAchat: number;
  tauxAnnuelIndicatif?: number; // TAEG affiché par le constructeur, déjà intégré dans les loyers (pas de champ dédié en LOA)
}

/** Offre de crédit constructeur réelle associée à un modèle, réappliquée à la sélection du modèle. */
export interface VehicleCreditOffer {
  apport: number;
  tauxAnnuel: number;
  dureeMois: number;
}

/** Offre LLD constructeur réelle associée à un modèle, réappliquée automatiquement à la sélection du modèle. */
export interface VehicleLldOffer {
  premierLoyer: number;
  loyerMensuel: number; // souvent "tout compris" (entretien/assurance inclus) — cf. `toutComprisEntretienAssurance`
  dureeMois: number;
  kmInclusAnnuel: number;
  toutComprisEntretienAssurance?: boolean; // si vrai, penser à réduire/annuler les champs assurance/entretien du simulateur pour éviter un double comptage
}

/** Palier de prime CEE (un seul applicable à la fois, selon le revenu du foyer). */
export interface CeeOffer {
  label: string;
  amount: number;
}

export interface VehicleModel {
  id: string;
  label: string;
  isElectric: boolean;
  ecoScoreEligible: boolean;
  notes: string;
  defaultPrice?: number; // prix TTC de référence, réappliqué à la sélection du modèle
  defaultLoaOffer?: VehicleLoaOffer; // offre LOA réelle publiée, réappliquée à la sélection du modèle
  defaultCreditOffer?: VehicleCreditOffer; // offre de crédit réelle publiée (apport, taux, durée)
  defaultLldOffer?: VehicleLldOffer; // offre LLD réelle publiée, réappliquée à la sélection du modèle
  // Prime CEE "Coup de pouce véhicules particuliers électriques" (cf. taxRules
  // "cee-coup-de-pouce-vehicule-electrique") — RÉSERVÉE AUX PARTICULIERS (personnes physiques),
  // jamais applicable à un achat par la société. Paliers selon le revenu fiscal de référence du
  // foyer (plus le revenu est modeste, plus la prime est élevée) — l'utilisateur choisit celui qui
  // correspond à sa situation, aucun n'est présélectionné par défaut.
  ceeOffers?: CeeOffer[];
  // Bonus de reprise commercial constructeur (état + reprise d'un ancien véhicule) — offre privée du
  // constructeur, généralement ouverte aux achats professionnels aussi (à confirmer au cas par cas
  // avec le concessionnaire au moment de l'achat, cf. RuleNote correspondante).
  bonusRepriseConstructeur?: number;
}

export const VEHICLE_MODELS: VehicleModel[] = [
  {
    id: "tesla-model-y-berlin",
    label: "Tesla Model Y (assemblage Berlin, codes TVV éligibles)",
    isElectric: true,
    ecoScoreEligible: true,
    notes: "Versions assemblées à Berlin généralement éligibles ; vérifier le code TVV précis sur la carte grise.",
    // Offres relevées au configurateur Tesla pour la Model Y Propulsion. Le prix comptant, la LOA,
    // le crédit et la LLD proviennent de la même page au même moment : ils sont donc comparables
    // entre eux, ce qui est la condition pour que le classement des modes de financement ait un sens.
    defaultPrice: 42784,
    defaultLoaOffer: {
      // 10 000 € de premier loyer, 279 €/mois sur 48 mois, option à 20 722 €, pour 10 000 km/an.
      premierLoyerMajore: 10000,
      loyerMensuel: 279,
      dureeMois: 48,
      valeurOptionAchat: 20722,
      tauxAnnuelIndicatif: 0.0099,
    },
    defaultCreditOffer: {
      // 10 000 € d'apport, 469 €/mois sur 72 mois, TAEG fixe de 0,99 %.
      apport: 10000,
      tauxAnnuel: 0.0099,
      dureeMois: 72,
    },
    defaultLldOffer: {
      // 5 000 € d'apport, 326 €/mois sur 60 mois, 10 000 km/an. Loyer nu : le configurateur ne
      // couvre ni l'entretien ni l'assurance, qui restent supportés en plus — et le montant le
      // confirme, très en deçà d'une offre « tout compris » sur le même véhicule.
      premierLoyer: 5000,
      loyerMensuel: 326,
      dureeMois: 60,
      kmInclusAnnuel: 10000,
      toutComprisEntretienAssurance: false,
    },
    // Coup de pouce constaté 2026 (combiné, cf. Tesla-mag) : 3 600€ (revenu standard) à 5 700€
    // (revenu modeste/très modeste) — à vérifier au cas par cas (barème révisé régulièrement,
    // bonifié depuis le 01/10/2025 si batterie/cellules assemblées en zone économique européenne).
    ceeOffers: [
      { label: "Revenu standard", amount: 3600 },
      { label: "Revenu modeste / très modeste (bonifié)", amount: 5700 },
    ],
    bonusRepriseConstructeur: 5000, // offre Tesla constatée 2026 (Model Y Propulsion) — vérifier le montant en vigueur au moment de l'achat
  },
  {
    id: "tesla-model-3",
    label: "Tesla Model 3 Propulsion",
    isElectric: true,
    ecoScoreEligible: false,
    notes: "Majoritairement non éligible (production hors UE pour une grande partie des versions commercialisées en France).",
    defaultPrice: 42990, // version Propulsion, prix constaté 2026
    defaultLoaOffer: {
      // Offre LOA Tesla constatée 2026 (Model 3 Propulsion, 36 mois / 10 000 km/an).
      premierLoyerMajore: 8250,
      loyerMensuel: 279,
      dureeMois: 36,
      valeurOptionAchat: 16745,
    },
    // Prime CEE constatée 2026 (montant unique, non gradué par revenu pour ce modèle — remplace le
    // bonus écologique, non éligible du fait de la production hors UE) — à vérifier au cas par cas.
    ceeOffers: [{ label: "Prime CEE", amount: 400 }],
    bonusRepriseConstructeur: 3000, // offre Tesla constatée 2026 — vérifier le montant en vigueur au moment de l'achat
  },
  {
    id: "renault-megane-e-tech",
    label: "Renault Megane E-Tech Electric",
    isElectric: true,
    ecoScoreEligible: true,
    notes:
      "Assemblée en France (Douai) — listée parmi les véhicules éligibles à l'éco-score ADEME. Prix catalogue constaté 2026 (finition Techno, restylée) ; pas d'offre LOA constructeur au format complet (1er loyer/mensualité/durée/option d'achat) trouvée de façon fiable — l'estimation générique (% du prix) s'applique pour la LOA/LLD/crédit.",
    defaultPrice: 37500,
    // Prime « Coup de pouce bonifié » Renault constatée 2026, 3 paliers selon le revenu du foyer —
    // à vérifier au cas par cas (montant et conditions par finition/motorisation).
    ceeOffers: [
      { label: "Revenu standard", amount: 4830 },
      { label: "Revenu modeste", amount: 6030 },
      { label: "Revenu très modeste", amount: 8240 },
    ],
  },
  {
    id: "renault-scenic-e-tech",
    label: "Renault Scenic E-Tech Electric",
    isElectric: true,
    ecoScoreEligible: true,
    notes:
      "Assemblé en France (Douai) — listé parmi les véhicules éligibles à l'éco-score ADEME. Prix catalogue constaté 2026 (finition Equilibre, 60 kWh) ; pas d'offre LOA constructeur au format complet trouvée de façon fiable — l'estimation générique (% du prix) s'applique pour la LOA/LLD/crédit.",
    defaultPrice: 40490,
    // Prime « Coup de pouce bonifié » Renault constatée 2026, mêmes paliers que la Megane E-Tech —
    // à vérifier au cas par cas (montant et conditions par finition/motorisation).
    ceeOffers: [
      { label: "Revenu standard", amount: 4830 },
      { label: "Revenu modeste", amount: 6030 },
      { label: "Revenu très modeste", amount: 8240 },
    ],
  },
  {
    id: "autre",
    label: "Autre modèle / à vérifier manuellement",
    isElectric: true,
    ecoScoreEligible: false,
    notes: "Vérifier l'éligibilité sur la liste officielle ADEME au jour de la mise à disposition avant de cocher « Oui ».",
  },
];

export function getVehicleModel(id: string): VehicleModel | undefined {
  return VEHICLE_MODELS.find((m) => m.id === id);
}
