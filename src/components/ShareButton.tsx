import { useEffect, useState } from "react";
import { copyToClipboard } from "../lib/clipboard";
import { buildShareUrl } from "../lib/urlShare";

/** Bouton de partage par URL : copie dans le presse-papier un lien qui pré-remplit le formulaire du destinataire. */
export function ShareButton({ page, getInputs, label = "🔗 Partager par lien" }: { page: string; getInputs: () => unknown; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timeout = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [status]);

  async function handleClick() {
    const ok = await copyToClipboard(buildShareUrl(page, getInputs()));
    setStatus(ok ? "copied" : "failed");
  }

  return (
    <button type="button" className="btn btn--ghost share-button" onClick={handleClick}>
      {status === "copied" ? "✓ Lien copié dans le presse-papier" : status === "failed" ? "✗ Échec de la copie" : label}
    </button>
  );
}
