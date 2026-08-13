import { Fragment, useEffect, useMemo, useState } from "react";
import {
  type ParticipationVersementMode,
  type SimulationInputs,
  PARTICIPATION_VERSEMENT_LABELS,
  PARTICIPATION_VERSEMENT_MODES,
  DEFAULT_CORPORATE_TAX_RATE,
  DEFAULT_IK_RATE,
  DEFAULT_PFU_RATE,
  DEFAULT_TNS_RATE,
  DEFAULT_TVA_RATE,
  applyVehicleModel,
  computeSimulation,
  createDefaultInputs,
} from "../lib/simulator";
import { getCompanyType, resolveDirigeantStatus } from "../lib/companyTypes";
import { createDefaultFinancingInputs, getTauxUsureApplicable, type FinancingMode } from "../lib/financing";
import { IR_BAREME_2026 } from "../lib/frenchIncomeTax";
import { VEHICLE_MODELS, getVehicleModel } from "../lib/vehicleModels";
import { DEFAULT_DEPRECIATION_RATE_ANNUAL } from "../lib/vehicleDepreciation";
import { estimateMalusPoids } from "../lib/vehicleTaxes";
import {
  type BorneRechargeInputs,
  computeBorneRecharge,
  createDefaultBorneRechargeInputs,
} from "../lib/borneRecharge";
import { Field, NumberInput, ResetableNumberInput, Section, StatCard } from "../components/Field";
import { RuleNote } from "../components/RuleNote";
import { SavedSimulationsPanel } from "../components/SavedSimulationsPanel";
import { savePersonalTaxProfile, withPersistedPersonalTaxProfile } from "../lib/storage";
import { CopyButton } from "../components/CopyButton";
import { ShareButton } from "../components/ShareButton";
import { PdfButton } from "../components/PdfButton";
import { PrintableReport } from "../components/PrintableReport";
import { mergeSharedInputs } from "../lib/urlShare";
import { CompanyTypeFields } from "../components/CompanyTypeFields";
import { PersonalTaxProfileFields } from "../components/PersonalTaxProfileFields";
import { formatEUR, formatPercent } from "../lib/format";

const FINANCING_LABELS: Record<FinancingMode, string> = {
  comptant: "Comptant",
  credit: "Crédit",
  loa: "LOA",
  lld: "LLD",
};

type SortCriterion = "global" | "societe" | "personnel";
type CostPeriod = "annuel" | "mensuel";
/**
 * Point de vue retenu pour lire le comparatif.
 * — « consolide » : société et dirigeant à parité, un euro valant un euro de chaque côté ;
 * — « poche » : les euros dépensés par la société sont valorisés au net de leur coût de sortie
 *   (PFU), puisqu'ils n'auraient rejoint le patrimoine du dirigeant qu'amputés de ce prélèvement.
 */
type Perspective = "consolide" | "poche";

const SORT_LABELS: Record<SortCriterion, string> = {
  global: "Coût global (recommandé)",
  societe: "Coût le plus bas côté société",
  personnel: "Coût le plus bas côté dirigeant",
};

