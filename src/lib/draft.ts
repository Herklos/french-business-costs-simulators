// Persistance générique des saisies d'un simulateur dans le stockage local.
//
// Le principe, commun à tous les simulateurs : on mémorise TOUT ce que l'utilisateur a pu modifier,
// sauf une courte liste d'exclusions (identifiants techniques, profil fiscal partagé entre
// simulateurs). L'extraction se fait donc par soustraction et non par énumération — un champ ajouté
// au formulaire est persisté sans qu'on ait à y penser, ce qui évite la classe de bugs où une
// nouvelle saisie est silencieusement oubliée à la relecture.
//
// La relecture, elle, valide CHAQUE CHAMP INDIVIDUELLEMENT. Une donnée écrite par une version
// antérieure du code, tronquée, ou trafiquée à la main dans les outils du navigateur retombe sur son
// défaut sans emporter les autres : un brouillon partiellement invalide vaut mieux qu'un formulaire
// entier réinitialisé, et infiniment mieux qu'un formulaire rempli de valeurs absurdes.

/** Décrit ce qui, dans un formulaire donné, échappe à la validation générique. */
export interface DraftSchema {
  /** Champs jamais persistés : identifiants techniques, données partagées ailleurs. */
  champsNonPersistes: readonly string[];
  /** Champs à choix fermé : toute valeur hors liste est rejetée au profit du défaut. */
  valeursAdmises?: Readonly<Record<string, readonly string[]>>;
  /** Champs bornés à [0, 1] : un taux relu hors bornes produirait des montants absurdes. */
  champsTaux?: readonly string[];
  /** Champs dont `null` est une valeur légitime (surcharge absente, modèle non sélectionné). */
  champsNullables?: readonly string[];
  /**
   * Listes d'objets identifiés, fusionnées PAR IDENTIFIANT plutôt que remplacées. La fonction dit
   * quels champs de chaque élément sont repris du stockage ; tout le reste — ordre, libellés,
   * éléments ajoutés ou retirés depuis la dernière visite — vient du code.
   */
  listesParId?: Readonly<
    Record<string, (persistee: Record<string, unknown>, courant: Record<string, unknown>) => object>
  >;
}

/** Extrait du formulaire tout ce qui doit être mémorisé, par soustraction des champs exclus. */
export function extractDraft<T extends object>(inputs: T, champsNonPersistes: readonly string[]): Partial<T> {
  const draft: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(inputs)) {
    if (champsNonPersistes.includes(cle)) continue;
    draft[cle] = valeur;
  }
  return draft as Partial<T>;
}

function nombreValide(valeur: unknown, defaut: number): number {
  return typeof valeur === "number" && Number.isFinite(valeur) && valeur >= 0 ? valeur : defaut;
}

function fusionnerParId(
  courants: unknown,
  persistes: unknown,
  champs: (persistee: Record<string, unknown>, courant: Record<string, unknown>) => object,
): unknown {
  if (!Array.isArray(courants)) return courants;
  if (!Array.isArray(persistes)) return courants;
  return courants.map((courant) => {
    if (!courant || typeof courant !== "object") return courant;
    const c = courant as Record<string, unknown>;
    const persistee = persistes.find((p) => p && typeof p === "object" && p.id === c.id);
    return persistee ? { ...c, ...champs(persistee as Record<string, unknown>, c) } : courant;
  });
}

/** Un objet simple, à fusionner récursivement — par opposition à un tableau ou à `null`. */
function estObjetSimple(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

/**
 * Applique un brouillon relu du stockage aux valeurs par défaut.
 *
 * Le parcours suit les clés des DÉFAUTS, jamais celles du stockage : une clé inconnue du code est
 * ignorée, une clé disparue du stockage garde son défaut. Les objets imbriqués — paramètres de
 * financement, par exemple — sont fusionnés récursivement sous les mêmes règles.
 */
export function applyDraft<T extends object>(defaults: T, draft: unknown, schema: DraftSchema): T {
  if (!draft || typeof draft !== "object") return defaults;
  const persiste = draft as Record<string, unknown>;
  const defauts = defaults as unknown as Record<string, unknown>;
  const resultat: Record<string, unknown> = { ...defauts };

  for (const cle of Object.keys(defauts)) {
    if (schema.champsNonPersistes.includes(cle)) continue;
    if (!(cle in persiste)) continue;
    const valeur = persiste[cle];
    const defaut = defauts[cle];

    const fusionListe = schema.listesParId?.[cle];
    if (fusionListe) {
      resultat[cle] = fusionnerParId(defaut, valeur, fusionListe);
      continue;
    }

    const admises = schema.valeursAdmises?.[cle];

    if (schema.champsNullables?.includes(cle)) {
      // Un champ nullable a souvent `null` pour défaut : le type attendu ne peut donc pas être
      // déduit de celui-ci, et la validation générique par comparaison de types ne s'applique pas.
      // On accepte l'absence, puis la valeur elle-même sous ses formes plausibles.
      if (valeur === null) {
        resultat[cle] = null;
      } else if (admises) {
        // Champ nullable à choix fermé : la liste dit à elle seule ce qui est recevable.
        if (typeof valeur === "string" && admises.includes(valeur)) resultat[cle] = valeur;
      } else if (typeof valeur === "number" && Number.isFinite(valeur) && valeur >= 0) {
        resultat[cle] = valeur;
      }
      // Aucun repli permissif au-delà : un champ nullable sans liste déclarée est numérique, et
      // accepter n'importe quelle chaîne y ferait entrer une valeur que rien ne sait interpréter.
      continue;
    }

    if (admises) {
      if (typeof valeur === "string" && admises.includes(valeur)) resultat[cle] = valeur;
      continue;
    }

    if (estObjetSimple(defaut)) {
      // Sous-objet de paramètres : mêmes règles, appliquées un cran plus bas. Les listes et les
      // choix fermés ne sont pas redescendus — aucun formulaire n'en imbrique à ce jour, et les
      // faire suivre supposerait des clés qualifiées dont personne n'a encore besoin.
      resultat[cle] = applyDraft(defaut, valeur, {
        champsNonPersistes: [],
        champsTaux: schema.champsTaux,
        champsNullables: schema.champsNullables,
      });
      continue;
    }

    if (typeof defaut === "number") {
      const nombre = nombreValide(valeur, defaut);
      // Un taux hors [0, 1] est aussi absurde écrêté que brut : on préfère retomber sur le défaut.
      const horsBornes = (schema.champsTaux?.includes(cle) ?? false) && nombre > 1;
      resultat[cle] = horsBornes ? defaut : nombre;
      continue;
    }

    if (typeof valeur === typeof defaut && (typeof defaut === "boolean" || typeof defaut === "string")) {
      // Une chaîne vide relue n'écrase pas un défaut renseigné : c'est une absence, pas un choix.
      if (typeof defaut === "string" && (valeur as string).length === 0) continue;
      resultat[cle] = valeur;
    }
  }

  return resultat as T;
}
