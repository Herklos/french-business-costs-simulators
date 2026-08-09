import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  hint?: string;
  ruleNote?: ReactNode;
  children: ReactNode;
}

export function Field({ label, hint, ruleNote, children }: FieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
      {ruleNote}
    </label>
  );
}

export function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" inputMode="decimal" {...props} />;
}

/**
 * Champ numérique pour une valeur "placeholder" (taux, plafond...) : la valeur par défaut retenue
 * est indiquée et un bouton permet de revenir dessus en un clic, pour identifier facilement les
 * hypothèses de calcul et les réajuster/annuler sans avoir à retenir la valeur d'origine.
 */
export function ResetableNumberInput({
  value,
  defaultValue,
  onChange,
  step,
  formatDefault,
}: {
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
  step?: string;
  formatDefault?: (value: number) => string;
}) {
  const isDefault = value === defaultValue;
  const displayDefault = formatDefault ? formatDefault(defaultValue) : String(defaultValue);
  return (
    <div className="resetable-field">
      <NumberInput step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <button
        type="button"
        className="resetable-field__reset"
        disabled={isDefault}
        onClick={() => onChange(defaultValue)}
        title={`Revenir à la valeur par défaut (${displayDefault})`}
      >
        ↺ défaut : {displayDefault}
      </button>
    </div>
  );
}

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section__header">
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </header>
      <div className="section__body">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  tone = "neutral",
  sub,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
  sub?: string;
}) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">{value}</span>
      {sub && <span className="stat-card__sub">{sub}</span>}
    </div>
  );
}
