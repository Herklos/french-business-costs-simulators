import { useMemo, useState } from "react";
import {
  type HomeOfficeInputs,
  computeHomeOffice,
  createDefaultHomeOfficeInputs,
} from "../lib/homeOffice";
import { Field, NumberInput, Section, StatCard } from "../components/Field";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { formatEUR, formatPercent } from "../lib/format";

export function HomeOfficeSimulatorPage() {
  const [inputs, setInputs] = useState<HomeOfficeInputs>(() => createDefaultHomeOfficeInputs());
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeHomeOffice(inputs), [inputs]);

  function update<K extends keyof HomeOfficeInputs>(key: K, value: HomeOfficeInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function updatePersonalTax<K extends keyof HomeOfficeInputs["personalTaxProfile"]>(
    key: K,
    value: HomeOfficeInputs["personalTaxProfile"][K],
  ) {
    setInputs((prev) => ({ ...prev, personalTaxProfile: { ...prev.personalTaxProfile, [key]: value } }));
  }

  return (
    <div className="page">
      <h2>🏠 Indemnité d'occupation du domicile (bureau professionnel)</h2>
      <p className="page__intro">
        Le dirigeant met une partie de son domicile personnel à disposition de la société pour un usage
        professionnel. La société lui verse en contrepartie une indemnité d'occupation, déductible côté société et
        imposable côté dirigeant en tant que revenu foncier.
      </p>

      <div className="layout">
        <div className="layout__form">
          <Section title="Logement">
            <div className="grid grid--3">
              <Field label="Statut">
                <select
                  value={inputs.statutOccupant}
                  onChange={(e) => update("statutOccupant", e.target.value as HomeOfficeInputs["statutOccupant"])}
                >
                  <option value="proprietaire">Propriétaire</option>
                  <option value="locataire">Locataire</option>
                </select>
              </Field>
              <Field label="Surface totale du logement (m²)">
                <NumberInput value={inputs.surfaceTotaleM2} onChange={(e) => update("surfaceTotaleM2", Number(e.target.value))} />
              </Field>
              <Field label="Surface du bureau professionnel (m²)">
                <NumberInput value={inputs.surfaceBureauM2} onChange={(e) => update("surfaceBureauM2", Number(e.target.value))} />
              </Field>
            </div>
            <div className="grid grid--2">
              <Field label={inputs.statutOccupant === "locataire" ? "Loyer mensuel réel payé (€)" : "Valeur locative de marché estimée (€/mois)"}>
                <NumberInput
                  value={inputs.loyerOuValeurLocativeMensuel}
                  onChange={(e) => update("loyerOuValeurLocativeMensuel", Number(e.target.value))}
                />
              </Field>
              <Field label="Charges annuelles (chauffage, électricité, assurance, taxe foncière...) (€)">
                <NumberInput value={inputs.chargesAnnuelles} onChange={(e) => update("chargesAnnuelles", Number(e.target.value))} />
              </Field>
            </div>
            <p className="hint-block">
              Quote-part du bureau : <strong>{formatPercent(results.quotePartSurface)}</strong> · Indemnité annuelle
              brute : <strong>{formatEUR(results.indemniteAnnuelleBrute)}</strong>
            </p>
          </Section>

          <Section title="Fiscalité de l'indemnité (revenus fonciers du dirigeant)">
            <div className="grid grid--2">
              <Field label="Régime foncier">
                <select
                  value={inputs.regimeFoncier}
                  onChange={(e) => update("regimeFoncier", e.target.value as HomeOfficeInputs["regimeFoncier"])}
                >
                  <option value="micro">Micro-foncier (abattement 30 %)</option>
                  <option value="reel">Réel (charges déduites)</option>
                </select>
              </Field>
              <Field label="Autres revenus fonciers du foyer (€/an)">
                <NumberInput
                  value={inputs.autresRevenusFonciersFoyer}
                  onChange={(e) => update("autresRevenusFonciersFoyer", Number(e.target.value))}
                />
              </Field>
            </div>
            {!results.eligibleMicroFoncier && inputs.regimeFoncier === "micro" && (
              <p className="warning-block">
                Plafond micro-foncier (15 000 €) dépassé : le régime réel est appliqué automatiquement.
              </p>
            )}
            <RuleNote ruleId="foncier-abattement-micro" />
            <RuleNote ruleId="foncier-prelevements-sociaux" />
          </Section>

          <Section title="Régime fiscal & social de la société">
            <div className="grid grid--2">
              <Field label="Régime d'imposition">
                <select
                  value={inputs.impositionSociete}
                  onChange={(e) => update("impositionSociete", e.target.value as HomeOfficeInputs["impositionSociete"])}
                >
                  <option value="IS">Impôt sur les sociétés (IS)</option>
                  <option value="IR">Impôt sur le revenu (IR, société translucide)</option>
                </select>
              </Field>
              <Field label="Taux d'IS (si régime IS)">
                <NumberInput step="0.01" value={inputs.corporateTaxRate} onChange={(e) => update("corporateTaxRate", Number(e.target.value))} />
              </Field>
            </div>
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section title="Situation personnelle du dirigeant" subtitle="Utilisée pour calculer le TMI appliqué au revenu foncier.">
            <Field label="Mode">
              <select
                value={inputs.personalTaxProfile.mode}
                onChange={(e) => updatePersonalTax("mode", e.target.value as "manuel" | "calcule")}
              >
                <option value="calcule">Calculer le TMI à partir de ma situation</option>
                <option value="manuel">Saisir un taux manuel</option>
              </select>
            </Field>
            {inputs.personalTaxProfile.mode === "manuel" ? (
              <Field label="Taux marginal d'imposition manuel">
                <NumberInput
                  step="0.01"
                  value={inputs.personalTaxProfile.tauxManuel}
                  onChange={(e) => updatePersonalTax("tauxManuel", Number(e.target.value))}
                />
              </Field>
            ) : (
              <div className="grid grid--3">
                <Field label="Situation familiale">
                  <select
                    value={inputs.personalTaxProfile.situationFamiliale}
                    onChange={(e) => updatePersonalTax("situationFamiliale", e.target.value as "seul" | "couple")}
                  >
                    <option value="seul">Célibataire / divorcé(e) / veuf(ve)</option>
                    <option value="couple">Marié(e) / pacsé(e)</option>
                  </select>
                </Field>
                <Field label="Nombre d'enfants à charge">
                  <NumberInput
                    value={inputs.personalTaxProfile.nombreEnfants}
                    onChange={(e) => updatePersonalTax("nombreEnfants", Number(e.target.value))}
                  />
                </Field>
                <Field label="Salaire net imposable annuel (€)">
                  <NumberInput
                    value={inputs.personalTaxProfile.salaireNetImposableAnnuel}
                    onChange={(e) => updatePersonalTax("salaireNetImposableAnnuel", Number(e.target.value))}
                  />
                </Field>
              </div>
            )}
            <RuleNote ruleId="ir-bareme-2026" />
          </Section>

          <Section title="Comparaison — bureau externe">
            <Field label="Loyer d'un bureau externe équivalent (€/mois)">
              <NumberInput
                value={inputs.loyerBureauExterneMensuel}
                onChange={(e) => update("loyerBureauExterneMensuel", Number(e.target.value))}
              />
            </Field>
          </Section>

          <Field label="Nom de la simulation">
            <input value={inputs.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
        </div>

        <div className="layout__results">
          <div className="stat-grid">
            <StatCard label="Indemnité annuelle brute" value={formatEUR(results.indemniteAnnuelleBrute)} />
            <StatCard label="Base imposable foncière" value={formatEUR(results.baseImposableFonciere)} />
            <StatCard label="IR dû" value={formatEUR(results.irDu)} sub={`TMI : ${formatPercent(results.tauxIRUtilise)}`} />
            <StatCard label="Prélèvements sociaux (17,2 %)" value={formatEUR(results.prelevementsSociaux)} />
            <StatCard label="Gain net pour le dirigeant" value={formatEUR(results.gainNetGerant)} tone="good" />
            <StatCard label="Coût net société (après économie d'impôt)" value={formatEUR(results.coutNetSociete)} tone="bad" />
            <StatCard
              label="Économie vs bureau externe"
              value={formatEUR(results.economieVsBureauExterne)}
              tone={results.economieVsBureauExterne >= 0 ? "good" : "bad"}
            />
          </div>

          <Section title="Sauvegarde & comparaison">
            <SavedSimulationsPanel
              kind="homeOffice"
              currentInputs={inputs}
              version={saveVersion}
              onLoad={(loaded) => {
                setInputs(loaded);
                setSaveVersion((v) => v + 1);
              }}
              metricsFor={(sim) => {
                const r = computeHomeOffice(sim);
                return [
                  { label: "Indemnité annuelle brute", value: formatEUR(r.indemniteAnnuelleBrute) },
                  { label: "Gain net dirigeant", value: formatEUR(r.gainNetGerant) },
                  { label: "Coût net société", value: formatEUR(r.coutNetSociete) },
                  { label: "Économie vs bureau externe", value: formatEUR(r.economieVsBureauExterne) },
                ];
              }}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
