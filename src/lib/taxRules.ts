// Registre historisé des règles fiscales et sociales utilisées par les simulateurs.
// Chaque règle porte sa référence légale/réglementaire, sa période de validité
// (validFrom / validUntil) et sa source, afin de :
//  - tracer précisément d'où vient chaque valeur utilisée dans les calculs ;
//  - avertir l'utilisateur quand une règle est proche de son expiration ou obsolète ;
//  - garder l'historique des valeurs passées quand un simulateur est réutilisé sur
//    plusieurs années (une simulation sauvegardée reste rattachée aux règles de son année).
//
// NB : les montants 2026 sont ceux connus au moment de la rédaction (revalorisations
// PLF 2026 pour l'IR et l'AEN véhicules électriques). Ils doivent être vérifiés/ajustés
// à la publication définitive des textes (loi de finances, arrêtés annuels).

export type RuleCategory =
  | "aen_vehicule"
  | "cotisations_sociales"
  | "impot_revenu"
  | "indemnites_kilometriques"
  | "revenus_fonciers"
  | "impot_societe";

export interface TaxRule {
  id: string;
  category: RuleCategory;
  label: string;
  value: string; // valeur affichable (peut être composite : barème, taux, plafond...)
  legalReference: string; // article de loi / code / arrêté
  sourceLabel: string;
  sourceUrl?: string;
  validFrom: string; // ISO date
  validUntil: string | null; // ISO date, null = pas de fin connue
  notes?: string;
}

