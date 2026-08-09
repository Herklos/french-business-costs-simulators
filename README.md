# Simulateurs de coûts d'entreprise (France)

Application Vite + React + TypeScript regroupant des simulateurs pour dirigeants d'entreprise en France.

## Simulateurs disponibles

- **🚗 Véhicule de société** — calcul de l'avantage en nature (méthode réelle, obligatoire pour les gérants
  majoritaires TNS), abattement véhicule électrique éligible, comparaison avec un achat personnel indemnisé aux
  frais kilométriques, comparaison des modes de financement (comptant, crédit, LOA, LLD), et projection
  pluriannuelle.
- **🏠 Bureau au domicile personnel** — indemnité d'occupation versée par la société pour l'usage professionnel
  d'une partie du domicile du dirigeant (fiscalité des revenus fonciers, comparaison avec la location d'un bureau
  externe).

Chaque simulateur dépend du **pays** (France uniquement pour l'instant, l'architecture est prévue pour en
accueillir d'autres), de la **forme juridique** (EURL, SARL, SASU, SAS) — qui détermine le statut du dirigeant
(TNS ou assimilé salarié) — et du **régime d'imposition de la société** (IS ou IR). La situation personnelle du
dirigeant (situation familiale, parts fiscales, salaire) peut être renseignée pour calculer précisément son taux
marginal d'imposition (TMI), utilisé pour chiffrer l'impôt supplémentaire dû par l'avantage en nature / l'indemnité
d'occupation.

Toutes les simulations peuvent être **sauvegardées en local (localStorage)** et comparées entre elles.

La page **📚 Règles fiscales** liste l'ensemble des taux, plafonds et références légales utilisés dans les calculs,
avec leur période de validité et un indicateur de statut (en vigueur / expire bientôt / expirée).

## Développement

```bash
npm install
npm run dev      # serveur de développement
npm run build    # build de production (tsc + vite build)
npm run lint     # oxlint
npm run preview  # prévisualiser le build
```

## Avertissement

Cet outil est une aide à la décision basée sur des règles fiscales et sociales françaises susceptibles d'évoluer
chaque année (lois de finances, arrêtés). Il ne remplace pas l'avis d'un expert-comptable ou d'un conseiller
fiscal. Les hypothèses et simplifications retenues sont documentées dans le code (`src/lib/`) et dans la page
Règles fiscales de l'application.
