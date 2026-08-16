import { useEffect, useMemo, useState } from "react";
import {
  type MutuellePrevoyanceInputs,
  EFFECTIF_ASSUJETTI_FORFAIT_SOCIAL,
  PART_PATRONALE_MAXIMALE_POURCENT,
  PART_PATRONALE_MINIMALE_POURCENT,
  TAUX_CHARGES_PATRONALES_REINTEGRATION_DEFAUT,
  TAUX_CHARGES_SALARIALES_REINTEGRATION_DEFAUT,
  TAUX_CSG_CRDS_PART_PATRONALE,
  TAUX_FORFAIT_SOCIAL_PREVOYANCE,
  computeMutuellePrevoyance,
  createDefaultMutuellePrevoyanceInputs,
  applyMutuelleDraft,
  extractMutuelleDraft,
} from "../lib/mutuellePrevoyance";
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
import { loadDraft, savePersonalTaxProfile, saveDraft, withPersistedPersonalTaxProfile } from "../lib/storage";
import { formatEUR, formatPercent } from "../lib/format";

/** Résumé texte complet d'une simulation mutuelle/prévoyance, destiné à être copié dans le presse-papier. */
function buildMutuelleExportText(sim: MutuellePrevoyanceInputs): string {
  const r = computeMutuellePrevoyance(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(`🩺 ${sim.name} — Simulateur mutuelle & prévoyance du dirigeant`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push(`Forme juridique : ${sim.companyType} · Statut : ${r.dirigeantStatus === "TNS" ? "TNS" : "Assimilé salarié"}`);
  push("");
  push("— Personnes couvertes —");
  push(
    `${r.nombrePersonnesCouvertes} personne(s) : dirigeant${sim.couvertureConjoint ? " + conjoint" : ""}${sim.nombreEnfantsCouverts > 0 ? ` + ${sim.nombreEnfantsCouverts} enfant(s)` : ""}`,
  );
  push(
    `Cotisation dirigeant seul : ${formatEUR(r.cotisationDirigeantSeul)} · Surcoût famille : ${formatEUR(r.cotisationFamille)} · Total : ${formatEUR(r.cotisationTotale)}/an`,
  );
  push("");
  if (r.dirigeantStatus === "TNS") {
    push("— TNS (Madelin) —");
    push(`Prise en charge : 100% ${sim.priseEnChargeParLaSociete ? "par la société" : "personnelle (dirigeant)"}`);
    push(`Plafond Madelin déductible : ${formatEUR(r.plafondMadelin)} · Déductible : ${formatEUR(r.cotisationDeductibleTNS)} · Non déductible : ${formatEUR(r.cotisationNonDeductibleTNS)}`);
    push("Les ayants droit sont déductibles dans ce plafond unique — il n'est pas relevé par personne couverte (art. 154 bis CGI).");
  } else {
    push("— Assimilé salarié (mutuelle collective) —");
    push(
      `Part patronale : ${formatEUR(r.partPatronale)} (dirigeant ${sim.partPatronalePourcent}% : ${formatEUR(r.partPatronaleDirigeant)} · famille ${sim.partPatronaleFamillePourcent}% : ${formatEUR(r.partPatronaleFamille)}) · Part salariale : ${formatEUR(r.partSalariale)}`,
    );
    push(
      `Extension famille : ${sim.extensionFamilleObligatoire ? "obligatoire (part patronale exonérée dans le plafond)" : "facultative (part patronale assujettie dès le 1er euro)"}`,
    );
    push(`Plafond d'exonération (sur la part patronale) : ${formatEUR(r.plafondExonerationSociale)} · Exonéré : ${formatEUR(r.montantExonere)}`);
    push(
      `Réintégré dans l'assiette : ${formatEUR(r.montantExcedentaire)} (dépassement de plafond ${formatEUR(r.excedentPlafond)} + famille facultative ${formatEUR(r.partFamilleAssujettie)})`,
    );
    push(
      `CSG/CRDS sur la part patronale : ${formatEUR(r.csgCrdsSurPartPatronale)} · Forfait social : ${formatEUR(r.forfaitSocial)}`,
    );
  }
  push("");
  push("— Résultats —");
  push(`Économie d'impôt société : ${formatEUR(r.economieImpotSociete)} · Coût net société : ${formatEUR(r.coutNetSociete)}`);
  push(`Économie d'impôt dirigeant : ${formatEUR(r.economieImpotDirigeant)} · Coût net dirigeant : ${formatEUR(r.coutNetDirigeant)}`);
  push(`Coût net global : ${formatEUR(r.coutNetGlobal)} (${formatPercent(r.tauxEconomieGlobal)} d'économie vs cotisation brute)`);
  push(
    `Économie vs le même contrat souscrit à titre individuel (${formatEUR(r.coutContratIndividuelEquivalent)}) : ${formatEUR(r.economieVsContratIndividuel)}/an`,
  );
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

export function MutuellePrevoyanceSimulatorPage({ initialShareData }: { initialShareData?: string }) {
  const [inputs, setInputs] = useState<MutuellePrevoyanceInputs>(
    () =>
      mergeSharedInputs(
        withPersistedPersonalTaxProfile(applyMutuelleDraft(createDefaultMutuellePrevoyanceInputs(), loadDraft("mutuelle"))),
        initialShareData,
      ),
  );
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeMutuellePrevoyance(inputs), [inputs]);

  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  // Tout le reste du formulaire est memorise sur cet appareil et recharge a la visite suivante.
  useEffect(() => {
    saveDraft("mutuelle", extractMutuelleDraft(inputs));
  }, [inputs]);

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
        <ShareButton page="mutuelle" getInputs={() => inputs} />
        <PdfButton />
      </div>
      <PrintableReport text={buildMutuelleExportText(inputs)} />

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

          <Section
            title="Qui est couvert ?"
            subtitle="Le dirigeant, et facultativement son conjoint et ses enfants. Les contrats facturent la famille par tête : c'est ce surcoût qui est saisi ici."
          >
            <Field label="Cotisation annuelle du dirigeant seul (€/an)" hint="Santé + prévoyance, couverture « isolé ».">
              <NumberInput value={inputs.cotisationAnnuelle} onChange={(e) => update("cotisationAnnuelle", Number(e.target.value))} />
            </Field>

            <div className="grid grid--2">
              <div className="field">
                <span className="field__label">Conjoint couvert ?</span>
                <select
                  value={inputs.couvertureConjoint ? "oui" : "non"}
                  onChange={(e) => update("couvertureConjoint", e.target.value === "oui")}
                >
                  <option value="non">Non — dirigeant seul</option>
                  <option value="oui">Oui — conjoint rattaché au contrat</option>
                </select>
              </div>
              <Field label="Surcoût annuel du conjoint (€/an)">
                <NumberInput
                  disabled={!inputs.couvertureConjoint}
                  value={inputs.surcoutConjointAnnuel}
                  onChange={(e) => update("surcoutConjointAnnuel", Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="grid grid--2">
              <Field label="Nombre d'enfants couverts">
                <NumberInput
                  min={0}
                  value={inputs.nombreEnfantsCouverts}
                  onChange={(e) => update("nombreEnfantsCouverts", Number(e.target.value))}
                />
              </Field>
              <Field
                label="Surcoût annuel par enfant (€/an)"
                hint="Beaucoup de contrats plafonnent la facturation au 2e ou 3e enfant : ajustez la valeur en conséquence."
              >
                <NumberInput
                  disabled={inputs.nombreEnfantsCouverts <= 0}
                  value={inputs.surcoutParEnfantAnnuel}
                  onChange={(e) => update("surcoutParEnfantAnnuel", Number(e.target.value))}
                />
              </Field>
            </div>

            <p className="hint-block">
              {results.nombrePersonnesCouvertes} personne{results.nombrePersonnesCouvertes > 1 ? "s" : ""} couverte
              {results.nombrePersonnesCouvertes > 1 ? "s" : ""} · cotisation totale{" "}
              <strong>{formatEUR(results.cotisationTotale)}/an</strong>
              {results.cotisationFamille > 0 && <> dont {formatEUR(results.cotisationFamille)} au titre de la famille</>}.
            </p>
          </Section>

          <Section title="Traitement de la cotisation">
            {results.dirigeantStatus === "TNS" ? (
              <>
                <Field
                  label="Qui paie la cotisation ?"
                  hint="Choix tout ou rien : la cotisation est payée en intégralité par l'un ou par l'autre, pas de partage possible."
                >
                  <select
                    value={inputs.priseEnChargeParLaSociete ? "societe" : "personnel"}
                    onChange={(e) => update("priseEnChargeParLaSociete", e.target.value === "societe")}
                  >
                    <option value="societe">
                      La société paie 100% de la cotisation ({formatEUR(results.cotisationTotale)}, déductible du résultat société)
                    </option>
                    <option value="personnel">
                      Le dirigeant paie 100% personnellement ({formatEUR(results.cotisationTotale)}, déductible de son revenu imposable)
                    </option>
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
                {results.cotisationFamille > 0 && (
                  <p className="hint-block">
                    <strong>Taux de prise en charge de la famille : 100 % possible</strong>, sans plafond ni minimum —
                    pour un TNS il n'existe qu'un contrat et un payeur, pas de partage patronal/salarial. Les
                    cotisations du conjoint et des enfants sont déductibles au même titre que les vôtres, à condition
                    qu'ils soient vos ayants droit au même régime de sécurité sociale. Mais elles s'imputent sur le{" "}
                    <strong>même plafond unique</strong> : couvrir la famille ne le relève pas, il se sature seulement
                    plus vite.
                    {results.cotisationNonDeductibleTNS > 0 && (
                      <>
                        {" "}
                        C'est exactement ce qui se produit ici :{" "}
                        <strong>{formatEUR(results.cotisationNonDeductibleTNS)}</strong> restent hors déduction.
                      </>
                    )}
                  </p>
                )}
                <RuleNote ruleId="madelin-ayants-droit-plafond-unique" />
              </>
            ) : (
              <>
                <div className="grid grid--2">
                  <Field
                    label="Part employeur sur le dirigeant (%)"
                    hint={`Plancher légal ${PART_PATRONALE_MINIMALE_POURCENT}%, aucun plafond : ${PART_PATRONALE_MAXIMALE_POURCENT}% est admis.`}
                  >
                    <NumberInput
                      min={PART_PATRONALE_MINIMALE_POURCENT}
                      max={PART_PATRONALE_MAXIMALE_POURCENT}
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

                {results.cotisationFamille > 0 && (
                  <>
                    <div className="grid grid--2">
                      <Field
                        label="Part employeur sur la famille (%)"
                        hint="Aucun minimum légal, aucun plafond : de 0 à 100 %, au libre choix de l'employeur."
                      >
                        <NumberInput
                          min={0}
                          max={PART_PATRONALE_MAXIMALE_POURCENT}
                          value={inputs.partPatronaleFamillePourcent}
                          onChange={(e) => update("partPatronaleFamillePourcent", Number(e.target.value))}
                        />
                      </Field>
                      <div className="field">
                        <span className="field__label">Affiliation des ayants droit</span>
                        <select
                          value={inputs.extensionFamilleObligatoire ? "obligatoire" : "facultative"}
                          onChange={(e) => update("extensionFamilleObligatoire", e.target.value === "obligatoire")}
                        >
                          <option value="facultative">Facultative — le salarié choisit d'y adhérer</option>
                          <option value="obligatoire">Obligatoire — imposée par l'acte fondateur</option>
                        </select>
                        <span className="field__hint">
                          Accord collectif, référendum ou décision unilatérale de l'employeur (DUE).
                        </span>
                      </div>
                    </div>

                    <p className={inputs.extensionFamilleObligatoire ? "hint-block" : "warning-block"}>
                      <strong>
                        Oui, 100 % est possible — mais le taux n'est pas ce qui décide du coût.
                      </strong>{" "}
                      L'obligation de financer la moitié ne porte que sur le salarié lui-même : sur les ayants droit,
                      l'employeur finance ce qu'il veut, de 0 à 100 %. Ce qui change tout, c'est le{" "}
                      <em>caractère obligatoire</em> de leur affiliation.{" "}
                      {inputs.extensionFamilleObligatoire ? (
                        <>
                          Ici l'extension est obligatoire : la part patronale qui la finance (
                          {formatEUR(results.partPatronaleFamille)}) garde le caractère collectif et obligatoire, et
                          entre dans l'exclusion d'assiette au même titre que celle du dirigeant — dans le plafond
                          commun, qu'elle contribue donc à saturer.
                        </>
                      ) : (
                        <>
                          Ici l'extension est facultative : toute part patronale qui la finance est{" "}
                          <strong>assujettie à cotisations dès le premier euro</strong>, sans même consommer le plafond
                          — {formatEUR(results.partPatronaleFamille)} au taux actuel de{" "}
                          {inputs.partPatronaleFamillePourcent} %. La financer revient à se verser un complément de
                          rémunération. Rendre l'affiliation obligatoire dans l'acte fondateur est le seul moyen de la
                          faire bénéficier de l'exonération.
                        </>
                      )}
                    </p>
                    <RuleNote ruleId="mutuelle-ayants-droit-caractere-obligatoire" />
                    <RuleNote ruleId="mutuelle-taux-prise-en-charge-employeur" />
                  </>
                )}

                <p className="hint-block">
                  Plafond d'exonération : <strong>{formatEUR(results.plafondExonerationSociale)}</strong>/an, apprécié
                  sur la seule part patronale ({formatEUR(results.partPatronale)}) — ce que le dirigeant finance
                  lui-même n'a jamais eu à être exclu d'une assiette.
                </p>
                {results.montantExcedentaire > 0 && (
                  <p className="warning-block">
                    <strong>{formatEUR(results.montantExcedentaire)}</strong> réintégrés dans l'assiette des cotisations
                    et imposés comme un complément de rémunération
                    {results.excedentPlafond > 0 && results.partFamilleAssujettie > 0 ? (
                      <>
                        {" "}
                        : {formatEUR(results.excedentPlafond)} de dépassement de plafond et{" "}
                        {formatEUR(results.partFamilleAssujettie)} au titre de l'extension famille facultative
                      </>
                    ) : results.partFamilleAssujettie > 0 ? (
                      <> au titre de l'extension famille facultative</>
                    ) : (
                      <> au titre du dépassement de plafond</>
                    )}
                    . Coût correspondant : {formatEUR(results.chargesPatronalesReintegration)} de charges patronales,{" "}
                    {formatEUR(results.chargesSalarialesReintegration)} de charges salariales et{" "}
                    {formatEUR(results.irSurExcedent)} d'impôt sur le revenu.
                  </p>
                )}
                <RuleNote ruleId="mutuelle-collective-plafond-exoneration" />

                <details className="details-block">
                  <summary>Ce que la fraction exonérée coûte quand même</summary>
                  <p>
                    Être exclu de l'assiette des cotisations de sécurité sociale n'est pas être exonéré de tout. Sur les{" "}
                    {formatEUR(results.montantExonere)} exonérés, la CSG/CRDS reste due au taux plein de{" "}
                    {formatPercent(TAUX_CSG_CRDS_PART_PATRONALE)}, sans l'abattement d'assiette de 1,75 % — soit{" "}
                    <strong>{formatEUR(results.csgCrdsSurPartPatronale)}</strong>, précomptés sur le bulletin et donc
                    supportés par le dirigeant. S'y ajoute, à partir de{" "}
                    {EFFECTIF_ASSUJETTI_FORFAIT_SOCIAL} salariés seulement, le forfait social de{" "}
                    {formatPercent(TAUX_FORFAIT_SOCIAL_PREVOYANCE)} à la charge de la société —{" "}
                    {inputs.effectifAuMoins11Salaries
                      ? `${formatEUR(results.forfaitSocial)} ici`
                      : "nul ici, l'effectif étant inférieur au seuil"}
                    .
                  </p>
                  <div className="grid grid--2">
                    <div className="field">
                      <span className="field__label">Effectif de la société</span>
                      <select
                        value={inputs.effectifAuMoins11Salaries ? "oui" : "non"}
                        onChange={(e) => update("effectifAuMoins11Salaries", e.target.value === "oui")}
                      >
                        <option value="non">Moins de {EFFECTIF_ASSUJETTI_FORFAIT_SOCIAL} salariés</option>
                        <option value="oui">{EFFECTIF_ASSUJETTI_FORFAIT_SOCIAL} salariés ou plus</option>
                      </select>
                    </div>
                    <Field label="Charges patronales sur la fraction réintégrée">
                      <ResetableNumberInput
                        step="0.01"
                        value={inputs.tauxChargesPatronalesReintegration}
                        defaultValue={TAUX_CHARGES_PATRONALES_REINTEGRATION_DEFAUT}
                        formatDefault={(v) => formatPercent(v)}
                        onChange={(v) => update("tauxChargesPatronalesReintegration", v)}
                      />
                    </Field>
                  </div>
                  <Field label="Charges salariales sur la fraction réintégrée">
                    <ResetableNumberInput
                      step="0.01"
                      value={inputs.tauxChargesSalarialesReintegration}
                      defaultValue={TAUX_CHARGES_SALARIALES_REINTEGRATION_DEFAUT}
                      formatDefault={(v) => formatPercent(v)}
                      onChange={(v) => update("tauxChargesSalarialesReintegration", v)}
                    />
                  </Field>
                  <RuleNote ruleId="mutuelle-csg-crds-part-patronale" />
                  <RuleNote ruleId="mutuelle-forfait-social-prevoyance" />
                </details>

                <details className="details-block">
                  <summary>Ce que le simulateur ne chiffre pas : l'impôt sur le revenu de la part patronale</summary>
                  <p>
                    Depuis l'imposition des revenus 2013, la fraction de contribution patronale finançant des{" "}
                    <strong>frais de santé</strong> est imposable pour le bénéficiaire dès le premier euro, alors même
                    qu'elle reste exonérée de cotisations sociales — les deux traitements sont dissociés. Celle qui
                    finance la <strong>prévoyance</strong> (incapacité, invalidité, décès) y échappe, et la part
                    salariale d'un contrat obligatoire reste déductible du salaire imposable. Ces effets jouent en sens
                    inverse et supposeraient de ventiler votre budget entre santé et prévoyance : plutôt que de les
                    approximer, le simulateur n'impose que la fraction réintégrée dans l'assiette sociale, qui l'est de
                    toute façon quelle que soit la garantie financée. Retenez que le coût net affiché est, sur ce point,
                    un plancher.
                  </p>
                  <RuleNote ruleId="mutuelle-part-patronale-sante-imposable" />
                </details>
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
            <StatCard
              label={`Cotisation — ${results.nombrePersonnesCouvertes} personne${results.nombrePersonnesCouvertes > 1 ? "s" : ""}`}
              value={formatEUR(results.cotisationTotale)}
              sub={
                results.cotisationFamille > 0
                  ? `Dirigeant ${formatEUR(results.cotisationDirigeantSeul)} · famille ${formatEUR(results.cotisationFamille)}`
                  : "Dirigeant seul"
              }
            />
            <StatCard
              label="Coût net société"
              value={formatEUR(results.coutNetSociete)}
              sub={`Après ${formatEUR(results.economieImpotSociete)} d'économie d'impôt`}
              tone="bad"
            />
            <StatCard
              label="Coût net dirigeant"
              value={formatEUR(results.coutNetDirigeant)}
              sub={
                results.economieImpotDirigeant > 0
                  ? `Après ${formatEUR(results.economieImpotDirigeant)} d'économie d'impôt`
                  : "Part salariale, CSG/CRDS et fraction réintégrée"
              }
              tone="bad"
            />
            <StatCard
              label="Coût net global"
              value={formatEUR(results.coutNetGlobal)}
              sub={`${formatPercent(results.tauxEconomieGlobal)} d'économie vs cotisation brute`}
              tone="neutral"
            />
            <StatCard
              label="Économie vs contrat individuel"
              value={formatEUR(results.economieVsContratIndividuel)}
              sub={`Même couverture souscrite en direct : ${formatEUR(results.coutContratIndividuelEquivalent)}`}
              tone={results.economieVsContratIndividuel > 0 ? "good" : "bad"}
            />
          </div>

          <Section title="Ce que la famille change">
            <p className="hint-block">
              {results.cotisationFamille === 0 ? (
                <>
                  Aucun ayant droit couvert pour l'instant. Ajoutez le conjoint ou des enfants pour voir ce que
                  l'extension coûte réellement — la réponse dépend beaucoup moins du taux de prise en charge que du
                  statut du dirigeant et, pour un assimilé salarié, du caractère obligatoire de leur affiliation.
                </>
              ) : results.dirigeantStatus === "TNS" ? (
                <>
                  Couvrir {results.nombrePersonnesCouvertes - 1} personne
                  {results.nombrePersonnesCouvertes > 2 ? "s" : ""} de plus ajoute{" "}
                  <strong>{formatEUR(results.cotisationFamille)}</strong> de cotisation, déductibles au même titre que
                  les vôtres — mais dans le même plafond de {formatEUR(results.plafondMadelin)}.{" "}
                  {results.cotisationNonDeductibleTNS > 0 ? (
                    <>
                      Le plafond est saturé : <strong>{formatEUR(results.cotisationNonDeductibleTNS)}</strong> ne
                      procurent plus aucun avantage fiscal.
                    </>
                  ) : (
                    <>
                      Il reste {formatEUR(results.plafondMadelin - results.cotisationDeductibleTNS)} d'enveloppe
                      disponible.
                    </>
                  )}
                </>
              ) : (
                <>
                  L'extension à {results.nombrePersonnesCouvertes - 1} ayant
                  {results.nombrePersonnesCouvertes > 2 ? "s" : ""} droit coûte{" "}
                  <strong>{formatEUR(results.cotisationFamille)}</strong>, dont{" "}
                  {formatEUR(results.partPatronaleFamille)} financés par la société.{" "}
                  {inputs.extensionFamilleObligatoire ? (
                    <>
                      L'affiliation étant obligatoire, cette contribution bénéficie de l'exclusion d'assiette — dans le
                      plafond commun de {formatEUR(results.plafondExonerationSociale)}, qu'elle contribue à saturer.
                    </>
                  ) : results.partPatronaleFamille === 0 ? (
                    <>
                      La société n'en finance rien : le dirigeant paie la totalité de son revenu net, exactement comme
                      s'il souscrivait un contrat individuel. L'affiliation étant facultative, faire financer cette
                      extension par la société l'assujettirait intégralement à cotisations — la rendre obligatoire dans
                      l'acte fondateur est le préalable à toute prise en charge avantageuse.
                    </>
                  ) : (
                    <>
                      Cette contribution étant facultative, elle est assujettie en totalité : elle déclenche{" "}
                      {formatEUR(
                        results.chargesPatronalesReintegration + results.chargesSalarialesReintegration + results.irSurExcedent,
                      )}{" "}
                      de charges et d'impôt supplémentaires. Rendre l'affiliation obligatoire dans l'acte fondateur la
                      ferait basculer dans l'exonération.
                    </>
                  )}
                </>
              )}
            </p>
          </Section>

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
                  { label: "Personnes couvertes", value: String(r.nombrePersonnesCouvertes) },
                  { label: "Cotisation totale", value: formatEUR(r.cotisationTotale) },
                  { label: "Coût net global", value: formatEUR(r.coutNetGlobal) },
                  { label: "Économie vs contrat individuel", value: formatEUR(r.economieVsContratIndividuel) },
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
