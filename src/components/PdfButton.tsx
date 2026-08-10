/**
 * Exporte la simulation en PDF via l'impression navigateur (Ctrl/Cmd+P → "Enregistrer en PDF") :
 * aucune dépendance PDF côté client, le rendu imprimable est déjà présent dans le DOM (cf.
 * PrintableReport) et masqué à l'écran par les règles `@media print` de index.css.
 */
export function PdfButton({ label = "🖨️ Exporter en PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn btn--ghost" onClick={() => window.print()}>
      {label}
    </button>
  );
}
