import { formatEUR } from "../lib/format";

export interface MontageCardData {
  /** Identifiant stable, utilisé comme clé et rendu à la sélection. */
  id: string;
  label: string;
  resume: string;
  cout: number;
  ecartVsMeilleur: number;
  meilleur: boolean;
}

/**
 * Comparatif de montages sous forme de cartes cliquables, classées du moins cher au plus cher.
 *
 * Il remplace un menu déroulant demandant à l'utilisateur de choisir un montage avant de pouvoir en
 * connaître le coût : ici les montages sont tous chiffrés d'emblée, et sélectionner l'un d'eux ne
 * fait qu'ouvrir son détail. Le choix devient une conclusion plutôt qu'un préalable.
 */
export function MontageCards({
  montages,
  selectedId,
  onSelect,
  legende,
}: {
  montages: MontageCardData[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Unité du montant affiché, rappelée sous chaque carte (« sur 6 ans », « /an »...). */
  legende: string;
}) {
  // Échelle commune : le montage le plus cher occupe toute la largeur, ce qui rend l'écart lisible
  // sans avoir à soustraire deux nombres de tête.
  const coutMax = Math.max(...montages.map((m) => m.cout), 1);

  return (
    <div className="montage-cards" role="radiogroup" aria-label="Montages comparés">
      {montages.map((m) => {
        const selected = m.id === selectedId;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`montage-card ${m.meilleur ? "montage-card--best" : ""} ${selected ? "montage-card--selected" : ""}`}
            onClick={() => onSelect(m.id)}
          >
            <span className="montage-card__head">
              <span className="montage-card__label">
                {m.meilleur && (
                  <span className="montage-card__trophy" title="Montage le moins cher">
                    🏆{" "}
                  </span>
                )}
                {m.label}
              </span>
              <span className="montage-card__cout">{formatEUR(m.cout)}</span>
            </span>
            <span className="montage-card__bar" aria-hidden="true">
              <span style={{ width: `${Math.max(2, (m.cout / coutMax) * 100)}%` }} />
            </span>
            <span className="montage-card__meta">
              <span className="montage-card__legende">{legende}</span>
              {m.meilleur ? (
                <span className="montage-card__ecart montage-card__ecart--best">le moins cher</span>
              ) : (
                <span className="montage-card__ecart">+{formatEUR(m.ecartVsMeilleur)}</span>
              )}
            </span>
            <span className="montage-card__resume">{m.resume}</span>
          </button>
        );
      })}
    </div>
  );
}
