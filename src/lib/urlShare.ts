// Partage d'une simulation par URL — sans aucun backend : l'état complet de la simulation (tous les
// champs du formulaire) est encodé dans le paramètre `data` de l'URL, avec le simulateur cible dans
// `page`. Ouvrir un tel lien pré-remplit directement le formulaire correspondant, sans passer par le
// localStorage — pratique pour partager une simulation par email/Slack sans que le destinataire ait
// besoin de ressaisir quoi que ce soit.
//
// Limite assumée : l'URL grandit avec la taille de l'objet inputs (base64 d'un JSON) — reste très
// raisonnable pour ces formulaires (quelques centaines d'octets), mais ne conviendrait pas à un objet
// nettement plus volumineux.

/** Encode un objet de simulation en chaîne compacte, sûre dans une URL (base64 URL-safe). */
export function encodeSimulationForUrl(inputs: unknown): string {
  const json = JSON.stringify(inputs);
  // btoa n'accepte que du Latin1 : on passe par encodeURIComponent/unescape pour supporter l'UTF-8
  // (accents, caractères spéciaux) présents dans les noms de simulation saisis par l'utilisateur.
  const base64 = btoa(unescape(encodeURIComponent(json)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Décode une chaîne produite par `encodeSimulationForUrl`. Retourne `null` si le contenu est corrompu ou absent. */
export function decodeSimulationFromUrl<T>(encoded: string | null | undefined): T | null {
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = decodeURIComponent(escape(atob(padded)));
    const parsed = JSON.parse(json);
    // Un objet JSON valide mais de forme inattendue (tableau, primitive...) n'est pas exploitable
    // comme un objet de simulation — rejeté ici pour que `mergeSharedInputs` reste sûr.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Fusionne un objet de simulation partagé (potentiellement partiel — lien ancien créé avant l'ajout
 * d'un champ, ou payload corrompu/tronqué) PAR-DESSUS des valeurs par défaut complètes, plutôt que de
 * le substituer intégralement : un champ manquant retombe sur sa valeur par défaut au lieu de valoir
 * `undefined` et de faire planter le moteur de calcul en aval (cf. régression trouvée en vérification
 * manuelle : un partage partiel de MaterielInputs sans `personalTaxProfile` faisait planter
 * `computeMateriel`). Utilisée par tous les simulateurs à l'initialisation de leur état.
 */
export function mergeSharedInputs<T extends object>(defaults: T, encoded: string | null | undefined): T {
  const shared = decodeSimulationFromUrl<Partial<T>>(encoded);
  return shared ? { ...defaults, ...shared } : defaults;
}

/** Construit l'URL de partage complète pour une simulation d'un simulateur donné. */
export function buildShareUrl(page: string, inputs: unknown): string {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set("page", page);
  url.searchParams.set("data", encodeSimulationForUrl(inputs));
  return url.toString();
}

/** Lit les paramètres `page`/`data` de l'URL courante, s'ils existent. */
export function readShareFromUrl(): { page: string; data: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  const data = params.get("data");
  if (!page || !data) return null;
  return { page, data };
}

/** Retire `page`/`data` de la barre d'adresse une fois la simulation partagée chargée, sans recharger la page. */
export function clearShareFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("page");
  url.searchParams.delete("data");
  window.history.replaceState({}, "", url.toString());
}
