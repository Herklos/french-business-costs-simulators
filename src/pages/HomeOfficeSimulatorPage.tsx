import { useEffect, useMemo, useState } from "react";
import {
  type ChargeLine,
  type HomeOfficeInputs,
  TOLERANCE_SURFACE_BUREAU_DEFAUT,
  applyLogementProfile,
  chargeLinesDeReference,
  computeHomeOffice,
  createDefaultHomeOfficeInputs,
  extractLogementProfile,
} from "../lib/homeOffice";
import { LOYERS_VILLES, SOURCES_LOYERS, VILLE_AUTRE, prixM2Ville } from "../lib/loyersVille";
import { findChargeReference, fourchetteReferenceCharge, montantReferenceCharge } from "../lib/logementCharges";
import {
  BANDES_SURFACE_BUREAU,
  FORFAIT_TELETRAVAIL_MENSUEL_AVEC_ACCORD,
  FORFAIT_TELETRAVAIL_MENSUEL_SANS_ACCORD,
  LOYER_ANNUEL_M2_PRUDENT,
  SOURCES_SEUIL_SURFACE,
  bandeSurfaceBureau,
} from "../lib/surfaceBureau";
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
import {
  clearLogementProfile,
  loadLogementProfile,
  savePersonalTaxProfile,
  saveLogementProfile,
  withPersistedPersonalTaxProfile,
} from "../lib/storage";
import { formatEUR, formatPercent } from "../lib/format";

/**
 * Période d'affichage des montants de charge. Purement cosmétique : les entrées restent stockées en
 * euros par an, seul l'affichage et la saisie sont divisés par 12. Un loyer se lit naturellement au
 * mois — 1 280 €/mois parle davantage que 15 360 €/an — alors qu'une taxe foncière se lit à l'année.
 */
type PeriodeAffichage = "an" | "mois";

