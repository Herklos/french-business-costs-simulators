// Registre des formes juridiques et statuts du dirigeant, par pays.
// Seule la France est renseignée pour l'instant ; la structure (indexée par code pays)
// permet d'ajouter d'autres juridictions sans toucher au moteur de calcul.

export type DirigeantStatus = "TNS" | "ASSIMILE_SALARIE";
export type ImpositionSociete = "IS" | "IR";

export interface CompanyTypeConfig {
  code: string;
  label: string;
  description: string;
  hasGerantMajoriteOption: boolean; // true => l'utilisateur choisit majoritaire/minoritaire (impacte le statut)
  defaultDirigeantStatus: DirigeantStatus;
  impositionOptions: ImpositionSociete[]; // régimes possibles
  defaultImposition: ImpositionSociete;
  defaultCotisationRate: number; // taux de charges par défaut appliqué sur l'AEN net selon le statut
}

export const COMPANY_TYPES_BY_COUNTRY: Record<string, CompanyTypeConfig[]> = {
  FR: [
    {
      code: "EURL",
      label: "EURL (associé unique)",
      description: "Le gérant associé unique est de plein droit gérant majoritaire → statut TNS.",
      hasGerantMajoriteOption: false,
      defaultDirigeantStatus: "TNS",
      impositionOptions: ["IR", "IS"],
      defaultImposition: "IR",
      defaultCotisationRate: 0.43,
    },
    {
      code: "SARL",
      label: "SARL",
      description: "Le statut du gérant dépend de la répartition du capital (majoritaire ou minoritaire/égalitaire).",
      hasGerantMajoriteOption: true,
      defaultDirigeantStatus: "TNS",
      impositionOptions: ["IS", "IR"],
      defaultImposition: "IS",
      defaultCotisationRate: 0.43,
    },
    {
      code: "SASU",
      label: "SASU (président unique)",
      description: "Le président de SASU est assimilé salarié, quel que soit le montant de sa rémunération.",
      hasGerantMajoriteOption: false,
      defaultDirigeantStatus: "ASSIMILE_SALARIE",
      impositionOptions: ["IS", "IR"],
      defaultImposition: "IS",
      defaultCotisationRate: 0.55,
    },
    {
      code: "SAS",
      label: "SAS",
      description: "Le président (et les dirigeants assimilés) de SAS relèvent du régime général assimilé salarié.",
      hasGerantMajoriteOption: false,
      defaultDirigeantStatus: "ASSIMILE_SALARIE",
      impositionOptions: ["IS", "IR"],
      defaultImposition: "IS",
      defaultCotisationRate: 0.55,
    },
  ],
};

export function getCompanyTypes(country: string): CompanyTypeConfig[] {
  return COMPANY_TYPES_BY_COUNTRY[country] ?? [];
}

export function getCompanyType(country: string, code: string): CompanyTypeConfig | undefined {
  return getCompanyTypes(country).find((c) => c.code === code);
}

/** Résout le statut effectif du dirigeant en tenant compte de l'option majoritaire/minoritaire (SARL). */
export function resolveDirigeantStatus(
  companyType: CompanyTypeConfig | undefined,
  gerantMajoritaire: boolean,
): DirigeantStatus {
  if (!companyType) return "TNS";
  if (!companyType.hasGerantMajoriteOption) return companyType.defaultDirigeantStatus;
  return gerantMajoritaire ? "TNS" : "ASSIMILE_SALARIE";
}
