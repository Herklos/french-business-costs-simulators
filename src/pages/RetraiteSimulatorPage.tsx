import { useEffect, useMemo, useState } from "react";
import { type RetraiteInputs, computeRetraite, createDefaultRetraiteInputs } from "../lib/retraite";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { DEFAULT_CORPORATE_TAX_RATE } from "../lib/simulator";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { CopyButton } from "../components/CopyButton";
import { CompanyTypeFields } from "../components/CompanyTypeFields";
import { PersonalTaxProfileFields } from "../components/PersonalTaxProfileFields";
import { savePersonalTaxProfile, withPersistedPersonalTaxProfile } from "../lib/storage";
import { formatEUR, formatPercent } from "../lib/format";

/** Résumé texte complet d'une simulation épargne retraite, destiné à être copié dans le presse-papier. */
function buildRetraiteExportText(sim: RetraiteInputs): string {
  const r = computeRetraite(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(`🏦 ${sim.name} — Simulateur épargne retraite du dirigeant (PER / Madelin)`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push(`Forme juridique : ${sim.companyType} · Statut : ${r.dirigeantStatus === "TNS" ? "TNS (Madelin retraite)" : "Assimilé salarié (PER individuel classique)"}`);
  push(`Versement annuel : ${formatEUR(sim.versementAnnuel)}`);
  push(`Plafond de déduction : ${formatEUR(r.plafondDeduction)} · Déductible : ${formatEUR(r.versementDeductible)} · Non déductible : ${formatEUR(r.versementNonDeductible)}`);
  push("");
  push("— Résultats —");
  if (r.dirigeantStatus === "TNS") {
    push(`Versement pris en charge par la société · Économie d'impôt société : ${formatEUR(r.economieImpotSociete)}`);
  } else {
    push(`Versement financé personnellement · Économie d'impôt (IR) : ${formatEUR(r.economieImpotDirigeant)}`);
  }
  push(`Coût net global : ${formatEUR(r.coutNetGlobal)} (${formatPercent(r.tauxEconomieGlobal)} d'économie vs versement brut)`);
  if (sim.plafondNonUtiliseAnneesPrecedentes > 0) {
    push(
      `Report des plafonds non utilisés (3 ans) : +${formatEUR(sim.plafondNonUtiliseAnneesPrecedentes)} → plafond total ${formatEUR(r.plafondDeductionAvecReport)}, versement déductible ${formatEUR(r.versementDeductibleAvecReport)}`,
    );
  }
  push("");
  if (r.dureeProjectionAnnees > 0) {
    push("— Projection & rente viagère —");
    push(
      `À ${sim.ageDepartRetraite} ans (${r.dureeProjectionAnnees} ans de versements, rendement ${formatPercent(sim.tauxRendementAnnuelProjection)}/an) : capital brut projeté ${formatEUR(r.capitalBrutFinalProjete)} (dont plus-value ${formatEUR(r.plusValueLatenteFinale)})`,
    );
    push(`Rente viagère estimée : ${formatEUR(r.renteViagereAnnuelleEstimee)}/an, soit ${formatEUR(r.renteViagereMensuelleEstimee)}/mois`);
    push(
      `PER vs assurance-vie (capital net à la sortie) : PER ${formatEUR(r.comparaisonAssuranceVie.perCapitalNetApresImpot)} vs assurance-vie ${formatEUR(r.comparaisonAssuranceVie.assuranceVieCapitalNetApresImpot)}`,
    );
    push("");
  }
  push("— Liquidité —");
  push("Sortie normale : à l'âge légal de la retraite (62 à 64 ans selon l'année de naissance) ou à la liquidation de la pension.");
  push(
    "Déblocage anticipé (aucune durée minimale) : décès du conjoint/partenaire de PACS, invalidité, surendettement, fin de droits chômage, cessation d'activité non salariée suite à liquidation judiciaire, achat de la résidence principale (PER uniquement). Le mariage n'en fait PAS partie.",
  );
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

export function RetraiteSimulatorPage() {
  const [inputs, setInputs] = useState<RetraiteInputs>(() => withPersistedPersonalTaxProfile(createDefaultRetraiteInputs()));
  const [saveVersion, setSaveVersion] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const results = useMemo(() => computeRetraite(inputs), [inputs]);

  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  function update<K extends keyof RetraiteInputs>(key: K, value: RetraiteInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function handleCompanyTypeChange(code: string) {
    setInputs((prev) => ({ ...prev, companyType: code, gerantMajoritaire: true }));
  }

  return (
    <div className="page">
      <h2>🏦 Épargne retraite du dirigeant (PER individuel / Madelin retraite)</h2>
      <p className="page__intro">
        Le plafond de déduction fiscale d'un versement sur un plan d'épargne retraite dépend du statut du dirigeant :
        formule TNS (« Madelin retraite »), nettement plus généreuse dès que le bénéfice dépasse le PASS, ou plafond
        classique de 10% du revenu professionnel pour un assimilé salarié.
      </p>

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildRetraiteExportText(inputs)} />
      </div>

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
            />
          </Section>

          <Section title="Versement sur le plan d'épargne retraite">
            <Field label="Versement annuel envisagé (€/an)">
              <NumberInput value={inputs.versementAnnuel} onChange={(e) => update("versementAnnuel", Number(e.target.value))} />
            </Field>

            {results.dirigeantStatus === "TNS" ? (
              <>
                <p className="hint-block">
                  Versement pris en charge par la société (Madelin retraite). Plafond déductible :{" "}
                  <strong>{formatEUR(results.plafondDeduction)}</strong>/an
                  {results.versementNonDeductible > 0 && (
                    <>
                      {" "}
                      · Fraction non déductible : <strong>{formatEUR(results.versementNonDeductible)}</strong>
                    </>
                  )}
                </p>
                <RuleNote ruleId="per-plafond-deduction-tns" />
              </>
            ) : (
              <>
                <Field label="Revenu professionnel net N-1 (€)" hint="Base du plafond de déduction (10% du revenu, plafonné à 8×PASS).">
                  <NumberInput
                    value={inputs.revenuNetImposableN1}
                    onChange={(e) => update("revenuNetImposableN1", Number(e.target.value))}
                  />
                </Field>
                <p className="hint-block">
                  Versement financé personnellement (PER individuel classique). Plafond déductible :{" "}
                  <strong>{formatEUR(results.plafondDeduction)}</strong>/an
                  {results.versementNonDeductible > 0 && (
                    <>
                      {" "}
                      · Fraction non déductible : <strong>{formatEUR(results.versementNonDeductible)}</strong>
                    </>
                  )}
                </p>
                <RuleNote ruleId="per-plafond-deduction-salarie" />
              </>
            )}

            <Field
              label="Plafond non utilisé des 3 années précédentes (€)"
              hint="Montant cumulé disponible en report, indiqué sur l'avis d'imposition (« plafond épargne retraite »)."
            >
              <NumberInput
                value={inputs.plafondNonUtiliseAnneesPrecedentes}
                onChange={(e) => update("plafondNonUtiliseAnneesPrecedentes", Number(e.target.value))}
              />
            </Field>
            {inputs.plafondNonUtiliseAnneesPrecedentes > 0 && (
              <p className="hint-block">
                Avec report : plafond total <strong>{formatEUR(results.plafondDeductionAvecReport)}</strong>/an · versement
                déductible <strong>{formatEUR(results.versementDeductibleAvecReport)}</strong>
                {results.economieSupplementaireGraceAuReport > 0 && (
                  <>
                    {" "}
                    · économie d'impôt supplémentaire grâce au report :{" "}
                    <strong>{formatEUR(results.economieSupplementaireGraceAuReport)}</strong>
                  </>
                )}
              </p>
            )}
            <RuleNote ruleId="per-report-plafonds-3-ans" />
          </Section>

          <Section
            title="Liquidité : quand peut-on récupérer l'argent ?"
            subtitle="L'avantage fiscal immédiat a une contrepartie : les fonds sont bloqués jusqu'à la retraite, sauf cas exceptionnels."
          >
            <p className="hint-block">
              <strong>Sortie normale</strong> : à l'âge légal de départ à la retraite — actuellement relevé
              progressivement de 62 à 64 ans selon l'année de naissance (64 ans pour les générations nées à partir de
              1968) — ou à la liquidation effective de la pension d'un régime obligatoire si l'activité se poursuit
              au-delà. Le PER (contrairement aux anciens contrats Madelin retraite d'avant 2019) permet une sortie en
              capital, en rente viagère, ou un mixte des deux, au choix.
            </p>
            <p className="hint-block">
              <strong>Déblocage anticipé</strong> — liste fermée de 6 cas, sans aucune durée de détention minimale
              (contrairement à l'assurance-vie et son palier des 8 ans) :
            </p>
            <ul className="rules-list">
              <li>Décès du conjoint ou du partenaire de PACS</li>
              <li>Invalidité (du titulaire, de ses enfants, de son conjoint ou partenaire de PACS)</li>
              <li>Surendettement</li>
              <li>Expiration des droits à l'assurance chômage</li>
              <li>Cessation d'activité non salariée suite à liquidation judiciaire</li>
              <li>Achat de la résidence principale (1ère acquisition — PER uniquement, pas les anciens contrats Madelin)</li>
            </ul>
            <p className="warning-block">
              Le mariage n'est PAS un cas de déblocage anticipé (seul le décès du conjoint/partenaire de PACS l'est)
              — c'est une confusion fréquente. Aucun autre événement de vie (divorce, naissance...) n'y ouvre droit
              non plus : la liste ci-dessus est limitative.
            </p>
            <RuleNote ruleId="per-cas-deblocage-anticipe" />
            <RuleNote ruleId="age-legal-retraite" />
          </Section>

          <Section
            title="📈 Projection du capital & estimation de rente viagère"
            subtitle="Hypothèse de versement annuel constant jusqu'à l'âge de départ, avec rendement composé."
          >
            <div className="grid grid--2">
              <Field label="Âge actuel">
                <NumberInput value={inputs.ageActuel} onChange={(e) => update("ageActuel", Number(e.target.value))} />
              </Field>
              <Field label="Âge de départ à la retraite envisagé">
                <NumberInput value={inputs.ageDepartRetraite} onChange={(e) => update("ageDepartRetraite", Number(e.target.value))} />
              </Field>
            </div>
            <Field label="Rendement annuel net estimé du contrat (%)">
              <ResetableNumberInput
                step="0.01"
                value={inputs.tauxRendementAnnuelProjection}
                defaultValue={0.03}
                formatDefault={(v) => formatPercent(v)}
                onChange={(v) => update("tauxRendementAnnuelProjection", v)}
              />
            </Field>

            {results.dureeProjectionAnnees > 0 ? (
              <>
                <div className="stat-grid">
                  <StatCard label="Versements cumulés" value={formatEUR(results.versementsCumulesFinal)} />
                  <StatCard label="Capital brut projeté" value={formatEUR(results.capitalBrutFinalProjete)} tone="good" />
                  <StatCard label="dont plus-value latente" value={formatEUR(results.plusValueLatenteFinale)} />
                </div>

                <p className="hint-block">
                  <strong>Rente viagère estimée</strong> à {inputs.ageDepartRetraite} ans (taux de conversion indicatif{" "}
                  {formatPercent(results.renteViagereTauxConversion)}/an) :{" "}
                  <strong>{formatEUR(results.renteViagereAnnuelleEstimee)}</strong>/an, soit environ{" "}
                  <strong>{formatEUR(results.renteViagereMensuelleEstimee)}</strong>/mois.
                </p>
                <RuleNote ruleId="rente-viagere-conversion" />

                <p className="hint-block">
                  <strong>PER vs assurance-vie</strong> — capital net d'impôt à la sortie, à effort d'épargne brut
                  identique : PER <strong>{formatEUR(results.comparaisonAssuranceVie.perCapitalNetApresImpot)}</strong> vs
                  assurance-vie <strong>{formatEUR(results.comparaisonAssuranceVie.assuranceVieCapitalNetApresImpot)}</strong>
                  {" — "}
                  {results.comparaisonAssuranceVie.ecartEnFaveurPER >= 0 ? "le PER est" : "l'assurance-vie est"} plus
                  avantageux de <strong>{formatEUR(Math.abs(results.comparaisonAssuranceVie.ecartEnFaveurPER))}</strong> ici,
                  toutes choses égales par ailleurs.
                </p>
                <RuleNote ruleId="per-vs-assurance-vie-fiscalite" />

                <div className="rules-table-wrap">
                  <table className="rules-table">
                    <thead>
                      <tr>
                        <th>Âge</th>
                        <th>Versements cumulés</th>
                        <th>Capital brut projeté</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.projectionCapital.map((p) => (
                        <tr key={p.year}>
                          <td>{p.age} ans</td>
                          <td>{formatEUR(p.versementsCumules)}</td>
                          <td>{formatEUR(p.capitalBrut)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="hint-block">L'âge de départ doit être postérieur à l'âge actuel pour projeter le capital.</p>
            )}
          </Section>

          {results.dirigeantStatus === "TNS" && (
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
                <Field label="Éligible au taux réduit IS 15% ?">
                  <select
                    value={inputs.eligibleTauxReduitPME ? "oui" : "non"}
                    onChange={(e) => update("eligibleTauxReduitPME", e.target.value === "oui")}
                  >
                    <option value="oui">Oui (capital détenu ≥75% par des personnes physiques)</option>
                    <option value="non">Non</option>
                  </select>
                </Field>
              </div>
              {inputs.impositionSociete === "IS" && (
                <Field label="Bénéfice imposable prévisionnel avant charge (€/an)">
                  <NumberInput
                    value={inputs.beneficeAvantChargePrevisionnel}
                    onChange={(e) => update("beneficeAvantChargePrevisionnel", Number(e.target.value))}
                  />
                </Field>
              )}
              <RuleNote ruleId="is-taux-normal" />
            </Section>
          )}

          <Section title="Revenu de référence du foyer fiscal" subtitle="Utilisé pour calculer le taux marginal d'imposition (TMI) réel.">
            <PersonalTaxProfileFields
              profile={inputs.personalTaxProfile}
              onChange={(profile) => update("personalTaxProfile", profile)}
              showAutresRevenus={false}
              footerAlways={<RuleNote ruleId="ir-bareme-2026" />}
            />
          </Section>

          <Field label="Nom de la simulation">
            <input value={inputs.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
        </div>

        <div className="layout__results">
          <div className="stat-grid">
            <StatCard label="Plafond de déduction" value={formatEUR(results.plafondDeduction)} />
            <StatCard label="Versement déductible" value={formatEUR(results.versementDeductible)} tone="good" />
            {results.versementNonDeductible > 0 && (
              <StatCard label="Versement non déductible" value={formatEUR(results.versementNonDeductible)} tone="bad" />
            )}
            <StatCard
              label={results.dirigeantStatus === "TNS" ? "Économie d'impôt société" : "Économie d'impôt dirigeant (IR)"}
              value={formatEUR(results.dirigeantStatus === "TNS" ? results.economieImpotSociete : results.economieImpotDirigeant)}
              tone="good"
            />
            <StatCard
              label="Coût net global"
              value={formatEUR(results.coutNetGlobal)}
              sub={`${formatPercent(results.tauxEconomieGlobal)} d'économie vs versement brut`}
              tone="neutral"
            />
          </div>

          <button type="button" className="btn btn--ghost detail-toggle" onClick={() => setShowDetail((s) => !s)}>
            <span className="option-row__caret">{showDetail ? "▾" : "▸"}</span>
            Détail du calcul — où et pour qui se réalise l'économie ({results.dirigeantStatus === "TNS" ? "société" : "dirigeant"})
          </button>
          {showDetail && (
            <ul className="detail-list">
              {results.detail.map((line) => (
                <li key={line.label}>
                  {line.label} : {formatEUR(line.value)}
                </li>
              ))}
            </ul>
          )}

          <Section title="Sauvegarde & comparaison">
            <SavedSimulationsPanel
              kind="retraite"
              currentInputs={inputs}
              version={saveVersion}
              onLoad={(loaded) => {
                setInputs(loaded);
                setSaveVersion((v) => v + 1);
              }}
              metricsFor={(sim) => {
                const r = computeRetraite(sim);
                return [
                  { label: "Plafond de déduction", value: formatEUR(r.plafondDeduction) },
                  { label: "Versement déductible", value: formatEUR(r.versementDeductible) },
                  { label: "Coût net global", value: formatEUR(r.coutNetGlobal) },
                  { label: "Économie vs versement brut", value: formatPercent(r.tauxEconomieGlobal) },
                ];
              }}
              exportText={buildRetraiteExportText}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
