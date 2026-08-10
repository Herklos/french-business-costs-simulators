// Vue consolidée multi-simulateurs.
//
// Agrège, pour un même dirigeant, le coût net GLOBAL annuel — société et dirigeant pris ENSEMBLE,
// après économies d'impôt de part et d'autre — de toutes les simulations sauvegardées sur les 5
// simulateurs "récurrents" (Véhicule, Bureau à domicile, Matériel, Mutuelle & prévoyance, Retraite).
//
// Rémunération et Holding sont volontairement EXCLUS du total : ce ne sont pas des "coûts"
// additionnels au même sens que les 5 précédents.
//  - Rémunération est le mécanisme de revenu de base du dirigeant (pas une charge qui s'ajoute aux
//    autres — sommer son "coût" avec celui d'une voiture de société n'aurait pas de sens).
//  - Holding est un montage de capitalisation pluriannuel, pas une charge récurrente annuelle.
// Ces deux simulateurs restent listés séparément, à titre informatif, avec leur métrique la plus
// représentative.
//
// Chaque simulateur définit son propre "coût net global annuel" à partir de champs déjà exposés par
// son moteur de calcul (voir le détail par simulateur ci-dessous) — aucune nouvelle hypothèse de
// calcul n'est introduite ici, ce module ne fait qu'agréger.

import { listSimulations, type SimulatorKind } from "./storage";
import { computeSimulation, type SimulationInputs } from "./simulator";
import { computeHomeOffice, type HomeOfficeInputs } from "./homeOffice";
import { computeMateriel, type MaterielInputs } from "./materiel";
import { computeMutuellePrevoyance, type MutuellePrevoyanceInputs } from "./mutuellePrevoyance";
import { computeRetraite, type RetraiteInputs } from "./retraite";
import { computeRemuneration, type RemunerationInputs } from "./remuneration";
import { computeHolding, type HoldingInputs } from "./holding";

/** Les 5 simulateurs dont le coût net annuel est additionné dans le total consolidé. */
export type RecurringSimulatorKind = "vehicle" | "homeOffice" | "materiel" | "mutuelle" | "retraite";

export const RECURRING_SIMULATOR_LABELS: Record<RecurringSimulatorKind, { icon: string; label: string }> = {
  vehicle: { icon: "🚗", label: "Véhicule de société" },
  homeOffice: { icon: "🏠", label: "Bureau à domicile" },
  materiel: { icon: "💻", label: "Matériel professionnel" },
  mutuelle: { icon: "🩺", label: "Mutuelle & prévoyance" },
  retraite: { icon: "🏦", label: "Épargne retraite" },
};

export interface ConsolidatedCostLine {
  kind: RecurringSimulatorKind;
  simulationId: string;
  simulationName: string;
  coutNetGlobalAnnuel: number;
  savedAt: string;
}

export const INFO_SIMULATOR_LABELS: Record<"remuneration" | "holding", { icon: string; label: string }> = {
  remuneration: { icon: "💰", label: "Rémunération du dirigeant" },
  holding: { icon: "🏛️", label: "Holding / montage patrimonial" },
};

export interface ConsolidatedInfoLine {
  kind: "remuneration" | "holding";
  simulationId: string;
  simulationName: string;
  metricLabel: string;
  metricValue: number;
  savedAt: string;
}

export interface ConsolidatedView {
  costLines: ConsolidatedCostLine[];
  totalCoutNetGlobalAnnuel: number;
  infoLines: ConsolidatedInfoLine[];
}

/** Construit la vue consolidée à partir de toutes les simulations sauvegardées en localStorage. */
export function computeConsolidatedView(): ConsolidatedView {
  const costLines: ConsolidatedCostLine[] = [];

  // Véhicule : le simulateur compare 8 combinaisons {société|personnel}×{comptant|crédit|LOA|LLD} —
  // on retient la "meilleure option" déjà identifiée par le simulateur (r.bestOption), qui est déjà
  // un coût combiné société+dirigeant (globalCostAnnual = partSociete + partDirigeant).
  for (const s of listSimulations<SimulationInputs>("vehicle")) {
    const r = computeSimulation(s.inputs);
    costLines.push({
      kind: "vehicle",
      simulationId: s.inputs.id,
      simulationName: s.inputs.name,
      coutNetGlobalAnnuel: r.bestOption.globalCostAnnual,
      savedAt: s.savedAt,
    });
  }

  for (const s of listSimulations<HomeOfficeInputs>("homeOffice")) {
    const r = computeHomeOffice(s.inputs);
    costLines.push({
      kind: "homeOffice",
      simulationId: s.inputs.id,
      simulationName: s.inputs.name,
      coutNetGlobalAnnuel: r.coutNetGlobal,
      savedAt: s.savedAt,
    });
  }

  for (const s of listSimulations<MaterielInputs>("materiel")) {
    const r = computeMateriel(s.inputs);
    costLines.push({
      kind: "materiel",
      simulationId: s.inputs.id,
      simulationName: s.inputs.name,
      coutNetGlobalAnnuel: r.coutNetGlobalAnnee1,
      savedAt: s.savedAt,
    });
  }

  for (const s of listSimulations<MutuellePrevoyanceInputs>("mutuelle")) {
    const r = computeMutuellePrevoyance(s.inputs);
    costLines.push({
      kind: "mutuelle",
      simulationId: s.inputs.id,
      simulationName: s.inputs.name,
      coutNetGlobalAnnuel: r.coutNetGlobal,
      savedAt: s.savedAt,
    });
  }

  for (const s of listSimulations<RetraiteInputs>("retraite")) {
    const r = computeRetraite(s.inputs);
    costLines.push({
      kind: "retraite",
      simulationId: s.inputs.id,
      simulationName: s.inputs.name,
      coutNetGlobalAnnuel: r.coutNetGlobal,
      savedAt: s.savedAt,
    });
  }

  const totalCoutNetGlobalAnnuel = costLines.reduce((sum, l) => sum + l.coutNetGlobalAnnuel, 0);

  const infoLines: ConsolidatedInfoLine[] = [];

  for (const s of listSimulations<RemunerationInputs>("remuneration")) {
    const r = computeRemuneration(s.inputs);
    infoLines.push({
      kind: "remuneration",
      simulationId: s.inputs.id,
      simulationName: s.inputs.name,
      metricLabel: "Coût total entreprise (budget alloué, identique pour tous les scénarios)",
      metricValue: r.meilleurScenario.coutTotalEntreprise,
      savedAt: s.savedAt,
    });
  }

  for (const s of listSimulations<HoldingInputs>("holding")) {
    const r = computeHolding(s.inputs);
    infoLines.push({
      kind: "holding",
      simulationId: s.inputs.id,
      simulationName: s.inputs.name,
      metricLabel: "Coût IS de la remontée de dividendes (année 1)",
      metricValue: r.coutISAnnee1,
      savedAt: s.savedAt,
    });
  }

  return { costLines, totalCoutNetGlobalAnnuel, infoLines };
}

/** Mappe un SimulatorKind (registre storage.ts) vers le kind restreint utilisé par ce module. */
export function isRecurringKind(kind: SimulatorKind): kind is RecurringSimulatorKind {
  return kind === "vehicle" || kind === "homeOffice" || kind === "materiel" || kind === "mutuelle" || kind === "retraite";
}
