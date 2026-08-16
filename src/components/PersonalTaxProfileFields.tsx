import type { ReactNode } from "react";
import {
  type PersonalTaxProfile,
  PLAFOND_GARDE_ENFANTS_PAR_ENFANT,
  PLAFOND_SERVICES_PERSONNE_INVALIDITE,
  PLAFOND_SERVICES_PERSONNE_MAJORE_MAX,
  TAUX_CREDIT_GARDE_ENFANTS,
  TAUX_CREDIT_SERVICES_PERSONNE,
  resolvePersonalTaxProfile,
} from "../lib/frenchIncomeTax";
import { Field, NumberInput, ResetableNumberInput } from "./Field";
import { RuleNote } from "./RuleNote";
import { formatEUR, formatPercent } from "../lib/format";

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
      <CreditsImpotFields profile={profile} onChange={onChange} />
      {footerAlways}
    </>
  );
}

/**
 * Crédits d'impôt du foyer — emploi à domicile, garde d'enfants, autres dispositifs.
 *
 * Bloc replié par défaut : il ne change aucun résultat de simulation, et c'est précisément ce que
 * la plupart des utilisateurs ignorent. Un crédit d'impôt s'impute sur l'impôt DÛ, pas sur le revenu
 * imposable : il ne déplace aucune tranche, et un euro de revenu supplémentaire reste taxé au même
 * taux marginal. Le bloc le dit en toutes lettres plutôt que de laisser croire à un effet de levier.
 */
