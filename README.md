# 🇫🇷 Simulateurs de coûts d'entreprise

Application web (Vite + React + TypeScript) regroupant une suite de simulateurs financiers et fiscaux à
destination des dirigeants d'entreprise en France (EURL, SARL, SASU, SAS). Chaque simulateur chiffre
précisément le **coût réel** — société et personnel — d'une décision courante de dirigeant, en tenant compte du
statut social (TNS ou assimilé salarié), du régime d'imposition (IS ou IR) et de la situation fiscale du foyer.

## Simulateurs disponibles

### 🚗 Véhicule de société
Calcule l'avantage en nature (AEN) selon la méthode réelle (obligatoire pour les gérants majoritaires TNS),
l'abattement véhicule électrique éligible (barème réel 50%, forfaitaire 70% réservé aux assimiliés salariés),
et compare **8 combinaisons** {société | personnel + IK} × {comptant | crédit | LOA | LLD} pour identifier
l'option la moins coûteuse au global — pas seulement celle qui arrange la société ou le dirigeant pris isolément.
Inclut une base de modèles de véhicules avec offres constructeur réelles (Tesla Model Y/3, Renault Megane/Scenic
E-Tech), un comparateur de financement avec taux d'usure légal, l'estimation de la valeur résiduelle en fin de
période, et une projection pluriannuelle.

### 🏠 Bureau au domicile personnel
Indemnité d'occupation versée par la société pour l'usage professionnel d'une partie du domicile du dirigeant :
calcul de la quote-part de surface, régime foncier (micro-foncier ou réel) avec son plafond, formalisation
(simple convention ou bail professionnel), et comparaison avec la location d'un bureau externe équivalent.

### 💰 Rémunération du dirigeant
Compare, **à coût total identique pour l'entreprise**, trois façons de se payer : 100% salaire, 100% dividendes,
ou un mixte au pourcentage de son choix. Prend en compte la règle décisive souvent méconnue : pour un gérant
majoritaire TNS, les dividendes qui excèdent 10% du capital social (+ primes d'émission + comptes courants
d'associés) sont eux aussi soumis aux cotisations sociales — contrairement à un président de SASU/SAS (assimilé
salarié), dont les dividendes échappent totalement aux charges sociales (seul le PFU de 30% s'applique). Affiche
le brut/net annuel et mensuel de chaque scénario, et met en avant le **coût pour 1€ net perçu** par le dirigeant,
tout compris, pour identifier immédiatement le montage le plus efficace.

### 💻 Matériel professionnel
Ordinateur, mobilier de bureau : déduction immédiate en charge si le prix HT n'excède pas 500€ (« petit matériel
», art. 39-1 3° CGI), sinon amortissement linéaire sur sa durée d'usage. Compare l'achat par la société, l'achat
personnel remboursé par note de frais (fiscalement identique — lève une confusion fréquente), et l'achat
personnel non remboursé (aucun avantage fiscal).

### 🩺 Mutuelle & prévoyance du dirigeant
Le traitement fiscal et social diffère radicalement selon le statut : cotisations **Madelin** déductibles dans
une limite légale pour un TNS (au choix prises en charge par la société ou personnellement), ou mutuelle
**collective obligatoire** pour un assimilé salarié (employeur ≥50%, avec un plafond d'exonération sociale et
fiscale sur la part patronale).

### 🏦 Épargne retraite du dirigeant (PER individuel / Madelin retraite)
Plafond de déduction fiscale selon le statut — formule TNS nettement plus généreuse dès que le bénéfice dépasse
le PASS, ou plafond classique de 10% du revenu professionnel pour un assimilé salarié. Détaille aussi la
**liquidité réelle** du placement : âge légal de sortie, et la liste fermée des 6 cas de déblocage anticipé
(avec les confusions courantes explicitement levées, comme le mariage qui n'en fait *pas* partie).

### 📚 Règles fiscales
Registre historisé de l'ensemble des taux, barèmes, plafonds et références légales utilisés par les calculs,
chacun avec sa source, sa période de validité et un indicateur de statut (en vigueur / expire bientôt / expirée)
— pour tracer précisément d'où vient chaque hypothèse et savoir quand la revérifier.

## Fonctionnalités transversales

- **Statut du dirigeant résolu automatiquement** — TNS ou assimilé salarié selon la forme juridique (EURL,
  SASU : statut fixe ; SARL : dépend de la majorité/minorité du gérant), partagé par tous les simulateurs qui en
  ont besoin.
- **Revenu de référence du foyer fiscal persistant** — la situation personnelle (situation familiale, enfants,
  salaire, conjoint) saisie sur un simulateur est automatiquement sauvegardée et pré-remplie sur tous les autres,
  sans avoir à la ressaisir à chaque changement de page.
- **Détail dépliable du calcul** — sur les simulateurs qui comparent plusieurs scénarios ou plusieurs parties
  prenantes, un détail ligne par ligne montre exactement où et pour qui (société ou dirigeant) chaque montant se
  réalise.
- **Sauvegarde & comparaison locale** — chaque simulation peut être sauvegardée dans le `localStorage` du
  navigateur (aucune donnée envoyée à un serveur), rechargée plus tard, et comparée côte à côte à d'autres
  simulations du même simulateur.
- **Export presse-papier** — un bouton copie un résumé texte complet de la simulation (hypothèses, détail du
  calcul, résultats), prêt à coller dans un email ou un document.
- **Architecture multi-pays prévue** — seule la France est renseignée actuellement, mais la structure (forme
  juridique, barèmes, règles fiscales) est indexée par pays pour permettre l'ajout d'autres juridictions sans
  toucher au moteur de calcul.

## Développement

```bash
npm install
npm run dev        # serveur de développement
npm run build      # build de production (tsc + vite build)
npm run lint       # oxlint
npm run test       # tests unitaires (vitest) — moteurs de calcul (src/lib/*.test.ts)
npm run test:watch # tests en mode watch
npm run preview    # prévisualiser le build
```

### Structure du code

- `src/lib/` — moteurs de calcul purs (un module par simulateur : `simulator.ts` (véhicule), `homeOffice.ts`,
  `remuneration.ts`, `materiel.ts`, `mutuellePrevoyance.ts`, `retraite.ts`), plus les modules partagés
  (`companyTypes.ts`, `frenchIncomeTax.ts`, `corporateTax.ts`, `financing.ts`, `taxRules.ts`, `storage.ts`...).
  Chaque module a son fichier de tests associé (`*.test.ts`).
- `src/pages/` — une page React par simulateur, réutilisant les composants partagés de `src/components/`
  (`Field`, `Section`, `StatCard`, `CompanyTypeFields`, `PersonalTaxProfileFields`, `RuleNote`,
  `SavedSimulationsPanel`, `CopyButton`...).
- `src/lib/taxRules.ts` — registre unique de toutes les règles fiscales/sociales sourcées, consommé à la fois par
  les moteurs de calcul (documentation) et par la page Règles fiscales (affichage).

## Avertissement

Cet outil est une aide à la décision basée sur des règles fiscales et sociales françaises susceptibles d'évoluer
chaque année (lois de finances, arrêtés). Il ne remplace pas l'avis d'un expert-comptable ou d'un conseiller
fiscal. Les hypothèses et simplifications retenues sont documentées dans le code (`src/lib/`) et dans la page
Règles fiscales de l'application.
