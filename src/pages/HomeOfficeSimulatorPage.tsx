import { useEffect, useMemo, useState } from "react";
import {
  type ChargeLine,
  type HomeOfficeInputs,
  computeHomeOffice,
  createDefaultHomeOfficeInputs,
} from "../lib/homeOffice";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { DEFAULT_CORPORATE_TAX_RATE } from "../lib/simulator";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { CopyButton } from "../components/CopyButton";
import { PersonalTaxProfileFields } from "../components/PersonalTaxProfileFields";
import { savePersonalTaxProfile, withPersistedPersonalTaxProfile } from "../lib/storage";
import { formatEUR, formatPercent } from "../lib/format";

const SURFACE_TOLERANCE = 0.3;

/** Résumé texte complet d'une simulation bureau à domicile, destiné à être copié dans le presse-papier. */
function buildHomeOfficeExportText(sim: HomeOfficeInputs): string {
  const r = computeHomeOffice(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(`🏠 ${sim.name} — Simulateur bureau à domicile`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push("— Logement —");
  push(`Statut : ${sim.statutOccupant} · Surface totale : ${sim.surfaceTotaleM2} m² · Surface bureau : ${sim.surfaceBureauM2} m²`);
  push(`Quote-part bureau : ${formatPercent(r.quotePartSurface)}`);
  push("");
  push("— Charges retenues —");
  for (const c of sim.chargeLines) {
    push(`  ${c.enabled ? "☑" : "☐"} ${c.label} : ${formatEUR(c.montantAnnuel)}/an`);
  }
  push(`Total charges retenues : ${formatEUR(r.totalChargesRetenuesAnnuel)}/an`);
  push("");
  push(`Formalisation : ${sim.formalisation === "bail_professionnel" ? "Bail professionnel réel" : "Indemnité d'occupation"}`);
  push(`Régime foncier : ${sim.regimeFoncier === "micro" ? "Micro-foncier" : "Réel"}${!r.eligibleMicroFoncier ? " (plafond dépassé, régime réel appliqué)" : ""}`);
  push("");
  push("— Résultats —");
  push(`Indemnité annuelle brute : ${formatEUR(r.indemniteAnnuelleBrute)}`);
  push(`Base imposable foncière : ${formatEUR(r.baseImposableFonciere)} · IR : ${formatEUR(r.irDu)} (TMI ${formatPercent(r.tauxIRUtilise)}) · Prélèvements sociaux : ${formatEUR(r.prelevementsSociaux)}`);
  push(`Gain net dirigeant (récurrent) : ${formatEUR(r.gainNetGerant)}`);
  if (sim.formalisation === "bail_professionnel" && sim.fraisMiseEnPlaceBail > 0) {
    push(`Gain net dirigeant — 1ère année (après frais de mise en place) : ${formatEUR(r.gainNetGerantAnnee1)}`);
  }
  push(`Coût net société (après économie d'impôt) : ${formatEUR(r.coutNetSociete)}`);
  push(`Économie vs bureau externe : ${formatEUR(r.economieVsBureauExterne)}`);
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

export function HomeOfficeSimulatorPage() {
  const [inputs, setInputs] = useState<HomeOfficeInputs>(() => withPersistedPersonalTaxProfile(createDefaultHomeOfficeInputs()));
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeHomeOffice(inputs), [inputs]);

  // Le revenu de référence du foyer fiscal est un réglage transversal (identique quel que soit le
  // simulateur) : on le persiste à chaque modification pour le retrouver pré-rempli sur les autres
  // simulateurs et à la prochaine visite.
  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  function update<K extends keyof HomeOfficeInputs>(key: K, value: HomeOfficeInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function updateChargeLine(id: string, patch: Partial<ChargeLine>) {
    setInputs((prev) => ({
      ...prev,
      chargeLines: prev.chargeLines.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  const surfaceRatio = inputs.surfaceTotaleM2 > 0 ? inputs.surfaceBureauM2 / inputs.surfaceTotaleM2 : 0;
  const surfaceDepasseTolerance = surfaceRatio > SURFACE_TOLERANCE;

  return (
    <div className="page">
      <h2>🏠 Indemnité d'occupation du domicile (bureau professionnel)</h2>
      <p className="page__intro">
        Le dirigeant met une partie de son domicile personnel à disposition de la société pour un usage
        professionnel. La société lui verse en contrepartie une indemnité d'occupation, déductible côté société et
        imposable côté dirigeant en tant que revenu foncier.
      </p>

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildHomeOfficeExportText(inputs)} />
      </div>

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
            <p className="hint-block">
              Quote-part du bureau : <strong>{formatPercent(results.quotePartSurface)}</strong> · Charges retenues
              (postes activés) : <strong>{formatEUR(results.totalChargesRetenuesAnnuel)}</strong>/an · Indemnité
              annuelle brute : <strong>{formatEUR(results.indemniteAnnuelleBrute)}</strong>
            </p>
            {surfaceDepasseTolerance && (
              <p className="warning-block">
                ⚠️ Surface du bureau ({formatPercent(surfaceRatio)}) au-delà de la tolérance pratique de 30% de la
                surface totale généralement admise sans justification renforcée. Restez en mesure de prouver la
                réalité de cet usage professionnel (photos, plan, absence d'usage personnel de la pièce).
              </p>
            )}
            <RuleNote ruleId="domicile-surface-bureau-tolerance-30-pourcent" />
          </Section>

          <Section
            title="Charges du logement retenues dans l'indemnité"
            subtitle="Chaque poste (y compris le loyer) est inclus par défaut mais peut être désactivé individuellement."
          >
            <ul className="charge-lines">
              {inputs.chargeLines.map((c) => (
                <li key={c.id} className="charge-line">
                  <label className="charge-line__toggle">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => updateChargeLine(c.id, { enabled: e.target.checked })}
                    />
                    <span>
                      {c.label}
                      {c.id === "loyer" && (inputs.statutOccupant === "locataire" ? " (loyer réel)" : " (valeur locative de marché)")}
                    </span>
                  </label>
                  <NumberInput
                    disabled={!c.enabled}
                    value={c.montantAnnuel}
                    onChange={(e) => updateChargeLine(c.id, { montantAnnuel: Number(e.target.value) })}
                  />
                  <span className="charge-line__unit">€/an</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Formalisation de la mise à disposition"
            subtitle="Même traitement fiscal de fond ; le bail réel est plus robuste juridiquement mais implique des frais de mise en place."
          >
            <div className="grid grid--2">
              <Field label="Formalisation retenue">
                <select
                  value={inputs.formalisation}
                  onChange={(e) => update("formalisation", e.target.value as HomeOfficeInputs["formalisation"])}
                >
                  <option value="indemnite">Indemnité d'occupation (convention simple)</option>
                  <option value="bail_professionnel">Bail professionnel réel (plus robuste)</option>
                </select>
              </Field>
              {inputs.formalisation === "bail_professionnel" && (
                <Field label="Frais de mise en place du bail (rédaction, enregistrement) (€, ponctuel)">
                  <NumberInput
                    value={inputs.fraisMiseEnPlaceBail}
                    onChange={(e) => update("fraisMiseEnPlaceBail", Number(e.target.value))}
                  />
                </Field>
              )}
            </div>
            <RuleNote ruleId="domicile-formalisation-bail-vs-indemnite" />
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

          <Section
            title="Régime fiscal & rentabilité de la société"
            subtitle="Le bénéfice prévisionnel détermine l'économie d'impôt réelle générée par l'indemnité déductible."
          >
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
              <Field label="Taux d'IS normal (tranche &gt; 42 500€, si régime IS)">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.corporateTaxRate}
                  defaultValue={DEFAULT_CORPORATE_TAX_RATE}
                  formatDefault={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update("corporateTaxRate", v)}
                />
              </Field>
            </div>
            {inputs.impositionSociete === "IS" && (
              <div className="grid grid--2">
                <Field label="Bénéfice imposable prévisionnel avant indemnité (€/an)">
                  <NumberInput
                    value={inputs.beneficeAvantChargePrevisionnel}
                    onChange={(e) => update("beneficeAvantChargePrevisionnel", Number(e.target.value))}
                  />
                </Field>
                <Field label="Éligible au taux réduit IS 15% (CA&lt;10M€, capital détenu ≥75% par des personnes physiques)">
                  <select
                    value={inputs.eligibleTauxReduitPME ? "oui" : "non"}
                    onChange={(e) => update("eligibleTauxReduitPME", e.target.value === "oui")}
                  >
                    <option value="oui">Oui</option>
                    <option value="non">Non</option>
                  </select>
                </Field>
              </div>
            )}
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section title="Situation personnelle du dirigeant" subtitle="Utilisée pour calculer le TMI appliqué au revenu foncier.">
            <PersonalTaxProfileFields
              profile={inputs.personalTaxProfile}
              onChange={(profile) => update("personalTaxProfile", profile)}
              showAutresRevenus={false}
              footerWhenCalcule={
                inputs.impositionSociete === "IR" && (
                  <p className="field__hint">
                    Le bénéfice prévisionnel de la société (régime IR, translucide) est ajouté au revenu imposable du
                    foyer pour déterminer le TMI réel.
                  </p>
                )
              }
              footerAlways={<RuleNote ruleId="ir-bareme-2026" />}
            />
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
            <StatCard label="Gain net pour le dirigeant (récurrent)" value={formatEUR(results.gainNetGerant)} tone="good" />
            {inputs.formalisation === "bail_professionnel" && inputs.fraisMiseEnPlaceBail > 0 && (
              <StatCard
                label="Gain net — 1ère année (après frais de mise en place)"
                value={formatEUR(results.gainNetGerantAnnee1)}
                tone={results.gainNetGerantAnnee1 >= 0 ? "good" : "bad"}
              />
            )}
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
              exportText={buildHomeOfficeExportText}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
