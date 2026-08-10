import { useEffect, useMemo, useState } from "react";
import {
  type RemunerationInputs,
  type ScenarioResult,
  DEFAULT_TAUX_CHARGES_PATRONALES,
  DEFAULT_TAUX_CHARGES_SALARIALES,
  DEFAULT_TAUX_CHARGES_TNS,
  breakdownCotisationsTNS,
  computeRemuneration,
  createDefaultRemunerationInputs,
} from "../lib/remuneration";
import {
  type InteressementInputs,
  computeInteressement,
  createDefaultInteressementInputs,
} from "../lib/interessement";
import {
  type AttributionActionsGratuitesInputs,
  computeAttributionActionsGratuites,
  createDefaultAttributionActionsGratuitesInputs,
} from "../lib/attributionActionsGratuites";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { DEFAULT_CORPORATE_TAX_RATE } from "../lib/simulator";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { CopyButton } from "../components/CopyButton";
import { ShareButton } from "../components/ShareButton";
import { PdfButton } from "../components/PdfButton";
import { PrintableReport } from "../components/PrintableReport";
import { mergeSharedInputs } from "../lib/urlShare";
import { CompanyTypeFields } from "../components/CompanyTypeFields";
import { PersonalTaxProfileFields } from "../components/PersonalTaxProfileFields";
import { savePersonalTaxProfile, withPersistedPersonalTaxProfile } from "../lib/storage";
import { resolvePersonalTaxProfile } from "../lib/frenchIncomeTax";
import { formatEUR, formatEURPrecise, formatPercent } from "../lib/format";

