// Registre des pays supportés. Seule la France est implémentée pour le moment,
// mais toute la chaîne de calcul est organisée pour dépendre du pays choisi,
// afin de pouvoir brancher d'autres juridictions (Belgique, Suisse, Luxembourg, ...)
// sans casser l'architecture existante.

export interface CountryConfig {
  code: string;
  label: string;
  flag: string;
  available: boolean; // false => affiché mais désactivé dans le sélecteur ("bientôt disponible")
}

export const COUNTRIES: CountryConfig[] = [
  { code: "FR", label: "France", flag: "🇫🇷", available: true },
  { code: "BE", label: "Belgique", flag: "🇧🇪", available: false },
  { code: "CH", label: "Suisse", flag: "🇨🇭", available: false },
  { code: "LU", label: "Luxembourg", flag: "🇱🇺", available: false },
];

export const DEFAULT_COUNTRY = "FR";

export function getCountry(code: string): CountryConfig {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}
