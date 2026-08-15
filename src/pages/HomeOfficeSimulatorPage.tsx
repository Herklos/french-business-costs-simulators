import { useEffect, useMemo, useState } from "react";
import {
  type ChargeLine,
  type HomeOfficeInputs,
  chargeLinesDeReference,
  computeHomeOffice,
  createDefaultHomeOfficeInputs,
} from "../lib/homeOffice";
import { LOYERS_VILLES, SOURCES_LOYERS, VILLE_AUTRE, prixM2Ville } from "../lib/loyersVille";
import { findChargeReference, fourchetteReferenceCharge, montantReferenceCharge } from "../lib/logementCharges";
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
import { formatEUR, formatPercent } from "../lib/format";

const SURFACE_TOLERANCE = 0.3;

/** Résumé texte complet d'une simulation bureau à domicile, destiné à être copié dans le presse-papier. */
function buildHomeOfficeExportText(sim: HomeOfficeInputs): string {
  const r = computeHomeOffice(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(`🏠 ${sim.name} — Simulateur bureau à domicile`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push("— Logement —");
  push(
    `Statut : ${sim.statutOccupant} · Type : ${sim.typeLogement === "maison" ? "maison individuelle" : "immeuble collectif"} · Surface totale : ${sim.surfaceTotaleM2} m² · Surface bureau : ${sim.surfaceBureauM2} m²`,
  );
  push(`Quote-part bureau : ${formatPercent(r.quotePartSurface)}`);
  push(
    `Ville : ${LOYERS_VILLES.find((v) => v.id === sim.ville)?.label ?? "autre"} · Loyer de marché retenu : ${sim.loyerMarcheM2Mensuel} €/m²/mois hors charges${sim.loyerAutoDepuisPrixM2 ? " (loyer calculé automatiquement)" : " (loyer saisi manuellement)"}`,
  );
  push(`Loyer imputable au bureau : ${formatEUR(r.loyerAnnuelBureauRetenu)}/an`);
  push("");
  push("— Charges retenues —");
  for (const c of r.chargeLinesEffectives) {
    push(`  ${c.enabled ? "☑" : "☐"} ${c.label} : ${formatEUR(c.montantAnnuel)}/an`);
  }
  push(`Total charges retenues : ${formatEUR(r.totalChargesRetenuesAnnuel)}/an`);
  push("");
  push(`Formalisation : ${sim.formalisation === "bail_professionnel" ? "Bail professionnel réel" : "Indemnité d'occupation"}`);
  push(`Régime foncier : ${sim.regimeFoncier === "micro" ? "Micro-foncier" : "Réel"}${!r.eligibleMicroFoncier ? " (plafond dépassé, régime réel appliqué)" : ""}`);
  if (r.interetsEmpruntDeduits > 0) {
    push(
      `Intérêts d'emprunt : ${formatEUR(sim.interetsEmpruntAnnuels)}/an, dont ${formatEUR(r.interetsEmpruntDeduits)} de quote-part professionnelle déduite du revenu foncier`,
    );
  }
  push("");
  push("— Résultats —");
  push(`Indemnité annuelle brute : ${formatEUR(r.indemniteAnnuelleBrute)}`);
  push(`Base imposable foncière : ${formatEUR(r.baseImposableFonciere)} · IR : ${formatEUR(r.irDu)} (TMI ${formatPercent(r.tauxIRUtilise)}) · Prélèvements sociaux : ${formatEUR(r.prelevementsSociaux)}`);
  push(`Gain net dirigeant (récurrent) : ${formatEUR(r.gainNetGerant)}`);
  if (sim.formalisation === "bail_professionnel" && sim.fraisMiseEnPlaceBail > 0) {
    push(`Gain net dirigeant — 1ère année (après frais de mise en place) : ${formatEUR(r.gainNetGerantAnnee1)}`);
  }
  push(`Coût net société (après économie d'impôt) : ${formatEUR(r.coutNetSociete)}`);
  push(
    `Bureau externe (${sim.typeComparaisonExterne === "coworking" ? "coworking" : "location classique"}) : ${formatEUR(r.coutBureauExterneAnnuel)}/an · Économie vs bureau externe : ${formatEUR(r.economieVsBureauExterne)}`,
  );
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

export function HomeOfficeSimulatorPage({ initialShareData }: { initialShareData?: string }) {
  const [inputs, setInputs] = useState<HomeOfficeInputs>(
    () => mergeSharedInputs(withPersistedPersonalTaxProfile(createDefaultHomeOfficeInputs()), initialShareData),
  );
  const [saveVersion, setSaveVersion] = useState(0);
  const results = useMemo(() => computeHomeOffice(inputs), [inputs]);

  // Le revenu de référence du foyer fiscal est un réglage transversal (identique quel que soit le
  // simulateur) : on le persiste à chaque modification pour le retrouver pré-rempli sur les autres
  // simulateurs et à la prochaine visite.
  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  function update<K extends keyof HomeOfficeInputs>(key: K, value: HomeOfficeInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function updateChargeLine(id: string, patch: Partial<ChargeLine>) {
    setInputs((prev) => ({
      ...prev,
      chargeLines: prev.chargeLines.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  /** Changer de ville réaligne le prix au m² sur la médiane locale ; « Autre » conserve la saisie. */
  function selectVille(ville: string) {
    setInputs((prev) => ({
      ...prev,
      ville,
      loyerMarcheM2Mensuel: ville === VILLE_AUTRE ? prev.loyerMarcheM2Mensuel : prixM2Ville(ville),
    }));
  }

  /**
   * Réaligne tous les postes de charge sur les références 2025-2026, à la surface et au statut
   * d'occupation courants. Action explicite plutôt qu'automatique : une fois les vraies factures
   * saisies, un recalcul silencieux sur un changement de surface les écraserait.
   */
  function appliquerReferences() {
    setInputs((prev) => ({
      ...prev,
      chargeLines: chargeLinesDeReference(prev.surfaceTotaleM2, prev.statutOccupant, prev.typeLogement, prev.chargeLines),
    }));
  }

  const surfaceRatio = inputs.surfaceTotaleM2 > 0 ? inputs.surfaceBureauM2 / inputs.surfaceTotaleM2 : 0;
  const surfaceDepasseTolerance = surfaceRatio > SURFACE_TOLERANCE;

  return (
    <div className="page">
      <h2>🏠 Indemnité d'occupation du domicile (bureau professionnel)</h2>
      <p className="page__intro">
        Le dirigeant met une partie de son domicile personnel à disposition de la société pour un usage
        professionnel. La société lui verse en contrepartie une indemnité d'occupation, déductible côté société et
        imposable côté dirigeant en tant que revenu foncier.
      </p>

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildHomeOfficeExportText(inputs)} />
        <ShareButton page="homeOffice" getInputs={() => inputs} />
        <PdfButton />
      </div>
      <PrintableReport text={buildHomeOfficeExportText(inputs)} />

      <div className="layout">
        <div className="layout__form">
          <Section title="Logement">
            <div className="grid grid--3">
              <Field label="Statut">
                <select
                  value={inputs.statutOccupant}
                  onChange={(e) => update("statutOccupant", e.target.value as HomeOfficeInputs["statutOccupant"])}
                >
                  <option value="proprietaire">Propriétaire</option>
                  <option value="locataire">Locataire</option>
                </select>
              </Field>
              {/* Volontairement une <div> et non un <Field> : celui-ci rend un <label>, et un bouton
                  encapsulé dans un label est déclenché par un clic n'importe où sur le libellé. */}
              <div className="field">
                <span className="field__label">Type de logement</span>
                <div className="toggle-group">
                  {(
                    [
                      ["appartement", "Immeuble"],
                      ["maison", "Maison"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`btn btn--ghost ${inputs.typeLogement === value ? "btn--active" : ""}`}
                      onClick={() => update("typeLogement", value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="field__hint">
                  Déplace les charges : copropriété en immeuble, entretien courant en maison.
                </span>
              </div>
              <Field label="Surface totale du logement (m²)">
                <NumberInput value={inputs.surfaceTotaleM2} onChange={(e) => update("surfaceTotaleM2", Number(e.target.value))} />
              </Field>
              <Field label="Surface du bureau professionnel (m²)">
                <NumberInput value={inputs.surfaceBureauM2} onChange={(e) => update("surfaceBureauM2", Number(e.target.value))} />
              </Field>
            </div>
            <div className="grid grid--3">
              <Field label="Ville du logement">
                <select value={inputs.ville} onChange={(e) => selectVille(e.target.value)}>
                  {LOYERS_VILLES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} — {v.prixM2Mensuel} €/m²
                    </option>
                  ))}
                  <option value={VILLE_AUTRE}>Autre ville (saisie manuelle)</option>
                </select>
              </Field>
              <Field
                label="Loyer de marché (€/m²/mois, hors charges)"
                hint={
                  inputs.ville === VILLE_AUTRE
                    ? "Relevez 2 ou 3 annonces comparables (même quartier, même surface) et archivez-les : c'est la justification attendue en cas de contrôle."
                    : "Médiane indicative de l'agglomération — ajustez-la à votre quartier."
                }
              >
                <NumberInput
                  step="0.5"
                  value={inputs.loyerMarcheM2Mensuel}
                  onChange={(e) => update("loyerMarcheM2Mensuel", Number(e.target.value))}
                />
              </Field>
              {/* Une <div> plutôt qu'un <Field> : imbriquer un <label> dans un autre est invalide. */}
              <div className="field">
                <span className="field__label">Calcul du loyer</span>
                <label className="charge-line__toggle">
                  <input
                    type="checkbox"
                    checked={inputs.loyerAutoDepuisPrixM2}
                    onChange={(e) => update("loyerAutoDepuisPrixM2", e.target.checked)}
                  />
                  <span>Calculer automatiquement depuis le prix au m²</span>
                </label>
              </div>
            </div>
            <p className="hint-block">
              Quote-part du bureau : <strong>{formatPercent(results.quotePartSurface)}</strong> · Charges retenues
              (postes activés) : <strong>{formatEUR(results.totalChargesRetenuesAnnuel)}</strong>/an · Indemnité
              annuelle brute : <strong>{formatEUR(results.indemniteAnnuelleBrute)}</strong>
            </p>
            {inputs.loyerAutoDepuisPrixM2 && (
              <p className="hint-block">
                Loyer imputable au bureau : {inputs.surfaceBureauM2} m² × {inputs.loyerMarcheM2Mensuel} €/m²/mois × 12 ={" "}
                <strong>{formatEUR(results.loyerAnnuelBureauRetenu)}</strong>/an, soit{" "}
                <strong>{formatEUR(results.loyerAnnuelBureauRetenu / 12)}</strong>/mois. La ligne « Loyer » ci-dessous
                porte la valeur locative du logement entier ({formatEUR(results.loyerAnnuelLogementRetenu)}/an), ensuite
                ramenée au bureau par la quote-part de surface — les deux calculs donnent le même montant.
              </p>
            )}
            <details className="charge-line__ref">
              <summary>Vérifier ce loyer de marché — sources publiques</summary>
              <p>
                Les valeurs proposées sont des médianes d'agglomération indicatives. En cas de contrôle, la
                justification attendue reste 2 ou 3 annonces comparables, datées et archivées au moment où le loyer a
                été fixé.
                <br />
                {SOURCES_LOYERS.map((s) => (
                  <span key={s.url}>
                    <br />
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.label}
                    </a>{" "}
                    — {s.note}
                  </span>
                ))}
              </p>
            </details>
            <RuleNote ruleId="domicile-loyer-coherent-avec-le-marche" />
            {surfaceDepasseTolerance && (
              <p className="warning-block">
                ⚠️ Surface du bureau ({formatPercent(surfaceRatio)}) au-delà de la tolérance pratique de 30% de la
                surface totale généralement admise sans justification renforcée. Restez en mesure de prouver la
                réalité de cet usage professionnel (photos, plan, absence d'usage personnel de la pièce).
              </p>
            )}
            <RuleNote ruleId="domicile-surface-bureau-tolerance-30-pourcent" />
          </Section>

          <Section
            title="Charges du logement retenues dans l'indemnité"
            subtitle="Chaque poste (y compris le loyer) est inclus par défaut mais peut être désactivé individuellement. Les montants pré-remplis sont des ordres de grandeur 2025-2026 : remplacez-les par vos factures réelles, seules opposables en cas de contrôle."
          >
            <p className="hint-block">
              Valeurs de référence pour {inputs.surfaceTotaleM2} m² en{" "}
              {inputs.typeLogement === "maison" ? "maison individuelle" : "immeuble collectif"}, en tant que{" "}
              {inputs.statutOccupant === "locataire" ? "locataire" : "propriétaire"}.{" "}
              <button type="button" className="charge-line__apply" onClick={appliquerReferences}>
                ↺ Tout réaligner sur les références
              </button>
            </p>
            <ul className="charge-lines">
              {results.chargeLinesEffectives.map((c) => {
                const reference = montantReferenceCharge(c.id, inputs.surfaceTotaleM2, inputs.statutOccupant, inputs.typeLogement);
                const fourchette = fourchetteReferenceCharge(c.id, inputs.surfaceTotaleM2, inputs.statutOccupant, inputs.typeLogement);
                const infos = findChargeReference(c.id);
                const loyerAuto = c.id === "loyer" && inputs.loyerAutoDepuisPrixM2;
                // On ne signale que la sous-évaluation : c'est le biais que corrige cette section.
                // Une saisie supérieure à la fourchette peut parfaitement refléter des factures
                // réelles élevées, et n'a rien d'anormal.
                const sousEvalue = fourchette !== undefined && fourchette[0] > 0 && c.montantAnnuel < fourchette[0];
                return (
                  <li key={c.id} className="charge-line">
                    <div className="charge-line__row">
                      <label className="charge-line__toggle">
                        <input
                          type="checkbox"
                          checked={c.enabled}
                          onChange={(e) => updateChargeLine(c.id, { enabled: e.target.checked })}
                        />
                        <span>
                          {c.id === "entretienCopropriete" && inputs.typeLogement === "maison"
                            ? "Charges de copropriété (sans objet en maison individuelle)"
                            : c.label}
                          {c.id === "loyer" &&
                            (loyerAuto
                              ? " (valeur locative de marché)"
                              : inputs.statutOccupant === "locataire"
                                ? " (loyer réel)"
                                : " (valeur locative estimée)")}
                        </span>
                      </label>
                      <NumberInput
                        disabled={!c.enabled || loyerAuto}
                        value={c.montantAnnuel}
                        onChange={(e) => updateChargeLine(c.id, { montantAnnuel: Number(e.target.value) })}
                      />
                      <span className="charge-line__unit">€/an</span>
                    </div>
                    {loyerAuto ? (
                      <div className="charge-line__ref">
                        Calculé : {inputs.surfaceTotaleM2} m² × {inputs.loyerMarcheM2Mensuel} €/m²/mois × 12. Décochez
                        « Calculer automatiquement » ci-dessus pour saisir votre loyer réel.
                      </div>
                    ) : (
                      infos !== undefined &&
                      reference !== undefined && (
                        <details className={`charge-line__ref${sousEvalue ? " charge-line__ref--low" : ""}`}>
                          <summary>
                            {sousEvalue ? "⚠️ " : ""}Référence : {formatEUR(reference)}/an
                            {fourchette !== undefined && fourchette[1] > 0 && (
                              <> (fourchette {formatEUR(fourchette[0])} – {formatEUR(fourchette[1])})</>
                            )}
                            {c.montantAnnuel !== reference && (
                              <button
                                type="button"
                                className="charge-line__apply"
                                onClick={(e) => {
                                  e.preventDefault();
                                  updateChargeLine(c.id, { montantAnnuel: reference });
                                }}
                              >
                                appliquer
                              </button>
                            )}
                          </summary>
                          <p>
                            {infos.note}
                            <br />
                            <em>
                              Source :{" "}
                              <a href={infos.sourceUrl} target="_blank" rel="noreferrer noopener">
                                {infos.source}
                              </a>
                            </em>
                          </p>
                        </details>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
            {inputs.statutOccupant === "locataire" &&
              results.chargeLinesEffectives.some(
                (c) => c.id === "taxeFonciere" && c.enabled && c.montantAnnuel > 0,
              ) && (
                <p className="warning-block">
                  ⚠️ Vous êtes locataire : la taxe foncière est due par votre bailleur, pas par vous. Désactivez ce
                  poste ou remettez-le à 0 — sinon l'indemnité refacture à la société une charge que vous ne supportez
                  pas, ce qui la rend indéfendable en cas de contrôle.
                </p>
              )}
            <RuleNote ruleId="domicile-charges-reelles-justificatifs" />
          </Section>

          <Section
            title="Formalisation de la mise à disposition"
            subtitle="Même traitement fiscal de fond ; le bail réel est plus robuste juridiquement mais implique des frais de mise en place."
          >
            <div className="grid grid--2">
              <Field label="Formalisation retenue">
                <select
                  value={inputs.formalisation}
                  onChange={(e) => update("formalisation", e.target.value as HomeOfficeInputs["formalisation"])}
                >
                  <option value="indemnite">Indemnité d'occupation (convention simple)</option>
                  <option value="bail_professionnel">Bail professionnel réel (plus robuste)</option>
                </select>
              </Field>
              {inputs.formalisation === "bail_professionnel" && (
                <Field label="Frais de mise en place du bail (rédaction, enregistrement) (€, ponctuel)">
                  <NumberInput
                    value={inputs.fraisMiseEnPlaceBail}
                    onChange={(e) => update("fraisMiseEnPlaceBail", Number(e.target.value))}
                  />
                </Field>
              )}
            </div>
            <RuleNote ruleId="domicile-formalisation-bail-vs-indemnite" />
          </Section>

          <Section title="Fiscalité de l'indemnité (revenus fonciers du dirigeant)">
            <div className="grid grid--2">
              <Field label="Régime foncier">
                <select
                  value={inputs.regimeFoncier}
                  onChange={(e) => update("regimeFoncier", e.target.value as HomeOfficeInputs["regimeFoncier"])}
                >
                  <option value="micro">Micro-foncier (abattement 30 %)</option>
                  <option value="reel">Réel (charges déduites)</option>
                </select>
              </Field>
              <Field label="Autres revenus fonciers du foyer (€/an)">
                <NumberInput
                  value={inputs.autresRevenusFonciersFoyer}
                  onChange={(e) => update("autresRevenusFonciersFoyer", Number(e.target.value))}
                />
              </Field>
            </div>
            {!results.eligibleMicroFoncier && inputs.regimeFoncier === "micro" && (
              <p className="warning-block">
                Plafond micro-foncier (15 000 €) dépassé : le régime réel est appliqué automatiquement.
              </p>
            )}
            {inputs.statutOccupant === "proprietaire" && (
              <Field
                label="Intérêts annuels de l'emprunt immobilier (€/an)"
                hint="Déductibles du revenu foncier au régime réel uniquement, au prorata de la surface professionnelle. Ils ne s'ajoutent pas à l'indemnité : le loyer de marché rémunère déjà la mise à disposition du bien."
              >
                <NumberInput
                  value={inputs.interetsEmpruntAnnuels}
                  onChange={(e) => update("interetsEmpruntAnnuels", Number(e.target.value))}
                />
              </Field>
            )}
            {inputs.interetsEmpruntAnnuels > 0 && inputs.regimeFoncier === "micro" && results.eligibleMicroFoncier && (
              <p className="hint-block">
                Au micro-foncier, l'abattement forfaitaire de 30 % remplace toute déduction : vos intérêts d'emprunt
                ne sont pas pris en compte. Comparez avec le régime réel, qui déduirait{" "}
                <strong>
                  {formatEUR(Math.max(0, inputs.interetsEmpruntAnnuels) * results.quotePartSurface)}
                </strong>{" "}
                de quote-part professionnelle.
              </p>
            )}
            {results.interetsEmpruntDeduits > 0 && (
              <p className="hint-block">
                Quote-part professionnelle des intérêts déduite du revenu foncier :{" "}
                <strong>{formatEUR(results.interetsEmpruntDeduits)}</strong>/an.
              </p>
            )}
            <RuleNote ruleId="foncier-charges-deductibles-regime-reel" />
            <RuleNote ruleId="foncier-abattement-micro" />
            <RuleNote ruleId="foncier-prelevements-sociaux" />
          </Section>

          <Section
            title="Régime fiscal & rentabilité de la société"
            subtitle="Le bénéfice prévisionnel détermine l'économie d'impôt réelle générée par l'indemnité déductible."
          >
            <div className="grid grid--2">
              <Field label="Régime d'imposition">
                <select
                  value={inputs.impositionSociete}
                  onChange={(e) => update("impositionSociete", e.target.value as HomeOfficeInputs["impositionSociete"])}
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
                <Field label="Bénéfice imposable prévisionnel avant indemnité (€/an)">
                  <NumberInput
                    value={inputs.beneficeAvantChargePrevisionnel}
                    onChange={(e) => update("beneficeAvantChargePrevisionnel", Number(e.target.value))}
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
            )}
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section title="Situation personnelle du dirigeant" subtitle="Utilisée pour calculer le TMI appliqué au revenu foncier.">
            <PersonalTaxProfileFields
              profile={inputs.personalTaxProfile}
              onChange={(profile) => update("personalTaxProfile", profile)}
              showAutresRevenus={false}
              footerWhenCalcule={
                inputs.impositionSociete === "IR" && (
                  <p className="field__hint">
                    Le bénéfice prévisionnel de la société (régime IR, translucide) est ajouté au revenu imposable du
                    foyer pour déterminer le TMI réel.
                  </p>
                )
              }
              footerAlways={<RuleNote ruleId="ir-bareme-2026" />}
            />
          </Section>

          <Section title="Comparaison — bureau externe" subtitle="Bail classique (loyer fixe) ou espace de coworking (tarification flexible à la journée).">
            <Field label="Type de comparaison">
              <select
                value={inputs.typeComparaisonExterne}
                onChange={(e) => update("typeComparaisonExterne", e.target.value as HomeOfficeInputs["typeComparaisonExterne"])}
              >
                <option value="location">Location classique (bail)</option>
                <option value="coworking">Espace de coworking</option>
              </select>
            </Field>
            {inputs.typeComparaisonExterne === "location" ? (
              <Field label="Loyer d'un bureau externe équivalent (€/mois)">
                <NumberInput
                  value={inputs.loyerBureauExterneMensuel}
                  onChange={(e) => update("loyerBureauExterneMensuel", Number(e.target.value))}
                />
              </Field>
            ) : (
              <div className="grid grid--2">
                <Field label="Tarif journalier coworking (€/jour)">
                  <NumberInput
                    value={inputs.coworkingTarifJournalier}
                    onChange={(e) => update("coworkingTarifJournalier", Number(e.target.value))}
                  />
                </Field>
                <Field label="Jours d'utilisation par mois">
                  <NumberInput
                    value={inputs.coworkingJoursParMois}
                    onChange={(e) => update("coworkingJoursParMois", Number(e.target.value))}
                  />
                </Field>
              </div>
            )}
          </Section>

          <Field label="Nom de la simulation">
            <input value={inputs.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
        </div>

        <div className="layout__results">
          <div className="stat-grid">
            <StatCard label="Indemnité annuelle brute" value={formatEUR(results.indemniteAnnuelleBrute)} />
            <StatCard label="Base imposable foncière" value={formatEUR(results.baseImposableFonciere)} />
            <StatCard label="IR dû" value={formatEUR(results.irDu)} sub={`TMI : ${formatPercent(results.tauxIRUtilise)}`} />
            <StatCard label="Prélèvements sociaux (17,2 %)" value={formatEUR(results.prelevementsSociaux)} />
            <StatCard label="Gain net pour le dirigeant (récurrent)" value={formatEUR(results.gainNetGerant)} tone="good" />
            {inputs.formalisation === "bail_professionnel" && inputs.fraisMiseEnPlaceBail > 0 && (
              <StatCard
                label="Gain net — 1ère année (après frais de mise en place)"
                value={formatEUR(results.gainNetGerantAnnee1)}
                tone={results.gainNetGerantAnnee1 >= 0 ? "good" : "bad"}
              />
            )}
            <StatCard label="Coût net société (après économie d'impôt)" value={formatEUR(results.coutNetSociete)} tone="bad" />
            <StatCard
              label="Économie vs bureau externe"
              value={formatEUR(results.economieVsBureauExterne)}
              tone={results.economieVsBureauExterne >= 0 ? "good" : "bad"}
            />
          </div>

          <Section title="Sauvegarde & comparaison">
            <SavedSimulationsPanel
              kind="homeOffice"
              currentInputs={inputs}
              version={saveVersion}
              onLoad={(loaded) => {
                setInputs(loaded);
                setSaveVersion((v) => v + 1);
              }}
              metricsFor={(sim) => {
                const r = computeHomeOffice(sim);
                return [
                  { label: "Indemnité annuelle brute", value: formatEUR(r.indemniteAnnuelleBrute) },
                  { label: "Gain net dirigeant", value: formatEUR(r.gainNetGerant) },
                  { label: "Coût net société", value: formatEUR(r.coutNetSociete) },
                  { label: "Économie vs bureau externe", value: formatEUR(r.economieVsBureauExterne) },
                ];
              }}
              exportText={buildHomeOfficeExportText}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