/** Résumé texte complet d'une simulation rémunération, destiné à être copié dans le presse-papier. */
function buildRemunerationExportText(sim: RemunerationInputs): string {
  const r = computeRemuneration(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  const scenarioLine = (s: ScenarioResult) =>
    push(
      `  ${s.label} : net ${formatEUR(s.netTotalAnnuel)}/an (${formatEUR(s.netTotalMensuel)}/mois) — brut ${formatEUR(s.bruteTotalAnnuel)}/an — coût pour 1€ net : ${Number.isFinite(s.coutPour1EuroNet) ? formatEURPrecise(s.coutPour1EuroNet) : "—"} (prélèvement global ${formatPercent(s.tauxPrelevementGlobal)})`,
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

export function RemunerationSimulatorPage({ initialShareData }: { initialShareData?: string }) {
  const [inputs, setInputs] = useState<RemunerationInputs>(
    () => mergeSharedInputs(withPersistedPersonalTaxProfile(createDefaultRemunerationInputs()), initialShareData),
  );
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeRemuneration(inputs), [inputs]);
  const tauxIRUtilise = resolvePersonalTaxProfile(inputs.personalTaxProfile).tauxUtilise;

  const [interessementInputs, setInteressementInputs] = useState<InteressementInputs>(() => createDefaultInteressementInputs());
  const [agaInputs, setAgaInputs] = useState<AttributionActionsGratuitesInputs>(() => createDefaultAttributionActionsGratuitesInputs());

  // Ces deux calculateurs annexes (intéressement, AGA) sont des charges/opérations déductibles
  // additionnelles : faute d'un "bénéfice prévisionnel" dédié dans ce simulateur, on retient
  // l'enveloppe budgétaire déjà saisie comme référence pour le calcul de l'économie d'impôt société.
  const ctxAddons = useMemo(
    () => ({
      impositionSociete: inputs.impositionSociete,
      beneficeAvantChargePrevisionnel: inputs.budgetAnnuelDisponible,
      eligibleTauxReduitPME: inputs.eligibleTauxReduitPME,
      corporateTaxRate: inputs.corporateTaxRate,
    }),
    [inputs.impositionSociete, inputs.budgetAnnuelDisponible, inputs.eligibleTauxReduitPME, inputs.corporateTaxRate],
  );
  const interessementResults = useMemo(
    () => computeInteressement(interessementInputs, ctxAddons, tauxIRUtilise),
    [interessementInputs, ctxAddons, tauxIRUtilise],
  );
  const agaResults = useMemo(
    () => computeAttributionActionsGratuites(agaInputs, ctxAddons, tauxIRUtilise),
    [agaInputs, ctxAddons, tauxIRUtilise],
  );

  function updateInteressement<K extends keyof InteressementInputs>(key: K, value: InteressementInputs[K]) {
    setInteressementInputs((prev) => ({ ...prev, [key]: value }));
  }

  function updateAga<K extends keyof AttributionActionsGratuitesInputs>(key: K, value: AttributionActionsGratuitesInputs[K]) {
    setAgaInputs((prev) => ({ ...prev, [key]: value }));
  }

  // Le revenu de référence du foyer fiscal est un réglage transversal (identique quel que soit le
  // simulateur) : on le persiste à chaque modification pour le retrouver pré-rempli sur les autres
  // simulateurs et à la prochaine visite.
  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  function update<K extends keyof RemunerationInputs>(key: K, value: RemunerationInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function handleCompanyTypeChange(code: string) {
    setInputs((prev) => ({ ...prev, companyType: code, gerantMajoritaire: true }));
  }

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
        <ShareButton page="remuneration" getInputs={() => inputs} />
        <PdfButton />
      </div>
      <PrintableReport text={buildRemunerationExportText(inputs)} />

      <div className="layout">
        <div className="layout__form">
          <Section title="Forme juridique & statut du dirigeant">
            <CompanyTypeFields
              country={inputs.country}
              companyType={inputs.companyType}
              gerantMajoritaire={inputs.gerantMajoritaire}
              impositionSociete={inputs.impositionSociete}
              onCountryChange={(country) => update("country", country)}
              onCompanyTypeChange={handleCompanyTypeChange}
              onGerantMajoritaireChange={(v) => update("gerantMajoritaire", v)}
              onImpositionChange={(v) => update("impositionSociete", v)}
            >
              {inputs.impositionSociete === "IR" && (
                <p className="warning-block">
                  Régime IR (société translucide) : le bénéfice est déjà taxé au barème IR du foyer quelle que soit
                  son affectation. La distinction salaire/dividendes est nettement moins pertinente dans ce régime
                  (pas d'IS, pas de PFU) — les résultats restent indicatifs.
                </p>
              )}
            </CompanyTypeFields>
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
            <Field
              label="Rémunération variable / bonus annuel (€, en plus de l'enveloppe)"
              hint="Toujours versé en salaire (jamais en dividendes), dans les 3 scénarios comparés."
            >
              <NumberInput value={inputs.bonusAnnuel} onChange={(e) => update("bonusAnnuel", Number(e.target.value))} />
            </Field>
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
            {results.dirigeantStatus === "TNS" && (
              <>
                <p className="field__hint">
                  Répartition indicative des cotisations TNS par branche (scénario 100% salaire, non officielle — cf.
                  note ci-dessus) :
                </p>
                <ul className="detail-list">
                  {breakdownCotisationsTNS(results.scenarioSalaire.cotisationsTNS).map((l) => (
                    <li key={l.label}>
                      {l.label} : {formatEUR(l.value)}
                    </li>
                  ))}
                </ul>
              </>
            )}
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

          <Section
            title="🤝 Intéressement du dirigeant"
            subtitle="Depuis la loi PACTE, un dirigeant peut bénéficier de l'intéressement mis en place dans son entreprise — canal optionnel, en plus du salaire/dividendes ci-dessus."
          >
            <div className="grid grid--2">
              <Field label="Montant annuel d'intéressement (€)">
                <NumberInput
                  value={interessementInputs.montantAnnuel}
                  onChange={(e) => updateInteressement("montantAnnuel", Number(e.target.value))}
                />
              </Field>
              <Field label="Entreprise de moins de 250 salariés ?" hint="Exonère le forfait social (20% sinon).">
                <select
                  value={interessementInputs.entrepriseMoinsDe250Salaries ? "oui" : "non"}
                  onChange={(e) => updateInteressement("entrepriseMoinsDe250Salaries", e.target.value === "oui")}
                >
                  <option value="oui">Oui</option>
                  <option value="non">Non</option>
                </select>
              </Field>
            </div>
            <Field label="Placé sur un plan d'épargne salariale (PEE/PERCO) ?" hint="Exonère l'IR (mais pas la CSG-CRDS) si placé au moins 5 ans.">
              <select
                value={interessementInputs.placeSurPlanEpargneSalariale ? "oui" : "non"}
                onChange={(e) => updateInteressement("placeSurPlanEpargneSalariale", e.target.value === "oui")}
              >
                <option value="non">Non — perçu immédiatement</option>
                <option value="oui">Oui — placé</option>
              </select>
            </Field>
            <div className="stat-grid">
              <StatCard label="Coût net société" value={formatEUR(interessementResults.coutNetSociete)} tone="bad" />
              <StatCard label="Net dirigeant" value={formatEUR(interessementResults.netDirigeant)} tone="good" />
            </div>
            <RuleNote ruleId="interessement-forfait-social-pacte" />
          </Section>

          {results.dirigeantStatus === "ASSIMILE_SALARIE" && (
            <Section
              title="📈 Attribution Gratuite d'Actions (AGA)"
              subtitle="Réservé aux sociétés par actions (SAS/SASU). Régime fiscal parmi les plus complexes — calcul simplifié, à confirmer avec un expert-comptable."
            >
              <div className="grid grid--2">
                <Field label="Valeur des actions à l'acquisition définitive (€)">
                  <NumberInput
                    value={agaInputs.valeurActionsAttribution}
                    onChange={(e) => updateAga("valeurActionsAttribution", Number(e.target.value))}
                  />
                </Field>
                <Field label="Prix de cession estimé (€)">
                  <NumberInput
                    value={agaInputs.prixCessionEstime}
                    onChange={(e) => updateAga("prixCessionEstime", Number(e.target.value))}
                  />
                </Field>
              </div>
              <Field label="PME n'ayant jamais distribué de dividendes ?" hint="Exonère la contribution patronale de 20%.">
                <select
                  value={agaInputs.pmeExonereeContributionPatronale ? "oui" : "non"}
                  onChange={(e) => updateAga("pmeExonereeContributionPatronale", e.target.value === "oui")}
                >
                  <option value="oui">Oui</option>
                  <option value="non">Non</option>
                </select>
              </Field>
              <div className="stat-grid">
                <StatCard label="Contribution patronale" value={formatEUR(agaResults.contributionPatronale)} tone="bad" />
                <StatCard label="Coût net société" value={formatEUR(agaResults.coutNetSociete)} tone="bad" />
                <StatCard label="Net bénéficiaire (après PFU sur les 2 gains)" value={formatEUR(agaResults.netBeneficiaire)} tone="good" />
              </div>
              <RuleNote ruleId="aga-regime-simplifie" />
            </Section>
          )}

          <Section
            title="📅 Projection pluriannuelle"
            subtitle="Net cumulé sur plusieurs années, à budget constant ou croissant, pour chaque scénario."
          >
            <div className="grid grid--2">
              <Field label="Durée de projection (années)">
                <NumberInput value={inputs.projectionYears} onChange={(e) => update("projectionYears", Number(e.target.value))} />
              </Field>
              <Field label="Croissance annuelle estimée du budget (%)">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.tauxCroissanceBudgetAnnuel}
                  defaultValue={0}
                  formatDefault={(v) => formatPercent(v)}
                  onChange={(v) => update("tauxCroissanceBudgetAnnuel", v)}
                />
              </Field>
            </div>
            {results.projection.length > 0 && (
              <div className="rules-table-wrap">
                <table className="rules-table">
                  <thead>
                    <tr>
                      <th>Année</th>
                      <th>Cumul net — Salaire</th>
                      <th>Cumul net — Dividendes</th>
                      <th>Cumul net — Mixte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.projection.map((p) => (
                      <tr key={p.year}>
                        <td>{p.year}</td>
                        <td>{formatEUR(p.cumulSalaire)}</td>
                        <td>{formatEUR(p.cumulDividendes)}</td>
                        <td>{formatEUR(p.cumulMixte)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Revenu de référence du foyer fiscal" subtitle="Utilisé pour calculer le taux marginal d'imposition (TMI) réel appliqué au salaire et aux dividendes soumis au barème.">
            <PersonalTaxProfileFields
              profile={inputs.personalTaxProfile}
              onChange={(profile) => update("personalTaxProfile", profile)}
              showSalaireDirigeant={false}
              footerAlways={<RuleNote ruleId="ir-bareme-2026" />}
            />
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

          <Section
            title="Coût, tout compris, pour 1€ net perçu par le dirigeant"
            subtitle="À enveloppe entreprise égale : combien l'entreprise doit-elle décaisser pour que le dirigeant touche 1€ net, selon le mode retenu ? Le plus bas est le plus efficace."
          >
            <div className="stat-grid">
              {[results.scenarioSalaire, results.scenarioDividendes, results.scenarioMixte].map((s) => (
                <StatCard
                  key={s.key}
                  label={s.label}
                  value={Number.isFinite(s.coutPour1EuroNet) ? `${formatEURPrecise(s.coutPour1EuroNet)}` : "—"}
                  sub={s.key === results.meilleurScenario.key ? "🏆 le plus efficace" : undefined}
                  tone={s.key === results.meilleurScenario.key ? "good" : "neutral"}
                />
              ))}
            </div>
          </Section>

          {[results.scenarioSalaire, results.scenarioDividendes, results.scenarioMixte].map((s) => (
            <Section
              key={s.key}
              title={s.label}
              subtitle={s.key === results.meilleurScenario.key ? "🏆 Le plus avantageux pour le dirigeant" : undefined}
            >
              <div className="stat-grid">
                <StatCard
                  label="Coût pour 1€ net perçu"
                  value={Number.isFinite(s.coutPour1EuroNet) ? formatEURPrecise(s.coutPour1EuroNet) : "—"}
                  sub={`prélèvement global : ${formatPercent(s.tauxPrelevementGlobal)}`}
                  tone={s.key === results.meilleurScenario.key ? "good" : "bad"}
                />
                <StatCard label="Brut annuel" value={formatEUR(s.bruteTotalAnnuel)} sub={`${formatEUR(s.bruteTotalMensuel)}/mois`} />
                <StatCard
                  label="Net annuel"
                  value={formatEUR(s.netTotalAnnuel)}
                  sub={`${formatEUR(s.netTotalMensuel)}/mois`}
                  tone={s.key === results.meilleurScenario.key ? "good" : "neutral"}
                />
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
