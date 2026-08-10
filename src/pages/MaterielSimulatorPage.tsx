import { useEffect, useMemo, useState } from "react";
import {
  type CategorieMateriel,
  type MaterielInputs,
  type ModeAcquisitionMateriel,
  CATEGORIE_LABELS,
  DUREE_AMORTISSEMENT_PAR_CATEGORIE,
  SEUIL_CHARGE_IMMEDIATE_HT,
  computeMateriel,
  createDefaultMaterielInputs,
} from "../lib/materiel";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { DEFAULT_CORPORATE_TAX_RATE } from "../lib/simulator";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { CopyButton } from "../components/CopyButton";
import { PersonalTaxProfileFields } from "../components/PersonalTaxProfileFields";
import { savePersonalTaxProfile, withPersistedPersonalTaxProfile } from "../lib/storage";
import { formatEUR, formatEURPrecise } from "../lib/format";

const MODE_LABELS: Record<ModeAcquisitionMateriel, string> = {
  societe: "Achat par la société",
  personnel_rembourse: "Achat personnel remboursé (note de frais)",
  personnel_non_rembourse: "Achat personnel non remboursé",
};

/** Résumé texte complet d'une simulation matériel, destiné à être copié dans le presse-papier. */
function buildMaterielExportText(sim: MaterielInputs): string {
  const r = computeMateriel(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(`💻 ${sim.name} — Simulateur matériel professionnel`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push(`Catégorie : ${CATEGORIE_LABELS[sim.categorie]} · Prix HT : ${formatEUR(sim.prixHT)} · Montage : ${MODE_LABELS[sim.modeAcquisition]}`);
  push(
    r.eligibleChargeImmediate
      ? `Déduction immédiate en charge (≤ ${SEUIL_CHARGE_IMMEDIATE_HT}€ HT), pas d'amortissement.`
      : `Amorti sur ${sim.dureeAmortissementAnnees} ans — annuité : ${formatEUR(r.annuiteAmortissement)}/an`,
  );
  push("");
  push("— Résultats —");
  push(`Charge déductible année 1 : ${formatEUR(r.chargeAnnee1)} · Économie d'impôt année 1 : ${formatEUR(r.economieImpotAnnee1)}`);
  push(`Coût net société — année 1 : ${formatEUR(r.coutNetSocieteAnnee1)} · sur la durée totale : ${formatEUR(r.coutNetSocieteTotalSurDuree)}`);
  if (sim.modeAcquisition === "personnel_non_rembourse") {
    push(`Coût supporté par le dirigeant (aucune déduction) : ${formatEUR(r.coutDirigeantNonRembourse)}`);
  }
  push(`Économie totale vs achat personnel jamais remboursé : ${formatEUR(r.economieVsNonRembourse)}`);
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

export function MaterielSimulatorPage() {
  const [inputs, setInputs] = useState<MaterielInputs>(() => withPersistedPersonalTaxProfile(createDefaultMaterielInputs()));
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeMateriel(inputs), [inputs]);

  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  function update<K extends keyof MaterielInputs>(key: K, value: MaterielInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function handleCategorieChange(categorie: CategorieMateriel) {
    setInputs((prev) => ({ ...prev, categorie, dureeAmortissementAnnees: DUREE_AMORTISSEMENT_PAR_CATEGORIE[categorie] }));
  }

  return (
    <div className="page">
      <h2>💻 Matériel professionnel — société, achat remboursé, ou personnel ?</h2>
      <p className="page__intro">
        Ordinateur, mobilier de bureau, équipement professionnel : le simulateur chiffre la charge déductible
        (immédiate si le prix HT n'excède pas {formatEUR(SEUIL_CHARGE_IMMEDIATE_HT)}, sinon amortie) selon que
        l'achat est fait par la société, par le dirigeant puis remboursé (note de frais — fiscalement identique), ou
        par le dirigeant sans remboursement (aucun avantage fiscal).
      </p>

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildMaterielExportText(inputs)} />
      </div>

      <div className="layout">
        <div className="layout__form">
          <Section title="Matériel">
            <div className="grid grid--3">
              <Field label="Catégorie">
                <select value={inputs.categorie} onChange={(e) => handleCategorieChange(e.target.value as CategorieMateriel)}>
                  {Object.entries(CATEGORIE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Prix HT (€)">
                <NumberInput value={inputs.prixHT} onChange={(e) => update("prixHT", Number(e.target.value))} />
              </Field>
              <Field label="Durée d'amortissement (années)" hint={results.eligibleChargeImmediate ? "Sans effet : déduction immédiate en charge." : undefined}>
                <NumberInput
                  disabled={results.eligibleChargeImmediate}
                  value={inputs.dureeAmortissementAnnees}
                  onChange={(e) => update("dureeAmortissementAnnees", Number(e.target.value))}
                />
              </Field>
            </div>
            <p className="hint-block">
              {results.eligibleChargeImmediate
                ? `Prix ≤ ${formatEUR(SEUIL_CHARGE_IMMEDIATE_HT)} HT : déduction immédiate en charge, sans amortissement.`
                : `Prix > ${formatEUR(SEUIL_CHARGE_IMMEDIATE_HT)} HT : amorti sur ${inputs.dureeAmortissementAnnees} ans — annuité : ${formatEUR(results.annuiteAmortissement)}/an.`}
            </p>
            <RuleNote ruleId="materiel-petit-equipement-charge-immediate" />
          </Section>

          <Section
            title="Montage retenu"
            subtitle="Achat société et achat personnel remboursé sont fiscalement identiques — seul le circuit de paiement diffère."
          >
            <Field label="Qui achète ?">
              <select
                value={inputs.modeAcquisition}
                onChange={(e) => update("modeAcquisition", e.target.value as ModeAcquisitionMateriel)}
              >
                {Object.entries(MODE_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {inputs.modeAcquisition === "personnel_non_rembourse" && (
              <p className="warning-block">
                Aucune charge déductible pour la société dans ce montage : le dirigeant supporte le prix plein sur des
                revenus déjà taxés, sans aucun avantage fiscal.
              </p>
            )}
          </Section>

          <Section title="Régime fiscal & rentabilité de la société">
            <div className="grid grid--2">
              <Field label="Régime d'imposition">
                <select
                  value={inputs.impositionSociete}
                  onChange={(e) => update("impositionSociete", e.target.value as MaterielInputs["impositionSociete"])}
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
                <Field label="Bénéfice imposable prévisionnel avant charge (€/an)">
                  <NumberInput
                    value={inputs.beneficeAvantChargePrevisionnel}
                    onChange={(e) => update("beneficeAvantChargePrevisionnel", Number(e.target.value))}
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
            )}
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section title="Revenu de référence du foyer fiscal" subtitle="Utilisé si le régime IR (société translucide) est retenu.">
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
            <StatCard label="Charge déductible année 1" value={formatEUR(results.chargeAnnee1)} />
            <StatCard label="Économie d'impôt année 1" value={formatEUR(results.economieImpotAnnee1)} tone="good" />
            <StatCard label="Coût net société — année 1" value={formatEUR(results.coutNetSocieteAnnee1)} tone="bad" />
            <StatCard label="Coût net société — sur la durée totale" value={formatEUR(results.coutNetSocieteTotalSurDuree)} tone="bad" />
            {inputs.modeAcquisition === "personnel_non_rembourse" && (
              <StatCard label="Coût dirigeant (non remboursé)" value={formatEUR(results.coutDirigeantNonRembourse)} tone="bad" />
            )}
            <StatCard
              label="Économie vs achat personnel jamais remboursé"
              value={formatEURPrecise(results.economieVsNonRembourse)}
              tone={results.economieVsNonRembourse > 0 ? "good" : "neutral"}
            />
          </div>

          <Section title="Sauvegarde & comparaison">
            <SavedSimulationsPanel
              kind="materiel"
              currentInputs={inputs}
              version={saveVersion}
              onLoad={(loaded) => {
                setInputs(loaded);
                setSaveVersion((v) => v + 1);
              }}
              metricsFor={(sim) => {
                const r = computeMateriel(sim);
                return [
                  { label: "Charge déductible année 1", value: formatEUR(r.chargeAnnee1) },
                  { label: "Coût net société — sur la durée", value: formatEUR(r.coutNetSocieteTotalSurDuree) },
                  { label: "Coût dirigeant (non remboursé)", value: formatEUR(r.coutDirigeantNonRembourse) },
                  { label: "Économie vs non remboursé", value: formatEURPrecise(r.economieVsNonRembourse) },
                ];
              }}
              exportText={buildMaterielExportText}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
