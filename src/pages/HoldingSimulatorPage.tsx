import { useMemo, useState } from "react";
import {
  DUREE_DETENTION_MINIMALE_MERE_FILLE_ANNEES,
  type HoldingInputs,
  SEUIL_DETENTION_MERE_FILLE_POURCENT,
  computeHolding,
  createDefaultHoldingInputs,
} from "../lib/holding";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { DEFAULT_CORPORATE_TAX_RATE } from "../lib/simulator";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { CopyButton } from "../components/CopyButton";
import { ShareButton } from "../components/ShareButton";
import { PdfButton } from "../components/PdfButton";
import { PrintableReport } from "../components/PrintableReport";
import { mergeSharedInputs } from "../lib/urlShare";
import { formatEUR, formatPercent } from "../lib/format";

/** Résumé texte complet d'une simulation holding, destiné à être copié dans le presse-papier. */
function buildHoldingExportText(sim: HoldingInputs): string {
  const r = computeHolding(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(`🏛️ ${sim.name} — Simulateur holding / montage patrimonial`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push(`Dividende annuel de la filiale : ${formatEUR(sim.dividendeAnnuelFiliale)}`);
  push(
    `Détention : ${sim.tauxDetentionFilialePourcent}% depuis ${sim.dureeDetentionFilialeAnnees} an(s) → régime mère-fille ${r.eligibleRegimeMereFille ? "APPLICABLE" : "NON applicable"}`,
  );
  push("");
  push("— Année 1 (indicatif) —");
  push(`Coût IS sur la remontée : ${formatEUR(r.coutISAnnee1)} · Net capitalisé dans la holding : ${formatEUR(r.netCapitaliseHoldingAnnee1)}`);
  push(`Sans holding (distribution directe, PFU 30%) : net perçu ${formatEUR(r.netDistributionDirecteAnnee1)}`);
  push("");
  if (r.dureeProjectionAnnees > 0) {
    push(`— Projection sur ${r.dureeProjectionAnnees} ans (rendement ${formatPercent(sim.tauxRendementReinvestissement)}/an) —`);
    push(`Capital holding brut final : ${formatEUR(r.capitalHoldingFinalBrut)} · après sortie finale (PFU) : ${formatEUR(r.capitalHoldingFinalNetApresSortie)}`);
    push(`Capital personnel final (sans holding, distributions directes réinvesties) : ${formatEUR(r.capitalDirectPersonnelFinal)}`);
    push(
      `Écart en faveur de la holding : ${formatEUR(r.ecartEnFaveurHolding)} (${r.ecartEnFaveurHolding >= 0 ? "avantage" : "désavantage"})`,
    );
    push("");
  }
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un avocat fiscaliste.");

  return lines.join("\n");
}

export function HoldingSimulatorPage({ initialShareData }: { initialShareData?: string }) {
  const [inputs, setInputs] = useState<HoldingInputs>(
    () => mergeSharedInputs(createDefaultHoldingInputs(), initialShareData),
  );
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeHolding(inputs), [inputs]);

  function update<K extends keyof HoldingInputs>(key: K, value: HoldingInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="page">
      <h2>🏛️ Holding / montage patrimonial (régime mère-fille)</h2>
      <p className="page__intro">
        Interposer une holding entre le dirigeant et sa société opérationnelle permet de faire remonter les
        dividendes sous le régime mère-fille — quasiment sans frottement fiscal — plutôt que de les distribuer
        directement au dirigeant, taxés immédiatement au prélèvement forfaitaire unique (PFU) de 30%.
      </p>

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildHoldingExportText(inputs)} />
        <ShareButton page="holding" getInputs={() => inputs} />
        <PdfButton />
      </div>
      <PrintableReport text={buildHoldingExportText(inputs)} />

      <div className="layout">
        <div className="layout__form">
          <Section title="Filiale opérationnelle & détention par la holding">
            <Field label="Dividende annuel versé par la filiale (€/an)">
              <NumberInput value={inputs.dividendeAnnuelFiliale} onChange={(e) => update("dividendeAnnuelFiliale", Number(e.target.value))} />
            </Field>
            <div className="grid grid--2">
              <Field label="Détention du capital de la filiale par la holding (%)">
                <NumberInput
                  value={inputs.tauxDetentionFilialePourcent}
                  onChange={(e) => update("tauxDetentionFilialePourcent", Number(e.target.value))}
                />
              </Field>
              <Field label="Ancienneté de la détention des titres (années)">
                <NumberInput
                  value={inputs.dureeDetentionFilialeAnnees}
                  onChange={(e) => update("dureeDetentionFilialeAnnees", Number(e.target.value))}
                />
              </Field>
            </div>
            <p className={results.eligibleRegimeMereFille ? "hint-block" : "warning-block"}>
              {results.eligibleRegimeMereFille
                ? `Régime mère-fille applicable (détention ≥${SEUIL_DETENTION_MERE_FILLE_POURCENT}% depuis ≥${DUREE_DETENTION_MINIMALE_MERE_FILLE_ANNEES} ans) : seule une quote-part de frais et charges de 5% du dividende est réintégrée au résultat imposable de la holding.`
                : `Régime mère-fille NON applicable (détention <${SEUIL_DETENTION_MERE_FILLE_POURCENT}% ou détenue depuis <${DUREE_DETENTION_MINIMALE_MERE_FILLE_ANNEES} ans) : le dividende reçu par la holding est imposé à l'IS pour son montant brut entier, sans exonération.`}
            </p>
            <RuleNote ruleId="regime-mere-fille" />
          </Section>

          <Section title="Régime fiscal de la holding">
            <div className="grid grid--2">
              <Field label="Taux d'IS normal de la holding">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.corporateTaxRateHolding}
                  defaultValue={DEFAULT_CORPORATE_TAX_RATE}
                  formatDefault={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update("corporateTaxRateHolding", v)}
                />
              </Field>
              <Field label="Éligible au taux réduit IS 15% ?">
                <select
                  value={inputs.eligibleTauxReduitPMEHolding ? "oui" : "non"}
                  onChange={(e) => update("eligibleTauxReduitPMEHolding", e.target.value === "oui")}
                >
                  <option value="oui">Oui (capital détenu ≥75% par des personnes physiques)</option>
                  <option value="non">Non</option>
                </select>
              </Field>
            </div>
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section
            title="Projection & sortie finale"
            subtitle="Capitalisation du dividende net dans la holding, comparée à une distribution directe réinvestie personnellement."
          >
            <div className="grid grid--2">
              <Field label="Durée de projection (années)">
                <NumberInput value={inputs.dureeProjectionAnnees} onChange={(e) => update("dureeProjectionAnnees", Number(e.target.value))} />
              </Field>
              <Field label="Rendement annuel du réinvestissement (%)">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.tauxRendementReinvestissement}
                  defaultValue={0.04}
                  formatDefault={(v) => formatPercent(v)}
                  onChange={(v) => update("tauxRendementReinvestissement", v)}
                />
              </Field>
            </div>
            <RuleNote ruleId="pfu-dividendes" />
            <RuleNote ruleId="holding-strategies-sortie-hors-perimetre" />
          </Section>

          <Field label="Nom de la simulation">
            <input value={inputs.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
        </div>

        <div className="layout__results">
          <div className="stat-grid">
            <StatCard label="Coût IS remontée (année 1)" value={formatEUR(results.coutISAnnee1)} tone="bad" />
            <StatCard label="Net capitalisé holding (année 1)" value={formatEUR(results.netCapitaliseHoldingAnnee1)} tone="good" />
            <StatCard label="Net distribution directe (année 1)" value={formatEUR(results.netDistributionDirecteAnnee1)} />
          </div>

          {results.dureeProjectionAnnees > 0 ? (
            <>
              <div className="stat-grid">
                <StatCard label="Capital holding brut final" value={formatEUR(results.capitalHoldingFinalBrut)} />
                <StatCard label="Capital holding net après sortie finale" value={formatEUR(results.capitalHoldingFinalNetApresSortie)} tone="good" />
                <StatCard label="Capital personnel final (sans holding)" value={formatEUR(results.capitalDirectPersonnelFinal)} />
                <StatCard
                  label="Écart en faveur de la holding"
                  value={formatEUR(results.ecartEnFaveurHolding)}
                  tone={results.ecartEnFaveurHolding >= 0 ? "good" : "bad"}
                />
              </div>

              <div className="rules-table-wrap">
                <table className="rules-table">
                  <thead>
                    <tr>
                      <th>Année</th>
                      <th>Capital holding</th>
                      <th>Capital personnel (sans holding)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.projection.map((p) => (
                      <tr key={p.year}>
                        <td>{p.year}</td>
                        <td>{formatEUR(p.capitalHolding)}</td>
                        <td>{formatEUR(p.capitalDirectPersonnel)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="hint-block">Choisissez une durée de projection supérieure à 0 pour comparer les deux stratégies dans le temps.</p>
          )}

          <Section title="Sauvegarde & comparaison">
            <SavedSimulationsPanel
              kind="holding"
              currentInputs={inputs}
              version={saveVersion}
              onLoad={(loaded) => {
                setInputs(loaded);
                setSaveVersion((v) => v + 1);
              }}
              metricsFor={(sim) => {
                const r = computeHolding(sim);
                return [
                  { label: "Net capitalisé holding (année 1)", value: formatEUR(r.netCapitaliseHoldingAnnee1) },
                  { label: "Capital holding net final", value: formatEUR(r.capitalHoldingFinalNetApresSortie) },
                  { label: "Capital personnel final", value: formatEUR(r.capitalDirectPersonnelFinal) },
                  { label: "Écart en faveur holding", value: formatEUR(r.ecartEnFaveurHolding) },
                ];
              }}
              exportText={buildHoldingExportText}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
