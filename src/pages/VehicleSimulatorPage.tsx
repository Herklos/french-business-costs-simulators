import { useMemo, useState } from "react";
import {
  type SimulationInputs,
  computeSimulation,
  createDefaultInputs,
} from "../lib/simulator";
import { COUNTRIES } from "../lib/countries";
import { getCompanyType, getCompanyTypes, resolveDirigeantStatus } from "../lib/companyTypes";
import { createDefaultFinancingInputs, compareFinancingModes, type FinancingMode } from "../lib/financing";
import { Field, NumberInput, Section, StatCard } from "../components/Field";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { formatEUR, formatEURPrecise, formatPercent } from "../lib/format";

const FINANCING_LABELS: Record<FinancingMode, string> = {
  comptant: "Comptant",
  credit: "Crédit",
  loa: "LOA",
  lld: "LLD",
};

export function VehicleSimulatorPage() {
  const [inputs, setInputs] = useState<SimulationInputs>(() => createDefaultInputs());
  const [saveVersion, setSaveVersion] = useState(0);

  const results = useMemo(() => computeSimulation(inputs), [inputs]);
  const financingResults = useMemo(() => compareFinancingModes(inputs.financing), [inputs.financing]);
  const companyTypes = getCompanyTypes(inputs.country);
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);

  function update<K extends keyof SimulationInputs>(key: K, value: SimulationInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function updatePersonalTax<K extends keyof SimulationInputs["personalTaxProfile"]>(
    key: K,
    value: SimulationInputs["personalTaxProfile"][K],
  ) {
    setInputs((prev) => ({ ...prev, personalTaxProfile: { ...prev.personalTaxProfile, [key]: value } }));
  }

  function updateFinancing<M extends FinancingMode>(
    mode: M,
    patch: Partial<SimulationInputs["financing"][M]>,
  ) {
    setInputs((prev) => ({
      ...prev,
      financing: { ...prev.financing, [mode]: { ...prev.financing[mode], ...patch } },
    }));
  }

  function handleVehiclePriceChange(price: number) {
    setInputs((prev) => ({
      ...prev,
      vehiclePrice: price,
      financing: createDefaultFinancingInputs(price),
    }));
  }

  function handleCountryChange(country: string) {
    setInputs((prev) => ({ ...prev, country }));
  }

  function handleCompanyTypeChange(code: string) {
    const cfg = getCompanyType(inputs.country, code);
    setInputs((prev) => ({
      ...prev,
      companyType: code,
      gerantMajoritaire: true,
      impositionSociete: cfg?.defaultImposition ?? prev.impositionSociete,
      tnsContributionRate: cfg?.defaultCotisationRate ?? prev.tnsContributionRate,
    }));
  }

  const recoLabel =
    results.recommandation === "societe"
      ? "Achat / financement via la société plus avantageux"
      : results.recommandation === "personnel"
        ? "Achat personnel + indemnités kilométriques plus avantageux"
        : "Les deux scénarios sont équivalents";

  return (
    <div className="page">
      <h2>🚗 Véhicule de société — coût AEN, société, personnel</h2>
      <p className="page__intro">
        Simulateur pour dirigeant TNS (gérant majoritaire) ou assimilé salarié : calcul de l'avantage en nature par
        la méthode réelle (obligatoire pour les TNS), comparaison avec un achat personnel indemnisé aux frais
        kilométriques, et comparaison des modes de financement.
      </p>

      <div className="layout">
        <div className="layout__form">
          <Section title="Juridiction & structure" subtitle="Détermine le statut du dirigeant et le régime applicable.">
            <div className="grid grid--3">
              <Field label="Pays">
                <select value={inputs.country} onChange={(e) => handleCountryChange(e.target.value)}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code} disabled={!c.available}>
                      {c.flag} {c.label} {!c.available ? "(bientôt disponible)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
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
                  onChange={(e) => update("impositionSociete", e.target.value as SimulationInputs["impositionSociete"])}
                >
                  {(companyTypeConfig?.impositionOptions ?? ["IS", "IR"]).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === "IS" ? "Impôt sur les sociétés (IS)" : "Impôt sur le revenu (IR, société translucide)"}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
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
            <p className="hint-block">
              Statut retenu : <strong>{dirigeantStatus === "TNS" ? "Travailleur Non Salarié (TNS)" : "Assimilé salarié"}</strong>
              {" — "}
              {companyTypeConfig?.description}
            </p>
            <RuleNote ruleId="aen-methode-reelle-obligatoire-tns" />
          </Section>

          <Section title="Véhicule">
            <div className="grid grid--3">
              <Field label="Prix d'achat TTC (€)">
                <NumberInput value={inputs.vehiclePrice} onChange={(e) => handleVehiclePriceChange(Number(e.target.value))} />
              </Field>
              <Field label="Âge du véhicule">
                <select
                  value={inputs.vehicleOverFiveYears ? "gt5" : "lte5"}
                  onChange={(e) => update("vehicleOverFiveYears", e.target.value === "gt5")}
                >
                  <option value="lte5">≤ 5 ans (amortissement 20 %/an)</option>
                  <option value="gt5">&gt; 5 ans (amortissement 10 %/an)</option>
                </select>
              </Field>
              <Field label="Motorisation">
                <select
                  value={inputs.isElectric ? "electrique" : "thermique"}
                  onChange={(e) => update("isElectric", e.target.value === "electrique")}
                >
                  <option value="electrique">100 % électrique</option>
                  <option value="thermique">Thermique / hybride</option>
                </select>
              </Field>
            </div>
            <RuleNote ruleId="aen-amortissement-taux" />
            {inputs.isElectric && (
              <Field label="Véhicule éligible à l'éco-score renforcé (≥ 60 pts, liste ADEME) ?">
                <select
                  value={inputs.isEcoScoreEligible ? "oui" : "non"}
                  onChange={(e) => update("isEcoScoreEligible", e.target.value === "oui")}
                >
                  <option value="oui">Oui (ex. Tesla Model Y Berlin — codes TVV validés)</option>
                  <option value="non">Non (ex. Tesla Model 3, majoritairement)</option>
                </select>
              </Field>
            )}
            {inputs.isElectric && <RuleNote ruleId="aen-abattement-vehicule-electrique-taux" />}
            {inputs.isElectric && <RuleNote ruleId="aen-abattement-vehicule-electrique-plafond" />}
          </Section>

          <Section title="Usage" subtitle="La répartition pro/privé doit être justifiable (carnet de bord, application...).">
            <div className="grid grid--2">
              <Field label={`% d'usage privé : ${inputs.privateUsePercent}%`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={inputs.privateUsePercent}
                  onChange={(e) => update("privateUsePercent", Number(e.target.value))}
                />
              </Field>
              <Field label="Kilométrage total annuel (km)">
                <NumberInput value={inputs.totalKmAnnual} onChange={(e) => update("totalKmAnnual", Number(e.target.value))} />
              </Field>
            </div>
          </Section>

          <Section title="Charges annuelles réelles">
            <div className="grid grid--3">
              <Field label="Assurance annuelle (€)">
                <NumberInput value={inputs.annualInsurance} onChange={(e) => update("annualInsurance", Number(e.target.value))} />
              </Field>
              <Field label="Entretien annuel (€)">
                <NumberInput value={inputs.annualMaintenance} onChange={(e) => update("annualMaintenance", Number(e.target.value))} />
              </Field>
              {!inputs.isElectric && (
                <Field label="Carburant — usage privé annuel (€)">
                  <NumberInput
                    value={inputs.annualFuelPrivateCost}
                    onChange={(e) => update("annualFuelPrivateCost", Number(e.target.value))}
                  />
                </Field>
              )}
            </div>
          </Section>

          <Section title="Cotisations & fiscalité">
            <div className="grid grid--2">
              <Field label={`Taux de charges sociales sur l'AEN (${dirigeantStatus === "TNS" ? "TNS" : "assimilé salarié"})`}>
                <NumberInput
                  step="0.01"
                  value={inputs.tnsContributionRate}
                  onChange={(e) => update("tnsContributionRate", Number(e.target.value))}
                />
              </Field>
              <Field label="Taux d'IS (si régime IS)">
                <NumberInput step="0.01" value={inputs.corporateTaxRate} onChange={(e) => update("corporateTaxRate", Number(e.target.value))} />
              </Field>
            </div>
            <RuleNote ruleId={dirigeantStatus === "TNS" ? "cotisations-tns-taux-global" : "cotisations-assimile-salarie-taux"} />
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section
            title="Situation personnelle du dirigeant"
            subtitle="Permet de calculer précisément le taux marginal d'imposition (TMI) appliqué à l'avantage en nature."
          >
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
              <>
                <div className="grid grid--3">
                  <Field label="Situation familiale">
                    <select
                      value={inputs.personalTaxProfile.situationFamiliale}
                      onChange={(e) =>
                        updatePersonalTax("situationFamiliale", e.target.value as "seul" | "couple")
                      }
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
                  <Field label="Salaire net imposable annuel du gérant (€)">
                    <NumberInput
                      value={inputs.personalTaxProfile.salaireNetImposableAnnuel}
                      onChange={(e) => updatePersonalTax("salaireNetImposableAnnuel", Number(e.target.value))}
                    />
                  </Field>
                </div>
                <Field label="Autres revenus imposables du foyer (€/an)">
                  <NumberInput
                    value={inputs.personalTaxProfile.autresRevenusImposablesFoyer}
                    onChange={(e) => updatePersonalTax("autresRevenusImposablesFoyer", Number(e.target.value))}
                  />
                </Field>
                <p className="hint-block">
                  Parts fiscales : <strong>{results.partsFiscales}</strong> · Revenu imposable retenu :{" "}
                  <strong>{formatEUR(results.revenuImposableFoyer)}</strong> · TMI calculé :{" "}
                  <strong>{formatPercent(results.tmiCalcule)}</strong>
                </p>
                <RuleNote ruleId="ir-bareme-2026" />
                <RuleNote ruleId="ir-abattement-10-salaires" />
              </>
            )}
          </Section>

          <Section title="Optimisations">
            <div className="grid grid--2">
              <Field label="Participation financière mensuelle du gérant (€)">
                <NumberInput
                  value={inputs.monthlyParticipation}
                  onChange={(e) => update("monthlyParticipation", Number(e.target.value))}
                />
              </Field>
              <Field label="Barème IK retenu (€/km) — scénario achat personnel">
                <NumberInput step="0.001" value={inputs.ikRatePerKm} onChange={(e) => update("ikRatePerKm", Number(e.target.value))} />
              </Field>
            </div>
            <RuleNote ruleId="ik-bareme-2026" />
          </Section>

          <Section title="Comparaison — crédit personnel alternatif">
            <Field label="Mensualité crédit personnel de référence (€/mois)">
              <NumberInput value={inputs.personalLoanMonthly} onChange={(e) => update("personalLoanMonthly", Number(e.target.value))} />
            </Field>
          </Section>

          <Section title="Mode d'acquisition du véhicule" subtitle="Comparaison Comptant / Crédit / LOA / LLD, indépendamment du calcul d'AEN.">
            <div className="financing-grid">
              <div className="financing-card">
                <h4>Comptant</h4>
                <Field label="Durée de détention (mois)">
                  <NumberInput
                    value={inputs.financing.comptant.dureeDetentionMois}
                    onChange={(e) => updateFinancing("comptant", { dureeDetentionMois: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Taux d'opportunité du capital (%/an)">
                  <NumberInput
                    step="0.01"
                    value={inputs.financing.comptant.tauxOpportunite}
                    onChange={(e) => updateFinancing("comptant", { tauxOpportunite: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <div className="financing-card">
                <h4>Crédit</h4>
                <Field label="Apport (€)">
                  <NumberInput
                    value={inputs.financing.credit.apport}
                    onChange={(e) => updateFinancing("credit", { apport: Number(e.target.value) })}
                  />
                </Field>
                <Field label="TAEG (%/an)">
                  <NumberInput
                    step="0.001"
                    value={inputs.financing.credit.tauxAnnuel}
                    onChange={(e) => updateFinancing("credit", { tauxAnnuel: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Durée (mois)">
                  <NumberInput
                    value={inputs.financing.credit.dureeMois}
                    onChange={(e) => updateFinancing("credit", { dureeMois: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <div className="financing-card">
                <h4>LOA</h4>
                <Field label="1er loyer majoré (€)">
                  <NumberInput
                    value={inputs.financing.loa.premierLoyerMajore}
                    onChange={(e) => updateFinancing("loa", { premierLoyerMajore: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Loyer mensuel (€)">
                  <NumberInput
                    value={inputs.financing.loa.loyerMensuel}
                    onChange={(e) => updateFinancing("loa", { loyerMensuel: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Durée (mois)">
                  <NumberInput
                    value={inputs.financing.loa.dureeMois}
                    onChange={(e) => updateFinancing("loa", { dureeMois: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Valeur option d'achat (€)">
                  <NumberInput
                    value={inputs.financing.loa.valeurOptionAchat}
                    onChange={(e) => updateFinancing("loa", { valeurOptionAchat: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Lever l'option d'achat en fin de contrat ?">
                  <select
                    value={inputs.financing.loa.leveeOption ? "oui" : "non"}
                    onChange={(e) => updateFinancing("loa", { leveeOption: e.target.value === "oui" })}
                  >
                    <option value="non">Non — restitution</option>
                    <option value="oui">Oui — achat final</option>
                  </select>
                </Field>
              </div>

              <div className="financing-card">
                <h4>LLD</h4>
                <Field label="1er loyer (€)">
                  <NumberInput
                    value={inputs.financing.lld.premierLoyer}
                    onChange={(e) => updateFinancing("lld", { premierLoyer: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Loyer mensuel (€)">
                  <NumberInput
                    value={inputs.financing.lld.loyerMensuel}
                    onChange={(e) => updateFinancing("lld", { loyerMensuel: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Durée (mois)">
                  <NumberInput
                    value={inputs.financing.lld.dureeMois}
                    onChange={(e) => updateFinancing("lld", { dureeMois: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Km inclus/an">
                  <NumberInput
                    value={inputs.financing.lld.kmInclusAnnuel}
                    onChange={(e) => updateFinancing("lld", { kmInclusAnnuel: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Km réel estimé/an">
                  <NumberInput
                    value={inputs.financing.lld.kmReelAnnuel}
                    onChange={(e) => updateFinancing("lld", { kmReelAnnuel: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Coût km supplémentaire (€/km)">
                  <NumberInput
                    step="0.01"
                    value={inputs.financing.lld.coutKmSupplementaire}
                    onChange={(e) => updateFinancing("lld", { coutKmSupplementaire: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </div>
          </Section>

          <Section title="Projection">
            <Field label="Durée de projection (années)">
              <NumberInput value={inputs.projectionYears} onChange={(e) => update("projectionYears", Number(e.target.value))} />
            </Field>
          </Section>

          <Field label="Nom de la simulation">
            <input value={inputs.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
        </div>

        <div className="layout__results">
          <div className={`banner banner--${results.recommandation}`}>
            <strong>{recoLabel}</strong>
            <span>
              Différence annuelle : {formatEUR(Math.abs(results.difference))}{" "}
              {results.difference > 0 ? "en faveur du personnel" : results.difference < 0 ? "en faveur de la société" : ""}
            </span>
            {results.seuilPrivateUsePercent !== null && (
              <span>
                Seuil d'usage privé à partir duquel le personnel devient plus intéressant : ~
                {results.seuilPrivateUsePercent.toFixed(0)}%
              </span>
            )}
          </div>

          <div className="stat-grid">
            <StatCard label="AEN brut" value={formatEUR(results.aenBrut)} />
            <StatCard label="Abattement électrique" value={formatEUR(results.abattement)} tone={results.abattement > 0 ? "good" : "neutral"} />
            <StatCard label="AEN net" value={formatEUR(results.aenNet)} />
            <StatCard label="Cotisations sociales" value={formatEUR(results.cotisationsTNS)} />
            <StatCard label="IR estimé sur l'AEN" value={formatEUR(results.irEstimee)} sub={`TMI utilisé : ${formatPercent(results.tauxIRUtilise)}`} />
            <StatCard
              label="Coût total annuel — gérant (société)"
              value={formatEUR(results.coutTotalGerantSociete)}
              tone="bad"
            />
            <StatCard label="Coût scénario personnel + IK" value={formatEUR(results.coutScenarioPersonnel)} tone="bad" />
            <StatCard label="Coût net société (après économie d'impôt)" value={formatEUR(results.coutNetSociete)} />
          </div>

          <Section title="Détail société">
            <ul className="detail-list">
              <li>Amortissement annuel ({formatPercent(results.amortRate)}) : {formatEUR(results.amortAnnual)}</li>
              <li>Quote-part professionnelle déductible : {formatEUR(results.quotePartProfessionnelleDeductible)}</li>
              <li>Quote-part privée réintégrée (non déductible) : {formatEUR(results.quotePartPrivéeNonDeductible)}</li>
              <li>Économie d'impôt sur la quote-part pro : {formatEUR(results.economieImpotQuotePartPro)}</li>
            </ul>
          </Section>

          <Section title="Détail scénario personnel + IK">
            <ul className="detail-list">
              <li>Km professionnels/an : {results.proKmAnnual.toFixed(0)} km</li>
              <li>Km privés/an : {results.privateKmAnnual.toFixed(0)} km</li>
              <li>Remboursement IK perçu : {formatEUR(results.ikReimbursement)}</li>
              <li>Crédit personnel annuel : {formatEUR(results.personalLoanAnnual)}</li>
            </ul>
          </Section>

          <Section title="Projection">
            <table className="projection-table">
              <thead>
                <tr>
                  <th>Année</th>
                  <th>Cumul société (€)</th>
                  <th>Cumul personnel (€)</th>
                </tr>
              </thead>
              <tbody>
                {results.projection.map((p) => (
                  <tr key={p.year}>
                    <td>{p.year}</td>
                    <td>{formatEUR(p.cumulSociete)}</td>
                    <td>{formatEUR(p.cumulPersonnel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Modes de financement">
            <table className="projection-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Coût total</th>
                  <th>Équivalent mensuel</th>
                  <th>Devient propriétaire ?</th>
                </tr>
              </thead>
              <tbody>
                {financingResults.map((f) => (
                  <tr key={f.mode} className={f.mode === inputs.financingMode ? "row--selected" : undefined}>
                    <td>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => update("financingMode", f.mode)}
                        title="Retenir ce mode de financement"
                      >
                        {FINANCING_LABELS[f.mode]}
                      </button>
                    </td>
                    <td>{formatEURPrecise(f.coutTotal)}</td>
                    <td>{formatEURPrecise(f.coutMensuelEquivalent)}</td>
                    <td>{f.devientProprietaire ? "Oui" : "Non"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Sauvegarde & comparaison">
            <SavedSimulationsPanel
              kind="vehicle"
              currentInputs={inputs}
              version={saveVersion}
              onLoad={(loaded) => {
                setInputs(loaded);
                setSaveVersion((v) => v + 1);
              }}
              metricsFor={(sim) => {
                const r = computeSimulation(sim);
                return [
                  { label: "AEN net", value: formatEUR(r.aenNet) },
                  { label: "Coût total gérant (société)", value: formatEUR(r.coutTotalGerantSociete) },
                  { label: "Coût scénario personnel", value: formatEUR(r.coutScenarioPersonnel) },
                  { label: "Recommandation", value: r.recommandation },
                ];
              }}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