function CreditsImpotFields({
  profile,
  onChange,
}: {
  profile: PersonalTaxProfile;
  onChange: (profile: PersonalTaxProfile) => void;
}) {
  const r = resolvePersonalTaxProfile(profile);
  const update = <K extends keyof PersonalTaxProfile>(key: K, value: PersonalTaxProfile[K]) =>
    onChange({ ...profile, [key]: value });

  return (
    <details className="details-block">
      <summary>
        Crédits et réductions d'impôt du foyer — emploi à domicile, garde d'enfants
        {r.creditsImpotTotal + r.reductionsImpotTotal > 0
          ? ` (${formatEUR(r.creditsImpotTotal + r.reductionsImpotTotal)})`
          : ""}
      </summary>

      <div className="grid grid--2">
        <Field
          label="Dépenses d'emploi à domicile (€/an)"
          hint="Ménage, garde d'enfants à votre domicile, jardinage, petit bricolage, soutien scolaire — salarié direct ou organisme agréé."
        >
          <NumberInput
            value={profile.depensesServicesPersonne}
            onChange={(e) => update("depensesServicesPersonne", Number(e.target.value))}
          />
        </Field>
        <div className="field">
          <span className="field__label">Invalidité dans le foyer ?</span>
          <select
            value={profile.foyerInvalidite ? "oui" : "non"}
            onChange={(e) => update("foyerInvalidite", e.target.value === "oui")}
          >
            <option value="non">Non</option>
            <option value="oui">Oui — carte mobilité inclusion « invalidité » ou pension 3e catégorie</option>
          </select>
          <span className="field__hint">
            Porte le plafond à {formatEUR(PLAFOND_SERVICES_PERSONNE_INVALIDITE)}, sans majoration possible.
          </span>
        </div>
      </div>

      <div className="grid grid--2">
        <Field
          label="Dépenses de garde hors domicile (€/an)"
          hint="Crèche, halte-garderie, assistante maternelle agréée — enfants de moins de 6 ans uniquement."
        >
          <NumberInput
            value={profile.depensesGardeEnfantsHorsDomicile}
            onChange={(e) => update("depensesGardeEnfantsHorsDomicile", Number(e.target.value))}
          />
        </Field>
        <Field
          label="Nombre d'enfants de moins de 6 ans gardés"
          hint={`Le plafond s'apprécie par enfant : ${formatEUR(PLAFOND_GARDE_ENFANTS_PAR_ENFANT)} de dépenses chacun.`}
        >
          <NumberInput
            min={0}
            value={profile.nombreEnfantsGardeHorsDomicile}
            onChange={(e) => update("nombreEnfantsGardeHorsDomicile", Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="grid grid--2">
        <Field
          label="Autres CRÉDITS d'impôt (€/an)"
          hint="Montant du crédit, non la dépense : dons, cotisations syndicales… L'excédent est remboursé."
        >
          <NumberInput
            value={profile.autresCreditsImpot}
            onChange={(e) => update("autresCreditsImpot", Number(e.target.value))}
          />
        </Field>
        <Field
          label="RÉDUCTIONS d'impôt (€/an)"
          hint="Pinel, FIP/FCPI, Malraux… L'excédent est perdu, jamais remboursé : la distinction n'est pas cosmétique."
        >
          <NumberInput
            value={profile.autresReductionsImpot}
            onChange={(e) => update("autresReductionsImpot", Number(e.target.value))}
          />
        </Field>
      </div>

      {r.creditsImpotTotal + r.reductionsImpotTotal > 0 && (
        <p className="hint-block">
          Crédit total : <strong>{formatEUR(r.creditsImpotTotal)}</strong>
          {r.reductionsImpotTotal > 0 && <> · réductions {formatEUR(r.reductionsImpotTotal)}</>}
          {r.creditServicesPersonne > 0 && (
            <>
              {" "}
              · emploi à domicile {formatEUR(r.creditServicesPersonne)} ({formatPercent(TAUX_CREDIT_SERVICES_PERSONNE)}{" "}
              de {formatEUR(Math.min(profile.depensesServicesPersonne, r.plafondServicesPersonne))} retenus, plafond{" "}
              {formatEUR(r.plafondServicesPersonne)})
            </>
          )}
          {r.creditGardeEnfants > 0 && (
            <>
              {" "}
              · garde hors domicile {formatEUR(r.creditGardeEnfants)} ({formatPercent(TAUX_CREDIT_GARDE_ENFANTS)} de{" "}
              {formatEUR(Math.min(profile.depensesGardeEnfantsHorsDomicile, r.plafondGardeEnfants))} retenus)
            </>
          )}
          . Impôt du foyer : {formatEUR(r.impotApresDecote)} avant imputation,{" "}
          <strong>{formatEUR(r.impotApresCreditsImpot)}</strong> après
          {r.restitutionAttendue > 0 && (
            <>
              {" "}
              — et {formatEUR(r.restitutionAttendue)} restitués par virement, l'excédent d'un véritable crédit
              n'étant pas perdu
            </>
          )}
          .
        </p>
      )}

      {(r.plafondAtteintServicesPersonne || r.plafondAtteintGardeEnfants) && (
        <p className="warning-block">
          {r.plafondAtteintServicesPersonne && (
            <>
              Vos dépenses d'emploi à domicile dépassent le plafond de {formatEUR(r.plafondServicesPersonne)} :
              l'excédent n'ouvre aucun crédit.{" "}
              {!profile.foyerInvalidite && r.plafondServicesPersonne < PLAFOND_SERVICES_PERSONNE_MAJORE_MAX && (
                <>Chaque enfant à charge relève ce plafond de 1 500 €, dans la limite de {formatEUR(PLAFOND_SERVICES_PERSONNE_MAJORE_MAX)}. </>
              )}
            </>
          )}
          {r.plafondAtteintGardeEnfants && (
            <>
              Vos dépenses de garde hors domicile dépassent le plafond de {formatEUR(r.plafondGardeEnfants)} pour{" "}
              {profile.nombreEnfantsGardeHorsDomicile} enfant
              {profile.nombreEnfantsGardeHorsDomicile > 1 ? "s" : ""}.
            </>
          )}
        </p>
      )}

      <p>
        <strong>Un crédit d'impôt ne modifie pas le taux marginal, et donc pas le coût d'un euro supplémentaire.</strong>{" "}
        Il s'impute sur l'impôt <em>dû</em>, pas sur le revenu imposable : il ne déplace aucune tranche. Et lorsqu'il
        excède l'impôt, l'excédent est remboursé — un revenu supplémentaire ne fait alors que réduire ce remboursement
        d'autant, pour un coût net identique. Les simulations sont donc inchangées, ce qui est le comportement correct.
      </p>
      <p>
        <strong>Une réduction d'impôt non imputée, en revanche, change bel et bien la donne.</strong> Son excédent
        n'est pas remboursé : il est perdu. Tant qu'il subsiste, chaque euro d'impôt supplémentaire ne fait que
        l'absorber, si bien que le revenu qui le génère ne coûte rien.
        {r.reductionPerdue > 0 ? (
          <>
            {" "}
            C'est votre cas : <strong>{formatEUR(r.reductionPerdue)}</strong> de réduction sont aujourd'hui perdus. Les{" "}
            <strong>{formatEUR(r.revenuAbsorbeParReductionPerdue)}</strong> premiers euros de revenu imposable
            supplémentaire — rémunération, avantage en nature, indemnité d'occupation — n'engendreraient donc aucun
            impôt réel. Au-delà, le taux marginal de {formatPercent(r.tauxMarginalEffectif)} reprend ses droits. Les
            simulateurs ne tiennent pas compte de cette franchise : ils retiennent le taux marginal sur la totalité,
            et surestiment donc d'autant le coût de la première tranche de revenu.
          </>
        ) : (
          <>
            {" "}
            Ce n'est pas votre cas ici : vos réductions s'imputent intégralement sur l'impôt dû, sans excédent perdu.
          </>
        )}
      </p>
      <RuleNote ruleId="credit-impot-services-a-la-personne" />
      <RuleNote ruleId="credit-impot-garde-jeunes-enfants" />
    </details>
  );
}
