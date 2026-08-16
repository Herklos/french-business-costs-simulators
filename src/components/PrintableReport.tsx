import { createPortal } from "react-dom";

// Rendu imprimable d'un export texte (buildXXXExportText), invisible à l'écran et affiché
// uniquement via `window.print()` grâce aux règles `@media print` de index.css (cf. PdfButton).
// Convertit le texte structuré (titres "— Section —", lignes vides comme espacement) en HTML léger.
//
// Rendu via un portail DIRECTEMENT sous <body>, en dehors de l'arbre `.app` : les règles
// `@media print` masquent tout `.app` avec un simple `display: none`, ce qui évite le piège classique
// du `visibility: hidden` (qui réserve son espace de mise en page et produisait une page PDF
// blanche supplémentaire à l'impression, l'arbre caché de `.app` restant plus haut qu'une page A4).
export function PrintableReport({ text }: { text: string }) {
  const lines = text.split("\n");
  return createPortal(
    <div className="printable-report">
      {lines.map((line, i) => {
        const key = `${i}-${line}`;
        if (line.trim() === "") return <div key={key} className="printable-report__spacer" />;
        const sectionMatch = /^— (.+) —$/.exec(line.trim());
        if (sectionMatch) return <h3 key={key}>{sectionMatch[1]}</h3>;
        if (i === 0) return <h1 key={key}>{line}</h1>;
        // Une tabulation en tête marque une ligne de tableau : rendue en chasse fixe pour que les
        // colonnes s'alignent, ce qu'une police proportionnelle ne permet pas.
        if (line.startsWith("\t")) {
          return (
            <p key={key} className="printable-report__row">
              {line.slice(1)}
            </p>
          );
        }
        return <p key={key}>{line}</p>;
      })}
    </div>,
    document.body,
  );
}
