import { useMemo, useState } from "react";
import {
  type RemunerationInputs,
  type ScenarioResult,
  DEFAULT_TAUX_CHARGES_PATRONALES,
  DEFAULT_TAUX_CHARGES_SALARIALES,
  DEFAULT_TAUX_CHARGES_TNS,
  computeRemuneration,
  createDefaultRemunerationInputs,
} from "../lib/remuneration";
import { getCompanyType, getCompanyTypes } from "../lib/companyTypes";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { DEFAULT_CORPORATE_TAX_RATE } from "../lib/simulator";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { CopyButton } from "../components/CopyButton";
import { formatEUR, formatPercent } from "../lib/format";

/** Résumé texte complet d'une simulation rémunération, destiné à être copié dans le presse-papier. */
function buildRemunerationExportText(sim: RemunerationInputs): string {
  const r = computeRemuneration(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  const scenarioLine = (s: ScenarioResult) =>
    push(
      `  ${s.label} : net ${formatEUR(s.netTotalAnnuel)}/an (${formatEUR(s.netTotalMensuel)}/mois) — brut ${formatEUR(s.bruteTotalAnnuel)}/an — prélèvement global ${formatPercent(s.tauxPrelevementGlobal)}`,
    );

  push(`💰 ${sim.name} — Simulateur de rémunération du dirigeant`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push(`Forme juridique : ${sim.companyType} · Statut : ${r.dirigeantStatus === "TNS" ? "TNS" : "Assimilé salarié"} · Régime : ${sim.impositionSociete}`);
  push(`Enveloppe annuelle disponible (coût total entreprise) : ${formatEUR(sim.budgetAnnuelDisponible)}`);
  if (r.dirigeantStatus === "TNS") {
    push(
      `Capital social + primes + CCA : ${formatEUR(sim.capitalSocial + sim.primesEmissionEtCCA)} · Seuil dividendes sans cotisations sociales (10%) : ${formatEUR(r.seuilDividendesTNS)}/an`,
    );
  }
  push("");
  push("— Comparaison des 3 scénarios (à coût entreprise égal) —");
  for (const s of r.scenarios) scenarioLine(s);
  push("");
  push(`🏆 Scénario le plus avantageux pour le dirigeant : ${r.meilleurScenario.label}`);
  push("");
  push("— Détail du scénario mixte —");
  const m = r.scenarioMixte;
  push(`Part salaire : ${m.partSalairePourcent}% · Coût salaire : ${formatEUR(m.coutSalaireEntreprise)} · Bénéfice soumis à l'IS : ${formatEUR(m.beneficeSoumisIS)}`);
  push(`Salaire brut : ${formatEUR(m.salaireBrutAnnuel)}/an (${formatEUR(m.salaireBrutAnnuel / 12)}/mois) · Salaire net après IR : ${formatEUR(m.salaireNetApresImpotAnnuel)}/an (${formatEUR(m.salaireNetApresImpotAnnuel / 12)}/mois)`);
  push(`IS dû : ${formatEUR(m.isDue)} · Dividende brut distribuable : ${formatEUR(m.dividendeBrutDistribuable)}`);
  if (m.dividendeAuDessusSeuilTNS > 0) {
    push(`  dont sous seuil 10% : ${formatEUR(m.dividendeSousSeuilTNS)} · dont excédent (cotisations TNS) : ${formatEUR(m.dividendeAuDessusSeuilTNS)}`);
  }
  push(`Dividende net (après PS/cotisations TNS + IR) : ${formatEUR(m.dividendeNetAnnuel)}/an (${formatEUR(m.dividendeNetAnnuel / 12)}/mois)`);
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

export function RemunerationSimulatorPage() {
  const [inputs, setInputs] = useState<RemunerationInputs>(() => createDefaultRemunerationInputs());
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeRemuneration(inputs), [inputs]);

  function update<K extends keyof RemunerationInputs>(key: K, value: RemunerationInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function updatePersonalTax<K extends keyof RemunerationInputs["personalTaxProfile"]>(
    key: K,
    value: RemunerationInputs["personalTaxProfile"][K],
  ) {
    setInputs((prev) => ({ ...prev, personalTaxProfile: { ...prev.personalTaxProfile, [key]: value } }));
  }

  function handleSituationFamilialeChange(situationFamiliale: "seul" | "couple") {
    setInputs((prev) => ({
      ...prev,
      personalTaxProfile: {
        ...prev.personalTaxProfile,
        situationFamiliale,
        conjointSalaireNetImposableAnnuel:
          situationFamiliale === "couple" && prev.personalTaxProfile.conjointSalaireNetImposableAnnuel === 0
            ? prev.personalTaxProfile.salaireNetImposableAnnuel
            : prev.personalTaxProfile.conjointSalaireNetImposableAnnuel,
      },
    }));
  }

  function handleCompanyTypeChange(code: string) {
    setInputs((prev) => ({ ...prev, companyType: code, gerantMajoritaire: true }));
  }

  const companyTypes = getCompanyTypes(inputs.country);
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);

  return (
    <div className="page">
      <h2>💰 Rémunération du dirigeant — salaire, dividendes, ou un mixte des deux ?</h2>
      <p className="page__intro">
        À enveloppe totale égale pour l'entreprise, le simulateur compare le net réellement perçu par le dirigeant
        selon que cette enveloppe est versée en rémunération (charge déductible), en dividendes (distribués après
        IS), ou selon un mixte des deux — en tenant compte du statut social (TNS ou assimilé salarié) déterminé par
        la forme juridique.
      </p>

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildRemunerationExportText(inputs)} />
      </div>

      <div className="layout">
        <div className="layout__form">
          <Section title="Forme juridique & statut du dirigeant">
            <div className="grid grid--3">
              <Field label="Forme juridique">
                <select value={inputs.companyType} onChange={(e) => handleCompanyTypeChange(e.target.value)}>
                  {companyTypes.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Régime d'imposition de la société">
                <select
                  value={inputs.impositionSociete}
                  onChange={(e) => update("impositionSociete", e.target.value as RemunerationInputs["impositionSociete"])}
                >
                  {(companyTypeConfig?.impositionOptions ?? ["IS", "IR"]).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === "IS" ? "Impôt sur les sociétés (IS)" : "Impôt sur le revenu (IR, société translucide)"}
                    </option>
                  ))}
                </select>
              </Field>
              {companyTypeConfig?.hasGerantMajoriteOption && (
                <Field label="Le gérant est-il majoritaire ?">
                  <select
                    value={inputs.gerantMajoritaire ? "oui" : "non"}
                    onChange={(e) => update("gerantMajoritaire", e.target.value === "oui")}
                  >
                    <option value="oui">Oui — gérant majoritaire (statut TNS)</option>
                    <option value="non">Non — minoritaire/égalitaire (assimilé salarié)</option>
                  </select>
                </Field>
              )}
            </div>
            <p className="hint-block">
              Statut retenu :{" "}
              <strong>{results.dirigeantStatus === "TNS" ? "Travailleur Non Salarié (TNS)" : "Assimilé salarié"}</strong>
              {" — "}
              {companyTypeConfig?.description}
            </p>
            {inputs.impositionSociete === "IR" && (
              <p className="warning-block">
                Régime IR (société translucide) : le bénéfice est déjà taxé au barème IR du foyer quelle que soit son
                affectation. La distinction salaire/dividendes est nettement moins pertinente dans ce régime (pas
                d'IS, pas de PFU) — les résultats restent indicatifs.
              </p>
            )}
          </Section>

          <Section
            title="Enveloppe disponible & répartition"
            subtitle="Coût total identique pour l'entreprise dans les 3 scénarios comparés — seule la répartition change."
          >
            <div className="grid grid--2">
              <Field label="Enveloppe annuelle disponible pour la rémunération du dirigeant (€, coût total entreprise)">
                <NumberInput
                  value={inputs.budgetAnnuelDisponible}
                  onChange={(e) => update("budgetAnnuelDisponible", Number(e.target.value))}
                />
              </Field>
              <Field label="Part du budget allouée au salaire dans le scénario « mixte » (%)">
                <NumberInput
                  min={0}
                  max={100}
                  value={inputs.partSalaireSurBudgetMixte}
                  onChange={(e) => update("partSalaireSurBudgetMixte", Number(e.target.value))}
                />
              </Field>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={inputs.partSalaireSurBudgetMixte}
              onChange={(e) => update("partSalaireSurBudgetMixte", Number(e.target.value))}
              className="range-slider"
            />
          </Section>

          <Section
            title="Charges sociales"
            subtitle="Taux moyens forfaitaires (ordres de grandeur) — le taux effectivement appliqué dépend du statut résolu ci-dessus."
          >
            {results.dirigeantStatus === "TNS" ? (
              <Field label="Taux de cotisations sociales TNS (sur la rémunération nette)">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.tauxChargesTNS}
                  defaultValue={DEFAULT_TAUX_CHARGES_TNS}
                  formatDefault={(v) => formatPercent(v)}
                  onChange={(v) => update("tauxChargesTNS", v)}
                />
              </Field>
            ) : (
              <div className="grid grid--2">
                <Field label="Taux de charges patronales (sur le brut)">
                  <ResetableNumberInput
                    step="0.01"
                    value={inputs.tauxChargesPatronales}
                    defaultValue={DEFAULT_TAUX_CHARGES_PATRONALES}
                    formatDefault={(v) => formatPercent(v)}
                    onChange={(v) => update("tauxChargesPatronales", v)}
                  />
                </Field>
                <Field label="Taux de charges salariales (sur le brut)">
                  <ResetableNumberInput
                    step="0.01"
                    value={inputs.tauxChargesSalariales}
                    defaultValue={DEFAULT_TAUX_CHARGES_SALARIALES}
                    formatDefault={(v) => formatPercent(v)}
                    onChange={(v) => update("tauxChargesSalariales", v)}
                  />
                </Field>
              </div>
            )}
            <RuleNote ruleId={results.dirigeantStatus === "TNS" ? "cotisations-tns-taux-global" : "charges-patronales-salariales-assimile-salarie"} />
          </Section>

          <Section
            title="Dividendes"
            subtitle="Fiscalité applicable aux dividendes distribués par la société après IS."
          >
            {results.dirigeantStatus === "TNS" && (
              <>
                <div className="grid grid--2">
                  <Field label="Capital social (€)">
                    <NumberInput value={inputs.capitalSocial} onChange={(e) => update("capitalSocial", Number(e.target.value))} />
                  </Field>
                  <Field label="Primes d'émission + comptes courants d'associés (€)">
                    <NumberInput
                      value={inputs.primesEmissionEtCCA}
                      onChange={(e) => update("primesEmissionEtCCA", Number(e.target.value))}
                    />
                  </Field>
                </div>
                <p className="hint-block">
                  Seuil au-delà duquel les dividendes supportent des cotisations sociales TNS (10% du capital + primes
                  + CCA) : <strong>{formatEUR(results.seuilDividendesTNS)}</strong>/an
                </p>
                <RuleNote ruleId="dividendes-tns-seuil-10-pourcent-cotisations" />
              </>
            )}
            <Field label="Option pour le barème progressif de l'IR (sinon PFU 30% par défaut)">
              <select
                value={inputs.optionBaremeProgressifDividendes ? "oui" : "non"}
                onChange={(e) => update("optionBaremeProgressifDividendes", e.target.value === "oui")}
              >
                <option value="non">Non — PFU (flat tax) 30%</option>
                <option value="oui">Oui — barème progressif (abattement 40%)</option>
              </select>
            </Field>
            <RuleNote ruleId="pfu-dividendes-taux" />
          </Section>

          <Section title="Régime fiscal & rentabilité de la société">
            <div className="grid grid--2">
              <Field label="Taux d'IS normal (tranche &gt; 42 500€, si régime IS)">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.corporateTaxRate}
                  defaultValue={DEFAULT_CORPORATE_TAX_RATE}
                  formatDefault={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update("corporateTaxRate", v)}
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
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section title="Revenu de référence du foyer fiscal" subtitle="Utilisé pour calculer le taux marginal d'imposition (TMI) réel appliqué au salaire et aux dividendes soumis au barème.">
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
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.personalTaxProfile.tauxManuel}
                  defaultValue={0.3}
                  formatDefault={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => updatePersonalTax("tauxManuel", v)}
                />
              </Field>
            ) : (
              <>
                <div className="grid grid--3">
                  <Field label="Situation familiale">
                    <select
                      value={inputs.personalTaxProfile.situationFamiliale}
                      onChange={(e) => handleSituationFamilialeChange(e.target.value as "seul" | "couple")}
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
                  <Field label="Autres revenus imposables du foyer (€/an, hors rémunération/dividendes simulés)">
                    <NumberInput
                      value={inputs.personalTaxProfile.autresRevenusImposablesFoyer}
                      onChange={(e) => updatePersonalTax("autresRevenusImposablesFoyer", Number(e.target.value))}
                    />
                  </Field>
                </div>
                {inputs.personalTaxProfile.situationFamiliale === "couple" && (
                  <Field label="Salaire net imposable annuel du conjoint (€)">
                    <NumberInput
                      value={inputs.personalTaxProfile.conjointSalaireNetImposableAnnuel}
                      onChange={(e) => updatePersonalTax("conjointSalaireNetImposableAnnuel", Number(e.target.value))}
                    />
                  </Field>
                )}
              </>
            )}
            <RuleNote ruleId="ir-bareme-2026" />
          </Section>

          <Field label="Nom de la simulation">
            <input value={inputs.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
        </div>

        <div className="layout__results">
          <p className="hint-block">
            🏆 Scénario le plus avantageux pour le dirigeant : <strong>{results.meilleurScenario.label}</strong> — net{" "}
            <strong>{formatEUR(results.meilleurScenario.netTotalAnnuel)}</strong>/an (
            {formatEUR(results.meilleurScenario.netTotalMensuel)}/mois)
          </p>

          {[results.scenarioSalaire, results.scenarioDividendes, results.scenarioMixte].map((s) => (
            <Section
              key={s.key}
              title={s.label}
              subtitle={s.key === results.meilleurScenario.key ? "🏆 Le plus avantageux pour le dirigeant" : undefined}
            >
              <div className="stat-grid">
                <StatCard label="Brut annuel" value={formatEUR(s.bruteTotalAnnuel)} sub={`${formatEUR(s.bruteTotalMensuel)}/mois`} />
                <StatCard
                  label="Net annuel"
                  value={formatEUR(s.netTotalAnnuel)}
                  sub={`${formatEUR(s.netTotalMensuel)}/mois`}
                  tone={s.key === results.meilleurScenario.key ? "good" : "neutral"}
                />
                <StatCard label="Prélèvement global" value={formatPercent(s.tauxPrelevementGlobal)} sub="charges + IS + IR/PFU, vs enveloppe" tone="bad" />
              </div>
              <p className="field__hint">
                Salaire : brut {formatEUR(s.salaireBrutAnnuel)} · net après IR {formatEUR(s.salaireNetApresImpotAnnuel)}
                {s.cotisationsTNS > 0 && ` · cotisations TNS ${formatEUR(s.cotisationsTNS)}`}
                {s.cotisationsPatronales > 0 && ` · charges patronales ${formatEUR(s.cotisationsPatronales)}`}
                {s.cotisationsSalariales > 0 && ` · charges salariales ${formatEUR(s.cotisationsSalariales)}`}
              </p>
              <p className="field__hint">
                Dividendes : IS {formatEUR(s.isDue)} · brut distribuable {formatEUR(s.dividendeBrutDistribuable)} · net{" "}
                {formatEUR(s.dividendeNetAnnuel)}
                {s.dividendeAuDessusSeuilTNS > 0 && ` (dont ${formatEUR(s.dividendeAuDessusSeuilTNS)} soumis aux cotisations TNS)`}
              </p>
            </Section>
          ))}

          <Section title="Sauvegarde & comparaison">
            <SavedSimulationsPanel
              kind="remuneration"
              currentInputs={inputs}
              version={saveVersion}
              onLoad={(loaded) => {
                setInputs(loaded);
                setSaveVersion((v) => v + 1);
              }}
              metricsFor={(sim) => {
                const r = computeRemuneration(sim);
                return [
                  { label: "Net — 100% Salaire", value: formatEUR(r.scenarioSalaire.netTotalAnnuel) },
                  { label: "Net — 100% Dividendes", value: formatEUR(r.scenarioDividendes.netTotalAnnuel) },
                  { label: "Net — Mixte", value: formatEUR(r.scenarioMixte.netTotalAnnuel) },
                  { label: "Meilleur scénario", value: r.meilleurScenario.label },
                ];
              }}
              exportText={buildRemunerationExportText}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
