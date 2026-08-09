import type { ReactNode } from "react";
import { type PersonalTaxProfile } from "../lib/frenchIncomeTax";
import { Field, NumberInput, ResetableNumberInput } from "./Field";
import { formatPercent } from "../lib/format";

interface PersonalTaxProfileFieldsProps {
  profile: PersonalTaxProfile;
  onChange: (profile: PersonalTaxProfile) => void;
  /** Affiche un champ "salaire net imposable du dirigeant" distinct (véhicule, bureau à domicile :
   * sert de base au calcul du TMI indépendamment du montant simulé). À désactiver quand ce salaire
   * est déjà calculé par le simulateur lui-même (rémunération), pour éviter un champ sans effet. */
  showSalaireDirigeant?: boolean;
  salaireDirigeantLabel?: string;
  /** Affiche un champ "autres revenus imposables du foyer" — toujours utile sauf quand
   * `showSalaireDirigeant` est aussi désactivé faute de place dans la grille (cf. bureau à domicile). */
  showAutresRevenus?: boolean;
  /** Contenu additionnel affiché uniquement en mode "calculé" (stats, avertissements spécifiques au simulateur appelant). */
  footerWhenCalcule?: ReactNode;
  /** Contenu additionnel affiché quel que soit le mode (ex. RuleNote toujours pertinente). */
  footerAlways?: ReactNode;
}

/**
 * Bloc de champs partagé pour la situation fiscale personnelle du dirigeant (et du foyer), utilisé
 * par tous les simulateurs qui doivent déterminer un TMI (véhicule, bureau à domicile, rémunération).
 */
export function PersonalTaxProfileFields({
  profile,
  onChange,
  showSalaireDirigeant = true,
  salaireDirigeantLabel = "Salaire net imposable annuel du dirigeant (€)",
  showAutresRevenus = true,
  footerWhenCalcule,
  footerAlways,
}: PersonalTaxProfileFieldsProps) {
  function update<K extends keyof PersonalTaxProfile>(key: K, value: PersonalTaxProfile[K]) {
    onChange({ ...profile, [key]: value });
  }

  function handleSituationFamilialeChange(situationFamiliale: "seul" | "couple") {
    onChange({
      ...profile,
      situationFamiliale,
      // Par défaut, on suppose un conjoint au même salaire que le dirigeant (modifiable ensuite).
      conjointSalaireNetImposableAnnuel:
        situationFamiliale === "couple" && profile.conjointSalaireNetImposableAnnuel === 0
          ? profile.salaireNetImposableAnnuel
          : profile.conjointSalaireNetImposableAnnuel,
    });
  }

  return (
    <>
      <Field label="Mode">
        <select value={profile.mode} onChange={(e) => update("mode", e.target.value as "manuel" | "calcule")}>
          <option value="calcule">Calculer le TMI à partir de ma situation</option>
          <option value="manuel">Saisir un taux manuel</option>
        </select>
      </Field>
      {profile.mode === "manuel" ? (
        <Field label="Taux marginal d'imposition manuel">
          <ResetableNumberInput
            step="0.01"
            value={profile.tauxManuel}
            defaultValue={0.3}
            formatDefault={(v) => formatPercent(v)}
            onChange={(v) => update("tauxManuel", v)}
          />
        </Field>
      ) : (
        <>
          <div className="grid grid--3">
            <Field label="Situation familiale">
              <select
                value={profile.situationFamiliale}
                onChange={(e) => handleSituationFamilialeChange(e.target.value as "seul" | "couple")}
              >
                <option value="seul">Célibataire / divorcé(e) / veuf(ve)</option>
                <option value="couple">Marié(e) / pacsé(e)</option>
              </select>
            </Field>
            <Field label="Nombre d'enfants à charge">
              <NumberInput value={profile.nombreEnfants} onChange={(e) => update("nombreEnfants", Number(e.target.value))} />
            </Field>
            {showSalaireDirigeant ? (
              <Field label={salaireDirigeantLabel}>
                <NumberInput
                  value={profile.salaireNetImposableAnnuel}
                  onChange={(e) => update("salaireNetImposableAnnuel", Number(e.target.value))}
                />
              </Field>
            ) : showAutresRevenus ? (
              <Field label="Autres revenus imposables du foyer (€/an, hors montants simulés)">
                <NumberInput
                  value={profile.autresRevenusImposablesFoyer}
                  onChange={(e) => update("autresRevenusImposablesFoyer", Number(e.target.value))}
                />
              </Field>
            ) : null}
          </div>
          {profile.situationFamiliale === "couple" && (
            <Field label="Salaire net imposable annuel du conjoint (€)">
              <NumberInput
                value={profile.conjointSalaireNetImposableAnnuel}
                onChange={(e) => update("conjointSalaireNetImposableAnnuel", Number(e.target.value))}
              />
            </Field>
          )}
          {showSalaireDirigeant && showAutresRevenus && (
            <Field label="Autres revenus imposables du foyer (€/an) — fonciers, dividendes, etc.">
              <NumberInput
                value={profile.autresRevenusImposablesFoyer}
                onChange={(e) => update("autresRevenusImposablesFoyer", Number(e.target.value))}
              />
            </Field>
          )}
          {footerWhenCalcule}
        </>
      )}
      {footerAlways}
    </>
  );
}
