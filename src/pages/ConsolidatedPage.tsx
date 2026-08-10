import { useMemo } from "react";
import type { Page } from "../App";
import {
  INFO_SIMULATOR_LABELS,
  RECURRING_SIMULATOR_LABELS,
  computeConsolidatedView,
} from "../lib/consolidated";
import { Section, StatCard } from "../components/Field";
import { formatDate, formatEUR } from "../lib/format";

const KIND_TO_PAGE: Record<string, Page> = {
  vehicle: "vehicle",
  homeOffice: "homeOffice",
  materiel: "materiel",
  mutuelle: "mutuelle",
  retraite: "retraite",
  remuneration: "remuneration",
  holding: "holding",
};

export function ConsolidatedPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const view = useMemo(() => computeConsolidatedView(), []);

  const hasAnything = view.costLines.length > 0 || view.infoLines.length > 0;

  return (
    <div className="page">
      <h2>📊 Vue consolidée</h2>
      <p className="page__intro">
        Rassemble toutes les simulations sauvegardées, tous simulateurs confondus, pour donner une vue
        d'ensemble du coût réel des décisions déjà chiffrées. Le total ci-dessous additionne le{" "}
        <strong>coût net global annuel</strong> — société et dirigeant pris ensemble, après économies
        d'impôt de part et d'autre — des 5 simulateurs "récurrents" (Véhicule, Bureau à domicile,
        Matériel, Mutuelle &amp; prévoyance, Retraite). Rémunération et Holding sont affichés à part :
        ce ne sont pas des coûts additionnels au même sens (la rémunération est le revenu de base du
        dirigeant, la holding un montage de capitalisation pluriannuel), donc volontairement exclus du
        total.
      </p>

      {!hasAnything ? (
        <p className="hint-block">
          Aucune simulation sauvegardée pour l'instant. Ouvrez un simulateur, ajustez vos hypothèses,
          puis cliquez sur « Sauvegarder cette simulation » pour qu'elle apparaisse ici.
        </p>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="Coût net global annuel total"
              value={formatEUR(view.totalCoutNetGlobalAnnuel)}
              sub={`${view.costLines.length} simulation(s) récurrente(s) sauvegardée(s)`}
              tone={view.totalCoutNetGlobalAnnuel >= 0 ? "bad" : "good"}
            />
          </div>

          {view.costLines.length > 0 && (
            <Section title="Coûts récurrents annuels" subtitle="Chaque ligne = coût net global annuel d'une simulation sauvegardée.">
              <div className="rules-table-wrap">
                <table className="rules-table">
                  <thead>
                    <tr>
                      <th>Simulateur</th>
                      <th>Simulation</th>
                      <th>Coût net global annuel</th>
                      <th>Sauvegardée le</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.costLines
                      .slice()
                      .sort((a, b) => b.coutNetGlobalAnnuel - a.coutNetGlobalAnnuel)
                      .map((l) => (
                        <tr key={`${l.kind}-${l.simulationId}`}>
                          <td>
                            {RECURRING_SIMULATOR_LABELS[l.kind].icon} {RECURRING_SIMULATOR_LABELS[l.kind].label}
                          </td>
                          <td>{l.simulationName}</td>
                          <td className={l.coutNetGlobalAnnuel < 0 ? "consolidated-cost--gain" : undefined}>
                            {formatEUR(l.coutNetGlobalAnnuel)}
                          </td>
                          <td>{formatDate(l.savedAt)}</td>
                          <td>
                            <button type="button" className="btn btn--ghost" onClick={() => onNavigate(KIND_TO_PAGE[l.kind])}>
                              Voir →
                            </button>
                          </td>
                        </tr>
                      ))}
                    <tr>
                      <td colSpan={2}>
                        <strong>Total</strong>
                      </td>
                      <td>
                        <strong>{formatEUR(view.totalCoutNetGlobalAnnuel)}</strong>
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {view.infoLines.length > 0 && (
            <Section
              title="Informations complémentaires (hors total)"
              subtitle="Rémunération et Holding sont listés à titre indicatif, non additionnés au coût net global ci-dessus."
            >
              <div className="rules-table-wrap">
                <table className="rules-table">
                  <thead>
                    <tr>
                      <th>Simulateur</th>
                      <th>Simulation</th>
                      <th>Métrique</th>
                      <th>Sauvegardée le</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.infoLines
                      .slice()
                      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
                      .map((l) => (
                        <tr key={`${l.kind}-${l.simulationId}`}>
                          <td>
                            {INFO_SIMULATOR_LABELS[l.kind].icon} {INFO_SIMULATOR_LABELS[l.kind].label}
                          </td>
                          <td>{l.simulationName}</td>
                          <td>
                            {l.metricLabel} : {formatEUR(l.metricValue)}
                          </td>
                          <td>{formatDate(l.savedAt)}</td>
                          <td>
                            <button type="button" className="btn btn--ghost" onClick={() => onNavigate(KIND_TO_PAGE[l.kind])}>
                              Voir →
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