export const TAX_RULES: TaxRule[] = [
  {
    id: "aen-amortissement-taux",
    category: "aen_vehicule",
    label: "Taux d'amortissement annuel retenu pour l'AEN (véhicule ≤ 5 ans)",
    value: "20 % du prix d'achat TTC/an",
    legalReference: "BOI-RSA-BASE-30-50-30, § méthode du forfait réel",
    sourceLabel: "BOFiP-Impôts",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1512-PGP.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes: "10 % au-delà de 5 ans de mise en circulation.",
  },
  {
    id: "aen-methode-reelle-obligatoire-tns",
    category: "aen_vehicule",
    label: "Méthode d'évaluation obligatoire pour les gérants majoritaires TNS",
    value: "Frais réels uniquement (barème forfaitaire URSSAF exclu)",
    legalReference: "Art. L311-3 et R242-1 CSS ; BOI-RSA-BASE-30-50",
    sourceLabel: "BOFiP-Impôts / URSSAF",
    validFrom: "2020-01-01",
    validUntil: null,
  },
  {
    id: "aen-abattement-vehicule-electrique-taux",
    category: "aen_vehicule",
    label: "Abattement AEN véhicule électrique éligible (méthode réelle)",
    value: "50 % de l'AEN, plafonné",
    legalReference: "Arrêté du 25 février 2025 relatif à l'évaluation des avantages en nature (art. 3)",
    sourceLabel: "Légifrance",
    sourceUrl: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000051230000",
    validFrom: "2025-02-01",
    validUntil: "2027-12-31",
    notes:
      "Dispositif renforcé applicable aux véhicules mis à disposition entre le 1er février 2025 et le 31 décembre 2027. Condition d'éligibilité : éco-score ≥ 60 points (liste ADEME) au jour de la mise à disposition.",
  },
  {
    id: "aen-abattement-vehicule-electrique-plafond",
    category: "aen_vehicule",
    label: "Plafond annuel de l'abattement véhicule électrique (méthode réelle)",
    value: "2 026,30 € / an (2026)",
    legalReference: "Arrêté du 25 février 2025 (revalorisation annuelle par circulaire URSSAF)",
    sourceLabel: "URSSAF",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Plafond révisé chaque année civile ; 4 641,60 € pour la méthode forfaitaire (non applicable aux TNS).",
  },
  {
    id: "cotisations-tns-taux-global",
    category: "cotisations_sociales",
    label: "Taux global de cotisations sociales TNS (gérant majoritaire)",
    value: "≈ 41 % à 45 % de la rémunération nette (défaut retenu : 43 %)",
    legalReference: "Art. L131-6 et s. CSS ; réforme de l'assiette sociale unique 2026",
    sourceLabel: "URSSAF / SSI",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Le taux exact dépend du revenu (tranches maladie, retraite de base/complémentaire, PASS 2026 = 48 060 €).",
  },
  {
    id: "cotisations-assimile-salarie-taux",
    category: "cotisations_sociales",
    label: "Charges sociales président assimilé salarié (SASU/SAS) sur avantage en nature",
    value: "≈ 55 % (charges patronales + salariales, ordre de grandeur)",
    legalReference: "Régime général — Art. L242-1 CSS",
    sourceLabel: "URSSAF",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Taux nettement supérieur au régime TNS ; à affiner selon la convention collective et les tranches.",
  },
  {
    id: "ir-bareme-2026",
    category: "impot_revenu",
    label: "Barème progressif de l'impôt sur le revenu (par part)",
    value: "0 % ≤ 11 497 € | 11 % ≤ 29 315 € | 30 % ≤ 83 823 € | 41 % ≤ 180 294 € | 45 % au-delà",
    legalReference: "Art. 197 CGI, revalorisé par la loi de finances pour 2026 (+0,9 %)",
    sourceLabel: "Service-Public.fr / Légifrance",
    sourceUrl: "https://www.service-public.gouv.fr/particuliers/actualites/A18045?lang=fr",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Applicable aux revenus perçus en 2026, déclarés en 2027. Revalorisé chaque année en loi de finances.",
  },
  {
    id: "ir-abattement-10-salaires",
    category: "impot_revenu",
    label: "Abattement forfaitaire de 10 % sur les salaires (frais professionnels)",
    value: "Min 495 € — Max 14 171 € (valeurs reconduites, à confirmer PLF 2026)",
    legalReference: "Art. 83, 3° CGI",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2025-01-01",
    validUntil: "2026-12-31",
  },
  {
    id: "ik-bareme-2026",
    category: "indemnites_kilometriques",
    label: "Barème kilométrique automobile (indemnités kilométriques)",
    value: "Ex. 5 CV : 0,636 €/km (≤5000 km) ; (0,357×d)+1395 (5001-20000 km) ; 0,427 €/km (>20000 km)",
    legalReference: "Art. 6 B, annexe IV CGI ; barème publié par arrêté annuel (BOI-BAREME-000001)",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Barème 2026 reconduit à l'identique de 2025. Majoration de 20 % pour les véhicules électriques.",
  },
  {
    id: "foncier-abattement-micro",
    category: "revenus_fonciers",
    label: "Abattement micro-foncier",
    value: "30 %, applicable si revenus fonciers bruts ≤ 15 000 €/an",
    legalReference: "Art. 32 CGI",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2017-01-01",
    validUntil: null,
  },
  {
    id: "foncier-prelevements-sociaux",
    category: "revenus_fonciers",
    label: "Prélèvements sociaux sur revenus fonciers",
    value: "17,2 %",
    legalReference: "Art. L136-6 CSS ; CGI art. 1600-0 C et s.",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2018-01-01",
    validUntil: null,
  },
  {
    id: "is-taux-normal",
    category: "impot_societe",
    label: "Taux normal de l'impôt sur les sociétés",
    value: "25 % (15 % jusqu'à 42 500 € de bénéfice sous conditions PME)",
    legalReference: "Art. 219, I CGI",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2022-01-01",
    validUntil: null,
  },
];

export function getRule(id: string): TaxRule | undefined {
  return TAX_RULES.find((r) => r.id === id);
}

export function getRulesByCategory(category: RuleCategory): TaxRule[] {
  return TAX_RULES.filter((r) => r.category === category);
}

export type RuleStatus = "active" | "expiring_soon" | "expired";

/** Statut d'une règle à une date donnée (par défaut aujourd'hui). "Bientôt expirée" = échéance sous 90 jours. */
export function getRuleStatus(rule: TaxRule, atDate: Date = new Date()): RuleStatus {
  if (!rule.validUntil) return "active";
  const until = new Date(rule.validUntil);
  const diffDays = (until.getTime() - atDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "expired";
  if (diffDays <= 90) return "expiring_soon";
  return "active";
}
