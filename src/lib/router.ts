// Routage léger, sans dépendance externe (pas de react-router) : la page affichée est reflétée dans
// le paramètre de query string `?page=...`, avec history.pushState/popstate pour un vrai
// comportement navigateur — rafraîchir la page reste sur le même simulateur, précédent/suivant
// fonctionnent, un lien direct vers `?page=holding` s'ouvre sur le bon simulateur.
//
// Un paramètre de query string est utilisé délibérément, plutôt qu'un chemin d'URL (`/holding`) :
// le chemin reste toujours `/`, donc ça fonctionne sur n'importe quel hébergement statique sans
// configuration serveur (redirection SPA / fallback vers index.html pour chaque sous-route), au prix
// d'une URL un peu moins "propre".
//
// Le paramètre `data` (cf. urlShare.ts) partage le même espace d'URL pour le partage de simulation
// par lien : il est toujours retiré dès qu'on pousse une nouvelle entrée d'historique, pour ne pas
// le réappliquer si l'utilisateur navigue ailleurs puis revient sur cette page.

export type Page =
  | "home"
  | "vehicle"
  | "homeOffice"
  | "remuneration"
  | "materiel"
  | "mutuelle"
  | "retraite"
  | "holding"
  | "consolidated"
  | "rules";

export const VALID_PAGES: Page[] = [
  "home",
  "vehicle",
  "homeOffice",
  "remuneration",
  "materiel",
  "mutuelle",
  "retraite",
  "holding",
  "consolidated",
  "rules",
];

function isValidPage(value: string | null): value is Page {
  return value !== null && (VALID_PAGES as string[]).includes(value);
}

/** Lit la page courante depuis l'URL (`?page=...`), "home" par défaut si absente/invalide. */
export function readPageFromUrl(): Page {
  if (typeof window === "undefined") return "home";
  const value = new URLSearchParams(window.location.search).get("page");
  return isValidPage(value) ? value : "home";
}

function buildUrlForPage(page: Page): string {
  const url = new URL(window.location.href);
  if (page === "home") {
    url.searchParams.delete("page");
  } else {
    url.searchParams.set("page", page);
  }
  url.searchParams.delete("data"); // un partage en cours de lecture ne doit pas persister au-delà de sa première consommation
  return url.toString();
}

/** Pousse une nouvelle entrée d'historique pour une navigation utilisateur (clic sur un lien de nav). */
export function pushPageToUrl(page: Page): void {
  if (typeof window === "undefined") return;
  window.history.pushState({ page }, "", buildUrlForPage(page));
}

/** Remplace l'entrée d'historique courante sans en créer une nouvelle (nettoyage post-partage). */
export function replacePageInUrl(page: Page): void {
  if (typeof window === "undefined") return;
  window.history.replaceState({ page }, "", buildUrlForPage(page));
}
