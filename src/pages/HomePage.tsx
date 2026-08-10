import type { Page } from "../App";

interface SimulatorCard {
  page: Page;
  icon: string;
  title: string;
  description: string;
  available: boolean;
}

const SIMULATORS: SimulatorCard[] = [
  {
    page: "vehicle",
    icon: "🚗",
    title: "Véhicule de société",
    description:
      "Coût de l'avantage en nature (méthode réelle TNS), comparaison avec un achat personnel + IK, et comparaison des modes de financement (comptant, crédit, LOA, LLD).",
    available: true,
  },
  {
    page: "homeOffice",
    icon: "🏠",
    title: "Bureau au domicile personnel",
    description:
      "Indemnité d'occupation versée par la société pour l'usage professionnel d'une partie du domicile du dirigeant, avec sa fiscalité (revenus fonciers).",
    available: true,
  },
  {
    page: "remuneration",
    icon: "💰",
    title: "Rémunération du dirigeant",
    description:
      "Salaire, dividendes, ou un mixte des deux : cotisations sociales selon la forme juridique (TNS ou assimilé salarié), fiscalité du foyer, brut/net annuel et mensuel, et scénario le plus avantageux à coût entreprise égal.",
    available: true,
  },
  {
    page: "materiel",
    icon: "💻",
    title: "Matériel professionnel",
    description:
      "Ordinateur, mobilier de bureau : charge immédiate ou amortissement selon le seuil des 500€ HT, et comparaison achat société / achat personnel remboursé (identique) / achat personnel non remboursé (aucun avantage fiscal).",
    available: true,
  },
  {
    page: "mutuelle",
    icon: "🩺",
    title: "Mutuelle & prévoyance du dirigeant",
    description:
      "Cotisations Madelin déductibles (TNS) vs mutuelle collective obligatoire prise en charge par l'employeur (assimilé salarié) : plafonds légaux, économie d'impôt société et dirigeant, coût net global.",
    available: true,
  },
  {
    page: "retraite",
    icon: "🏦",
    title: "Épargne retraite du dirigeant",
    description:
      "PER individuel / Madelin retraite : plafond de déduction fiscale selon le statut (formule TNS plus généreuse dès que le bénéfice dépasse le PASS, ou 10% du revenu pour un assimilé salarié), économie d'impôt et coût net.",
    available: true,
  },
];

export function HomePage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <div className="page">
      <h2>Simulateurs de coûts pour entrepreneurs français</h2>
      <p className="page__intro">
        Une suite d'outils pour chiffrer précisément le coût réel — société et personnel — des principales
        décisions d'un dirigeant d'entreprise en France : véhicule de société, bureau à domicile, et bientôt
        d'autres frais professionnels courants.
      </p>
      <div className="home-grid">
        {SIMULATORS.map((s) => (
          <button
            key={s.page}
            type="button"
            className="home-card"
            disabled={!s.available}
            onClick={() => s.available && onNavigate(s.page)}
          >
            <span className="home-card__icon">{s.icon}</span>
            <h3>{s.title}</h3>
            <p>{s.description}</p>
            {!s.available && <span className="home-card__badge">Bientôt disponible</span>}
          </button>
        ))}
        <div className="home-card home-card--placeholder">
          <span className="home-card__icon">➕</span>
          <h3>D'autres simulateurs à venir</h3>
          <p>Frais de repas, mutuelle, matériel informatique, notes de frais... Suggestions bienvenues.</p>
        </div>
      </div>
    </div>
  );
}