const DIVISEUR_PERIODE: Record<PeriodeAffichage, number> = { an: 1, mois: 12 };
const SUFFIXE_PERIODE: Record<PeriodeAffichage, string> = { an: "€/an", mois: "€/mois" };

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
  push(
    `Quote-part bureau : ${formatPercent(r.quotePartSurface)} · Seuil de justification renforcée retenu : ${formatPercent(sim.toleranceSurfaceBureau)} (${Math.round(r.surfaceBureauTolerance * 10) / 10} m²)${r.depasseToleranceSurface ? " — DÉPASSÉ" : ""}`,
  );
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
  push(
    `Comparaison des régimes : micro ${formatEUR(r.coutFiscalMicro)}/an vs réel ${formatEUR(r.coutFiscalReel)}/an d'impôt et prélèvements sociaux — le régime ${r.regimeOptimal === "micro" ? "micro-foncier" : "réel"} est plus favorable de ${formatEUR(r.gainRegimeOptimal)}/an`,
  );
  push(
    `Charges déductibles au réel : ${formatEUR(r.chargesDeductiblesReel)}/an · Abattement micro (30 %) : ${formatEUR(r.seuilBasculeReel)}/an`,
  );
  if (sim.interetsEmpruntAnnuels > 0 || sim.assuranceEmpruntAnnuelle > 0) {
    push(
      `Emprunt : ${formatEUR(sim.interetsEmpruntAnnuels)}/an d'intérêts et ${formatEUR(sim.assuranceEmpruntAnnuelle)}/an d'assurance emprunteur, dont ${formatEUR(r.interetsEmpruntDeduits)} de quote-part professionnelle déduite (régime réel uniquement)`,
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
  // Ordre d'application, du plus général au plus spécifique : valeurs par défaut, puis profil fiscal
  // du foyer, puis logement mémorisé, et enfin le lien de partage — qui décrit une simulation
  // précise et doit donc primer sur tout ce qui a été mémorisé localement.
  const [inputs, setInputs] = useState<HomeOfficeInputs>(() =>
    mergeSharedInputs(
      applyLogementProfile(withPersistedPersonalTaxProfile(createDefaultHomeOfficeInputs()), loadLogementProfile()),
      initialShareData,
    ),
  );
  const [saveVersion, setSaveVersion] = useState(0);
  const [periodeAffichage, setPeriodeAffichage] = useState<PeriodeAffichage>("an");
  const results = useMemo(() => computeHomeOffice(inputs), [inputs]);

  const diviseur = DIVISEUR_PERIODE[periodeAffichage];
  /** Montant annuel formaté dans la période d'affichage courante, suffixe compris. */
  const parPeriode = (montantAnnuel: number) =>
    `${formatEUR(montantAnnuel / diviseur)}${periodeAffichage === "mois" ? "/mois" : "/an"}`;

  // Le revenu de référence du foyer fiscal est un réglage transversal (identique quel que soit le
  // simulateur) : on le persiste à chaque modification pour le retrouver pré-rempli sur les autres
  // simulateurs et à la prochaine visite.
  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  // La description du logement est un fait, pas une hypothèse : on la mémorise à chaque modification
  // pour la retrouver telle quelle à la prochaine visite, sans action explicite de l'utilisateur.
  const logementProfile = useMemo(() => extractLogementProfile(inputs), [inputs]);
  useEffect(() => {
    saveLogementProfile(logementProfile);
  }, [logementProfile]);

  function update<K extends keyof HomeOfficeInputs>(key: K, value: HomeOfficeInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function updateChargeLine(id: string, patch: Partial<ChargeLine>) {
    setInputs((prev) => ({
      ...prev,
      chargeLines: prev.chargeLines.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }

  /** Repart des valeurs par défaut pour le logement — après un déménagement, par exemple. */
  function oublierLogementMemorise() {
    clearLogementProfile();
    const defauts = createDefaultHomeOfficeInputs();
    setInputs((prev) => ({
      ...prev,
      statutOccupant: defauts.statutOccupant,
      typeLogement: defauts.typeLogement,
      surfaceTotaleM2: defauts.surfaceTotaleM2,
      surfaceBureauM2: defauts.surfaceBureauM2,
      toleranceSurfaceBureau: defauts.toleranceSurfaceBureau,
      ville: defauts.ville,
      loyerMarcheM2Mensuel: defauts.loyerMarcheM2Mensuel,
      loyerAutoDepuisPrixM2: defauts.loyerAutoDepuisPrixM2,
      chargeLines: defauts.chargeLines,
      interetsEmpruntAnnuels: defauts.interetsEmpruntAnnuels,
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

  /**
   * Leviers qui augmentent l'indemnité SANS toucher à la surface du bureau. La surface, elle, n'est
   * pas un levier : c'est une mesure de ce qui est mis à disposition. Chaque levier est chiffré sur
   * les valeurs courantes pour être comparable aux autres.
   */
  const leviers = useMemo(() => {
    const quotePart = results.quotePartSurface;

    // 1. Prix au m² : sensibilité par euro supplémentaire, plutôt qu'une cible arbitraire.
    const gainParEuroM2 = inputs.surfaceBureauM2 * 12;

    // 2. Postes activés saisis SOUS la fourchette basse de référence : l'écart est probablement une
    //    sous-évaluation, pas une facture réellement plus basse.
    let ecartSousEvalue = 0;
    const postesSousEvalues: string[] = [];
    // 3. Postes désactivés qui ont une valeur de référence non nulle.
    let gainPostesDesactives = 0;
    const postesDesactives: string[] = [];

    for (const ligne of results.chargeLinesEffectives) {
      if (ligne.id === "loyer") continue;
      const reference = montantReferenceCharge(
        ligne.id,
        inputs.surfaceTotaleM2,
        inputs.statutOccupant,
        inputs.typeLogement,
      );
      if (reference === undefined || reference <= 0) continue;
      if (!ligne.enabled) {
        gainPostesDesactives += reference * quotePart;
        postesDesactives.push(ligne.label);
        continue;
      }
      const fourchette = fourchetteReferenceCharge(
        ligne.id,
        inputs.surfaceTotaleM2,
        inputs.statutOccupant,
        inputs.typeLogement,
      );
      if (fourchette && fourchette[0] > 0 && ligne.montantAnnuel < fourchette[0]) {
        ecartSousEvalue += (reference - ligne.montantAnnuel) * quotePart;
        postesSousEvalues.push(ligne.label);
      }
    }

    return { gainParEuroM2, ecartSousEvalue, postesSousEvalues, gainPostesDesactives, postesDesactives };
  }, [inputs.surfaceBureauM2, inputs.surfaceTotaleM2, inputs.statutOccupant, inputs.typeLogement, results]);

  const surfaceRatio = results.quotePartSurface;
  const surfaceDepasseTolerance = results.depasseToleranceSurface;
  const bande = bandeSurfaceBureau(results.quotePartSurface);

  /**
   * Porte la surface du bureau au maximum admis par le seuil de tolérance retenu. C'est le levier
   * le plus direct sur le montant de l'indemnité, puisque tous les postes sont proratisés par la
   * quote-part de surface — mais il ne vaut que si la pièce fait réellement cette surface et sert
   * réellement à l'activité : c'est l'usage réel, pas le curseur, qui est opposable.
   */
  function alignerSurTolerance() {
    setInputs((prev) => ({
      ...prev,
      surfaceBureauM2:
        Math.round(Math.max(0, prev.surfaceTotaleM2) * Math.min(1, Math.max(0, prev.toleranceSurfaceBureau)) * 10) / 10,
    }));
  }

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

      {/* Colonne unique, sans bandeau de résultats latéral : la synthèse chiffrée sous les champs du
          logement donne le retour immédiat que le bandeau assurait, et les résultats détaillés se
          lisent en fin de parcours, une fois tous les paramètres renseignés. */}
      <div className="page__column">
      <Section title="Logement">
          <p className="charges-toolbar">
            <span className="charges-toolbar__context">
              💾 Surfaces, type, ville, prix au m² et factures sont mémorisés sur cet appareil et rechargés à votre
              prochaine visite. Rien n'est envoyé ailleurs.
            </span>
            <button type="button" className="charge-line__apply" onClick={oublierLogementMemorise}>
              Oublier ce logement
            </button>
          </p>
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
              <span className="field__hint">Copropriété en immeuble, entretien courant en maison.</span>
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
            {/* Une <div> plutôt qu'un <Field> : celui-ci rend un <label>, et un bouton encapsulé
                dans un label est déclenché par un clic n'importe où sur le libellé. */}
            <div className="field">
              <span className="field__label">Montant du loyer</span>
              <div className="toggle-group">
                {(
                  [
                    [true, "Calculé"],
                    [false, "Saisi"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={String(value)}
                    type="button"
                    className={`btn btn--ghost ${inputs.loyerAutoDepuisPrixM2 === value ? "btn--active" : ""}`}
                    onClick={() => update("loyerAutoDepuisPrixM2", value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="field__hint">
                {inputs.loyerAutoDepuisPrixM2
                  ? "Déduit du prix au m² et des surfaces."
                  : "Saisi à la main sur la ligne « Loyer » ci-dessous."}
              </span>
            </div>
          </div>

          {/* Synthèse des quatre chiffres qui découlent directement de ce paramétrage : elle évite
              d'avoir à descendre dans le tableau des charges pour savoir où l'on en est. */}
          <div className="keyfigures">
            <div className="keyfigures__head">
              <span className="keyfigures__title">Ce que ce paramétrage produit</span>
              <div className="toggle-group toggle-group--mini">
                {(
                  [
                    ["an", "Annuel"],
                    ["mois", "Mensuel"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`btn btn--ghost ${periodeAffichage === value ? "btn--active" : ""}`}
                    onClick={() => setPeriodeAffichage(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="keyfigures__grid">
              <div className="keyfigure">
                <span className="keyfigure__label">Quote-part du bureau</span>
                <span className="keyfigure__value">
                  {formatPercent(results.quotePartSurface)}
                  <span className={`bande-chip bande-chip--${bande.ton}`}>{bande.label}</span>
                </span>
                <span className="keyfigure__sub">
                  {inputs.surfaceBureauM2} m² sur {inputs.surfaceTotaleM2} m²
                </span>
              </div>
              <div className="keyfigure">
                <span className="keyfigure__label">Loyer imputé au bureau</span>
                <span className="keyfigure__value">{parPeriode(results.loyerAnnuelBureauRetenu)}</span>
                <span className="keyfigure__sub">
                  {inputs.surfaceBureauM2} m² × {inputs.loyerMarcheM2Mensuel} €/m²/mois
                </span>
              </div>
              <div className="keyfigure">
                <span className="keyfigure__label">Charges retenues</span>
                <span className="keyfigure__value">{parPeriode(results.totalChargesRetenuesAnnuel)}</span>
                <span className="keyfigure__sub">
                  {results.chargeLinesEffectives.filter((c) => c.enabled).length} postes activés, logement entier
                </span>
              </div>
              <div className="keyfigure keyfigure--accent">
                <span className="keyfigure__label">Indemnité brute</span>
                <span className="keyfigure__value">{parPeriode(results.indemniteAnnuelleBrute)}</span>
                <span className="keyfigure__sub">charges retenues × quote-part</span>
              </div>
            </div>

            {/* Jauge de surface : le seuil n'est pas un plafond légal mais le point au-delà duquel
                la justification doit être renforcée. Le montrer en permanence vaut mieux que de
                n'alerter qu'une fois dépassé, et le rendre modifiable évite de faire passer une
                tolérance de pratique pour une règle. */}
            <div className="surface-gauge">
              <div className="surface-gauge__track">
                <div
                  className={`surface-gauge__fill${surfaceDepasseTolerance ? " surface-gauge__fill--over" : ""}`}
                  style={{ width: `${Math.min(100, surfaceRatio * 100)}%` }}
                />
                <div
                  className="surface-gauge__marker"
                  style={{ left: `${Math.min(100, Math.max(0, inputs.toleranceSurfaceBureau) * 100)}%` }}
                />
              </div>
              <div className="surface-gauge__legend">
                <span>
                  Seuil de justification renforcée :{" "}
                  <input
                    type="number"
                    className="surface-gauge__input"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(inputs.toleranceSurfaceBureau * 1000) / 10}
                    onChange={(e) => update("toleranceSurfaceBureau", Number(e.target.value) / 100)}
                    aria-label="Seuil de justification renforcée, en % de la surface totale"
                  />{" "}
                  % de la surface totale, soit {Math.round(results.surfaceBureauTolerance * 10) / 10} m² de bureau
                </span>
                {/* Formulé comme une CORRECTION de saisie, pas comme un objectif à atteindre : la
                    surface du bureau est une mesure, pas un curseur d'optimisation. */}
                <button
                  type="button"
                  className="charge-line__apply"
                  onClick={alignerSurTolerance}
                  title="Ne l'utilisez que si votre pièce fait réellement cette surface : agrandir le chiffre n'agrandit pas le bureau."
                  disabled={Math.abs(inputs.surfaceBureauM2 - results.surfaceBureauTolerance) < 0.05}
                >
                  Ma pièce fait en réalité {Math.round(results.surfaceBureauTolerance * 10) / 10} m²
                </button>
              </div>
            </div>
          </div>

          {surfaceDepasseTolerance && (
            <p className="warning-block">
              ⚠️ Surface du bureau ({formatPercent(surfaceRatio)}) au-delà du seuil de{" "}
              {formatPercent(inputs.toleranceSurfaceBureau)} retenu : justification renforcée nécessaire. Restez en
              mesure de prouver la réalité de cet usage professionnel (plan coté, photos, absence d'usage personnel de
              la pièce).
            </p>
          )}
          <details className="charge-line__ref">
            <summary>Augmenter l'indemnité — les leviers légitimes, chiffrés sur vos valeurs</summary>
            <div className="seuil-doc">
              <p>
                <strong>La surface du bureau n'est pas un levier.</strong> L'indemnité vaut
                (loyer de marché + charges) × (surface bureau ÷ surface totale) : la surface{" "}
                <em>mesure</em> ce que vous mettez à disposition, elle ne se règle pas. Si la pièce fait 12 m², elle
                fait 12 m². Le seul cas où l'augmenter est légitime, c'est quand vous aviez sous-compté — le coin
                bureau saisi au lieu de la pièce entière qui lui est dédiée, une seconde pièce oubliée, ou deux
                conventions de mesure différentes entre le numérateur et le dénominateur.
              </p>
              <p>Voici, en revanche, ce qui augmente l'indemnité à surface constante.</p>
              <ol>
                <li>
                  <strong>Ajuster le prix au m² à votre quartier.</strong> La table propose des médianes
                  d'agglomération ; un quartier cher peut être très au-dessus. Sur vos {inputs.surfaceBureauM2} m²,
                  chaque euro de plus au m²/mois vaut <strong>{formatEUR(leviers.gainParEuroM2)}/an</strong>{" "}
                  d'indemnité. Adossez-le à 2 ou 3 annonces comparables archivées — c'est exactement la preuve
                  attendue.
                </li>
                <li>
                  <strong>Saisir vos factures réelles à la place des moyennes.</strong> Les charges pèsent{" "}
                  {formatPercent(
                    results.totalChargesRetenuesAnnuel > 0
                      ? 1 - results.loyerAnnuelLogementRetenu / results.totalChargesRetenuesAnnuel
                      : 0,
                  )}{" "}
                  de l'assiette : c'est le poste le plus simple à documenter, puisque vous avez les pièces.
                  {leviers.ecartSousEvalue > 0 ? (
                    <>
                      {" "}
                      Vos saisies sont sous la fourchette basse sur {leviers.postesSousEvalues.length} poste(s) —{" "}
                      {leviers.postesSousEvalues.join(", ")} — soit{" "}
                      <strong>{formatEUR(leviers.ecartSousEvalue)}/an</strong> d'indemnité en moins que les
                      références.
                    </>
                  ) : (
                    " Aucun de vos postes activés n'est actuellement sous sa fourchette de référence."
                  )}
                </li>
                <li>
                  <strong>Activer les postes que vous supportez réellement.</strong>
                  {leviers.gainPostesDesactives > 0 ? (
                    <>
                      {" "}
                      {leviers.postesDesactives.join(", ")} {leviers.postesDesactives.length > 1 ? "sont" : "est"}{" "}
                      désactivé(s) : les activer aux valeurs de référence ajouterait{" "}
                      <strong>{formatEUR(leviers.gainPostesDesactives)}/an</strong>. Ne le faites que si vous les
                      supportez vraiment — la TEOM n'a de sens que si votre taxe foncière a été saisie hors TEOM, ou
                      si vous êtes locataire.
                    </>
                  ) : (
                    " Tous les postes disposant d'une référence sont déjà activés."
                  )}
                </li>
                <li>
                  <strong>Choisir le bon régime foncier.</strong> Il ne change pas l'indemnité versée, mais ce qui
                  vous en reste.{" "}
                  {!results.eligibleMicroFoncier ? (
                    <>
                      Pas ici : votre indemnité dépasse le plafond micro-foncier de 15 000 €, le régime réel
                      s'applique d'office. Raison de plus pour renseigner intérêts et assurance emprunteur, seuls
                      déductibles à ce régime.
                    </>
                  ) : results.gainRegimeOptimal > 0 ? (
                    <>
                      Le régime {results.regimeOptimal === "micro" ? "micro-foncier" : "réel"} vous laisse{" "}
                      <strong>{formatEUR(results.gainRegimeOptimal)}/an</strong> de plus que l'autre — détaillé dans
                      la section « Fiscalité de l'indemnité » plus bas.
                    </>
                  ) : (
                    "Les deux régimes donnent ici le même résultat."
                  )}
                </li>
              </ol>
            </div>
          </details>

          <details className="charge-line__ref">
            <summary>
              Quelle quote-part est légitime ? Repères chiffrés, bandes de lecture et sources
            </summary>
            <div className="seuil-doc">
              <p>
                <strong>Aucun texte ne fixe de pourcentage.</strong> Ni le CGI, ni le BOFiP, ni la jurisprudence ne
                connaissent de « seuil des 30 % » : c'est une tolérance de pratique, largement reprise par les
                experts-comptables, qui résume l'endroit où l'administration cesse de considérer la quote-part comme
                allant de soi. Les vrais tests sont ailleurs, et ils sont qualitatifs.
              </p>
              <ol>
                <li>
                  <strong>La charge est-elle non excessive et engagée dans l'intérêt de l'exploitation</strong> (art.
                  39-1-1° CGI) ? Une surface plus grande qu'utile rend la fraction excédentaire non déductible chez la
                  société <em>et</em> imposable chez le dirigeant en revenus distribués (art. 109-1-2° CGI) — double
                  sanction.
                </li>
                <li>
                  <strong>L'activité peut-elle légalement s'exercer là</strong> (art. L631-7-3 CCH) ? Elle doit être
                  exercée par les seuls occupants ayant leur résidence principale dans le logement,{" "}
                  <strong>sans réception de clientèle ni de marchandises</strong>, et sans clause contraire du bail ou
                  du règlement de copropriété. Si vous recevez des clients, la surface n'est plus le sujet : c'est un
                  changement d'usage.
                </li>
                <li>
                  <strong>La pièce sert-elle réellement à cela, et pouvez-vous le prouver ?</strong> Plan coté, photos,
                  absence d'usage personnel de la pièce.
                </li>
              </ol>
              <p>
                Le pourcentage n'est donc qu'un indicateur de la <strong>charge de preuve</strong> à constituer : plus
                il monte, plus la démonstration doit être solide. Il ne rend jamais licite ce qui ne l'est pas, ni
                illicite ce qui est réellement justifié.
              </p>

              <table className="seuil-table">
                <thead>
                  <tr>
                    <th>Quote-part</th>
                    <th>Lecture</th>
                    <th>Ce que cela suppose</th>
                  </tr>
                </thead>
                <tbody>
                  {BANDES_SURFACE_BUREAU.map((b, i) => {
                    const min = i === 0 ? 0 : BANDES_SURFACE_BUREAU[i - 1].max;
                    return (
                      <tr key={b.id} className={b.id === bande.id ? "seuil-table__row--current" : undefined}>
                        <td>
                          {i === 0 ? "≤ " : `${formatPercent(min)} – `}
                          {formatPercent(b.max)}
                        </td>
                        <td>
                          <span className={`bande-chip bande-chip--${b.ton}`}>{b.label}</span>
                          <br />
                          {b.resume}
                        </td>
                        <td>{b.detail}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <p>
                <strong>Votre situation :</strong> {inputs.surfaceBureauM2} m² sur {inputs.surfaceTotaleM2} m², soit{" "}
                {formatPercent(results.quotePartSurface)} —{" "}
                <span className={`bande-chip bande-chip--${bande.ton}`}>{bande.label}</span> {bande.resume}
              </p>

              <p>
                <strong>La surface n'est pas le seul plafond.</strong> Le montant doit rester cohérent avec le marché
                local : au-delà de ~{LOYER_ANNUEL_M2_PRUDENT} €/m²/an (soit ~
                {formatEUR(LOYER_ANNUEL_M2_PRUDENT * 15)}/an pour 15 m²), un loyer appelle une justification
                documentée, quelle que soit la quote-part. Autre repère utile, côté social : un salarié en télétravail
                peut recevoir {formatEUR(FORFAIT_TELETRAVAIL_MENSUEL_SANS_ACCORD)}/mois{" "}
                <em>sans aucun justificatif</em> ({formatEUR(FORFAIT_TELETRAVAIL_MENSUEL_AVEC_ACCORD)}/mois avec accord
                collectif). Votre indemnité de {parPeriode(results.indemniteAnnuelleBrute)} se situe très au-dessus de
                cet ordre de grandeur — ce qui est normal pour une indemnité d'occupation calculée au réel, mais
                signifie que les justificatifs ne sont pas optionnels.
              </p>

              <p>Sources :</p>
              <ul>
                {SOURCES_SEUIL_SURFACE.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer noopener">
                      {s.label}
                    </a>{" "}
                    — {s.note}
                  </li>
                ))}
              </ul>
            </div>
          </details>

          {inputs.toleranceSurfaceBureau > TOLERANCE_SURFACE_BUREAU_DEFAUT && (
            <p className="warning-block">
              ⚠️ Seuil relevé au-delà des {formatPercent(TOLERANCE_SURFACE_BUREAU_DEFAUT)} habituellement admis. Aucun
              texte ne fixe de plafond légal, donc rien ne l'interdit — mais déplacer ce curseur ne déplace que l'alerte
              de ce simulateur, pas le risque : ce qui protège reste l'usage réel de la pièce et sa preuve. Rappel :
              louer l'intégralité d'une résidence principale à sa société n'est pas possible (changement de
              destination).
            </p>
          )}

          <details className="charge-line__ref">
            <summary>Comment ce loyer est calculé, et comment le justifier</summary>
            <p>
              La ligne « Loyer » de la section suivante porte la valeur locative du{" "}
              <strong>logement entier</strong> ({parPeriode(results.loyerAnnuelLogementRetenu)}), comme tous les
              autres postes de charge ; elle est ensuite ramenée au bureau par la quote-part de surface. Le résultat
              est identique à {inputs.surfaceBureauM2} m² × {inputs.loyerMarcheM2Mensuel} €/m²/mois — appliquer
              directement le prix au m² à la surface du bureau la proratiserait deux fois.
              <br />
              <br />
              Les valeurs proposées par ville sont des médianes d'agglomération indicatives. En cas de contrôle, la
              justification attendue reste 2 ou 3 annonces comparables, datées et archivées au moment où le loyer a
              été fixé. Sources publiques pour vérifier ou affiner :
              {SOURCES_LOYERS.map((s) => (
                <span key={s.url}>
                  <br />
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
          <RuleNote ruleId="domicile-surface-bureau-tolerance-30-pourcent" />
        </Section>

        <Section
          title="Charges du logement retenues dans l'indemnité"
          subtitle="Chaque poste (y compris le loyer) est inclus par défaut mais peut être désactivé individuellement. Les montants pré-remplis sont des ordres de grandeur 2025-2026 : remplacez-les par vos factures réelles, seules opposables en cas de contrôle."
        >
          <div className="charges-toolbar">
            <span className="charges-toolbar__context">
              Références pour {inputs.surfaceTotaleM2} m² en{" "}
              {inputs.typeLogement === "maison" ? "maison individuelle" : "immeuble collectif"},{" "}
              {inputs.statutOccupant === "locataire" ? "locataire" : "propriétaire"} · montants{" "}
              {periodeAffichage === "mois" ? "mensuels" : "annuels"}
            </span>
            <button type="button" className="charge-line__apply" onClick={appliquerReferences}>
              ↺ Tout réaligner sur les références
            </button>
          </div>
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
                      // Le montant reste stocké à l'année : en affichage mensuel on divise pour
                      // afficher et on remultiplie à la saisie, pour ne pas dupliquer l'état.
                      value={Math.round((c.montantAnnuel / diviseur) * 100) / 100}
                      onChange={(e) => updateChargeLine(c.id, { montantAnnuel: Number(e.target.value) * diviseur })}
                    />
                    <span className="charge-line__unit">{SUFFIXE_PERIODE[periodeAffichage]}</span>
                  </div>
                  {loyerAuto ? (
                    <div className="charge-line__ref">
                      Calculé : {inputs.surfaceTotaleM2} m² × {inputs.loyerMarcheM2Mensuel} €/m²/mois
                      {periodeAffichage === "an" ? " × 12" : ""}. Basculez « Montant du loyer » sur « Saisi »
                      ci-dessus pour renseigner votre loyer réel.
                    </div>
                  ) : (
                    infos !== undefined &&
                    reference !== undefined && (
                      <details className={`charge-line__ref${sousEvalue ? " charge-line__ref--low" : ""}`}>
                        <summary>
                          {sousEvalue ? "⚠️ " : ""}Référence : {parPeriode(reference)}
                          {fourchette !== undefined && fourchette[1] > 0 && (
                            <>
                              {" "}
                              (fourchette {formatEUR(fourchette[0] / diviseur)} –{" "}
                              {formatEUR(fourchette[1] / diviseur)})
                            </>
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
          {inputs.statutOccupant === "proprietaire" && (
            <div className="grid grid--2">
              <Field
                label="Intérêts annuels de l'emprunt immobilier (€/an)"
                hint="Déductibles du revenu foncier au régime réel uniquement, au prorata de la surface professionnelle. Ils ne s'ajoutent pas à l'indemnité : le loyer de marché rémunère déjà la mise à disposition du bien."
              >
                <NumberInput
                  value={inputs.interetsEmpruntAnnuels}
                  onChange={(e) => update("interetsEmpruntAnnuels", Number(e.target.value))}
                />
              </Field>
              <Field
                label="Assurance emprunteur de ce prêt (€/an)"
                hint="Décès, invalidité, incapacité. Même traitement que les intérêts, et même ligne 250 de la 2044 : déductible au seul régime réel."
              >
                <NumberInput
                  value={inputs.assuranceEmpruntAnnuelle}
                  onChange={(e) => update("assuranceEmpruntAnnuelle", Number(e.target.value))}
                />
              </Field>
            </div>
          )}

          {/* Comparaison chiffrée des deux régimes : c'est un arbitrage à faire une fois, mais qui
              engage trois ans, et le bon choix n'est pas devinable sans calcul. */}
          <div className="keyfigures">
            <div className="keyfigures__head">
              <span className="keyfigures__title">Micro-foncier ou réel — ce que ça change</span>
              {results.regimeOptimal !== inputs.regimeFoncier && results.eligibleMicroFoncier && (
                <button
                  type="button"
                  className="charge-line__apply"
                  onClick={() => update("regimeFoncier", results.regimeOptimal)}
                >
                  Basculer sur le régime {results.regimeOptimal === "micro" ? "micro-foncier" : "réel"}
                </button>
              )}
            </div>
            <div className="keyfigures__grid">
              <div
                className={`keyfigure${results.regimeOptimal === "micro" && results.eligibleMicroFoncier ? " keyfigure--accent" : ""}`}
              >
                <span className="keyfigure__label">
                  Micro-foncier — abattement 30 %
                  {!results.eligibleMicroFoncier && <span className="bande-chip bande-chip--bad">Non ouvert</span>}
                </span>
                <span className="keyfigure__value">{parPeriode(results.coutFiscalMicro)}</span>
                <span className="keyfigure__sub">
                  d'impôt + prélèvements sociaux · abattement {formatEUR(results.seuilBasculeReel)}
                </span>
              </div>
              <div className={`keyfigure${results.regimeOptimal === "reel" ? " keyfigure--accent" : ""}`}>
                <span className="keyfigure__label">
                  Réel — charges déduites
                  {!results.eligibleMicroFoncier && <span className="bande-chip bande-chip--neutral">Imposé</span>}
                </span>
                <span className="keyfigure__value">{parPeriode(results.coutFiscalReel)}</span>
                <span className="keyfigure__sub">
                  d'impôt + prélèvements sociaux · charges déductibles {formatEUR(results.chargesDeductiblesReel)}
                </span>
              </div>
              <div className="keyfigure">
                <span className="keyfigure__label">Écart annuel</span>
                {/* Hors plafond, il n'y a pas d'arbitrage : afficher un « écart en faveur du réel »
                    laisserait croire à un choix gagnant, alors que le réel est ici subi — et coûte
                    même parfois plus cher que ne coûterait le micro s'il était ouvert. */}
                <span className="keyfigure__value">
                  {results.eligibleMicroFoncier ? parPeriode(results.gainRegimeOptimal) : "—"}
                </span>
                <span className="keyfigure__sub">
                  {results.eligibleMicroFoncier
                    ? `en faveur du ${results.regimeOptimal === "micro" ? "micro-foncier" : "réel"}`
                    : results.coutFiscalReel > results.coutFiscalMicro
                      ? `pas d'arbitrage possible — le micro coûterait ${parPeriode(results.coutFiscalMicro - results.coutFiscalReel < 0 ? results.coutFiscalReel - results.coutFiscalMicro : 0)} de moins s'il était ouvert`
                      : "pas d'arbitrage possible — le réel est de toute façon plus favorable"}
                </span>
              </div>
            </div>
          </div>

          {!results.eligibleMicroFoncier ? (
            <p className="warning-block">
              Plafond micro-foncier de 15 000 € dépassé (indemnité + autres revenus fonciers du foyer) : le régime
              réel s'applique d'office, ce n'est plus un choix. Le seuil s'apprécie par foyer fiscal, pas par bien.
            </p>
          ) : (
            <p className="hint-block">
              <strong>La règle est simple :</strong> le réel l'emporte dès que vos charges déductibles dépassent
              l'abattement forfaitaire de 30 %, soit {formatEUR(results.seuilBasculeReel)} ici. Vous en êtes à{" "}
              {formatEUR(results.chargesDeductiblesReel)} —{" "}
              {results.chargesDeductiblesReel > results.seuilBasculeReel
                ? "au-dessus, donc le réel est plus favorable."
                : `en dessous, donc l'abattement forfaitaire est plus généreux que vos charges réelles (il manque ${formatEUR(results.seuilBasculeReel - results.chargesDeductiblesReel)}).`}{" "}
              L'écart se creuse surtout avec un emprunt en cours : intérêts et assurance emprunteur ne sont
              déductibles qu'au réel, et l'abattement de 30 % les absorbe.
            </p>
          )}

          {results.eligibleMicroFoncier && (
            <p className="warning-block">
              ⚠️ L'option pour le régime réel est <strong>irrévocable pendant 3 ans</strong>. Ne raisonnez donc pas
              sur la seule année en cours : un emprunt qui s'amortit voit ses intérêts décroître chaque année, et de
              gros travaux ponctuels ne se répètent pas. Projetez les trois exercices avant d'opter.
            </p>
          )}

          {results.interetsEmpruntDeduits > 0 && (
            <p className="hint-block">
              Quote-part professionnelle des intérêts et de l'assurance emprunteur déduite du revenu foncier :{" "}
              <strong>{formatEUR(results.interetsEmpruntDeduits)}</strong>/an.
            </p>
          )}
          {results.chargeLinesEffectives.some((c) => c.enabled && c.id === "taxeOrduresMenageres") && (
            <p className="hint-block">
              La TEOM entre dans l'assiette de l'indemnité — c'est une charge que vous supportez réellement — mais
              elle n'est <strong>pas déductible</strong> du revenu foncier au régime réel : c'est une charge
              récupérable auprès du locataire (art. 31, I-1°-a ter CGI). Le simulateur l'exclut donc de la déduction.
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

        <Section
          title="Résultats"
          subtitle="Ce que l'indemnité coûte et rapporte, de part et d'autre, une fois tous les paramètres ci-dessus renseignés."
        >
          <div className="charges-toolbar">
            <span className="charges-toolbar__context">
              Montants {periodeAffichage === "mois" ? "mensuels" : "annuels"}
            </span>
            <div className="toggle-group toggle-group--mini">
              {(
                [
                  ["an", "Annuel"],
                  ["mois", "Mensuel"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`btn btn--ghost ${periodeAffichage === value ? "btn--active" : ""}`}
                  onClick={() => setPeriodeAffichage(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="stat-grid">
            <StatCard label="Indemnité brute" value={parPeriode(results.indemniteAnnuelleBrute)} />
            <StatCard label="Base imposable foncière" value={parPeriode(results.baseImposableFonciere)} />
            <StatCard label="IR dû" value={parPeriode(results.irDu)} sub={`TMI : ${formatPercent(results.tauxIRUtilise)}`} />
            <StatCard label="Prélèvements sociaux (17,2 %)" value={parPeriode(results.prelevementsSociaux)} />
            <StatCard label="Gain net pour le dirigeant (récurrent)" value={parPeriode(results.gainNetGerant)} tone="good" />
            {inputs.formalisation === "bail_professionnel" && inputs.fraisMiseEnPlaceBail > 0 && (
              <StatCard
                label="Gain net — 1ère année (après frais de mise en place)"
                value={formatEUR(results.gainNetGerantAnnee1)}
                sub="montant annuel : les frais de mise en place sont ponctuels"
                tone={results.gainNetGerantAnnee1 >= 0 ? "good" : "bad"}
              />
            )}
            <StatCard label="Coût net société (après économie d'impôt)" value={parPeriode(results.coutNetSociete)} tone="bad" />
            <StatCard
              label="Économie vs bureau externe"
              value={parPeriode(results.economieVsBureauExterne)}
              tone={results.economieVsBureauExterne >= 0 ? "good" : "bad"}
            />
          </div>
        </Section>

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
          <Field label="Nom de la simulation">
            <input value={inputs.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
        </Section>
      </div>
    </div>
  );
}
