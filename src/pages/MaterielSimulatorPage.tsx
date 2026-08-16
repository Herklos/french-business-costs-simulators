import { useEffect, useMemo, useState } from "react";
import {
  type CategorieMateriel,
  type MaterielInputs,
  type ModeAcquisitionMateriel,
  CATEGORIE_LABELS,
  DUREE_AMORTISSEMENT_PAR_CATEGORIE,
  MODE_ACQUISITION_LABELS,
  estLoa,
  SEUIL_CHARGE_IMMEDIATE_HT,
  compareMontagesMateriel,
  computeMateriel,
  createDefaultMaterielInputs,
} from "../lib/materiel";
import { MontageCards } from "../components/MontageCards";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { DEFAULT_CORPORATE_TAX_RATE } from "../lib/simulator";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { CopyButton } from "../components/CopyButton";
import { ShareButton } from "../components/ShareButton";
import { PdfButton } from "../components/PdfButton";
import { PrintableReport } from "../components/PrintableReport";
import { mergeSharedInputs } from "../lib/urlShare";
import { PersonalTaxProfileFields } from "../components/PersonalTaxProfileFields";
import { savePersonalTaxProfile, withPersistedPersonalTaxProfile } from "../lib/storage";
import { formatEUR, formatEURPrecise, formatPercent } from "../lib/format";

const MODE_LABELS = MODE_ACQUISITION_LABELS;

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
  push(
    `Plan de renouvellement — ${r.nombreCycles} cycle(s) sur ${sim.horizonRenouvellementAnnees} ans : coût net société total ${formatEUR(r.coutTotalSurHorizon)}`,
  );
  push("");
  push(`— Comparatif des montages (coût net global société + dirigeant sur ${sim.horizonRenouvellementAnnees} ans) —`);
  const { montages, meilleur } = compareMontagesMateriel(sim);
  for (const m of montages) {
    const ecart = m.meilleur ? "le moins cher" : `+${formatEUR(m.ecartVsMeilleur)}`;
    push(`${m.mode === sim.modeAcquisition ? "▸" : " "} ${m.label} : ${formatEUR(m.coutHorizon)} (${ecart})`);
  }
  push(`Montage le moins cher : ${meilleur.label}.`);
  if (sim.usagePrivePercent > 0) {
    push(
      `Usage mixte (${sim.usagePrivePercent}% privé) : AEN annuelle ${formatEUR(r.aenAnnuelle)} · coût dirigeant (cotisations + IR) ${formatEUR(r.coutDirigeantAEN)}`,
    );
  }
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

