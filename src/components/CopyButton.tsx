import { useEffect, useState } from "react";
import { copyToClipboard } from "../lib/clipboard";

/** Bouton de copie dans le presse-papier, avec confirmation visuelle temporaire. */
export function CopyButton({ getText, label = "📋 Copier cette simulation" }: { getText: () => string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timeout = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [status]);

  async function handleClick() {
    const ok = await copyToClipboard(getText());
    setStatus(ok ? "copied" : "failed");
  }

  return (
    <button type="button" className="btn btn--ghost copy-button" onClick={handleClick}>
      {status === "copied" ? "✓ Copié dans le presse-papier" : status === "failed" ? "✗ Échec de la copie" : label}
    </button>
  );
}
