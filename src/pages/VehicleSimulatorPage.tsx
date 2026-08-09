import { useMemo, useState } from "react";
import {
  type SimulationInputs,
  DEFAULT_CORPORATE_TAX_RATE,
  DEFAULT_IK_RATE,
  DEFAULT_TNS_RATE,
  computeSimulation,
  createDefaultInputs,
} from "../lib/simulator";
import { COUNTRIES } from "../lib/countries";
import { getCompanyType, getCompanyTypes, resolveDirigeantStatus } from "../lib/companyTypes";
import { createDefaultFinancingInputs, type FinancingMode } from "../lib/financing";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { formatEUR, formatPercent } from "../lib/format";

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
  const companyTypes = getCompanyTypes(inputs.country);
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);
  const defaultCotisationRate = companyTypeConfig?.defaultCotisationRate ?? DEFAULT_TNS_RATE;

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

  const best = results.bestOption;
  const currentIsBest = best.owner === "societe" ? inputs.financingMode === best.mode : inputs.personalFinancingMode === best.mode;

  return (
    <div className="page">
      <h2>🚗 Véhicule de société — quelle est l'option la moins coûteuse au global ?</h2>
      <p className="page__intro">
        Simulateur pour dirigeant TNS (gérant majoritaire) ou assimilé salarié : plutôt que d'opposer société et
        personnel, l'outil chiffre le <strong>coût total consolidé</strong> (société + dirigeant) de chacune des 8
        combinaisons possibles — propriétaire (société ou dirigeant) × mode de financement (comptant, crédit, LOA,
        LLD) — pour identifier celle qui coûte le moins cher au global.
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
            {dirigeantStatus === "ASSIMILE_SALARIE" && <RuleNote ruleId="aen-forfaitaire-assimile-salarie" />}
          </Section>

          <Section title="Véhicule">
            <div className="grid grid--3">
              <Field label="Prix d'achat TTC (€)">
                <NumberInput value={inputs.vehiclePrice} onChange={(e) => handleVehiclePriceChange(Number(e.target.value))} />
              </Field>
              <Field label="Âge du véhicule (si acheté)">
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
            {!inputs.isElectric && (
              <Field label="Émissions de CO2 (g/km, WLTP)" hint="Détermine le plafond de déduction fiscale (art. 39-4 CGI) et les taxes annuelles CO2/polluants.">
                <NumberInput value={inputs.co2EmissionsGkm} onChange={(e) => update("co2EmissionsGkm", Number(e.target.value))} />
              </Field>
            )}
            <RuleNote ruleId="aen-amortissement-taux" />
            <RuleNote ruleId="aen-vehicule-loue-taux" />
            <RuleNote ruleId="malus-ecologique" />
            <RuleNote ruleId="bonus-ecologique" />
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
            {!inputs.isElectric && (
              <Field
                label="Taxes annuelles CO2 + polluants — surcharge manuelle (€, laisser vide pour l'estimation automatique)"
                hint="Estimation simplifiée par paliers à partir des émissions de CO2 saisies ci-dessus ; à vérifier avec le barème officiel."
              >
                <NumberInput
                  value={inputs.annualVehicleTaxOverride ?? ""}
                  placeholder="Estimation automatique"
                  onChange={(e) => update("annualVehicleTaxOverride", e.target.value === "" ? null : Number(e.target.value))}
                />
              </Field>
            )}
            <RuleNote ruleId="taxe-annuelle-co2-polluants" />
            <RuleNote ruleId="tva-vehicule-carburant" />
          </Section>

          <Section
            title="Cotisations & fiscalité"
            subtitle="Valeurs par défaut indicatives (2026) — modifiables et réinitialisables en un clic."
          >
            <div className="grid grid--2">
              <Field label={`Taux de charges sociales sur l'AEN (${dirigeantStatus === "TNS" ? "TNS" : "assimilé salarié"})`}>
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.tnsContributionRate}
                  defaultValue={defaultCotisationRate}
                  formatDefault={(v) => formatPercent(v)}
                  onChange={(v) => update("tnsContributionRate", v)}
                />
              </Field>
              <Field label="Taux d'IS (si régime IS)">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.corporateTaxRate}
                  defaultValue={DEFAULT_CORPORATE_TAX_RATE}
                  formatDefault={(v) => formatPercent(v)}
                  onChange={(v) => update("corporateTaxRate", v)}
                />
              </Field>
            </div>
            <RuleNote ruleId={dirigeantStatus === "TNS" ? "cotisations-tns-taux-global" : "cotisations-assimile-salarie-taux"} />
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section
            title="Situation personnelle du dirigeant (et du foyer)"
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
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.personalTaxProfile.tauxManuel}
                  defaultValue={0.3}
                  formatDefault={(v) => formatPercent(v)}
                  onChange={(v) => updatePersonalTax("tauxManuel", v)}
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
                  <Field label="Salaire net imposable annuel du dirigeant (€)">
                    <NumberInput
                      value={inputs.personalTaxProfile.salaireNetImposableAnnuel}
                      onChange={(e) => updatePersonalTax("salaireNetImposableAnnuel", Number(e.target.value))}
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
                <Field label="Autres revenus imposables du foyer (€/an) — fonciers, dividendes, etc.">
                  <NumberInput
                    value={inputs.personalTaxProfile.autresRevenusImposablesFoyer}
                    onChange={(e) => updatePersonalTax("autresRevenusImposablesFoyer", Number(e.target.value))}
                  />
                </Field>
                <p className="hint-block">
                  Parts fiscales : <strong>{results.partsFiscales}</strong> · Revenu imposable retenu :{" "}
                  <strong>{formatEUR(results.revenuImposableFoyer)}</strong> · TMI calculé :{" "}
                  <strong>{formatPercent(results.tmiCalcule)}</strong> · Impôt du foyer après décote :{" "}
                  <strong>{formatEUR(results.impotFoyerApresDecote)}</strong>
                </p>
                <RuleNote ruleId="ir-bareme-2026" />
                <RuleNote ruleId="ir-abattement-10-salaires" />
                <RuleNote ruleId="ir-decote" />
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
                <ResetableNumberInput
                  step="0.001"
                  value={inputs.ikRatePerKm}
                  defaultValue={DEFAULT_IK_RATE}
                  onChange={(v) => update("ikRatePerKm", v)}
                />
              </Field>
            </div>
            <RuleNote ruleId="ik-bareme-2026" />
          </Section>

          <Section
            title="Mode d'acquisition du véhicule"
            subtitle="Paramètres communs, utilisés à la fois si la société achète le véhicule et si le dirigeant l'achète à titre personnel."
          >
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
          <div className="banner banner--societe">
            <strong>
              Option la moins coûteuse au global : {best.label} — {formatEUR(best.globalCostAnnual)}/an
            </strong>
            <span>
              Coût consolidé (société + dirigeant), toutes charges, cotisations et économies d'impôt comprises.
            </span>
            {!currentIsBest && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() =>
                  setInputs((prev) => ({
                    ...prev,
                    ...(best.owner === "societe" ? { financingMode: best.mode } : { personalFinancingMode: best.mode }),
                  }))
                }
              >
                Retenir cette option pour le détail ci-dessous
              </button>
            )}
          </div>

          <Section title="Comparaison de toutes les options">
            <table className="projection-table">
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Coût global annuel</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.allOptions.map((opt, idx) => (
                  <tr key={opt.label} className={idx === 0 ? "row--selected" : undefined}>
                    <td>
                      {idx === 0 && "🏆 "}
                      {opt.label}
                    </td>
                    <td>{formatEUR(opt.globalCostAnnual)}</td>
                    <td>
                      {idx > 0 && `+${formatEUR(opt.globalCostAnnual - results.allOptions[0].globalCostAnnual)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.seuilPrivateUsePercent !== null && (
              <p className="hint-block">
                Pour les modes actuellement sélectionnés ci-dessous, le seuil de bascule société ⇄ personnel se situe
                vers {results.seuilPrivateUsePercent.toFixed(0)}% d'usage privé.
              </p>
            )}
          </Section>

          <Section
            title={`Détail — société (${FINANCING_LABELS[inputs.financingMode]})`}
            subtitle="Mode de financement retenu pour cet affichage détaillé."
          >
            <div className="grid grid--2" style={{ marginBottom: "0.75rem" }}>
              <Field label="Mode de financement (société)">
                <select value={inputs.financingMode} onChange={(e) => update("financingMode", e.target.value as FinancingMode)}>
                  {(["comptant", "credit", "loa", "lld"] as FinancingMode[]).map((m) => (
                    <option key={m} value={m}>
                      {FINANCING_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="stat-grid">
              <StatCard label="AEN brut" value={formatEUR(results.aenBrut)} />
              <StatCard label="Abattement électrique" value={formatEUR(results.abattement)} tone={results.abattement > 0 ? "good" : "neutral"} />
              <StatCard label="AEN net" value={formatEUR(results.aenNet)} />
              <StatCard label="Cotisations sociales" value={formatEUR(results.cotisationsTNS)} />
              <StatCard label="IR estimé sur l'AEN" value={formatEUR(results.irEstimee)} sub={`TMI utilisé : ${formatPercent(results.tauxIRUtilise)}`} />
              <StatCard label="Coût cash annuel — dirigeant" value={formatEUR(results.coutTotalGerantSociete)} tone="bad" />
              <StatCard label="Coût net société (après économie d'impôt)" value={formatEUR(results.coutNetSociete)} tone="bad" />
              <StatCard label="Coût global consolidé" value={formatEUR(results.globalCostSociete)} tone="bad" />
            </div>
            <ul className="detail-list">
              <li>Base réelle retenue pour l'AEN : {formatEUR(results.aenBaseAnnualCosts)}</li>
              <li>Taxes annuelles CO2 + polluants (ex-TVS) : {formatEUR(results.annualVehicleTax)}</li>
              <li>
                Décaissement réel annuel société (financement + assurance + entretien + taxes) :{" "}
                {formatEUR(results.companyCashBaseAnnual)}
              </li>
              <li>
                Plafond de déduction fiscale (art. 39-4 CGI) : {formatEUR(results.plafondAmortissementDeductible)} — fraction
                déductible : {formatPercent(results.fractionFiscalementDeductible)}
              </li>
              {results.reintegrationFiscaleCO2 > 0 && (
                <li className="warning-inline">
                  Réintégration fiscale (dépassement du plafond) : {formatEUR(results.reintegrationFiscaleCO2)}/an
                </li>
              )}
              <li>Quote-part professionnelle déductible : {formatEUR(results.quotePartProfessionnelleDeductible)}</li>
              <li>Quote-part privée réintégrée (non déductible) : {formatEUR(results.quotePartPrivéeNonDeductible)}</li>
              <li>Économie d'impôt sur la quote-part pro : {formatEUR(results.economieImpotQuotePartPro)}</li>
            </ul>
            <RuleNote ruleId="plafond-amortissement-vehicule" />
          </Section>

          <Section
            title={`Détail — achat personnel + IK (${FINANCING_LABELS[inputs.personalFinancingMode]})`}
            subtitle="Mode de financement retenu pour cet affichage détaillé."
          >
            <div className="grid grid--2" style={{ marginBottom: "0.75rem" }}>
              <Field label="Mode de financement (personnel)">
                <select
                  value={inputs.personalFinancingMode}
                  onChange={(e) => update("personalFinancingMode", e.target.value as FinancingMode)}
                >
                  {(["comptant", "credit", "loa", "lld"] as FinancingMode[]).map((m) => (
                    <option key={m} value={m}>
                      {FINANCING_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="stat-grid">
              <StatCard label="Km professionnels/an" value={`${results.proKmAnnual.toFixed(0)} km`} />
              <StatCard label="Km privés/an" value={`${results.privateKmAnnual.toFixed(0)} km`} />
              <StatCard label="Remboursement IK perçu" value={formatEUR(results.ikReimbursement)} tone="good" />
              <StatCard label="Coût financement annuel" value={formatEUR(results.personalFinancingAnnual)} />
              <StatCard label="Coût net — dirigeant (après IK)" value={formatEUR(results.coutScenarioPersonnel)} tone="bad" />
              <StatCard label="Économie d'impôt société sur l'IK" value={formatEUR(results.economieImpotIK)} tone="good" />
              <StatCard label="Coût global consolidé" value={formatEUR(results.globalCostPersonnel)} tone="bad" />
            </div>
          </Section>

          <Section title="Projection (coût global cumulé)">
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
                  { label: "Meilleure option globale", value: r.bestOption.label },
                  { label: "Coût de la meilleure option", value: formatEUR(r.bestOption.globalCostAnnual) },
                  { label: "Coût global société (mode sélectionné)", value: formatEUR(r.globalCostSociete) },
                  { label: "Coût global personnel (mode sélectionné)", value: formatEUR(r.globalCostPersonnel) },
                ];
              }}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
