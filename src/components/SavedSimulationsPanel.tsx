import { useEffect, useState } from "react";
import {
  type SavedSimulation,
  type SimulatorKind,
  deleteSimulation,
  listSimulations,
  saveSimulation,
} from "../lib/storage";
import { formatDate } from "../lib/format";
import { copyToClipboard } from "../lib/clipboard";

interface Metric {
  label: string;
  value: string;
}

interface SavedSimulationsPanelProps<T extends { id: string; name: string }> {
  kind: SimulatorKind;
  currentInputs: T;
  onLoad: (inputs: T) => void;
  metricsFor: (inputs: T) => Metric[];
  exportText: (inputs: T) => string; // texte complet exporté vers le presse-papier
  version: number; // bump to force refresh after save
}

export function SavedSimulationsPanel<T extends { id: string; name: string }>({
  kind,
  currentInputs,
  onLoad,
  metricsFor,
  exportText,
  version,
}: SavedSimulationsPanelProps<T>) {
  const [selected, setSelected] = useState<string[]>([]);
  // `refreshTick` is bumped on every save/delete so this component re-renders and re-reads
  // localStorage: writing to storage does NOT by itself trigger a React re-render, so without
  // this the list (and the "N simulation(s) enregistrée(s)" count) would silently go stale —
  // the save button would appear to do nothing even though the write did succeed.
  const [refreshTick, setRefreshTick] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const [justCopiedId, setJustCopiedId] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const items = listSimulations<T>(kind);
  // version is read to satisfy the linter's dependency intuition; the list is re-read on every render
  void version;
  void refreshTick;

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  useEffect(() => {
    if (justCopiedId === null) return;
    const timeout = setTimeout(() => {
      setJustCopiedId(null);
      setCopyFailed(false);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [justCopiedId]);

  function handleSave() {
    saveSimulation(kind, currentInputs);
    setRefreshTick((t) => t + 1);
    setJustSaved(true);
  }

  async function handleCopy(id: string, inputs: T) {
    const ok = await copyToClipboard(exportText(inputs));
    setCopyFailed(!ok);
    setJustCopiedId(id);
  }

  function handleDelete(id: string) {
    deleteSimulation(kind, id);
    setSelected((s) => s.filter((x) => x !== id));
    setRefreshTick((t) => t + 1);
  }

  function toggleSelect(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? s : [...s, id]));
  }

  const comparedItems: SavedSimulation<T>[] = items.filter((it) => selected.includes(it.inputs.id));

  return (
    <div className="saved-panel">
      <div className="saved-panel__toolbar">
        <button type="button" className="btn btn--primary" onClick={handleSave}>
          💾 Sauvegarder cette simulation
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => handleCopy("__current__", currentInputs)}>
          📋 Copier cette simulation
        </button>
        {justSaved && <span className="saved-panel__confirmation">✓ Sauvegardé</span>}
        {justCopiedId === "__current__" && (
          <span className={`saved-panel__confirmation ${copyFailed ? "saved-panel__confirmation--error" : ""}`}>
            {copyFailed ? "✗ Échec de la copie" : "✓ Copié dans le presse-papier"}
          </span>
        )}
        <span className="saved-panel__count">{items.length} simulation(s) enregistrée(s) localement</span>
      </div>

      {items.length === 0 && <p className="empty-hint">Aucune simulation sauvegardée pour l'instant.</p>}

      {items.length > 0 && (
        <ul className="saved-list">
          {items.map((it) => (
            <li key={it.inputs.id} className="saved-list__item">
              <label className="saved-list__select">
                <input
                  type="checkbox"
                  checked={selected.includes(it.inputs.id)}
                  onChange={() => toggleSelect(it.inputs.id)}
                />
              </label>
              <div className="saved-list__meta">
                <strong>{it.inputs.name}</strong>
                <span>Enregistrée le {formatDate(it.savedAt)}</span>
              </div>
              <div className="saved-list__actions">
                {justCopiedId === it.inputs.id ? (
                  <span className={`saved-panel__confirmation ${copyFailed ? "saved-panel__confirmation--error" : ""}`}>
                    {copyFailed ? "✗ Échec" : "✓ Copié"}
                  </span>
                ) : (
                  <button type="button" className="btn btn--ghost" onClick={() => handleCopy(it.inputs.id, it.inputs)}>
                    📋 Copier
                  </button>
                )}
                <button type="button" className="btn btn--ghost" onClick={() => onLoad(it.inputs)}>
                  Charger
                </button>
                <button type="button" className="btn btn--ghost btn--danger" onClick={() => handleDelete(it.inputs.id)}>
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {comparedItems.length >= 2 && (
        <div className="compare-table-wrap">
          <h4>Comparaison</h4>
          <table className="compare-table">
            <thead>
              <tr>
                <th>Indicateur</th>
                {comparedItems.map((it) => (
                  <th key={it.inputs.id}>{it.inputs.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricsFor(comparedItems[0].inputs).map((_, rowIdx) => (
                <tr key={rowIdx}>
                  <td>{metricsFor(comparedItems[0].inputs)[rowIdx].label}</td>
                  {comparedItems.map((it) => (
                    <td key={it.inputs.id}>{metricsFor(it.inputs)[rowIdx]?.value ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
