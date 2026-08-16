import { Fragment, useState } from "react";
import type { GlobalOption, SimulationResults } from "../lib/simulator";
import type { FinancingMode } from "../lib/financing";
import { formatEUR, formatPercent } from "../lib/format";
import { Field, ResetableNumberInput } from "./Field";
import { RuleNote } from "./RuleNote";

export type SortCriterion = "global" | "societe" | "personnel";
export type CostPeriod = "annuel" | "mensuel";
/**
 * Point de vue retenu pour lire le comparatif.
 * — « consolide » : société et dirigeant à parité, un euro valant un euro de chaque côté ;
 * — « poche » : les euros dépensés par la société sont valorisés au net de leur coût de sortie
 *   (PFU), puisqu'ils n'auraient rejoint le patrimoine du dirigeant qu'amputés de ce prélèvement.
 */
export type Perspective = "consolide" | "poche";

const SORT_LABELS: Record<SortCriterion, string> = {
  global: "Coût le plus bas (recommandé)",
  societe: "Ce que paie la société",
  personnel: "Ce que paie le dirigeant",
};

const OWNER_BADGE: Record<GlobalOption["owner"], { icone: string; texte: string }> = {
  societe: { icone: "🏢", texte: "Société" },
  personnel: { icone: "👤", texte: "Perso" },
};

/** Met en forme une ligne de détail, dont l'unité dépend du libellé. */
function formatLigneDetail(label: string, value: number): string {
  if (label.includes("(€/km)")) return `${value.toFixed(3)} €/km`;
  if (label.includes("Km ")) return `${value.toFixed(0)} km`;
  return formatEUR(value);
}

/**
 * Une ligne de détail introduit une nouvelle rubrique lorsqu'elle commence par « = » (total
 * intermédiaire) : on s'en sert pour aérer une liste autrement indifférenciée de quinze postes.
 */
function estTotalIntermediaire(label: string): boolean {
  return label.trimStart().startsWith("=");
}

export interface OptionsComparisonProps {
  results: SimulationResults;
  tauxExtractionResultat: number;
  tauxExtractionDefaut: number;
  onTauxExtractionChange: (taux: number) => void;
  /** Modes actuellement retenus pour les panneaux de détail, mis en évidence dans le tableau. */
  financingMode: FinancingMode;
  personalFinancingMode: FinancingMode;
  perspective: Perspective;
  onPerspectiveChange: (p: Perspective) => void;
  costPeriod: CostPeriod;
  onCostPeriodChange: (p: CostPeriod) => void;
}

