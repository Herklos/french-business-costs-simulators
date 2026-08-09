import type { ReactNode } from "react";
import { COUNTRIES } from "../lib/countries";
import { type ImpositionSociete, getCompanyType, getCompanyTypes, resolveDirigeantStatus } from "../lib/companyTypes";
import { Field } from "./Field";

interface CompanyTypeFieldsProps {
  country: string;
  companyType: string;
  gerantMajoritaire: boolean;
  impositionSociete: ImpositionSociete;
  onCountryChange: (country: string) => void;
  onCompanyTypeChange: (code: string) => void;
  onGerantMajoritaireChange: (value: boolean) => void;
  onImpositionChange: (value: ImpositionSociete) => void;
  /** Notes légales additionnelles propres à l'appelant (ex. règles AEN pour le simulateur véhicule). */
  children?: ReactNode;
}

/**
 * Bloc de champs partagé "pays / forme juridique / régime d'imposition / gérant majoritaire", avec
 * le résumé du statut du dirigeant qui en découle (TNS ou assimilé salarié) — utilisé par tous les
 * simulateurs qui ont besoin de connaître ce statut (véhicule, rémunération...).
 */
export function CompanyTypeFields({
  country,
  companyType,
  gerantMajoritaire,
  impositionSociete,
  onCountryChange,
  onCompanyTypeChange,
  onGerantMajoritaireChange,
  onImpositionChange,
  children,
}: CompanyTypeFieldsProps) {
  const companyTypes = getCompanyTypes(country);
  const companyTypeConfig = getCompanyType(country, companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, gerantMajoritaire);

  return (
    <>
      <div className="grid grid--3">
        <Field label="Pays">
          <select value={country} onChange={(e) => onCountryChange(e.target.value)}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code} disabled={!c.available}>
                {c.flag} {c.label} {!c.available ? "(bientôt disponible)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Forme juridique">
          <select value={companyType} onChange={(e) => onCompanyTypeChange(e.target.value)}>
            {companyTypes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Régime d'imposition de la société">
          <select value={impositionSociete} onChange={(e) => onImpositionChange(e.target.value as ImpositionSociete)}>
            {(companyTypeConfig?.impositionOptions ?? ["IS", "IR"]).map((opt) => (
              <option key={opt} value={opt}>
                {opt === "IS" ? "Impôt sur les sociétés (IS)" : "Impôt sur le revenu (IR, société translucide)"}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {companyTypeConfig?.hasGerantMajoriteOption && (
        <Field label="Le gérant est-il majoritaire ?">
          <select
            value={gerantMajoritaire ? "oui" : "non"}
            onChange={(e) => onGerantMajoritaireChange(e.target.value === "oui")}
          >
            <option value="oui">Oui — gérant majoritaire (statut TNS)</option>
            <option value="non">Non — minoritaire/égalitaire (assimilé salarié)</option>
          </select>
        </Field>
      )}
      <p className="hint-block">
        Statut retenu : <strong>{dirigeantStatus === "TNS" ? "Travailleur Non Salarié (TNS)" : "Assimilé salarié"}</strong>
        {" — "}
        {companyTypeConfig?.description}
      </p>
      {children}
    </>
  );
}