/** Résumé texte complet d'une simulation véhicule, destiné à être copié dans le presse-papier. */
function buildVehicleExportText(sim: SimulationInputs): string {
  const r = computeSimulation(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  push(`🚗 ${sim.name} — Simulateur véhicule de société`);
  push(`Généré le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");
  push("— Juridiction —");
  push(`Pays : ${sim.country} · Forme juridique : ${sim.companyType} · Régime : ${sim.impositionSociete}`);
  push(`Statut du dirigeant : ${r.dirigeantStatus === "TNS" ? "TNS" : "Assimilé salarié"}`);
  push("");
  push("— Véhicule —");
  push(`Prix TTC : ${formatEUR(sim.vehiclePrice)} · Âge : ${sim.vehicleOverFiveYears ? "> 5 ans" : "≤ 5 ans"}`);
  push(`Motorisation : ${sim.isElectric ? "100% électrique" : "Thermique/hybride"}${sim.isElectric ? ` · Éco-score éligible : ${sim.isEcoScoreEligible ? "Oui" : "Non"}` : ` · CO2 : ${sim.co2EmissionsGkm} g/km`}`);
  push(`Usage privé : ${sim.privateUsePercent}% · Kilométrage annuel : ${sim.totalKmAnnual} km`);
  if (sim.privateUsePercent >= 80) {
    push("");
    push("⚠️ Usage privé élevé — sécuriser via la qualification « véhicule de fonction » (élément de rémunération,");
    push("art. 39-1-1° CGI) plutôt que « véhicule de service » (outil de travail) :");
    push("  1. Formaliser par une décision d'organe social (registre de l'associé unique en SASU/EURL, ou convention");
    push("     réglementée art. L227-10 / L223-19 c. com. en SAS/SARL) qualifiant le véhicule d'élément de rémunération.");
    push("  2. Déclarer l'AEN à 100% de l'usage privé réel, sans minoration.");
    push("  3. Vérifier que la rémunération globale (salaire + AEN) n'est pas excessive (art. 39-1-1° CGI).");
    push("  4. Tenir un carnet de bord même sans usage pro (cohérence et bonne foi).");
    push("  Réf. : CE 9e-10e ch., 4 oct. 2023, n°466887, Sté Collectivision (rémunération indirecte non anormale).");
  }
  push("");
  push("— Charges annuelles réelles (hypothèses) —");
  push(`Assurance : ${formatEUR(sim.annualInsurance)}/an · Entretien : ${formatEUR(sim.annualMaintenance)}/an${!sim.isElectric ? ` · Carburant usage privé : ${formatEUR(sim.annualFuelPrivateCost)}/an` : ""}`);
  push(`Taux de décote annuel estimé (valeur résiduelle) : ${formatPercent(sim.tauxDeprecationAnnuel)}/an`);
  push("");
  push("— Cotisations & fiscalité (hypothèses) —");
  push(`Taux de charges sociales sur l'AEN : ${formatPercent(sim.tnsContributionRate)} · Taux d'IS normal : ${formatPercent(sim.corporateTaxRate)}`);
  push(`Bénéfice imposable prévisionnel avant charges véhicule : ${formatEUR(sim.beneficeAvantChargePrevisionnel)}${sim.impositionSociete === "IS" ? ` (éligible taux réduit 15% : ${sim.eligibleTauxReduitPME ? "Oui" : "Non"})` : ""}`);
  push(`Participation financière mensuelle du dirigeant : ${formatEUR(sim.monthlyParticipation)} · Barème IK de base : ${sim.ikRatePerKm} €/km`);
  if (sim.monthlyParticipation > 0) {
    push(
      `Modalité de versement : ${PARTICIPATION_VERSEMENT_LABELS[sim.modeVersementParticipation]} — coût réel pour le dirigeant ${formatEUR(r.coutParticipationDirigeant)}/an ` +
        `pour ${formatEUR(r.participationAnnual)}/an de contrepartie` +
        (r.economieModeVersementOptimal > 1
          ? ` · modalité la moins coûteuse : ${PARTICIPATION_VERSEMENT_LABELS[r.modeVersementOptimal]} (−${formatEUR(r.economieModeVersementOptimal)}/an)`
          : ""),
    );
    if (sim.compenserParticipationParAugmentationSalaire) {
      push(
        `Participation compensée par une augmentation de rémunération : ${formatEUR(r.augmentationBruteParticipation)}/an de coût chargé pour la société ` +
          `(${formatEUR(r.coutNetAugmentationParticipation)}/an après économie d'impôt) — le coût du montage est reporté sur la société, il n'est pas supprimé`,
      );
      push(
        "  🚨 MONTAGE À HAUT RISQUE : opération circulaire (la rémunération majorée revient aussitôt en participation). Risques d'abus de droit",
      );
      push(
        "     fiscal (art. L64 A LPF, but principalement fiscal ; art. L64 et majoration de 80% si but exclusivement fiscal), de requalification",
      );
      push(
        "     URSSAF faute d'appauvrissement réel du bénéficiaire, et de perte de la déduction de TVA. Avis d'un avocat fiscaliste indispensable.",
      );
    }
  }
  push(
    `Participation optimale (ramène l'AEN à 0, mode société sélectionné) : ${formatEUR(r.participationOptimaleMensuelle)}/mois` +
      (sim.monthlyParticipation > 0
        ? ` · impôt société généré par la participation encaissée : ${formatEUR(r.impotSurParticipation)}/an`
        : ""),
  );
  if (sim.tvaRecuperableVehicule && r.tvaEffectivementDeductible) {
    push(
      `TVA récupérée sur le véhicule (participation au prix de marché, taux ${formatPercent(sim.tauxTVA)}) : ${formatEUR(r.tvaDeductible)}/an déduits ` +
        `sur le véhicule et l'entretien, ${formatEUR(r.tvaCollecteeSurParticipation)}/an collectés sur la participation (position nette ${formatEUR(r.gainTvaNet)}/an) — options « Société » uniquement`,
    );
  } else if (sim.tvaRecuperableVehicule) {
    push(
      "TVA récupérée sur le véhicule : option cochée mais SANS EFFET — aucune participation versée, donc mise à disposition à titre gratuit, hors du champ de la TVA (rescrit BOI-RES-TVA-000161).",
    );
  }
  if (sim.compenserMensualiteParAugmentationSalaire) {
    push("Mensualité compensée par une augmentation de salaire : OUI (en plus des IK, sur les options « Personnel »)");
  }
  if (r.remiseSociete > 0 || r.remisePersonnel > 0) {
    push(
      `Aides à l'achat déduites du prix (comptant/crédit) : société ${formatEUR(r.remiseSociete)} (prix net ${formatEUR(r.prixNetSociete)}) · personnel ${formatEUR(r.remisePersonnel)} (prix net ${formatEUR(r.prixNetPersonnel)})`,
    );
  }
  push("");
  push("— Modes de financement (paramètres, hypothèses) —");
  push(`Comptant : durée de détention ${sim.financing.comptant.dureeDetentionMois} mois, taux d'opportunité ${formatPercent(sim.financing.comptant.tauxOpportunite)}/an`);
  push(`Crédit : apport ${formatEUR(sim.financing.credit.apport)}, TAEG ${formatPercent(sim.financing.credit.tauxAnnuel, 3)}, durée ${sim.financing.credit.dureeMois} mois`);
  push(
    `LOA : 1er loyer majoré ${formatEUR(sim.financing.loa.premierLoyerMajore)}, loyer mensuel ${formatEUR(sim.financing.loa.loyerMensuel)}, durée ${sim.financing.loa.dureeMois} mois, option d'achat ${formatEUR(sim.financing.loa.valeurOptionAchat)} (${sim.financing.loa.leveeOption ? "levée" : "non levée"})`,
  );
  push(
    `LLD : 1er loyer ${formatEUR(sim.financing.lld.premierLoyer)}, loyer mensuel ${formatEUR(sim.financing.lld.loyerMensuel)}, durée ${sim.financing.lld.dureeMois} mois, km inclus/an ${sim.financing.lld.kmInclusAnnuel}, dépassement ${sim.financing.lld.coutKmSupplementaire} €/km`,
  );
  push(
    "Note : le comptant charge le coût d'opportunité sur la totalité du prix pendant toute la durée (capital récupéré en une fois, à la revente — déjà déduit ci-dessous en valeur résiduelle), tandis que le crédit ne facture des intérêts que sur le capital restant dû, dégressif. Un crédit peut donc coûter moins cher qu'un comptant même avec un TAEG supérieur au taux d'opportunité : ce n'est pas une erreur de calcul.",
  );
  push("");
  push("— Résultats AEN (société) —");
  push(`AEN brut : ${formatEUR(r.aenBrut)} · Abattement : ${formatEUR(r.abattement)} · AEN net : ${formatEUR(r.aenNet)}`);
  push(`Cotisations sociales : ${formatEUR(r.cotisationsTNS)} · IR sur l'AEN : ${formatEUR(r.irEstimee)} (TMI ${formatPercent(r.tauxIRUtilise)})`);
  push(`Coût net société : ${formatEUR(r.coutNetSociete)} · Coût cash dirigeant : ${formatEUR(r.coutTotalGerantSociete)}`);
  push(`Coût global consolidé (société) : ${formatEUR(r.globalCostSociete)}/an`);
  push("");
  push("— Achat personnel + IK —");
  push(`Km pro/privé : ${r.proKmAnnual.toFixed(0)}/${r.privateKmAnnual.toFixed(0)} km · Remboursement IK : ${formatEUR(r.ikReimbursement)}`);
  push(`Coût net dirigeant : ${formatEUR(r.coutScenarioPersonnel)} · Coût global consolidé (personnel) : ${formatEUR(r.globalCostPersonnel)}/an`);
  push("");
  push(`🏆 Meilleure option : ${r.bestOption.label} — ${formatEUR(r.bestOption.globalCostAnnual)}/an`);
  push("");
  push("— Comparaison de toutes les options (coût global annuel) —");
  push(
    "Note de lecture : le coût global additionne les euros de la société et ceux du dirigeant à parité. Si le résultat de la société",
  );
  push(
    `est destiné au patrimoine personnel, une charge qu'elle supporte ne coûte en réalité que ${formatPercent(1 - sim.tauxExtractionResultat)} de son montant`,
  );
  push(
    `(net de son coût de sortie, ${formatPercent(sim.tauxExtractionResultat)}). De ce point de vue, la meilleure option devient : ${r.bestOptionPocheDirigeant.label} — ` +
      `${formatEUR(r.bestOptionPocheDirigeant.coutPocheDirigeant)}/an.`,
  );
  for (const opt of r.allOptions) {
    const residuel = opt.devientProprietaire ? `, valeur résiduelle fin de période ${formatEUR(opt.valeurResiduelleEstimee)}` : ", véhicule restitué (rien)";
    push(`  ${opt.label} : ${formatEUR(opt.globalCostAnnual)}/an (dont société ${formatEUR(opt.partSociete)} · dont dirigeant ${formatEUR(opt.partDirigeant)}${residuel})`);
  }
  if (r.seuilPrivateUsePercent !== null) {
    push("");
    push(`Seuil de bascule société ⇄ personnel (modes sélectionnés) : ~${r.seuilPrivateUsePercent.toFixed(0)}% d'usage privé`);
  }
  push("");
  push("Généré par le simulateur de coûts d'entreprise — outil d'aide à la décision, ne remplace pas l'avis d'un expert-comptable.");

  return lines.join("\n");
}

const PERIOD_SUFFIX: Record<CostPeriod, string> = { annuel: "/an", mensuel: "/mois" };

export function VehicleSimulatorPage({ initialShareData }: { initialShareData?: string }) {
  const [inputs, setInputs] = useState<SimulationInputs>(
    () => mergeSharedInputs(withPersistedPersonalTaxProfile(createDefaultInputs()), initialShareData),
  );
  const [saveVersion, setSaveVersion] = useState(0);
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>("global");
  const [expandedOptions, setExpandedOptions] = useState<Set<string>>(new Set());
  const [costPeriod, setCostPeriod] = useState<CostPeriod>("annuel");
  const [perspective, setPerspective] = useState<Perspective>("consolide");
  const [showResidualValue, setShowResidualValue] = useState(false);
  const [borneInputs, setBorneInputs] = useState<BorneRechargeInputs>(() => createDefaultBorneRechargeInputs());

  function updateBorne<K extends keyof BorneRechargeInputs>(key: K, value: BorneRechargeInputs[K]) {
    setBorneInputs((prev) => ({ ...prev, [key]: value }));
  }

  // Le revenu de référence du foyer fiscal est un réglage transversal (identique quel que soit le
  // simulateur) : on le persiste à chaque modification pour le retrouver pré-rempli sur les autres
  // simulateurs et à la prochaine visite.
  useEffect(() => {
    savePersonalTaxProfile(inputs.personalTaxProfile);
  }, [inputs.personalTaxProfile]);

  function toPeriod(annualValue: number): number {
    return costPeriod === "mensuel" ? annualValue / 12 : annualValue;
  }

  /** Coût d'une option selon le point de vue retenu (consolidé, ou ramené à la poche du dirigeant). */
  function coutSelonPerspective(option: { globalCostAnnual: number; coutPocheDirigeant: number }): number {
    return perspective === "poche" ? option.coutPocheDirigeant : option.globalCostAnnual;
  }

  const results = useMemo(() => computeSimulation(inputs), [inputs]);
  // Contrefactuel du montage « participation compensée » : ce que coûterait la même situation sans
  // l'augmentation compensatrice. Sert à chiffrer explicitement le surcoût du montage plutôt que de
  // laisser l'utilisateur le déduire d'un écart entre deux lectures du comparatif.
  const surcoutCompensation = useMemo(() => {
    if (!inputs.compenserParticipationParAugmentationSalaire || inputs.monthlyParticipation <= 0) return 0;
    const sans = computeSimulation({ ...inputs, compenserParticipationParAugmentationSalaire: false });
    return results.globalCostSociete - sans.globalCostSociete;
  }, [inputs, results.globalCostSociete]);
  const companyTypeConfig = getCompanyType(inputs.country, inputs.companyType);
  const dirigeantStatus = resolveDirigeantStatus(companyTypeConfig, inputs.gerantMajoritaire);
  const defaultCotisationRate = companyTypeConfig?.defaultCotisationRate ?? DEFAULT_TNS_RATE;
  const selectedVehicleModel = inputs.vehicleModelId ? getVehicleModel(inputs.vehicleModelId) : undefined;
  const lldToutCompris = selectedVehicleModel?.defaultLldOffer?.toutComprisEntretienAssurance ?? false;
  const malusPoidsEstime = estimateMalusPoids(inputs.vehicleWeightKg, inputs.isElectric);
  const borneResults = useMemo(
    () => computeBorneRecharge(borneInputs, inputs, results.tauxIRUtilise),
    [borneInputs, inputs, results.tauxIRUtilise],
  );

  function update<K extends keyof SimulationInputs>(key: K, value: SimulationInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
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

  function handleVehicleModelChange(modelId: string) {
    // Réapplique motorisation/éco-score et, quand le modèle a une offre LOA constructeur réelle
    // connue (ex. Tesla Model Y), le prix TTC de référence et le mode d'acquisition du véhicule.
    setInputs((prev) => applyVehicleModel(prev, modelId));
  }

  function toggleExpandedOption(label: string) {
    setExpandedOptions((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function handleCreditTauxChange(raw: number) {
    const montantEmprunte = Math.max(0, inputs.financing.credit.prixTTC - inputs.financing.credit.apport);
    const seuil = getTauxUsureApplicable(montantEmprunte);
    updateFinancing("credit", { tauxAnnuel: Math.min(raw, seuil) });
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

  // Référence de "prix de marché" pour la participation ouvrant droit à déduction de TVA : le loyer
  // mensuel d'une offre locative constructeur pour ce même véhicule est le meilleur proxy disponible
  // de ce qu'un loueur professionnel facturerait, au prorata de la part d'usage privé facturée.
  const loyerReferenceMensuel = Math.max(inputs.financing.loa.loyerMensuel, inputs.financing.lld.loyerMensuel);
  const prixMarcheParticipation = loyerReferenceMensuel * (inputs.privateUsePercent / 100);
  const participationStatus: "none" | "low" | "ok" =
    inputs.monthlyParticipation <= 0
      ? "none"
      : prixMarcheParticipation > 0 && inputs.monthlyParticipation < prixMarcheParticipation * 0.7
        ? "low"
        : "ok";

  // Indicateurs du caractère non excessif de la rémunération globale (art. 39-1-1° CGI). Il n'existe
  // aucun seuil légal chiffré : l'administration compare à des emplois analogues et à la capacité
  // bénéficiaire de la société. Ces ratios ne sont donc que des signaux d'alerte, pas des verdicts.
  const salaireDirigeantAnnuel = inputs.personalTaxProfile.salaireNetImposableAnnuel;
  const remunerationGlobaleAnnuelle = salaireDirigeantAnnuel + results.aenBrut;
  const partAenDansRemuneration =
    remunerationGlobaleAnnuelle > 0 ? results.aenBrut / remunerationGlobaleAnnuelle : 0;
  const beneficeAvantRemuneration = inputs.beneficeAvantChargePrevisionnel + remunerationGlobaleAnnuelle;
  const partRemunerationDansBenefice =
    beneficeAvantRemuneration > 0 ? remunerationGlobaleAnnuelle / beneficeAvantRemuneration : 0;

  // La bannière suit le point de vue retenu dans le comparatif : afficher l'optimum consolidé alors
  // que le tableau classe selon la poche du dirigeant désignerait deux gagnants différents au même
  // écran.
  const best = perspective === "poche" ? results.bestOptionPocheDirigeant : results.bestOption;
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

      <div className="results-toolbar results-toolbar--top">
        <CopyButton getText={() => buildVehicleExportText(inputs)} />
        <ShareButton page="vehicle" getInputs={() => inputs} />
        <PdfButton />
      </div>
      <PrintableReport text={buildVehicleExportText(inputs)} />

      <div className="layout">
        <div className="layout__form">
          <Section title="Juridiction & structure" subtitle="Détermine le statut du dirigeant et le régime applicable.">
            <CompanyTypeFields
              country={inputs.country}
              companyType={inputs.companyType}
              gerantMajoritaire={inputs.gerantMajoritaire}
              impositionSociete={inputs.impositionSociete}
              onCountryChange={handleCountryChange}
              onCompanyTypeChange={handleCompanyTypeChange}
              onGerantMajoritaireChange={(v) => update("gerantMajoritaire", v)}
              onImpositionChange={(v) => update("impositionSociete", v)}
            >
              <RuleNote ruleId="aen-methode-reelle-obligatoire-tns" />
              {dirigeantStatus === "ASSIMILE_SALARIE" && <RuleNote ruleId="aen-forfaitaire-assimile-salarie" />}
            </CompanyTypeFields>
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
            <div className="grid grid--2">
              <Field
                label="Poids en ordre de marche (kg)"
                hint={`Malus au poids estimé (informatif, non déduit du prix saisi) : ${formatEUR(malusPoidsEstime)}`}
              >
                <NumberInput value={inputs.vehicleWeightKg} onChange={(e) => update("vehicleWeightKg", Number(e.target.value))} />
              </Field>
              <Field
                label="Aide à l'achat perçue (bonus écologique / prime à la conversion) (€)"
                hint="Informatif : à déduire vous-même du prix TTC ci-dessus si la société en a déjà bénéficié."
              >
                <NumberInput
                  value={inputs.aideAchatVehicule}
                  onChange={(e) => update("aideAchatVehicule", Number(e.target.value))}
                />
              </Field>
            </div>
            <RuleNote ruleId="aen-amortissement-taux" />
            <RuleNote ruleId="aen-vehicule-loue-taux" />
            <RuleNote ruleId="malus-ecologique" />
            <RuleNote ruleId="bonus-ecologique" />
            {inputs.isElectric && (
              <>
                <Field
                  label="Modèle (référence indicative de la liste ADEME éco-score)"
                  hint="Liste non exhaustive et non officielle : vérifiez la liste ADEME à jour au jour de la mise à disposition."
                >
                  <select
                    value={inputs.vehicleModelId ?? "autre"}
                    onChange={(e) => handleVehicleModelChange(e.target.value)}
                  >
                    {VEHICLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {(inputs.vehicleModelId === "autre" || inputs.vehicleModelId === null) && (
                  <Field label="Véhicule éligible à l'éco-score renforcé (≥ 60 pts, liste ADEME) ?">
                    <select
                      value={inputs.isEcoScoreEligible ? "oui" : "non"}
                      onChange={(e) => update("isEcoScoreEligible", e.target.value === "oui")}
                    >
                      <option value="oui">Oui</option>
                      <option value="non">Non</option>
                    </select>
                  </Field>
                )}
              </>
            )}
            {inputs.isElectric && <RuleNote ruleId="aen-abattement-vehicule-electrique-taux" />}
            {inputs.isElectric && <RuleNote ruleId="aen-abattement-vehicule-electrique-plafond" />}
          </Section>

          {inputs.isElectric && ((selectedVehicleModel?.ceeOffers?.length ?? 0) > 0 || (selectedVehicleModel?.bonusRepriseConstructeur ?? 0) > 0 || inputs.bonusRepriseActif) && (
            <Section
              title="🎁 Aides à l'achat (prime CEE, bonus de reprise)"
              subtitle="Déduites directement du prix TTC retenu pour le calcul (comptant/crédit uniquement — sans effet sur des loyers LOA/LLD déjà négociés)."
            >
              {(selectedVehicleModel?.ceeOffers?.length ?? 0) > 0 && (
                <Field
                  label="Prime CEE « Coup de pouce véhicules particuliers électriques »"
                  hint="Réservée aux particuliers : déduite uniquement côté achat personnel, jamais côté société."
                >
                  <select
                    value={inputs.ceeSelectedAmount}
                    onChange={(e) => update("ceeSelectedAmount", Number(e.target.value))}
                  >
                    <option value={0}>Aucune</option>
                    {selectedVehicleModel?.ceeOffers?.map((offer) => (
                      <option key={offer.label} value={offer.amount}>
                        {offer.label} — {formatEUR(offer.amount)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <label className="charge-line__toggle" style={{ marginTop: "0.75rem" }}>
                <input
                  type="checkbox"
                  checked={inputs.bonusRepriseActif}
                  onChange={(e) => update("bonusRepriseActif", e.target.checked)}
                />
                <span>Bonus de reprise constructeur (reprise d'un ancien véhicule)</span>
              </label>
              {inputs.bonusRepriseActif && (
                <div className="grid grid--2" style={{ marginTop: "0.5rem" }}>
                  <Field label="Montant du bonus de reprise (€)">
                    <NumberInput
                      value={inputs.bonusRepriseMontant}
                      onChange={(e) => update("bonusRepriseMontant", Number(e.target.value))}
                    />
                  </Field>
                  <Field
                    label="Applicable à un achat par la société ?"
                    hint="Offre commerciale privée du constructeur, non réglementaire : à confirmer au cas par cas avec le concessionnaire."
                  >
                    <select
                      value={inputs.bonusRepriseApplicableSociete ? "oui" : "non"}
                      onChange={(e) => update("bonusRepriseApplicableSociete", e.target.value === "oui")}
                    >
                      <option value="oui">Oui — déduit aussi côté société</option>
                      <option value="non">Non — déduit uniquement côté personnel</option>
                    </select>
                  </Field>
                </div>
              )}
              {(results.remiseSociete > 0 || results.remisePersonnel > 0) && (
                <div className="stat-grid" style={{ marginTop: "0.75rem" }}>
                  <StatCard
                    label="Prix net retenu — société"
                    value={formatEUR(results.prixNetSociete)}
                    sub={results.remiseSociete > 0 ? `− ${formatEUR(results.remiseSociete)} d'aides` : "Aucune aide applicable"}
                    tone={results.remiseSociete > 0 ? "good" : "neutral"}
                  />
                  <StatCard
                    label="Prix net retenu — personnel"
                    value={formatEUR(results.prixNetPersonnel)}
                    sub={results.remisePersonnel > 0 ? `− ${formatEUR(results.remisePersonnel)} d'aides` : "Aucune aide applicable"}
                    tone={results.remisePersonnel > 0 ? "good" : "neutral"}
                  />
                </div>
              )}
              <RuleNote ruleId="cee-coup-de-pouce-vehicule-electrique" />
              <RuleNote ruleId="bonus-reprise-constructeur" />
            </Section>
          )}

          {inputs.isElectric && (
            <Section
              title="⚡ Borne de recharge professionnelle"
              subtitle="Installation d'une borne sur le lieu de travail et indemnité de recharge à domicile — dispositifs propres au véhicule électrique."
            >
              <div className="grid grid--3">
                <Field label="Coût d'installation de la borne, TTC (€)">
                  <NumberInput
                    value={borneInputs.coutInstallationTTC}
                    onChange={(e) => updateBorne("coutInstallationTTC", Number(e.target.value))}
                  />
                </Field>
                <Field label="Durée d'amortissement (années)">
                  <NumberInput
                    value={borneInputs.dureeAmortissementAnnees}
                    onChange={(e) => updateBorne("dureeAmortissementAnnees", Number(e.target.value))}
                  />
                </Field>
                <Field label="Indemnité de recharge à domicile (€/mois)">
                  <NumberInput
                    value={borneInputs.indemniteRechargeDomicileMensuelle}
                    onChange={(e) => updateBorne("indemniteRechargeDomicileMensuelle", Number(e.target.value))}
                  />
                </Field>
              </div>
              <div className="stat-grid">
                <StatCard label="Crédit d'impôt IRVE (75%, plafonné 20 000€)" value={formatEUR(borneResults.creditImpotIRVE)} tone="good" />
                <StatCard
                  label="Coût net société — année d'installation"
                  value={formatEUR(borneResults.coutNetSocieteAnnee1)}
                  sub={`${formatEUR(borneResults.coutNetSocieteAnneesSuivantes)}/an les années suivantes`}
                  tone="bad"
                />
                <StatCard
                  label="Indemnité de recharge — coût net société"
                  value={formatEUR(borneResults.coutNetIndemniteRecharge)}
                  sub={`${formatEUR(borneResults.indemniteRechargeAnnuelle)}/an brut`}
                  tone="bad"
                />
              </div>
              <RuleNote ruleId="credit-impot-irve" />
              <RuleNote ruleId="indemnite-recharge-domicile" />
            </Section>
          )}

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
            {inputs.privateUsePercent >= 100 && (
              <p className="warning-block warning-block--danger">
                🚫 Usage 100% privé : le véhicule n'a aucun usage professionnel documenté. Il ne peut pas être justifié
                comme <strong>véhicule de service</strong> (outil de travail) — cette qualification supposerait un besoin
                professionnel réel et prouvable. Sans requalification en véhicule de fonction (ci-dessous), le risque est
                élevé : abus de biens sociaux (jusqu'à 5 ans d'emprisonnement, 375 000 € d'amende) et remise en cause
                totale de la déductibilité (acte anormal de gestion).
              </p>
            )}
            {inputs.privateUsePercent >= 90 && inputs.privateUsePercent < 100 && (
              <p className="warning-block warning-block--danger">
                ⚠️ Usage privé très majoritaire (≥90%) : l'usage professionnel résiduel ne suffit plus à justifier le
                véhicule comme simple outil de travail. La voie à sécuriser est celle du véhicule de fonction
                (ci-dessous).
              </p>
            )}
            {inputs.privateUsePercent >= 80 && inputs.privateUsePercent < 90 && (
              <p className="warning-block">
                Usage privé élevé (≥80%) : documentez précisément l'usage professionnel réel, et envisagez la
                qualification en véhicule de fonction pour sécuriser la part privée (ci-dessous).
              </p>
            )}
            {inputs.privateUsePercent >= 80 && (
              <div className="warning-block warning-block--info">
                <strong>✅ Sécuriser un usage privé élevé : la piste du « véhicule de fonction »</strong>
                <p>
                  Avec peu ou pas de déplacements professionnels, ne cherchez pas à justifier un besoin pro inexistant :
                  la bonne qualification juridique est le <strong>véhicule de fonction</strong>, c'est-à-dire un{" "}
                  <strong>élément de rémunération</strong>. Sa déductibilité repose alors sur l'art. 39-1-1° CGI
                  (rémunérations déductibles, <em>y compris les avantages en nature</em>), et non sur un usage
                  professionnel. Un usage privé, même exclusif, est alors parfaitement admis.
                </p>
                <ol className="detail-list checklist">
                  <li>
                    <strong>Formaliser par une décision d'organe social</strong> — le point le plus important, avant même
                    le carnet de bord. SASU/EURL : mention au registre des décisions de l'associé unique. SAS/SARL :
                    convention réglementée (art. L227-10 / L223-19 c. com.) votée par les associés. Y qualifier
                    explicitement le véhicule d'élément de rémunération, avec usage privé autorisé sans restriction.
                    <details className="checklist__more">
                      <summary>Voir la procédure applicable à votre structure</summary>
                      <div className="checklist__more-body">
                        <p>
                          Structure saisie : <strong>{companyTypeConfig?.label ?? inputs.companyType}</strong> —{" "}
                          {inputs.companyType === "SASU" || inputs.companyType === "EURL" ? (
                            <>
                              la procédure des conventions réglementées ne s'applique pas lorsque l'associé unique est
                              aussi le dirigeant, mais la convention doit être{" "}
                              <strong>mentionnée au registre des décisions de l'associé unique</strong>. C'est cette
                              mention qui matérialise la volonté de l'organe social, exigée par la jurisprudence
                              Collectivision.
                            </>
                          ) : (
                            <>
                              convention réglementée au sens des art. L227-10 (SAS) / L223-19 (SARL) c. com. : la
                              convention doit être <strong>déclarée puis soumise au vote des associés</strong>, le
                              dirigeant intéressé ne prenant pas part au vote en SARL.
                            </>
                          )}
                        </p>
                        <p>Mentions à faire figurer, au minimum :</p>
                        <ul className="detail-list">
                          <li>mise à disposition permanente, sans obligation de restitution ;</li>
                          <li>usage privé expressément autorisé et sans restriction ;</li>
                          <li>
                            qualification explicite d'<strong>élément de rémunération</strong> — c'est cette mention qui
                            fonde la déductibilité sur l'art. 39-1-1° CGI plutôt que sur un besoin professionnel ;
                          </li>
                          <li>
                            méthode d'évaluation de l'AEN retenue (ici : méthode réelle
                            {dirigeantStatus === "TNS" ? ", obligatoire pour un gérant majoritaire TNS" : ""}) ;
                          </li>
                          <li>
                            le cas échéant, la participation financière du dirigeant et sa modalité de versement (
                            {PARTICIPATION_VERSEMENT_LABELS[inputs.modeVersementParticipation].toLowerCase()}), qui
                            conditionne la récupération de TVA.
                          </li>
                        </ul>
                        <p>
                          À défaut : responsabilité personnelle du dirigeant sur les conséquences dommageables de la
                          convention, et risque de requalification en distribution déguisée — la somme est alors taxée
                          en revenus de capitaux mobiliers, sans l'abattement de 10 % des salaires.
                        </p>
                      </div>
                    </details>
                  </li>
                  <li>
                    <strong>Déclarer l'AEN à 100% de l'usage privé réel</strong>, sans minoration. Payer les cotisations
                    sur cet AEN n'est pas un coût subi : c'est ce qui transforme une dépense suspecte en rémunération
                    régulière. Déclarer un AEN partiel sans km pro documenté est la principale incohérence relevée en
                    contrôle.
                    <details className="checklist__more">
                      <summary>Voir l'AEN calculé sur vos valeurs</summary>
                      <div className="checklist__more-body">
                        <ul className="detail-list">
                          <li>
                            Base réelle annuelle du véhicule : <strong>{formatEUR(results.aenBaseAnnualCosts)}</strong>{" "}
                            (
                            {inputs.financingMode === "comptant" || inputs.financingMode === "credit"
                              ? "amortissement + assurance + entretien"
                              : "30 % du coût de location + assurance + entretien"}
                            )
                          </li>
                          <li>
                            × {inputs.privateUsePercent} % d'usage privé → AEN brut :{" "}
                            <strong>{formatEUR(results.aenBrut)}</strong>
                          </li>
                          {results.abattement > 0 && (
                            <li>
                              − abattement véhicule électrique : {formatEUR(results.abattement)} (plafonné à 2 026,30 €)
                            </li>
                          )}
                          {results.participationAnnual > 0 && (
                            <li>− participation financière versée : {formatEUR(results.participationAnnual)}</li>
                          )}
                          <li>
                            = <strong>AEN net déclaré : {formatEUR(results.aenNet)}</strong> → cotisations{" "}
                            {formatEUR(results.cotisationsTNS)} + IR {formatEUR(results.irEstimee)} ={" "}
                            <strong>{formatEUR(results.cotisationsTNS + results.irEstimee)}/an</strong> à la charge du
                            dirigeant
                          </li>
                        </ul>
                        <p>
                          C'est ce montant qui « achète » la régularité du montage. Le sous-déclarer pour l'économiser
                          est exactement ce qui fait basculer l'usage privé non déclaré vers l'abus de biens sociaux —
                          l'infraction supposant une dissimulation, et non l'usage privé en lui-même.
                        </p>
                        {inputs.privateUsePercent < 100 && (
                          <p className="warning-inline">
                            Vous déclarez {inputs.privateUsePercent} % d'usage privé, donc{" "}
                            {Math.round(results.proKmAnnual).toLocaleString("fr-FR")} km professionnels par an : ils
                            doivent être justifiables
                            individuellement (destination, date, motif). À défaut, retenez 100 %.
                          </p>
                        )}
                      </div>
                    </details>
                  </li>
                  <li>
                    <strong>Vérifier que la rémunération globale (salaire + AEN) n'est pas excessive</strong> au regard
                    du service rendu, du secteur et du bénéfice de la société — c'est le risque résiduel principal, avec
                    une double peine à la clé (réintégration au résultat + taxation en revenus de capitaux mobiliers).
                    <details className="checklist__more" open>
                      <summary>Voir les indicateurs calculés sur vos valeurs</summary>
                      <div className="checklist__more-body">
                        {salaireDirigeantAnnuel <= 0 ? (
                          <p className="warning-inline">
                            Aucun salaire de dirigeant n'est saisi (section « Situation personnelle du dirigeant »).
                            Renseignez-le pour que ces indicateurs soient calculables : un AEN véhicule de{" "}
                            {formatEUR(results.aenBrut)}/an constituerait sinon la totalité de la rémunération, ce qui
                            est le profil le plus exposé en contrôle.
                          </p>
                        ) : (
                          <>
                            <div className="stat-grid">
                              <StatCard
                                label="Rémunération globale annuelle"
                                value={formatEUR(remunerationGlobaleAnnuelle)}
                                sub={`${formatEUR(salaireDirigeantAnnuel)} de salaire + ${formatEUR(results.aenBrut)} d'AEN véhicule`}
                              />
                              <StatCard
                                label="Part de l'AEN véhicule"
                                value={formatPercent(partAenDansRemuneration)}
                                sub={
                                  partAenDansRemuneration > 0.3
                                    ? "Élevée — un avantage en nature qui pèse plus de 30 % de la rémunération attire l'attention"
                                    : "Proportion usuelle"
                                }
                                tone={partAenDansRemuneration > 0.3 ? "bad" : "good"}
                              />
                              <StatCard
                                label="Part du résultat avant rémunération absorbée"
                                value={formatPercent(partRemunerationDansBenefice)}
                                sub={`${formatEUR(remunerationGlobaleAnnuelle)} sur ${formatEUR(beneficeAvantRemuneration)} de résultat avant rémunération`}
                                tone={partRemunerationDansBenefice > 0.8 ? "bad" : "good"}
                              />
                            </div>
                            <p>
                              <strong>Comment lire ces chiffres.</strong> Il n'existe{" "}
                              <strong>aucun seuil légal chiffré</strong> : l'administration compare au cas par cas à la
                              rémunération de personnes occupant un emploi analogue (même secteur, même taille), au
                              rapport avec les bénéfices sociaux, aux salaires des autres membres du personnel et à la
                              qualification professionnelle. Ces ratios sont des signaux, pas des verdicts.
                            </p>
                            <ul className="detail-list">
                              <li>
                                <strong>Part de l'AEN</strong> — au-delà d'environ 30 %, la rémunération repose
                                majoritairement sur un avantage en nature plutôt que sur du numéraire, configuration
                                inhabituelle qui invite le vérificateur à regarder de près la réalité du travail fourni.
                              </li>
                              <li>
                                <strong>Part du résultat absorbée</strong> — au-delà d'environ 80 %, la société ne
                                dégage plus de bénéfice significatif après rémunération du dirigeant. C'est le profil le
                                plus fréquemment redressé : un AEN véhicule important sur une société à faible bénéfice.
                                {partRemunerationDansBenefice > 0.8 && (
                                  <>
                                    {" "}
                                    <span className="warning-inline">
                                      C'est votre cas ici — documentez soigneusement le travail effectif et comparez à
                                      des rémunérations de dirigeants de sociétés similaires.
                                    </span>
                                  </>
                                )}
                              </li>
                            </ul>
                            <p>
                              <strong>Si la fraction est jugée excessive</strong>, la double peine s'applique : elle est
                              réintégrée au résultat imposable de la société — au taux d'IS retenu ici, soit un surcoût
                              d'environ {formatPercent(inputs.corporateTaxRate)} du montant réintégré — <em>et</em>{" "}
                              taxée chez le dirigeant en revenus de capitaux mobiliers au lieu des traitements et
                              salaires, ce qui lui fait perdre l'abattement de 10 % pour frais professionnels.
                            </p>
                          </>
                        )}
                      </div>
                    </details>
                  </li>
                  <li>
                    <strong>Tenir un carnet de bord même sans usage pro</strong> : un registre montrant honnêtement
                    ~100% privé prouve la bonne foi et la cohérence avec l'AEN déclaré — bien mieux qu'un registre absent
                    ou gonflé.
                    <details className="checklist__more">
                      <summary>Voir ce que le registre doit montrer sur vos valeurs</summary>
                      <div className="checklist__more-body">
                        <ul className="detail-list">
                          <li>
                            Kilométrage total déclaré : <strong>{inputs.totalKmAnnual.toLocaleString("fr-FR")} km/an</strong>
                          </li>
                          <li>
                            dont privé : <strong>{Math.round(results.privateKmAnnual).toLocaleString("fr-FR")} km</strong>{" "}
                            · dont professionnel :{" "}
                            <strong>{Math.round(results.proKmAnnual).toLocaleString("fr-FR")} km</strong>
                          </li>
                        </ul>
                        <p>
                          Le registre doit reconstituer cette répartition, et elle seule : sa fonction n'est pas de
                          prouver un usage professionnel, mais d'établir que la répartition déclarée correspond à la
                          réalité. Un registre cohérent avec un AEN de {formatEUR(results.aenBrut)} vaut mieux qu'un
                          registre absent, qui laisse le vérificateur reconstituer lui-même la clé de répartition.
                        </p>
                        <p>
                          À consigner pour chaque trajet professionnel revendiqué : date, destination, motif, kilomètres.
                          Les relevés télématiques du véhicule, l'agenda et les notes de frais doivent raconter la même
                          histoire — c'est la cohérence entre pièces, plus que le registre pris isolément, qui emporte
                          la conviction.
                        </p>
                        {inputs.privateUsePercent >= 100 && (
                          <p>
                            Avec 100 % d'usage privé déclaré, aucun trajet professionnel n'est à justifier : le registre
                            se borne à confirmer l'absence d'usage professionnel, ce qui est parfaitement cohérent avec
                            la qualification de véhicule de fonction retenue ci-dessus.
                          </p>
                        )}
                      </div>
                    </details>
                  </li>
                </ol>
                <p>
                  Ce qui déclenche réellement les poursuites pour abus de biens sociaux, c'est l'usage privé{" "}
                  <em>non déclaré</em> : l'infraction suppose une <strong>mauvaise foi</strong>, exclue lorsque les faits
                  sont commis sans dissimulation et conformément à une convention prévoyant la contrepartie. La
                  protection, c'est la transparence formalisée — pas la discrétion.
                </p>
              </div>
            )}
            <RuleNote ruleId="risque-abus-biens-sociaux-usage-prive" />
            <RuleNote ruleId="vehicule-fonction-vs-vehicule-service" />
            <RuleNote ruleId="vehicule-fonction-formalisme-organe-social" />
            <RuleNote ruleId="remuneration-globale-non-excessive" />
            <RuleNote ruleId="coworking-deplacement-professionnel-vs-trajet-habituel" />
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
              <Field label="Taux d'IS normal (tranche &gt; 42 500€, si régime IS)">
                <ResetableNumberInput
                  step="0.01"
                  value={inputs.corporateTaxRate}
                  defaultValue={DEFAULT_CORPORATE_TAX_RATE}
                  formatDefault={(v) => formatPercent(v)}
                  onChange={(v) => update("corporateTaxRate", v)}
                />
              </Field>
            </div>
            <div className="grid grid--3">
              <Field
                label="Bénéfice imposable prévisionnel avant charges véhicule (€/an)"
                hint={
                  inputs.impositionSociete === "IS"
                    ? "Détermine l'économie d'impôt réelle (barème IS progressif, plafonnée par le bénéfice)."
                    : "Ajouté au revenu imposable du foyer (société translucide)."
                }
              >
                <NumberInput
                  value={inputs.beneficeAvantChargePrevisionnel}
                  onChange={(e) => update("beneficeAvantChargePrevisionnel", Number(e.target.value))}
                />
              </Field>
              {inputs.impositionSociete === "IS" && (
                <>
                  <Field label="CA prévisionnel (€/an)" hint="Informatif : condition d'éligibilité au taux réduit (CA < 10M€).">
                    <NumberInput
                      value={inputs.chiffreAffairesPrevisionnel}
                      onChange={(e) => update("chiffreAffairesPrevisionnel", Number(e.target.value))}
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
                </>
              )}
            </div>
            <RuleNote ruleId={dirigeantStatus === "TNS" ? "cotisations-tns-taux-global" : "cotisations-assimile-salarie-taux"} />
            <RuleNote ruleId="is-taux-normal" />
          </Section>

          <Section
            title="Situation personnelle du dirigeant (et du foyer)"
            subtitle="Permet de calculer précisément le taux marginal d'imposition (TMI) appliqué à l'avantage en nature."
          >
            <PersonalTaxProfileFields
              profile={inputs.personalTaxProfile}
              onChange={(profile) => update("personalTaxProfile", profile)}
              footerWhenCalcule={
                <>
                  <p className="hint-block">
                    Parts fiscales : <strong>{results.partsFiscales}</strong> · Quotient familial (revenu ÷ parts) :{" "}
                    <strong>{formatEUR(results.quotientFamilial)}</strong> · TMI de la tranche :{" "}
                    <strong>{formatPercent(results.tmiCalcule)}</strong> · Impôt du foyer après décote :{" "}
                    <strong>{formatEUR(results.impotFoyerApresDecote)}</strong>
                    {results.dansZoneDecote && (
                      <>
                        {" "}
                        · Taux marginal effectif retenu (zone de décote) :{" "}
                        <strong>{formatPercent(results.tauxMarginalEffectif)}</strong>
                      </>
                    )}
                  </p>
                  <p className="field__hint">
                    Le barème est une fonction en escalier : le taux marginal ne change que si le quotient familial
                    franchit une borne de tranche (
                    {IR_BAREME_2026.slice(0, -1)
                      .map((b) => formatEUR(b.upTo ?? 0))
                      .join(" · ")}
                    ). Un enfant de plus fait baisser le quotient mais pas forcément le taux, tant qu'il reste dans la
                    même tranche.
                  </p>
                  {inputs.impositionSociete === "IR" && (
                    <p className="field__hint">
                      Régime IR (société translucide) : le bénéfice prévisionnel de la société (
                      {formatEUR(inputs.beneficeAvantChargePrevisionnel)}) est ajouté au revenu imposable du foyer
                      ci-dessus pour déterminer le TMI réel.
                    </p>
                  )}
                  <RuleNote ruleId="ir-bareme-2026" />
                  <RuleNote ruleId="ir-abattement-10-salaires" />
                  <RuleNote ruleId="ir-decote" />
                </>
              }
            />
          </Section>

          <Section title="Optimisations">
            <div className="highlight-card">
              <h4 className="highlight-card__title">💶 Participation financière du dirigeant</h4>
              <p className="highlight-card__intro">
                Le levier le plus puissant du simulateur : la somme que le dirigeant verse chaque mois à la société pour
                l'usage privé du véhicule. Elle joue sur <strong>deux tableaux à la fois</strong> — elle réduit l'AEN
                imposable (donc les cotisations et l'IR du dirigeant), et depuis le 30/04/2025 elle peut ouvrir le droit
                à déduction de la TVA sur le véhicule si elle est facturée à un prix de marché.
              </p>
              <div className="grid grid--2">
                <Field label="Participation financière mensuelle (€/mois)">
                  <NumberInput
                    value={inputs.monthlyParticipation}
                    onChange={(e) => update("monthlyParticipation", Number(e.target.value))}
                  />
                </Field>
                <StatCard
                  label="Effet sur l'AEN net (mode société sélectionné)"
                  value={
                    results.participationReduitAen
                      ? `− ${formatEUR(Math.min(results.participationAnnual, results.aenNetBeforeParticipation))}/an`
                      : "aucun"
                  }
                  sub={
                    results.participationReduitAen
                      ? `AEN ${formatEUR(results.aenNetBeforeParticipation)} → ${formatEUR(results.aenNet)} · soit ${formatEUR(results.participationAnnual)}/an versés`
                      : `AEN maintenu à ${formatEUR(results.aenNet)} : une réduction de rémunération brute ne s'impute pas sur l'avantage en nature`
                  }
                  tone={results.participationAnnual > 0 && results.participationReduitAen ? "good" : "neutral"}
                />
              </div>

              <Field
                label="Comment le dirigeant s'acquitte-t-il de cette participation ?"
                hint="Toutes ces modalités sont admises comme contrepartie réelle par le rescrit BOI-RES-TVA-000161. Elles n'ont pas le même coût : voir la comparaison ci-dessous."
              >
                <select
                  value={inputs.modeVersementParticipation}
                  onChange={(e) => update("modeVersementParticipation", e.target.value as ParticipationVersementMode)}
                >
                  {PARTICIPATION_VERSEMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {PARTICIPATION_VERSEMENT_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Field>
              {inputs.monthlyParticipation > 0 && (
                <>
                  <p className="field__hint">
                    Coût réel de cette participation pour le dirigeant :{" "}
                    <strong>{formatEUR(results.coutParticipationDirigeant)}/an</strong> pour{" "}
                    {formatEUR(results.participationAnnual)}/an de contrepartie fournie à la société.
                    {inputs.modeVersementParticipation === "retenue_brute"
                      ? " En abandonnant de la rémunération brute, le dirigeant renonce à une somme avant cotisations et avant impôt : le versement lui coûte donc moins que sa valeur faciale. En contrepartie, ce sacrifice étant déjà porté par la rémunération amputée, il ne vient PAS en déduction de l'AEN, qui reste imposé pour sa valeur pleine — c'est souvent ce second effet qui l'emporte."
                      : " Cette modalité mobilise de l'argent ayant déjà supporté cotisations et impôt sur le revenu : le versement coûte sa valeur faciale, mais il vient en déduction de l'AEN, donc des cotisations et de l'IR dus dessus."}
                  </p>
                  <RuleNote ruleId="participation-financiere-deduction-aen" />
                  {results.economieModeVersementOptimal > 1 && (
                    <div className="optimum-line">
                      <span>
                        💡 Modalité la moins coûteuse :{" "}
                        <strong>{PARTICIPATION_VERSEMENT_LABELS[results.modeVersementOptimal]}</strong> — elle
                        économiserait {formatEUR(results.economieModeVersementOptimal)}/an à contrepartie identique.
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => update("modeVersementParticipation", results.modeVersementOptimal)}
                      >
                        Appliquer
                      </button>
                    </div>
                  )}
                  {inputs.modeVersementParticipation === "retenue_brute" && (
                    <>
                      <p className="warning-block">
                        ⚠️ Réduire la rémunération brute diminue aussi les droits sociaux qui en dépendent (retraite,
                        indemnités journalières, prévoyance) et doit être formalisé par une décision d'organe social, au
                        même titre que la mise à disposition du véhicule. À arbitrer avec votre expert-comptable : le
                        gain affiché ici est purement fiscal et social immédiat, il n'intègre pas la perte de droits
                        futurs.
                      </p>
                      <details className="checklist__more">
                        <summary>La réduction doit être décidée pour l'avenir — pourquoi c'est déterminant</summary>
                        <div className="checklist__more-body">
                          <p>
                            Le gain calculé ci-dessus suppose une <strong>réduction décidée pour l'avenir</strong> : la
                            rémunération future est abaissée par décision de l'organe social avant d'être due. Rien
                            n'étant dû, rien n'est cotisé ni imposé — c'est ce qui produit l'économie.
                          </p>
                          <p>
                            <strong>À ne pas confondre avec une renonciation après coup.</strong> Renoncer à encaisser
                            une rémunération déjà due ne produit pas le même effet : la Cour de cassation juge que{" "}
                            <strong>cette renonciation est inopposable à l'URSSAF</strong>, les cotisations restant dues
                            sur la somme à laquelle le dirigeant a renoncé. L'économie sociale disparaît alors, et
                            l'administration fiscale peut y voir une minoration artificielle de l'IS et de l'IR. Le
                            simulateur ne chiffre que la première voie ; si votre montage relève de la seconde, retenez
                            plutôt une modalité « sur ressources nettes », dont le coût est identique au montant versé.
                          </p>
                        </div>
                      </details>
                      <RuleNote ruleId="renonciation-remuneration-inopposable-urssaf" />
                    </>
                  )}
                  {inputs.modeVersementParticipation !== "retenue_brute" && (
                    <>
                      <label className="charge-line__toggle" style={{ marginTop: "0.6rem" }}>
                        <input
                          type="checkbox"
                          checked={inputs.compenserParticipationParAugmentationSalaire}
                          onChange={(e) => update("compenserParticipationParAugmentationSalaire", e.target.checked)}
                        />
                        <span>
                          Compenser la participation par une augmentation de rémunération (scénario société) —{" "}
                          <strong>montage à haut risque, voir l'avertissement</strong>
                        </span>
                      </label>
                      {inputs.compenserParticipationParAugmentationSalaire && (
                        <>
                          <div className="verdict verdict--bad">
                            <span className="verdict__label">Ce montage vous coûte</span>
                            <span className="verdict__value">+{formatEUR(surcoutCompensation)}/an</span>
                            <span className="verdict__sub">
                              {formatEUR(results.coutNetAugmentationParticipation)} de coût net d'augmentation pour
                              éviter {formatEUR(results.aenNetBeforeParticipation * (inputs.tnsContributionRate + results.tauxIRUtilise))} de
                              cotisations et d'IR. Il est <strong>perdant avant même</strong> de poser la question de sa
                              légalité.
                            </span>
                          </div>
                          <p className="warning-block warning-block--danger">
                            🚨 <strong>Et il est à haut risque juridique — à ne pas mettre en place sans avis d'un
                            avocat fiscaliste.</strong> Faire financer la participation par la société elle-même rend
                            l'opération <strong>circulaire</strong> : la rémunération majorée revient aussitôt sous forme
                            de participation, sans autre effet net que la disparition de l'avantage en nature. Trois
                            risques en découlent :
                          </p>
                          <ol className="detail-list">
                            <li>
                              <strong>Abus de droit fiscal.</strong> Depuis 2021, l'art. L64 A LPF permet d'écarter un
                              montage au but <em>principalement</em> fiscal — seuil abaissé qui vise exactement ce type
                              d'opération. Sur le fondement de l'art. L64 (but exclusivement fiscal), la majoration
                              atteint 80 %.
                            </li>
                            <li>
                              <strong>Requalification URSSAF.</strong> La déduction de l'AEN suppose un appauvrissement
                              réel du bénéficiaire. S'il est refinancé par la société, cet appauvrissement disparaît et
                              l'avantage peut être réintégré pour sa valeur pleine.
                            </li>
                            <li>
                              <strong>Perte de la déduction de TVA.</strong> Le rescrit exige la même réalité de la
                              contrepartie : elle tomberait avec elle.
                            </li>
                          </ol>
                          <p className="hint-block">
                            Chiffres du montage : la société verse{" "}
                            <strong>{formatEUR(results.augmentationBruteParticipation)}/an</strong> de coût chargé, soit{" "}
                            {formatEUR(results.coutNetAugmentationParticipation)}/an après économie d'impôt, pour ramener
                            le coût du dirigeant à {formatEUR(results.coutParticipationDirigeant)}/an.{" "}
                            <strong>Il est de surcroît perdant</strong> : ce coût excède les cotisations et l'IR que la
                            disparition de l'AEN permet d'éviter — le coût global consolidé augmente, comme le montre le
                            comparatif. Ce qui reste régulier, c'est une augmentation décidée pour ses propres motifs et
                            documentée comme telle : c'est sa <em>calibration</em> sur la participation, et leur
                            simultanéité, qui caractérisent le montage artificiel.
                          </p>
                          <RuleNote ruleId="risque-abus-droit-participation-compensee" />
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {!results.participationReduitAen ? (
                <p className="hint-block">
                  🎯 Aucune participation « optimale » à viser avec cette modalité : la réduction de rémunération brute
                  ne s'impute pas sur l'AEN, il n'existe donc pas de montant qui l'annulerait. L'optimum ci-dessous
                  réapparaît si vous choisissez une modalité prélevée sur des ressources nettes.
                </p>
              ) : (
              <div className="optimum-line">
                <span>
                  🎯 Participation optimale pour le mode{" "}
                  <strong>{FINANCING_LABELS[inputs.financingMode]}</strong> (celui retenu dans « Détail — société ») :{" "}
                  <strong>{formatEUR(results.participationOptimaleMensuelle)}/mois</strong> — le montant qui ramène
                  exactement l'AEN à 0. Chaque mode de financement ayant sa propre base d'AEN, cet optimum lui est
                  propre et ne vaut pas pour les autres lignes du comparatif.
                </span>
                {Math.abs(inputs.monthlyParticipation - results.participationOptimaleMensuelle) > 0.5 && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() =>
                      update("monthlyParticipation", Math.round(results.participationOptimaleMensuelle * 100) / 100)
                    }
                  >
                    Appliquer
                  </button>
                )}
              </div>
              )}
              {results.participationReduitAen && (
                <p className="field__hint">
                  En deçà, chaque euro versé économise cotisations + IR sur l'AEN (bien plus que l'impôt qu'il génère
                  côté société) : il reste des économies à prendre. Au-delà, l'AEN est déjà à 0 — l'euro supplémentaire
                  n'économise plus rien mais reste un <strong>produit imposable</strong> pour la société, et coûte en
                  plus la TVA collectée si l'option ci-dessous est activée. C'est donc un véritable optimum, pas un
                  plafond.
                </p>
              )}
              {results.participationReduitAen && inputs.monthlyParticipation > 0 && results.aenNet <= 0 && results.participationAnnual > results.aenNetBeforeParticipation + 6 && (
                <p className="warning-block">
                  ⚠️ La participation dépasse l'optimum de{" "}
                  {formatEUR(results.participationAnnual - results.aenNetBeforeParticipation)}/an. Cet excédent
                  n'apporte plus aucune économie de cotisations et augmente le coût global. Il ne se justifie que s'il
                  est nécessaire pour atteindre un prix de marché crédible et sécuriser la déduction de TVA ci-dessous.
                </p>
              )}

              <div className="eligibility-box">
                <strong>Puis-je activer la récupération de TVA ? — les 4 conditions</strong>
                <ol className="detail-list">
                  <li>
                    <strong>La société est redevable de la TVA.</strong> Une société en franchise en base, ou dont
                    l'activité est exonérée (médical, assurance…), ne récupère rien quelle que soit la participation.
                  </li>
                  <li>
                    <strong>Le dirigeant verse une contrepartie réelle</strong> — paiement effectif, retenue sur salaire
                    brut ou net, ou renoncement à un avantage contractuel convertible en rémunération.{" "}
                    <em>
                      ⚠️ Déclarer un avantage en nature sur le bulletin de paie ne suffit PAS : le rescrit exige que le
                      bénéficiaire s'appauvrisse réellement. C'est l'erreur la plus fréquente.
                    </em>
                  </li>
                  <li>
                    <strong>Le montant n'est pas symbolique</strong> et se rapproche du prix de marché — voir la
                    référence calculée ci-dessous.
                  </li>
                  <li>
                    <strong>L'opération est facturée et déclarée</strong> : facture avec TVA à chaque échéance, TVA
                    collectée reportée sur les déclarations. À cadrer avec votre expert-comptable.
                  </li>
                </ol>
                {loyerReferenceMensuel > 0 && (
                  <p className={`market-price market-price--${participationStatus}`}>
                    📊 Référence de prix de marché pour ce véhicule :{" "}
                    <strong>{formatEUR(prixMarcheParticipation)}/mois</strong> — soit le loyer mensuel d'une offre
                    locative constructeur ({formatEUR(loyerReferenceMensuel)}) au prorata de l'usage privé (
                    {inputs.privateUsePercent} %). Participation actuellement saisie :{" "}
                    <strong>{formatEUR(inputs.monthlyParticipation)}/mois</strong>
                    {participationStatus === "ok" && " — cohérent avec cette référence."}
                    {participationStatus === "low" &&
                      " — nettement en dessous : le caractère non symbolique serait difficile à défendre."}
                    {participationStatus === "none" && " — aucune contrepartie, le dispositif ne peut pas s'appliquer."}
                  </p>
                )}
                {prixMarcheParticipation > results.participationOptimaleMensuelle + 1 &&
                  results.participationOptimaleMensuelle > 0 && (
                    <p className="field__hint">
                      ⚖️ Arbitrage à connaître : le prix de marché ({formatEUR(prixMarcheParticipation)}/mois) est
                      supérieur à la participation optimale au sens de l'AEN (
                      {formatEUR(results.participationOptimaleMensuelle)}/mois). Sécuriser la TVA suppose donc de verser
                      plus que l'optimum fiscal de l'AEN — l'outil chiffre les deux effets, comparez le coût global avec
                      et sans l'option activée.
                    </p>
                  )}
              </div>

              <label className="charge-line__toggle" style={{ marginTop: "0.75rem" }}>
                <input
                  type="checkbox"
                  checked={inputs.tvaRecuperableVehicule}
                  onChange={(e) => update("tvaRecuperableVehicule", e.target.checked)}
                />
                <span>
                  Participation facturée au prix de marché → récupérer la TVA sur le véhicule (scénario société)
                </span>
              </label>
              {inputs.tvaRecuperableVehicule && (
                <>
                  <div className="grid grid--2" style={{ marginTop: "0.5rem" }}>
                    <Field label="Taux de TVA applicable">
                      <ResetableNumberInput
                        step="0.01"
                        value={inputs.tauxTVA}
                        defaultValue={DEFAULT_TVA_RATE}
                        formatDefault={(v) => formatPercent(v)}
                        onChange={(v) => update("tauxTVA", v)}
                      />
                    </Field>
                    <Field
                      label="Le prix d'achat contient-il de la TVA récupérable ?"
                      hint="Non pour un véhicule acheté à un particulier ou sous le régime de la marge : le prix ne porte alors aucune TVA déductible. Sans effet en LOA/LLD, dont les loyers sont toujours facturés avec TVA par le loueur."
                    >
                      <select
                        value={inputs.prixContientTvaRecuperable ? "oui" : "non"}
                        onChange={(e) => update("prixContientTvaRecuperable", e.target.value === "oui")}
                      >
                        <option value="oui">Oui — véhicule neuf ou acheté à un professionnel assujetti</option>
                        <option value="non">Non — achat à un particulier ou régime de la marge</option>
                      </select>
                    </Field>
                    <StatCard
                      label="Position nette de TVA (mode société sélectionné)"
                      value={`${formatEUR(results.gainTvaNet)}/an`}
                      sub={
                        results.tvaEffectivementDeductible
                          ? `${formatEUR(results.tvaDeductible)} récupérés − ${formatEUR(results.tvaCollecteeSurParticipation)} collectés`
                          : "Option sans effet : aucune contrepartie versée"
                      }
                      tone={results.gainTvaNet > 0 ? "good" : "neutral"}
                    />
                  </div>
                  {!results.tvaEffectivementDeductible && (
                    <p className="warning-block warning-block--danger">
                      🚫 Option sans effet : aucune participation financière n'est saisie ci-dessus. Sans contrepartie
                      réelle versée par le dirigeant, la mise à disposition reste une opération à titre gratuit, donc{" "}
                      <strong>hors du champ de la TVA — aucun droit à déduction</strong>. Le calcul neutralise donc
                      l'option tant que la participation est nulle. Saisissez une participation cohérente avec le prix
                      du marché pour qu'elle produise son effet.
                    </p>
                  )}
                  <p className="hint-block">
                    Périmètre modélisé : TVA récupérée sur le véhicule (loyer LOA/LLD, ou amortissement annuel en
                    comptant/crédit — ce qui en restitue bien 100 % sur la durée d'amortissement) et sur l'entretien.
                    L'assurance en est exclue (opération exonérée de TVA, art. 261 C CGI), de même que les taxes
                    annuelles. En contrepartie, la société collecte la TVA sur la participation encaissée. N'affecte que
                    les options « Société » : un véhicule acheté par le dirigeant à titre personnel n'ouvre aucun droit à
                    déduction.
                  </p>
                </>
              )}
              <RuleNote ruleId="tva-vehicule-fonction-participation-financiere" />
            </div>

            <Field
              label="Barème IK de base (€/km) — scénario achat personnel"
              hint={inputs.isElectric ? `Majoré automatiquement de 20% (véhicule électrique) : ${results.effectiveIkRatePerKm.toFixed(3)} €/km retenu.` : undefined}
            >
              <ResetableNumberInput
                step="0.001"
                value={inputs.ikRatePerKm}
                defaultValue={DEFAULT_IK_RATE}
                onChange={(v) => update("ikRatePerKm", v)}
              />
            </Field>
            <RuleNote ruleId="ik-bareme-2026" />
            <RuleNote ruleId="coworking-deplacement-professionnel-vs-trajet-habituel" />

            <label className="charge-line__toggle" style={{ marginTop: "0.75rem" }}>
              <input
                type="checkbox"
                checked={inputs.compenserMensualiteParAugmentationSalaire}
                onChange={(e) => update("compenserMensualiteParAugmentationSalaire", e.target.checked)}
              />
              <span>Compenser la mensualité par une augmentation de salaire (scénario achat personnel)</span>
            </label>
            <p className="hint-block">
              Si activé, en plus des IK, la société verse au dirigeant une augmentation de salaire brute
              annuelle égale à la mensualité de financement retenue pour l'achat personnel — chargée comme
              toute rémunération (cotisations sociales, économie d'impôt société sur la part déductible). Ce
              coût s'ajoute à celui des IK sur les options « Personnel », sans les remplacer. Le net
              réellement perçu par le dirigeant sur cette augmentation (après ses propres cotisations et son
              impôt sur le revenu) n'est pas déduit de son coût personnel affiché : ce montage n'est ici
              chiffré que du point de vue du coût supplémentaire pour la société.
            </p>
          </Section>

          <Section
            title="Mode d'acquisition du véhicule"
            subtitle="Paramètres communs, utilisés à la fois si la société achète le véhicule et si le dirigeant l'achète à titre personnel."
          >
            <RuleNote ruleId="taux-usure-credit-personnel" />
            <Field
              label="Taux de décote annuel estimé du véhicule"
              hint="Détermine la valeur résiduelle affichée en fin de période pour les options où le véhicule est possédé (comptant, crédit, LOA avec option d'achat levée) — nulle en LLD ou en LOA sans option, le véhicule étant restitué."
            >
              <ResetableNumberInput
                step="0.01"
                value={inputs.tauxDeprecationAnnuel}
                defaultValue={DEFAULT_DEPRECIATION_RATE_ANNUAL}
                formatDefault={(v) => formatPercent(v)}
                onChange={(v) => update("tauxDeprecationAnnuel", v)}
              />
            </Field>
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
                <p className="field__hint">
                  Le coût du comptant inclut ce coût d'opportunité sur la <strong>totalité du prix</strong>, pendant{" "}
                  <strong>toute la durée de détention</strong> (le capital n'est récupéré qu'à la revente, en une fois, en fin
                  de période — déjà déduite ci-dessous de la valeur résiduelle). À l'inverse, sur un crédit, les intérêts ne
                  portent que sur le capital restant dû, qui diminue chaque mois. Résultat : même avec un TAEG supérieur au
                  taux d'opportunité (comme ici, 4 % vs 3 % par défaut), le crédit peut ressortir moins cher que le comptant —
                  ce n'est pas une erreur, c'est l'effet mécanique d'un capital immobilisé en totalité (comptant) comparé à un
                  capital restant dû dégressif (crédit).
                </p>
              </div>

              <div className="financing-card">
                <h4>Crédit</h4>
                <Field label="Apport (€)">
                  <NumberInput
                    value={inputs.financing.credit.apport}
                    onChange={(e) => updateFinancing("credit", { apport: Number(e.target.value) })}
                  />
                </Field>
                <Field
                  label="TAEG (%/an)"
                  hint={`Plafonné automatiquement au taux d'usure applicable : ${formatPercent(
                    getTauxUsureApplicable(Math.max(0, inputs.financing.credit.prixTTC - inputs.financing.credit.apport)),
                    2,
                  )} pour ce montant emprunté.`}
                >
                  <NumberInput
                    step="0.001"
                    value={inputs.financing.credit.tauxAnnuel}
                    onChange={(e) => handleCreditTauxChange(Number(e.target.value))}
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
                <Field
                  label="Loyer « tout compris » (entretien et assurance inclus) ?"
                  hint="Si oui, le simulateur neutralise assurance et entretien POUR CE SEUL MODE, afin de ne pas les compter deux fois. Les montants saisis dans « Charges annuelles réelles » restent utilisés par les modes comptant, crédit et LOA."
                >
                  <select
                    value={inputs.financing.lld.toutComprisEntretienAssurance ? "oui" : "non"}
                    onChange={(e) => updateFinancing("lld", { toutComprisEntretienAssurance: e.target.value === "oui" })}
                  >
                    <option value="non">Non — loyer nu, assurance et entretien en plus</option>
                    <option value="oui">Oui — assurance et entretien inclus dans le loyer</option>
                  </select>
                </Field>
                {lldToutCompris && !inputs.financing.lld.toutComprisEntretienAssurance && (
                  <p className="warning-block">
                    ⚠️ L'offre constructeur de ce modèle est « tout compris ». En laissant « Non » ci-dessus, assurance
                    et entretien seront comptés en plus du loyer, donc en double.
                  </p>
                )}
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
              {perspective === "poche" ? "Option la moins coûteuse pour votre poche" : "Option la moins coûteuse au global"}{" "}
              : {best.label} — {formatEUR(toPeriod(coutSelonPerspective(best)))}
              {PERIOD_SUFFIX[costPeriod]}
            </strong>
            <span>
              {perspective === "poche"
                ? `Ce que vous payez vous-même, plus ce que paie la société valorisé à ${formatPercent(1 - inputs.tauxExtractionResultat)} de son montant — net de son coût de sortie vers votre patrimoine.`
                : "Coût consolidé (société + dirigeant), toutes charges, cotisations et économies d'impôt comprises."}
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
            <div className="compare-toolbar">
              <Field label="Trier par">
                <select value={sortCriterion} onChange={(e) => setSortCriterion(e.target.value as SortCriterion)}>
                  {(Object.keys(SORT_LABELS) as SortCriterion[]).map((c) => (
                    <option key={c} value={c}>
                      {SORT_LABELS[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="period-switch" role="group" aria-label="Point de vue retenu pour le coût">
                <button
                  type="button"
                  className={perspective === "consolide" ? "active" : ""}
                  onClick={() => setPerspective("consolide")}
                  title="Société et dirigeant à parité : un euro vaut un euro de chaque côté."
                >
                  Consolidé
                </button>
                <button
                  type="button"
                  className={perspective === "poche" ? "active" : ""}
                  onClick={() => setPerspective("poche")}
                  title="Les euros dépensés par la société sont valorisés au net de leur coût de sortie (PFU) : ils n'auraient rejoint votre poche qu'amputés de ce prélèvement."
                >
                  Poche du dirigeant
                </button>
              </div>
              <div className="period-switch" role="group" aria-label="Affichage annuel ou mensuel">
                <button
                  type="button"
                  className={costPeriod === "annuel" ? "active" : ""}
                  onClick={() => setCostPeriod("annuel")}
                >
                  Annuel
                </button>
                <button
                  type="button"
                  className={costPeriod === "mensuel" ? "active" : ""}
                  onClick={() => setCostPeriod("mensuel")}
                >
                  Mensuel
                </button>
              </div>
              <button
                type="button"
                className={`btn btn--ghost ${showResidualValue ? "btn--active" : ""}`}
                onClick={() => setShowResidualValue((v) => !v)}
                title="LLD : rien ne reste en fin de contrat. LOA (option levée), crédit, comptant : le dirigeant/la société devient propriétaire d'un véhicule dont la valeur a baissé avec le temps."
              >
                🚗💰 {showResidualValue ? "Masquer" : "Afficher"} la valeur résiduelle
              </button>
            </div>
            {perspective === "poche" ? (
              <div className="perspective-note">
                <p>
                  <strong>Un euro dépensé par la société ne vous coûte pas un euro.</strong> Cette richesse, pour
                  rejoindre votre patrimoine, aurait d'abord supporté son coût de sortie — {formatPercent(inputs.tauxExtractionResultat)}{" "}
                  de PFU sur des dividendes. Les charges logées dans la société sont donc valorisées ici à{" "}
                  {formatPercent(1 - inputs.tauxExtractionResultat)} de leur montant, tandis que ce que vous payez
                  vous-même compte pour sa valeur pleine. Ce point de vue est le bon si vous êtes seul associé et
                  destinez le résultat à votre patrimoine ; le point de vue consolidé l'est si le résultat reste
                  investi dans l'entreprise.
                </p>
                <Field label="Coût de sortie du résultat vers votre patrimoine">
                  <ResetableNumberInput
                    step="0.01"
                    value={inputs.tauxExtractionResultat}
                    defaultValue={DEFAULT_PFU_RATE}
                    formatDefault={(v) => formatPercent(v)}
                    onChange={(v) => update("tauxExtractionResultat", v)}
                  />
                </Field>
                <RuleNote ruleId="cout-sortie-resultat-pfu" />
                {results.bestOptionPocheDirigeant.label !== results.allOptions[0].label && (
                  <p className="warning-block">
                    ⚠️ Ce point de vue <strong>renverse le classement</strong> : « {results.allOptions[0].label} » reste
                    la meilleure option au coût consolidé, mais « {results.bestOptionPocheDirigeant.label} » l'emporte
                    du point de vue de votre poche. L'écart tient entièrement à la répartition entre société et
                    dirigeant, pas au coût réel du véhicule — arbitrez selon la destination que vous donnez au résultat.
                  </p>
                )}
              </div>
            ) : (
              <p className="field__hint">
                Point de vue consolidé : société et dirigeant à parité, un euro valant un euro de chaque côté. C'est
                l'hypothèse implicite de tout comparatif de ce type — elle suppose que le résultat de la société vous
                importe autant que votre trésorerie personnelle. Basculez sur « Poche du dirigeant » si vous destinez
                ce résultat à votre patrimoine : les charges portées par la société y sont alors valorisées nettes de
                leur coût de sortie, ce qui peut renverser le classement.
              </p>
            )}
            <table className="projection-table">
              <thead>
                <tr>
                  <th>Option</th>
                  <th>
                    {perspective === "poche" ? "Coût pour votre poche" : "Coût global"}{" "}
                    {costPeriod === "annuel" ? "annuel" : "mensuel"}
                  </th>
                  <th></th>
                  {showResidualValue && <th>Valeur résiduelle en fin de période</th>}
                </tr>
              </thead>
              <tbody>
                {[...results.allOptions]
                  .sort((a, b) => {
                    if (sortCriterion === "societe") return a.partSociete - b.partSociete;
                    if (sortCriterion === "personnel") return a.partDirigeant - b.partDirigeant;
                    return coutSelonPerspective(a) - coutSelonPerspective(b);
                  })
                  .map((opt, idx) => {
                    const meilleure =
                      perspective === "poche" ? results.bestOptionPocheDirigeant : results.allOptions[0];
                    const isGlobalBest = opt.label === meilleure.label;
                    const isExpanded = expandedOptions.has(opt.label);
                    return (
                      <Fragment key={opt.label}>
                        <tr
                          className={`option-row ${idx === 0 ? "row--selected" : ""}`}
                          onClick={() => toggleExpandedOption(opt.label)}
                        >
                          <td>
                            <span className="option-row__caret">{isExpanded ? "▾" : "▸"}</span>
                            {isGlobalBest && "🏆 "}
                            {opt.label}
                            <div className="option-breakdown">
                              dont société {formatEUR(toPeriod(opt.partSociete))} · dont dirigeant{" "}
                              {formatEUR(toPeriod(opt.partDirigeant))}
                            </div>
                          </td>
                          <td>{formatEUR(toPeriod(coutSelonPerspective(opt)))}</td>
                          <td>
                            {!isGlobalBest &&
                              `+${formatEUR(toPeriod(coutSelonPerspective(opt) - coutSelonPerspective(meilleure)))}`}
                          </td>
                          {showResidualValue && (
                            <td>
                              {opt.devientProprietaire ? (
                                <span className="residual-value residual-value--owned">
                                  🚗 {formatEUR(opt.valeurResiduelleEstimee)}
                                </span>
                              ) : (
                                <span className="residual-value residual-value--none">— rien (restitué)</span>
                              )}
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr className="option-detail-row">
                            <td colSpan={showResidualValue ? 4 : 3}>
                              <p className="field__hint">Détail du calcul (valeurs annuelles) :</p>
                              <ul className="detail-list">
                                {opt.detail.map((line) => (
                                  <li key={line.label}>
                                    {line.label} :{" "}
                                    {line.label.includes("(€/km)")
                                      ? `${line.value.toFixed(3)} €/km`
                                      : line.label.includes("Km ")
                                        ? `${line.value.toFixed(0)} km`
                                        : formatEUR(line.value)}
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
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
            {dirigeantStatus === "TNS" && inputs.isElectric && (
              <p className="field__hint">
                ℹ️ Abattement électrique plafonné à 50% de l'AEN (max. 2 026,30€) : c'est le plafond de la{" "}
                <strong>méthode réelle</strong>, seule autorisée pour un dirigeant TNS. L'abattement forfaitaire de
                70% (max. 4 641,60€) ne s'applique qu'à la méthode forfaitaire, elle-même interdite aux TNS — ce
                n'est donc pas une erreur si l'abattement affiché ci-dessous semble plus faible que ce chiffre.
              </p>
            )}
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
              {results.tvaEffectivementDeductible && (
                <li>
                  TVA récupérée (déjà déduite du décaissement ci-dessus) : {formatEUR(results.tvaDeductible)}, dont{" "}
                  {formatEUR(results.tvaDeductibleRecurrente)} sur le véhicule et l'entretien
                  {results.tvaOptionAchatAnnualisee > 0
                    ? ` et ${formatEUR(results.tvaOptionAchatAnnualisee)} sur la levée d'option d'achat lissée`
                    : ""}{" "}
                  — la TVA collectée sur la participation (
                  {formatEUR(results.tvaCollecteeSurParticipation)}) est reversée au Trésor et retirée de la
                  participation encaissée, qui n'est donc imposée que sur sa base HT
                </li>
              )}
              {inputs.tvaRecuperableVehicule && !results.tvaEffectivementDeductible && (
                <li className="warning-inline">
                  Option TVA cochée mais sans effet : aucune participation versée, donc aucun droit à déduction.
                </li>
              )}
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

          <Section
            title="Projection (coût global cumulé)"
            subtitle={
              results.anneeTransitionAmortissement !== null && inputs.projectionYears >= results.anneeTransitionAmortissement
                ? `L'amortissement du véhicule (si acheté) passe de 20% à 10%/an à partir de l'année ${results.anneeTransitionAmortissement} (véhicule >5 ans) — l'AEN et les coûts société baissent en conséquence à partir de cette année.`
                : undefined
            }
          >
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
                  <tr
                    key={p.year}
                    className={p.year === results.anneeTransitionAmortissement ? "row--selected" : undefined}
                  >
                    <td>
                      {p.year}
                      {p.year === results.anneeTransitionAmortissement ? " *" : ""}
                    </td>
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
              exportText={buildVehicleExportText}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
