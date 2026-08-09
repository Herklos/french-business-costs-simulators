import { getRule, getRuleStatus } from "../lib/taxRules";
import { formatDate } from "../lib/format";

const STATUS_LABEL: Record<string, string> = {
  active: "En vigueur",
  expiring_soon: "Expire bientôt",
  expired: "Expirée",
};

/** Petite citation légale affichée sous un champ de formulaire, avec statut de validité dans le temps. */
export function RuleNote({ ruleId }: { ruleId: string }) {
  const rule = getRule(ruleId);
  if (!rule) return null;
  const status = getRuleStatus(rule);

  return (
    <div className={`rule-note rule-note--${status}`} title={rule.notes ?? undefined}>
      <span className="rule-note__ref">{rule.legalReference}</span>
      <span className={`rule-note__badge rule-note__badge--${status}`}>
        {STATUS_LABEL[status]}
        {rule.validUntil ? ` · ${formatDate(rule.validUntil)}` : ""}
      </span>
    </div>
  );
}
