import { TAX_RULES, getRuleStatus } from "../lib/taxRules";
import { formatDate } from "../lib/format";

const CATEGORY_LABEL: Record<string, string> = {
  aen_vehicule: "Avantage en nature — véhicule",
  cotisations_sociales: "Cotisations sociales",
  impot_revenu: "Impôt sur le revenu",
  indemnites_kilometriques: "Indemnités kilométriques",
  revenus_fonciers: "Revenus fonciers",
  impot_societe: "Impôt sur les sociétés",
  fiscalite_vehicule_societe: "Fiscalité du véhicule de société (taxes, plafonds, aides)",
  risques_juridiques: "Seuils et risques juridiques (usure, abus de biens sociaux, tolérances)",
  remuneration_dirigeant: "Rémunération du dirigeant (salaire, dividendes)",
};

const STATUS_LABEL: Record<string, string> = {
  active: "En vigueur",
  expiring_soon: "Expire bientôt",
  expired: "Expirée",
};

export function RulesPage() {
  const byCategory = TAX_RULES.reduce<Record<string, typeof TAX_RULES>>((acc, rule) => {
    (acc[rule.category] ??= []).push(rule);
    return acc;
  }, {});

  return (
    <div className="page">
      <h2>📚 Règles fiscales & sociales utilisées</h2>
      <p className="page__intro">
        Historique des règles, taux et plafonds utilisés par les simulateurs, avec leur référence légale et leur
        période de validité. Une règle proche de son expiration est signalée : pensez à vérifier sa reconduction
        lors de la publication des textes annuels (loi de finances, arrêtés).
      </p>

      {Object.entries(byCategory).map(([category, rules]) => (
        <section key={category} className="rules-category">
          <h3>{CATEGORY_LABEL[category] ?? category}</h3>
          <div className="rules-table-wrap">
            <table className="rules-table">
              <thead>
                <tr>
                  <th>Règle</th>
                  <th>Valeur</th>
                  <th>Référence légale</th>
                  <th>Source</th>
                  <th>Validité</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const status = getRuleStatus(rule);
                  return (
                    <tr key={rule.id}>
                      <td>
                        <strong>{rule.label}</strong>
                        {rule.notes && <div className="rules-table__notes">{rule.notes}</div>}
                      </td>
                      <td>{rule.value}</td>
                      <td>{rule.legalReference}</td>
                      <td>
                        {rule.sourceUrl ? (
                          <a href={rule.sourceUrl} target="_blank" rel="noreferrer">
                            {rule.sourceLabel}
                          </a>
                        ) : (
                          rule.sourceLabel
                        )}
                      </td>
                      <td>
                        {formatDate(rule.validFrom)} → {rule.validUntil ? formatDate(rule.validUntil) : "indéterminée"}
                      </td>
                      <td>
                        <span className={`status-badge status-badge--${status}`}>{STATUS_LABEL[status]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