export function MaterielSimulatorPage({ initialShareData }: { initialShareData?: string }) {
  const [inputs, setInputs] = useState<MaterielInputs>(
    () => mergeSharedInputs(withPersistedPersonalTaxProfile(createDefaultMaterielInputs()), initialShareData),
  );
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeMateriel(inputs), [inputs]);
  const comparatif = useMemo(() => compareMontagesMateriel(inputs), [inputs]);

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
        (immédiate si le prix HT n'excède pas {formatEUR(SEUIL_CHARGE_IMMEDIATE_HT)}, sinon amortie) et compare
        d'emblée les <strong>cinq montages possibles</strong> — achat par la société, achat personnel remboursé sur
        note de frais, achat personnel non remboursé, LOA sans levée d'option et LOA avec levée. Vous n'avez pas à en
        choisir un pour en connaître le coût : ils sont tous chiffrés, le choix vient après.
      </p>

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildMaterielExportText(inputs)} />
        <ShareButton page="materiel" getInputs={() => inputs} />
        <PdfButton />
      </div>
      <PrintableReport text={buildMaterielExportText(inputs)} />

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
              <Field label="Prix HT (€)" hint={estLoa(inputs.modeAcquisition) ? "Sans effet en LOA : indicatif seulement, cf. loyer LOA ci-dessous." : undefined}>
                <NumberInput value={inputs.prixHT} onChange={(e) => update("prixHT", Number(e.target.value))} />
              </Field>
              <Field
                label="Durée d'amortissement (années)"
                hint={
                  estLoa(inputs.modeAcquisition)
                    ? "Sans effet en LOA : cf. durée du contrat LOA ci-dessous."
                    : results.eligibleChargeImmediate
                      ? "Sans effet : déduction immédiate en charge."
                      : undefined
                }
              >
                <NumberInput
                  disabled={results.eligibleChargeImmediate || estLoa(inputs.modeAcquisition)}
                  value={inputs.dureeAmortissementAnnees}
                  onChange={(e) => update("dureeAmortissementAnnees", Number(e.target.value))}
                />
              </Field>
            </div>
            <p className="hint-block">
              {estLoa(inputs.modeAcquisition)
                ? `LOA : loyers intégralement déductibles en charge, sans amortissement — annuité : ${formatEUR(results.chargeAnnee1)}/an.`
                : results.eligibleChargeImmediate
                  ? `Prix ≤ ${formatEUR(SEUIL_CHARGE_IMMEDIATE_HT)} HT : déduction immédiate en charge, sans amortissement.`
                  : `Prix > ${formatEUR(SEUIL_CHARGE_IMMEDIATE_HT)} HT : amorti sur ${inputs.dureeAmortissementAnnees} ans — annuité : ${formatEUR(results.annuiteAmortissement)}/an.`}
            </p>
            <RuleNote ruleId="materiel-petit-equipement-charge-immediate" />
          </Section>

          <Section
            title="Conditions de la LOA / du leasing"
            subtitle="Renseignées en permanence : la LOA est chiffrée d'office dans le comparatif, sans avoir à la sélectionner."
          >
            <div className="grid grid--3">
              <Field label="Loyer mensuel LOA (€)">
                <NumberInput value={inputs.loaLoyerMensuel} onChange={(e) => update("loaLoyerMensuel", Number(e.target.value))} />
              </Field>
              <Field label="Durée du contrat LOA (mois)">
                <NumberInput value={inputs.loaDureeMois} onChange={(e) => update("loaDureeMois", Number(e.target.value))} />
              </Field>
              <Field
                label="Prix de levée de l'option (€)"
                hint={
                  results.optionEnChargeImmediate
                    ? `Sous ${formatEUR(SEUIL_CHARGE_IMMEDIATE_HT)} HT : déduit immédiatement plutôt qu'amorti.`
                    : "Montant à payer au terme pour conserver le matériel."
                }
              >
                <NumberInput
                  value={inputs.loaValeurOptionAchat}
                  onChange={(e) => update("loaValeurOptionAchat", Number(e.target.value))}
                />
              </Field>
            </div>
            <p className="hint-block">
              Les loyers sont intégralement déductibles en charge, sans amortissement, et rien ne figure à l'actif
              pendant le contrat. Ce qui distingue les deux variantes comparées, c'est ce qui se passe au terme : sans
              levée d'option le matériel est restitué et doit être reloué pour continuer à servir ; avec levée, le prix
              de l'option acquiert le matériel, s'amortit à son tour, et le cycle s'allonge d'autant.
            </p>
            <details className="details-block">
              <summary>Pourquoi aucun champ ne demande le taux d'intérêt de la LOA</summary>
              <p>
                Parce qu'une offre de location ne s'exprime pas par un taux, mais par des loyers — qui l'incorporent
                déjà. Le saisir en plus serait redondant ; le saisir à la place des loyers supposerait de reconstituer
                ceux-ci par une convention d'amortissement que le loueur ne publie pas.
              </p>
              <p>
                Le simulateur fait donc l'inverse : il <strong>déduit</strong> le taux des flux réellement contractés,
                ce qui permet de comparer l'offre à un crédit sur la seule dimension où les deux sont comparables.
                {results.tauxImpliciteLoaAnnuel !== null ? (
                  <>
                    {" "}
                    Sur vos valeurs — {formatEUR(inputs.prixHT)} comptant contre{" "}
                    {formatEUR(inputs.loaLoyerMensuel)}/mois pendant {inputs.loaDureeMois} mois puis{" "}
                    {formatEUR(inputs.loaValeurOptionAchat)} de levée —, le taux annuel implicite ressort à{" "}
                    <strong>{formatPercent(results.tauxImpliciteLoaAnnuel)}</strong>.
                  </>
                ) : (
                  <>
                    {" "}
                    Ce taux n'a toutefois de sens que si l'option est levée : la société acquiert alors le matériel en
                    différé, et l'écart entre son prix comptant et la somme actualisée des loyers puis du prix de levée
                    est le coût de ce différé. Sans levée d'option, rien n'est financé — c'est une location, et lui
                    prêter un taux d'intérêt n'aurait pas de sens. Sélectionnez la carte « option levée » pour le voir
                    chiffré.
                  </>
                )}
              </p>
            </details>
          </Section>

          <Section
            title="Plan de renouvellement périodique"
            subtitle="Projette le coût sur plusieurs cycles d'acquisition successifs (achat ou LOA renouvelé à chaque échéance)."
          >
            <div className="grid grid--2">
              <Field label="Horizon de projection (années)">
                <NumberInput
                  value={inputs.horizonRenouvellementAnnees}
                  onChange={(e) => update("horizonRenouvellementAnnees", Number(e.target.value))}
                />
              </Field>
              <Field label="Inflation estimée du prix entre deux cycles (%)">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.tauxInflationMateriel}
                  defaultValue={0}
                  formatDefault={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update("tauxInflationMateriel", v)}
                />
              </Field>
            </div>
            <p className="hint-block">
              {results.nombreCycles} cycle{results.nombreCycles > 1 ? "s" : ""} de {results.dureeCycleAnnees.toFixed(1)} an
              {results.dureeCycleAnnees >= 2 ? "s" : ""} sur l'horizon choisi.
            </p>
          </Section>

          <Section
            title="Usage mixte pro/privé (avantage en nature)"
            subtitle="Si le dirigeant utilise aussi le matériel à titre personnel, un avantage en nature (AEN) est généré au prorata."
          >
            <div className="grid grid--2">
              <Field label={`% d'usage privé : ${inputs.usagePrivePercent}%`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={inputs.usagePrivePercent}
                  onChange={(e) => update("usagePrivePercent", Number(e.target.value))}
                />
              </Field>
              <Field label="Taux de charges sociales sur l'AEN">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.tauxChargesSocialesAEN}
                  defaultValue={0.43}
                  formatDefault={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => update("tauxChargesSocialesAEN", v)}
                />
              </Field>
            </div>
            <RuleNote ruleId="materiel-avantage-en-nature" />
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
          <Section
            title="Quel montage coûte le moins cher ?"
            subtitle={`Coût net global — société et dirigeant réunis — sur ${inputs.horizonRenouvellementAnnees} ans, seule base sur laquelle des cycles de longueurs différentes se comparent.`}
          >
            <MontageCards
              montages={comparatif.montages.map((m) => ({
                id: m.mode,
                label: m.label,
                resume: m.resume,
                cout: m.coutHorizon,
                ecartVsMeilleur: m.ecartVsMeilleur,
                meilleur: m.meilleur,
              }))}
              selectedId={inputs.modeAcquisition}
              onSelect={(id) => update("modeAcquisition", id as ModeAcquisitionMateriel)}
              legende={`sur ${inputs.horizonRenouvellementAnnees} ans`}
            />
            <p className="hint-block">
              Achat société et achat personnel remboursé affichent le même montant : ils sont fiscalement identiques,
              seul le circuit de paiement diffère. Les deux variantes de LOA se rejoignent de même tant qu'aucun prix
              de levée n'est saisi. Cliquez une carte pour en détailler le calcul ci-dessous.
            </p>
          </Section>

          <Section title={`Détail — ${MODE_LABELS[inputs.modeAcquisition]}`}>
            <div className="stat-grid">
              <StatCard
                label="Charge déductible année 1"
                value={formatEUR(results.chargeAnnee1)}
                sub={
                  estLoa(inputs.modeAcquisition)
                    ? `Loyers LOA · contrat de ${inputs.loaDureeMois} mois${results.valeurOptionAchatRetenue > 0 ? `, puis ${formatEUR(results.valeurOptionAchatRetenue)} de levée` : ""}`
                    : results.eligibleChargeImmediate
                      ? `Déduction immédiate (≤ ${formatEUR(SEUIL_CHARGE_IMMEDIATE_HT)} HT)`
                      : `Annuité d'amortissement sur ${inputs.dureeAmortissementAnnees} ans`
                }
              />
              <StatCard
                label="Économie d'impôt année 1"
                value={formatEUR(results.economieImpotAnnee1)}
                sub={`Économie vs achat non remboursé : ${formatEURPrecise(results.economieVsNonRembourse)}`}
                tone="good"
              />
              <StatCard
                label="Coût net société — année 1"
                value={formatEUR(results.coutNetSocieteAnnee1)}
                sub={`Sur un cycle de ${results.dureeCycleAnnees.toFixed(1)} an${results.dureeCycleAnnees >= 2 ? "s" : ""} : ${formatEUR(results.coutNetSocieteTotalSurDuree)}`}
                tone="bad"
              />
              <StatCard
                label={`Coût global sur ${inputs.horizonRenouvellementAnnees} ans`}
                value={formatEUR(results.coutNetGlobalSurHorizon)}
                sub={`${results.nombreCycles} cycle${results.nombreCycles > 1 ? "s" : ""} · dont société : ${formatEUR(results.coutTotalSurHorizon)}`}
                tone="bad"
              />
              {inputs.modeAcquisition === "personnel_non_rembourse" && (
                <StatCard
                  label="Coût dirigeant (non remboursé)"
                  value={formatEUR(results.coutDirigeantNonRembourse)}
                  sub="Payé sur des revenus déjà taxés, sans aucune charge déductible"
                  tone="bad"
                />
              )}
              {inputs.usagePrivePercent > 0 && (
                <StatCard
                  label="Coût dirigeant — avantage en nature"
                  value={formatEUR(results.coutDirigeantAEN)}
                  sub={`AEN annuelle : ${formatEUR(results.aenAnnuelle)} (${inputs.usagePrivePercent}% d'usage privé)`}
                  tone="bad"
                />
              )}
            </div>
            {inputs.modeAcquisition === "personnel_non_rembourse" && (
              <p className="warning-block">
                Aucune charge déductible pour la société dans ce montage : le dirigeant supporte le prix plein sur des
                revenus déjà taxés, sans aucun avantage fiscal.
              </p>
            )}
          </Section>

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
                  { label: "Montage", value: MODE_LABELS[sim.modeAcquisition] },
                  { label: "Charge déductible année 1", value: formatEUR(r.chargeAnnee1) },
                  { label: `Coût global sur ${sim.horizonRenouvellementAnnees} ans`, value: formatEUR(r.coutNetGlobalSurHorizon) },
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
