import { useEffect, useMemo, useState } from "react";
import {
  type MutuellePrevoyanceInputs,
  PART_PATRONALE_MINIMALE_POURCENT,
  computeMutuellePrevoyance,
  createDefaultMutuellePrevoyanceInputs,
} from "../lib/mutuellePrevoyance";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { DEFAULT_CORPORATE_TAX_RATE } from "../lib/simulator";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { CopyButton } from "../components/CopyButton";
import { CompanyTypeFields } from "../components/CompanyTypeFields";
import { PersonalTaxProfileFields } from "../components/PersonalTaxProfileFields";
import { savePersonalTaxProfile, withPersistedPersonalTaxProfile } from "../lib/storage";
import { formatEUR, formatPercent } from "../lib/format";

/** Résumé texte complet d'une simulation mutuelle/prévoyance, destiné à être copié dans le presse-papier. */
function buildMutuelleExportText(sim: MutuellePrevoyanceInputs): string {
  const r = computeMutuellePrevoyance(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(`🩺 ${sim.name} — Simulateur mutuelle & prévoyance du dirigeant`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push(`Forme juridique : ${sim.companyType} · Statut : ${r.dirigeantStatus === "TNS" ? "TNS" : "Assimilé salarié"} · Budget cotisation annuel : ${formatEUR(sim.cotisationAnnuelle)}`);
  push("");
  if (r.dirigeantStatus === "TNS") {
    push("— TNS (Madelin) —");
    push(`Prise en charge : ${sim.priseEnChargeParLaSociete ? "par la société" : "personnelle"}`);
    push(`Plafond Madelin déductible : ${formatEUR(r.plafondMadelin)} · Déductible : ${formatEUR(r.cotisationDeductibleTNS)} · Non déductible : ${formatEUR(r.cotisationNonDeductibleTNS)}`);
  } else {
    push("— Assimilé salarié (mutuelle collective) —");
    push(`Part patronale (${sim.partPatronalePourcent}%) : ${formatEUR(r.partPatronale)} · Part salariale : ${formatEUR(r.partSalariale)}`);
    push(`Plafond d'exonération : ${formatEUR(r.plafondExonerationSociale)} · Exonéré : ${formatEUR(r.montantExonere)} · Excédent imposé : ${formatEUR(r.montantExcedentaire)}`);
  }
  push("");
  push("— Résultats —");
  push(`Économie d'impôt société : ${formatEUR(r.economieImpotSociete)} · Coût net société : ${formatEUR(r.coutNetSociete)}`);
  push(`Économie d'impôt dirigeant : ${formatEUR(r.economieImpotDirigeant)} · Coût net dirigeant : ${formatEUR(r.coutNetDirigeant)}`);
  push(`Coût net global : ${formatEUR(r.coutNetGlobal)} (${formatPercent(r.tauxEconomieGlobal)} d'économie vs cotisation brute)`);
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

export function MutuellePrevoyanceSimulatorPage() {
  const [inputs, setInputs] = useState<MutuellePrevoyanceInputs>(() =>
    withPersistedPersonalTaxProfile(createDefaultMutuellePrevoyanceInputs()),
  );
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeMutuellePrevoyance(inputs), [inputs]);

  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  function update<K extends keyof MutuellePrevoyanceInputs>(key: K, value: MutuellePrevoyanceInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function handleCompanyTypeChange(code: string) {
    setInputs((prev) => ({ ...prev, companyType: code, gerantMajoritaire: true }));
  }

  return (
    <div className="page">
      <h2>🩺 Mutuelle & prévoyance du dirigeant</h2>
      <p className="page__intro">
        Le traitement fiscal et social de la complémentaire santé/prévoyance dépend entièrement du statut du
        dirigeant : cotisations Madelin déductibles dans une limite pour un TNS (EURL/SARL majoritaire), mutuelle
        collective obligatoire prise en charge à 50% minimum par l'employeur pour un assimilé salarié (SASU/SAS).
      </p>

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildMutuelleExportText(inputs)} />
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

          <Section title="Cotisation santé & prévoyance">
            <Field label="Budget cotisation annuel (€/an)">
              <NumberInput value={inputs.cotisationAnnuelle} onChange={(e) => update("cotisationAnnuelle", Number(e.target.value))} />
            </Field>

            {results.dirigeantStatus === "TNS" ? (
              <>
                <Field label="Qui prend en charge la cotisation ?">
                  <select
                    value={inputs.priseEnChargeParLaSociete ? "societe" : "personnel"}
                    onChange={(e) => update("priseEnChargeParLaSociete", e.target.value === "societe")}
                  >
                    <option value="societe">La société (déductible du résultat société)</option>
                    <option value="personnel">Le dirigeant personnellement (déductible de son revenu imposable)</option>
                  </select>
                </Field>
                <p className="hint-block">
                  Plafond Madelin déductible : <strong>{formatEUR(results.plafondMadelin)}</strong>/an
                  {results.cotisationNonDeductibleTNS > 0 && (
                    <>
                      {" "}
                      · Fraction non déductible : <strong>{formatEUR(results.cotisationNonDeductibleTNS)}</strong>
                    </>
                  )}
                </p>
                <RuleNote ruleId="madelin-plafond-deduction-tns" />
              </>
            ) : (
              <>
                <div className="grid grid--2">
                  <Field label="Part prise en charge par l'employeur (%)" hint={`Minimum légal : ${PART_PATRONALE_MINIMALE_POURCENT}%`}>
                    <NumberInput
                      min={PART_PATRONALE_MINIMALE_POURCENT}
                      max={100}
                      value={inputs.partPatronalePourcent}
                      onChange={(e) => update("partPatronalePourcent", Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Salaire brut annuel de référence (€)" hint="Sert au calcul du plafond d'exonération.">
                    <NumberInput
                      value={inputs.salaireBrutAnnuelReference}
                      onChange={(e) => update("salaireBrutAnnuelReference", Number(e.target.value))}
                    />
                  </Field>
                </div>
                <p className="hint-block">
                  Plafond d'exonération sociale/fiscale : <strong>{formatEUR(results.plafondExonerationSociale)}</strong>/an
                </p>
                {results.montantExcedentaire > 0 && (
                  <p className="warning-block">
                    Cotisation au-delà du plafond d'exonération : {formatEUR(results.montantExcedentaire)} réintégrés comme
                    complément de rémunération imposable (cotisations sociales supplémentaires non chiffrées ici).
                  </p>
                )}
                <RuleNote ruleId="mutuelle-collective-plafond-exoneration" />
              </>
            )}
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
            <StatCard label="Économie d'impôt société" value={formatEUR(results.economieImpotSociete)} tone="good" />
            <StatCard label="Coût net société" value={formatEUR(results.coutNetSociete)} tone="bad" />
            <StatCard label="Économie d'impôt dirigeant" value={formatEUR(results.economieImpotDirigeant)} tone="good" />
            <StatCard label="Coût net dirigeant" value={formatEUR(results.coutNetDirigeant)} tone="bad" />
            <StatCard
              label="Coût net global"
              value={formatEUR(results.coutNetGlobal)}
              sub={`${formatPercent(results.tauxEconomieGlobal)} d'économie vs cotisation brute`}
              tone="neutral"
            />
          </div>

          <Section title="Sauvegarde & comparaison">
            <SavedSimulationsPanel
              kind="mutuelle"
              currentInputs={inputs}
              version={saveVersion}
              onLoad={(loaded) => {
                setInputs(loaded);
                setSaveVersion((v) => v + 1);
              }}
              metricsFor={(sim) => {
                const r = computeMutuellePrevoyance(sim);
                return [
                  { label: "Coût net société", value: formatEUR(r.coutNetSociete) },
                  { label: "Coût net dirigeant", value: formatEUR(r.coutNetDirigeant) },
                  { label: "Coût net global", value: formatEUR(r.coutNetGlobal) },
                  { label: "Économie vs cotisation brute", value: formatPercent(r.tauxEconomieGlobal) },
                ];
              }}
              exportText={buildMutuelleExportText}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