export function OptionsComparison({
  results,
  tauxExtractionResultat,
  tauxExtractionDefaut,
  onTauxExtractionChange,
  financingMode,
  personalFinancingMode,
  perspective,
  onPerspectiveChange,
  costPeriod,
  onCostPeriodChange,
}: OptionsComparisonProps) {
  const [sortCriterion, setSortCriterion] = useState<SortCriterion>("global");
  const [expandedOptions, setExpandedOptions] = useState<Set<string>>(new Set());
  const [showResidualValue, setShowResidualValue] = useState(false);

  const toPeriod = (annualValue: number) => (costPeriod === "mensuel" ? annualValue / 12 : annualValue);
  const cout = (o: GlobalOption) => (perspective === "poche" ? o.coutPocheDirigeant : o.globalCostAnnual);

  function toggleExpandedOption(label: string) {
    setExpandedOptions((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const meilleure = perspective === "poche" ? results.bestOptionPocheDirigeant : results.allOptions[0];
  const classement = [...results.allOptions].sort((a, b) => {
    if (sortCriterion === "societe") return a.partSociete - b.partSociete;
    if (sortCriterion === "personnel") return a.partDirigeant - b.partDirigeant;
    return cout(a) - cout(b);
  });
  // Échelle commune des barres : l'option la plus chère occupe toute la largeur, ce qui rend les
  // écarts lisibles d'un coup d'œil sans avoir à comparer des nombres entre eux.
  const coutMax = Math.max(...results.allOptions.map(cout), 1);
  const classementDiverge = results.bestOptionPocheDirigeant.label !== results.allOptions[0].label;
  // Un coût annuel n'est comparable qu'à durée égale : étaler le même véhicule sur six ans plutôt
  // que cinq en réduit le montant annuel sans rien changer au coût réel. Les achats partagent
  // désormais la durée de détention ; les locations gardent leur terme contractuel, et c'est là que
  // l'écart subsiste — d'où l'avertissement, faute de pouvoir aligner ce qui ne l'est pas.
  const durees = [...new Set(results.allOptions.map((o) => Math.round(o.dureeAnnees * 10) / 10))]
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const dureesInegales = durees.length > 1;

  return (
    <>
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
        <div className="compare-toolbar__switches">
          <div className="switch-group">
            <span className="switch-group__label">Point de vue</span>
            <div className="period-switch" role="group" aria-label="Point de vue retenu pour le coût">
              <button
                type="button"
                className={perspective === "consolide" ? "active" : ""}
                onClick={() => onPerspectiveChange("consolide")}
                title="Société et dirigeant à parité : un euro vaut un euro de chaque côté."
              >
                Consolidé
              </button>
              <button
                type="button"
                className={perspective === "poche" ? "active" : ""}
                onClick={() => onPerspectiveChange("poche")}
                title="Les euros dépensés par la société sont valorisés au net de leur coût de sortie (PFU)."
              >
                Ma poche
              </button>
            </div>
          </div>
          <div className="switch-group">
            <span className="switch-group__label">Période</span>
            <div className="period-switch" role="group" aria-label="Affichage annuel ou mensuel">
              <button
                type="button"
                className={costPeriod === "annuel" ? "active" : ""}
                onClick={() => onCostPeriodChange("annuel")}
              >
                Annuel
              </button>
              <button
                type="button"
                className={costPeriod === "mensuel" ? "active" : ""}
                onClick={() => onCostPeriodChange("mensuel")}
              >
                Mensuel
              </button>
            </div>
          </div>
          <div className="switch-group">
            <span className="switch-group__label">Colonne</span>
            <button
              type="button"
              className={`btn btn--ghost ${showResidualValue ? "btn--active" : ""}`}
              onClick={() => setShowResidualValue((v) => !v)}
              title="LLD : rien ne reste en fin de contrat. LOA (option levée), crédit, comptant : le véhicule reste acquis, avec une valeur qui a baissé."
            >
              🚗💰 Valeur résiduelle
            </button>
          </div>
        </div>
      </div>

      {/* Le point de vue conditionne la lecture de tous les chiffres : son explication reste
          accessible en permanence, mais repliée pour ne pas repousser le tableau hors de l'écran. */}
      <details className="perspective-details" open={perspective === "poche" && classementDiverge}>
        <summary>
          {perspective === "poche"
            ? `Vos euros et ceux de la société ne se valent pas — sortie valorisée à ${formatPercent(tauxExtractionResultat)}`
            : "Point de vue consolidé : un euro société = un euro en poche"}
        </summary>
        <div className="perspective-details__body">
          {perspective === "poche" ? (
            <>
              <p>
                <strong>Un euro dépensé par la société ne vous coûte pas un euro.</strong> Cette richesse, pour
                rejoindre votre patrimoine, aurait d'abord supporté son coût de sortie —{" "}
                {formatPercent(tauxExtractionResultat)} de PFU sur des dividendes. Les charges logées dans la société
                sont donc valorisées ici à {formatPercent(1 - tauxExtractionResultat)} de leur montant, tandis que ce
                que vous payez vous-même compte pour sa valeur pleine. Ce point de vue est le bon si vous êtes seul
                associé et destinez le résultat à votre patrimoine ; le consolidé l'est si le résultat reste investi
                dans l'entreprise.
              </p>
              <Field label="Coût de sortie du résultat vers votre patrimoine">
                <ResetableNumberInput
                  step="0.01"
                  value={tauxExtractionResultat}
                  defaultValue={tauxExtractionDefaut}
                  formatDefault={(v) => formatPercent(v)}
                  onChange={onTauxExtractionChange}
                />
              </Field>
              <RuleNote ruleId="cout-sortie-resultat-pfu" />
            </>
          ) : (
            <p>
              Société et dirigeant à parité, un euro valant un euro de chaque côté. C'est l'hypothèse implicite de tout
              comparatif de ce type — elle suppose que le résultat de la société vous importe autant que votre
              trésorerie personnelle. Basculez sur « Ma poche » si vous destinez ce résultat à votre patrimoine : les
              charges portées par la société y sont alors valorisées nettes de leur coût de sortie, ce qui peut
              renverser le classement.
            </p>
          )}
        </div>
      </details>

      {classementDiverge && (
        <p className="warning-block">
          ⚠️ Les deux points de vue ne désignent pas le même gagnant : «{" "}
          <strong>{results.allOptions[0].label}</strong> » au coût consolidé, «{" "}
          <strong>{results.bestOptionPocheDirigeant.label}</strong> » pour votre poche. L'écart tient à la répartition
          entre les deux poches, pas au coût réel du véhicule — arbitrez selon la destination que vous donnez au
          résultat.
        </p>
      )}

      {dureesInegales && (
        <p className="warning-block">
          ⚠️ <strong>Toutes les options ne portent pas sur la même durée</strong> ({durees.map((d) => `${d} an${d > 1 ? "s" : ""}`).join(", ")}).
          Comptant et crédit décrivent le même véhicule conservé le même temps et sont ramenés à la durée de détention que
          vous avez saisie ; une location, elle, court sur son terme contractuel. Un coût annuel étalé sur six ans est
          mécaniquement plus faible que le même coût étalé sur cinq, sans que rien ne soit moins cher — alignez les durées
          de contrat sur la détention avant de conclure, ou lisez le classement en gardant l'écart à l'esprit.
        </p>
      )}

      <table className="projection-table compare-table">
        <thead>
          <tr>
            <th>Option</th>
            <th className="compare-table__num">
              {perspective === "poche" ? "Coût pour vous" : "Coût global"} {costPeriod === "annuel" ? "/an" : "/mois"}
            </th>
            <th className="compare-table__num">Écart</th>
            {showResidualValue && <th className="compare-table__num">Valeur résiduelle</th>}
          </tr>
        </thead>
        <tbody>
          {classement.map((opt) => {
            const isBest = opt.label === meilleure.label;
            const isExpanded = expandedOptions.has(opt.label);
            // Mode alimentant les panneaux de détail plus bas : le signaler évite de chercher
            // laquelle des huit lignes correspond aux chiffres détaillés qui suivent.
            const estAffichee =
              opt.owner === "societe" ? opt.mode === financingMode : opt.mode === personalFinancingMode;
            const total = Math.max(opt.partSociete + opt.partDirigeant, 1e-9);
            const partSocietePct = Math.max(0, Math.min(100, (opt.partSociete / total) * 100));
            const largeurBarre = Math.max(2, (cout(opt) / coutMax) * 100);
            const badge = OWNER_BADGE[opt.owner];
            return (
              <Fragment key={opt.label}>
                <tr
                  className={`option-row ${isBest ? "row--best" : ""} ${estAffichee ? "row--detaillee" : ""}`}
                  onClick={() => toggleExpandedOption(opt.label)}
                >
                  <td>
                    <div className="option-row__head">
                      <span className="option-row__caret">{isExpanded ? "▾" : "▸"}</span>
                      <span className={`owner-badge owner-badge--${opt.owner}`}>
                        {badge.icone} {badge.texte}
                      </span>
                      <span className="option-row__label">{opt.label.replace(/^.*— /, "")}</span>
                      {opt.dureeAnnees > 0 && (
                        <span
                          className="option-row__duree"
                          title="Durée sur laquelle le coût de cette option est ramené en €/an — durée de détention pour un achat, terme du contrat pour une location."
                        >
                          {(Math.round(opt.dureeAnnees * 10) / 10).toLocaleString("fr-FR")} ans
                        </span>
                      )}
                      {isBest && <span className="option-row__trophy" title="Meilleure option pour ce point de vue">🏆</span>}
                      {estAffichee && (
                        <span className="option-row__pin" title="Mode retenu pour les panneaux de détail plus bas" />
                      )}
                    </div>
                    {/* Barre proportionnelle : longueur = coût relatif, découpe = répartition
                        société / dirigeant. C'est la lecture que les chiffres seuls ne donnent pas. */}
                    <div className="cost-bar" style={{ width: `${largeurBarre}%` }} aria-hidden="true">
                      <span className="cost-bar__societe" style={{ width: `${partSocietePct}%` }} />
                      <span className="cost-bar__dirigeant" style={{ width: `${100 - partSocietePct}%` }} />
                    </div>
                    <div className="option-breakdown">
                      <span className="option-breakdown__societe">
                        Sté {formatEUR(toPeriod(opt.partSociete))}
                      </span>
                      <span className="option-breakdown__dirigeant">
                        Vous {formatEUR(toPeriod(opt.partDirigeant))}
                      </span>
                    </div>
                  </td>
                  <td className="compare-table__num compare-table__cost">{formatEUR(toPeriod(cout(opt)))}</td>
                  <td className="compare-table__num">
                    {isBest ? (
                      <span className="ecart ecart--best">référence</span>
                    ) : (
                      <span className="ecart">+{formatEUR(toPeriod(cout(opt) - cout(meilleure)))}</span>
                    )}
                  </td>
                  {showResidualValue && (
                    <td className="compare-table__num">
                      {opt.devientProprietaire ? (
                        <span className="residual-value residual-value--owned">
                          🚗 {formatEUR(opt.valeurResiduelleEstimee)}
                        </span>
                      ) : (
                        <span className="residual-value residual-value--none">— restitué</span>
                      )}
                    </td>
                  )}
                </tr>
                {isExpanded && (
                  <tr className="option-detail-row">
                    <td colSpan={showResidualValue ? 4 : 3}>
                      <p className="field__hint">Détail du calcul (valeurs annuelles) :</p>
                      <ul className="detail-list detail-list--calcul">
                        {opt.detail.map((line) => (
                          <li key={line.label} className={estTotalIntermediaire(line.label) ? "detail-list__total" : ""}>
                            <span className="detail-list__label">{line.label}</span>
                            <span className="detail-list__value">{formatLigneDetail(line.label, line.value)}</span>
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
    </>
  );
}
