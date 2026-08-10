// Registre historisé des règles fiscales et sociales utilisées par les simulateurs.
// Chaque règle porte sa référence légale/réglementaire, sa période de validité
// (validFrom / validUntil) et sa source, afin de :
//  - tracer précisément d'où vient chaque valeur utilisée dans les calculs ;
//  - avertir l'utilisateur quand une règle est proche de son expiration ou obsolète ;
//  - garder l'historique des valeurs passées quand un simulateur est réutilisé sur
//    plusieurs années (une simulation sauvegardée reste rattachée aux règles de son année).
//
// NB : les montants 2026 sont ceux connus au moment de la rédaction (revalorisations
// PLF 2026 pour l'IR et l'AEN véhicules électriques). Ils doivent être vérifiés/ajustés
// à la publication définitive des textes (loi de finances, arrêtés annuels).

export type RuleCategory =
  | "aen_vehicule"
  | "cotisations_sociales"
  | "impot_revenu"
  | "indemnites_kilometriques"
  | "revenus_fonciers"
  | "impot_societe"
  | "fiscalite_vehicule_societe"
  | "risques_juridiques"
  | "remuneration_dirigeant"
  | "materiel_professionnel"
  | "protection_sociale_dirigeant"
  | "epargne_retraite_dirigeant";

export interface TaxRule {
  id: string;
  category: RuleCategory;
  label: string;
  value: string; // valeur affichable (peut être composite : barème, taux, plafond...)
  legalReference: string; // article de loi / code / arrêté
  sourceLabel: string;
  sourceUrl?: string;
  validFrom: string; // ISO date
  validUntil: string | null; // ISO date, null = pas de fin connue
  notes?: string;
}

export const TAX_RULES: TaxRule[] = [
  {
    id: "aen-amortissement-taux",
    category: "aen_vehicule",
    label: "Taux d'amortissement annuel retenu pour l'AEN (véhicule ≤ 5 ans)",
    value: "20 % du prix d'achat TTC/an",
    legalReference: "BOI-RSA-BASE-30-50-30, § méthode du forfait réel",
    sourceLabel: "BOFiP-Impôts",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1512-PGP.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes: "10 % au-delà de 5 ans de mise en circulation.",
  },
  {
    id: "aen-vehicule-loue-taux",
    category: "aen_vehicule",
    label: "Base AEN pour un véhicule loué (LOA/LLD, méthode réelle)",
    value: "30 % du (coût global annuel de location + assurance + entretien)",
    legalReference: "BOI-RSA-BASE-30-50-30, § véhicule loué",
    sourceLabel: "BOFiP-Impôts",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1512-PGP.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Remplace le calcul par amortissement (20 %/10 %) lorsque le véhicule n'est pas acheté par la société : le loyer annuel (LOA ou LLD) se substitue au prix d'achat.",
  },
  {
    id: "aen-methode-reelle-obligatoire-tns",
    category: "aen_vehicule",
    label: "Méthode d'évaluation obligatoire pour les gérants majoritaires TNS",
    value: "Frais réels uniquement (barème forfaitaire URSSAF exclu)",
    legalReference: "Art. L311-3 et R242-1 CSS ; BOI-RSA-BASE-30-50",
    sourceLabel: "BOFiP-Impôts / URSSAF",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Confirmé par plusieurs sources professionnelles 2026 (Dougs, LégiSocial, Archipel Lyon...) : l'interdiction du barème forfaitaire s'applique aussi à l'abattement électrique associé — un TNS ne peut donc jamais bénéficier de l'abattement forfaitaire renforcé de 70% (plafond 4 641,60€), réservé aux dirigeants assimilés salariés en méthode forfaitaire. Seul l'abattement réel de 50% (plafond 2 026,30€, cf. règle dédiée) s'applique à un TNS, quelle que soit la valeur du véhicule.",
  },
  {
    id: "aen-abattement-vehicule-electrique-taux",
    category: "aen_vehicule",
    label: "Abattement AEN véhicule électrique éligible (méthode réelle)",
    value: "50 % de l'AEN, plafonné",
    legalReference: "Arrêté du 25 février 2025 relatif à l'évaluation des avantages en nature (art. 3)",
    sourceLabel: "Légifrance",
    sourceUrl: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000051230000",
    validFrom: "2025-02-01",
    validUntil: "2027-12-31",
    notes:
      "Dispositif renforcé applicable aux véhicules mis à disposition entre le 1er février 2025 et le 31 décembre 2027. Condition d'éligibilité : éco-score ≥ 60 points (liste ADEME) au jour de la mise à disposition. Modèles généralement éligibles : Tesla Model Y (assemblage Berlin), Renault Megane E-Tech, Renault Scenic E-Tech (assemblés en France). Modèle généralement non éligible : Tesla Model 3. Liste non exhaustive et évolutive — vérifier la liste ADEME officielle à jour.",
  },
  {
    id: "aen-abattement-vehicule-electrique-plafond",
    category: "aen_vehicule",
    label: "Plafond annuel de l'abattement véhicule électrique (méthode réelle)",
    value: "2 026,30 € / an (2026)",
    legalReference: "Arrêté du 25 février 2025 (revalorisation annuelle par circulaire URSSAF)",
    sourceLabel: "URSSAF",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Plafond révisé chaque année civile ; 4 641,60 € pour la méthode forfaitaire (non applicable aux TNS).",
  },
  {
    id: "cotisations-tns-taux-global",
    category: "cotisations_sociales",
    label: "Taux global de cotisations sociales TNS (gérant majoritaire)",
    value: "≈ 41 % à 45 % de la rémunération nette (défaut retenu : 43 %)",
    legalReference: "Art. L131-6 et s. CSS ; réforme de l'assiette sociale unique 2026",
    sourceLabel: "URSSAF / SSI",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Le taux exact dépend du revenu (tranches maladie, retraite de base/complémentaire, PASS 2026 = 48 060 €).",
  },
  {
    id: "cotisations-assimile-salarie-taux",
    category: "cotisations_sociales",
    label: "Charges sociales président assimilé salarié (SASU/SAS) sur avantage en nature",
    value: "≈ 55 % (charges patronales + salariales, ordre de grandeur)",
    legalReference: "Régime général — Art. L242-1 CSS",
    sourceLabel: "URSSAF",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Taux nettement supérieur au régime TNS ; à affiner selon la convention collective et les tranches.",
  },
  {
    id: "ir-bareme-2026",
    category: "impot_revenu",
    label: "Barème progressif de l'impôt sur le revenu (par part)",
    value: "0 % ≤ 11 497 € | 11 % ≤ 29 315 € | 30 % ≤ 83 823 € | 41 % ≤ 180 294 € | 45 % au-delà",
    legalReference: "Art. 197 CGI, revalorisé par la loi de finances pour 2026 (+0,9 %)",
    sourceLabel: "Service-Public.fr / Légifrance",
    sourceUrl: "https://www.service-public.gouv.fr/particuliers/actualites/A18045?lang=fr",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Applicable aux revenus perçus en 2026, déclarés en 2027. Revalorisé chaque année en loi de finances.",
  },
  {
    id: "ir-decote",
    category: "impot_revenu",
    label: "Décote de l'impôt sur le revenu",
    value: "897 € (seul) / 1 483 € (couple) − 45,25 % × impôt brut, si impôt brut < 1 982 € / 3 277 €",
    legalReference: "Art. 197, I-4 CGI",
    sourceLabel: "economie.gouv.fr",
    sourceUrl:
      "https://www.economie.gouv.fr/particuliers/impots-et-fiscalite/gerer-mon-impot-sur-le-revenu/pouvez-vous-beneficier-de-la-decote-de-limpot-sur-le-revenu",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "Réduit voire annule l'impôt des foyers modestes. Dans sa zone d'application, chaque euro de revenu marginal (ex. l'AEN) coûte 1,4525× le taux de la tranche en IR réel (dégressivité de la décote) : ce taux marginal effectif est utilisé par le simulateur en mode « calculer le TMI », au-delà du taux de tranche affiché.",
  },
  {
    id: "ir-abattement-10-salaires",
    category: "impot_revenu",
    label: "Abattement forfaitaire de 10 % sur les salaires (frais professionnels)",
    value: "Min 495 € — Max 14 171 € (valeurs reconduites, à confirmer PLF 2026)",
    legalReference: "Art. 83, 3° CGI",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2025-01-01",
    validUntil: "2026-12-31",
  },
  {
    id: "ik-bareme-2026",
    category: "indemnites_kilometriques",
    label: "Barème kilométrique automobile (indemnités kilométriques)",
    value: "Ex. 5 CV : 0,636 €/km (≤5000 km) ; (0,357×d)+1395 (5001-20000 km) ; 0,427 €/km (>20000 km)",
    legalReference: "Art. 6 B, annexe IV CGI ; barème publié par arrêté annuel (BOI-BAREME-000001)",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes: "Barème 2026 reconduit à l'identique de 2025. Majoration de 20 % pour les véhicules électriques.",
  },
  {
    id: "foncier-abattement-micro",
    category: "revenus_fonciers",
    label: "Abattement micro-foncier",
    value: "30 %, applicable si revenus fonciers bruts ≤ 15 000 €/an",
    legalReference: "Art. 32 CGI",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2017-01-01",
    validUntil: null,
  },
  {
    id: "foncier-prelevements-sociaux",
    category: "revenus_fonciers",
    label: "Prélèvements sociaux sur revenus fonciers",
    value: "17,2 %",
    legalReference: "Art. L136-6 CSS ; CGI art. 1600-0 C et s.",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2018-01-01",
    validUntil: null,
  },
  {
    id: "plafond-amortissement-vehicule",
    category: "fiscalite_vehicule_societe",
    label: "Plafond de déduction fiscale de l'amortissement (ou du loyer LOA/LLD au prorata)",
    value: "30 000 € (<20 g/km) | 20 300 € (20-49 g/km) | 18 300 € (50-160 g/km) | 9 900 € (>160 g/km)",
    legalReference: "Art. 39-4 CGI",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "La fraction du prix d'achat (ou du loyer, au prorata) au-delà du plafond n'est pas déductible du résultat fiscal et doit être réintégrée, y compris sur sa quote-part professionnelle. S'applique aussi bien à l'achat qu'à la LOA/LLD.",
  },
  {
    id: "taxe-annuelle-co2-polluants",
    category: "fiscalite_vehicule_societe",
    label: "Taxes annuelles sur l'affectation des véhicules de tourisme (ex-TVS)",
    value: "Barème progressif CO2 (ex. 100 g/km ≈ 213 €/an) + taxe polluants — exonération totale si 100% électrique/H2",
    legalReference: "Art. L421-94 et s. du code des impositions sur les biens et services",
    sourceLabel: "Service-Public Entreprendre",
    sourceUrl: "https://entreprendre.service-public.gouv.fr/vosdroits/F22203?lang=fr",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "A remplacé l'ex-TVS depuis 2023 (taxe CO2 + taxe polluants atmosphériques). Depuis 2025, les hybrides ne sont plus exonérés de la composante CO2. Le simulateur utilise une estimation simplifiée par paliers, à vérifier/ajuster manuellement (champ de surcharge) avant application stricte.",
  },
  {
    id: "malus-ecologique",
    category: "fiscalite_vehicule_societe",
    label: "Malus écologique (CO2 + poids) à l'achat d'un véhicule neuf",
    value: "Malus CO2 dès 108 g/km (jusqu'à 80 000 €) + malus au poids dès 1 500 kg (10 €/kg) — cumulables",
    legalReference: "Art. 1012 ter et 1012 ter A CGI",
    sourceLabel: "malus-ecologique.fr",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "Coût ponctuel généralement déjà inclus dans le prix TTC facturé par le concessionnaire : le simulateur en propose une estimation informative (champ « poids en ordre de marche ») pour vérifier la cohérence d'un prix catalogue, mais ne le déduit pas automatiquement — à vérifier que le « prix d'achat TTC » saisi l'intègre bien. Les véhicules 100% électriques sont exonérés du malus au poids sur toute l'année 2026.",
  },
  {
    id: "bonus-ecologique",
    category: "fiscalite_vehicule_societe",
    label: "Bonus écologique (aide à l'achat d'un véhicule électrique)",
    value: "Jusqu'à 5 700 € pour les entreprises (prix < 47 000 € TTC, masse < 2,4 t) + surbonus batterie UE",
    legalReference: "Décret n° 2014-1672 modifié ; dispositif désormais financé via les CEE depuis le 01/07/2025",
    sourceLabel: "Autosphere",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "Réduit le prix d'achat effectif si perçu par la société. Le champ « aide à l'achat perçue » du simulateur permet de le renseigner à titre informatif (affiché dans l'export), mais il reste à déduire manuellement du « prix d'achat TTC » saisi si la société en a déjà bénéficié — pour ne pas fausser la base de calcul de l'AEN/amortissement si le prix saisi est déjà net.",
  },
  {
    id: "tva-vehicule-carburant",
    category: "fiscalite_vehicule_societe",
    label: "TVA récupérable sur véhicule et carburant",
    value: "Véhicule de tourisme : 0% récupérable (sauf mise à disposition avec participation financière réelle depuis le 30/04/2025) · Carburant : 80% récupérable (100% si utilitaire)",
    legalReference: "Art. 206, IV, 2, 6° annexe II CGI",
    sourceLabel: "Qonto / Légifiscal",
    validFrom: "2025-04-30",
    validUntil: "2026-12-31",
    notes:
      "Non modélisé dans le simulateur (les montants saisis sont considérés TTC nets de toute récupération) — impact potentiel à vérifier au cas par cas, notamment si une participation financière réelle du dirigeant est mise en place (cf. section Optimisations).",
  },
  {
    id: "aen-forfaitaire-assimile-salarie",
    category: "aen_vehicule",
    label: "Méthode forfaitaire — alternative disponible pour les dirigeants assimilés salariés",
    value: "15%/20% (acheté) ou 50%/67% (loué) du prix ou du coût annuel, ou 30%/40% avec carburant payé par l'employeur",
    legalReference: "Arrêté du 25 février 2025 (barèmes forfaitaires AEN véhicule)",
    sourceLabel: "URSSAF",
    validFrom: "2025-02-01",
    validUntil: "2026-12-31",
    notes:
      "Contrairement aux gérants TNS (méthode réelle obligatoire), un président de SASU/SAS assimilé salarié peut légalement opter pour le barème forfaitaire, parfois plus favorable. Le simulateur applique uniformément la méthode réelle pour les deux statuts par souci de cohérence ; comparer manuellement avec ce barème forfaitaire si le statut est « assimilé salarié ».",
  },
  {
    id: "domicile-formalisation-bail-vs-indemnite",
    category: "revenus_fonciers",
    label: "Formalisation de la mise à disposition du domicile : indemnité d'occupation vs bail professionnel réel",
    value: "Même traitement fiscal de fond (revenu foncier) ; le bail réel offre une sécurité juridique accrue",
    legalReference: "Jurisprudence et doctrine (pas d'article dédié) — cf. art. L145-1 et s. C. com. pour le bail commercial",
    sourceLabel: "Compta-online / NS Avocats",
    sourceUrl: "https://www.compta-online.com/societe-domiciliee-chez-soi-indemnite-occupation-ou-loyer-t50793",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Il n'est pas possible de louer l'intégralité de la résidence principale à sa société (changement de destination) : seule la pièce dédiée à l'usage professionnel peut faire l'objet d'un bail. Le bail professionnel réel formalise davantage la relation (obligations, révision) que la simple indemnité d'occupation, réduisant le risque de requalification en cas de contrôle, au prix de frais de mise en place (rédaction, enregistrement).",
  },
  {
    id: "is-taux-normal",
    category: "impot_societe",
    label: "Taux normal de l'impôt sur les sociétés (barème progressif)",
    value: "15 % jusqu'à 42 500 € de bénéfice (sous conditions PME) puis 25 % au-delà",
    legalReference: "Art. 219, I-b CGI",
    sourceLabel: "BOFiP-Impôts",
    validFrom: "2022-01-01",
    validUntil: null,
    notes:
      "Taux réduit de 15% conditionné à : CA HT < 10 M€, capital entièrement libéré et détenu à ≥75% par des personnes physiques (généralement rempli pour une EURL/SARL/SASU familiale). Le simulateur applique ce barème progressif au bénéfice prévisionnel saisi et plafonne l'économie d'impôt générée par les charges déductibles (véhicule, indemnité d'occupation) au montant d'IS réellement dû sur ce bénéfice : une société déficitaire ou peu profitable ne récupère pas immédiatement tout le gain théorique — le surplus de charge ne fait qu'accroître un déficit reportable (avantage différé et incertain, non compté comme un gain immédiat).",
  },
  {
    id: "risque-abus-biens-sociaux-usage-prive",
    category: "risques_juridiques",
    label: "Risque pénal si usage privé très majoritaire non justifié (abus de biens sociaux)",
    value: "Jusqu'à 5 ans d'emprisonnement et 375 000 € d'amende — pas de seuil légal chiffré",
    legalReference: "Art. L241-3 et L242-6 code de commerce",
    sourceLabel: "Companeo / Portail PME",
    sourceUrl: "https://www.companeo.com/automobile-vl-vul/guide/le-loi-et-l-utilisation-personnelle-des-vehicules-de-societe",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Il n'existe aucun pourcentage légal d'usage privé « interdit » : l'infraction se caractérise par l'intention (usage contraire à l'intérêt social, sans contrepartie), quel que soit le montant. Un usage privé proche de 100% rend toutefois très difficile la justification de l'achat par la société (le simulateur affiche un avertissement croissant au-delà de 80/90/100%). Se prémunir : AEN correctement déclaré, carnet de bord précis, participation financière du dirigeant.",
  },
  {
    id: "taux-usure-credit-personnel",
    category: "risques_juridiques",
    label: "Taux d'usure (taux maximum légal) — prêts personnels",
    value: "23,56 % (≤3 000€, T1 2026) · 15,87 % (3 000-6 000€, T1 2026) · 8,56 % (>6 000€, T3 2026)",
    legalReference: "Art. L314-6 et L341-50 code de la consommation",
    sourceLabel: "Banque de France",
    sourceUrl: "https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure-2026-q3",
    validFrom: "2026-07-01",
    validUntil: "2026-09-30",
    notes:
      "Révisé chaque trimestre par la Banque de France. Le dépasser constitue un délit d'usure (jusqu'à 2 ans d'emprisonnement et 300 000 € d'amende pour le prêteur). Le simulateur plafonne automatiquement le TAEG saisi pour le mode « Crédit » à ce seuil (tranche >6 000€, la plus fréquente pour un crédit auto) et affiche une alerte en cas de dépassement.",
  },
  {
    id: "domicile-surface-bureau-tolerance-30-pourcent",
    category: "risques_juridiques",
    label: "Tolérance pratique de surface pour un bureau professionnel au domicile",
    value: "≈ 30 % de la surface totale du logement — au-delà, justification renforcée nécessaire",
    legalReference: "Doctrine/pratique professionnelle (pas de texte fixant un seuil légal strict)",
    sourceLabel: "BailFacile / Terrae Patrimoine",
    sourceUrl: "https://www.bailfacile.fr/guides/louer-partie-domicile-a-sa-societe",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Il reste possible de dépasser 30% si l'occupation professionnelle réelle est solidement justifiée (mais le risque de requalification augmente). Rappel : il n'est pas possible de louer l'intégralité d'un logement à usage principal d'habitation à sa société (changement de destination).",
  },
  {
    id: "charges-patronales-salariales-assimile-salarie",
    category: "remuneration_dirigeant",
    label: "Charges patronales et salariales — président assimilé salarié (SASU/SAS), régime général",
    value: "≈ 42 % de charges patronales (sur le brut) · ≈ 22 % de charges salariales (sur le brut)",
    legalReference: "Régime général — Art. L242-1 CSS",
    sourceLabel: "URSSAF",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "Ordres de grandeur pour un cadre assimilé salarié (le taux patronal réel varie fortement selon le niveau de rémunération, du fait des allègements Fillon sur les bas salaires). Cumulé, un coût total employeur de 100 se traduit par un net social d'environ 45 — proche du taux global de 55% déjà utilisé ailleurs dans l'application pour l'AEN.",
  },
  {
    id: "pfu-dividendes-taux",
    category: "remuneration_dirigeant",
    label: "Prélèvement forfaitaire unique (flat tax) sur les dividendes",
    value: "30 % (12,8 % IR + 17,2 % prélèvements sociaux)",
    legalReference: "Art. 200 A CGI",
    sourceLabel: "Service-Public.fr / Bercy Infos",
    sourceUrl: "https://www.economie.gouv.fr/particuliers/prelevement-forfaitaire-unique-pfu",
    validFrom: "2018-01-01",
    validUntil: null,
    notes:
      "Option pour le barème progressif de l'IR toujours possible (globale, pour tous les revenus mobiliers du foyer sur l'année), avec abattement de 40% sur l'assiette IR — intéressant surtout pour un foyer dont le TMI réel est inférieur à 12,8%. Les prélèvements sociaux de 17,2% restent dus dans tous les cas, sans abattement.",
  },
  {
    id: "dividendes-tns-seuil-10-pourcent-cotisations",
    category: "remuneration_dirigeant",
    label: "Cotisations sociales TNS sur les dividendes excédant 10% du capital (gérant majoritaire)",
    value: "Dividendes > 10% (capital social + primes d'émission + comptes courants d'associés) → cotisations sociales TNS sur l'excédent",
    legalReference: "Art. L131-6, al. 3 CSS (LFSS 2013)",
    sourceLabel: "URSSAF / Service-Public.fr",
    sourceUrl: "https://www.urssaf.fr/accueil/independants/vos-cotisations/calcul/dividendes.html",
    validFrom: "2013-01-01",
    validUntil: null,
    notes:
      "Concerne uniquement les gérants majoritaires de SARL/EURL soumises à l'IS (statut TNS). Ne s'applique pas au président (assimilé salarié) de SASU/SAS, dont les dividendes échappent totalement aux cotisations sociales (seul le PFU s'applique) — différence structurante dans l'arbitrage salaire/dividendes selon la forme juridique.",
  },
  {
    id: "materiel-petit-equipement-charge-immediate",
    category: "materiel_professionnel",
    label: "Déduction immédiate en charge du « petit matériel » (au lieu d'un amortissement)",
    value: "Prix unitaire HT ≤ 500€ → charge déductible immédiatement, sans amortissement",
    legalReference: "Art. 39-1 3° CGI",
    sourceLabel: "BOFiP-Impôts (BOI-BIC-CHG-20-30-10)",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1224-PGP.html",
    validFrom: "1960-01-01",
    validUntil: null,
    notes:
      "Seuil fixe (500€ HT), non revalorisé depuis des décennies. Au-delà, le matériel est immobilisé et amorti sur sa durée d'usage (généralement 3 ans pour l'informatique, 8-10 ans pour le mobilier de bureau).",
  },
  {
    id: "madelin-plafond-deduction-tns",
    category: "protection_sociale_dirigeant",
    label: "Plafond de déduction des cotisations Madelin santé/prévoyance (TNS)",
    value: "7% du PASS + 3,75% du bénéfice imposable, plafonné à 3% de 8×PASS",
    legalReference: "Art. 154 bis CGI ; loi n°94-126 du 11 février 1994 (loi Madelin)",
    sourceLabel: "URSSAF / Service-Public.fr",
    sourceUrl: "https://www.urssaf.fr/accueil/independants/vos-cotisations/exonerations/contrat-madelin.html",
    validFrom: "1994-01-01",
    validUntil: "2026-12-31",
    notes:
      "PASS 2026 = 48 060€. Ne s'applique qu'aux gérants majoritaires (statut TNS) — un président de SASU/SAS (assimilé salarié) n'y a pas droit, mais bénéficie en contrepartie d'une mutuelle collective obligatoire prise en charge à 50% minimum par l'employeur.",
  },
  {
    id: "mutuelle-collective-plafond-exoneration",
    category: "protection_sociale_dirigeant",
    label: "Plafond d'exonération sociale/fiscale de la mutuelle collective obligatoire (assimilé salarié)",
    value: "6% du PASS + 1,5% du salaire brut annuel, plafonné à 12% du PASS",
    legalReference: "Art. D242-1 CSS ; loi ANI du 11 janvier 2013 (généralisation au 1er janvier 2016)",
    sourceLabel: "URSSAF",
    sourceUrl: "https://www.urssaf.fr/accueil/employeur/dossiers-reglementaires/exonerations-de-cotisations/protection-sociale-complementair.html",
    validFrom: "2016-01-01",
    validUntil: "2026-12-31",
    notes:
      "Obligation légale de prise en charge patronale ≥50% (contrat collectif obligatoire, régime général). Au-delà du plafond, l'excédent est réintégré dans l'assiette des cotisations sociales et de l'impôt sur le revenu du salarié, comme un complément de rémunération — simplifié ici au seul coût IR (cf. note de module mutuellePrevoyance.ts).",
  },
  {
    id: "per-plafond-deduction-tns",
    category: "epargne_retraite_dirigeant",
    label: "Plafond de déduction du PER individuel / Madelin retraite (TNS)",
    value: "10% du bénéfice imposable (plafonné à 8×PASS) + 15% sur la tranche 1×PASS à 8×PASS, plancher 10% du PASS",
    legalReference: "Art. 154 bis, 163 quatervicies CGI ; ordonnance n°2019-766 (PER, ex-Madelin retraite)",
    sourceLabel: "Service-Public.fr / URSSAF",
    sourceUrl: "https://www.service-public.fr/particuliers/vosdroits/F35276",
    validFrom: "2019-10-01",
    validUntil: "2026-12-31",
    notes:
      "PASS 2026 = 48 060€. Plafond nettement plus généreux que celui des salariés dès que le bénéfice dépasse le PASS. Ne tient pas compte du report des plafonds non utilisés des 3 années précédentes (simplification).",
  },
  {
    id: "per-plafond-deduction-salarie",
    category: "epargne_retraite_dirigeant",
    label: "Plafond de déduction du PER individuel (assimilé salarié / droit commun)",
    value: "10% du revenu professionnel net N-1, plafonné à 8×PASS, plancher 10% du PASS",
    legalReference: "Art. 163 quatervicies CGI",
    sourceLabel: "Service-Public.fr / impots.gouv.fr",
    sourceUrl: "https://www.service-public.fr/particuliers/vosdroits/F35276",
    validFrom: "2019-10-01",
    validUntil: "2026-12-31",
    notes:
      "Plafond individuel affiché sur l'avis d'imposition (« plafond épargne retraite »). Comme pour le TNS, le report des plafonds non utilisés des 3 années précédentes n'est pas modélisé ici.",
  },
  {
    id: "per-cas-deblocage-anticipe",
    category: "epargne_retraite_dirigeant",
    label: "Cas de déblocage anticipé du PER (avant l'âge légal de la retraite)",
    value:
      "Liste limitative de 6 cas : décès du conjoint/partenaire de PACS, invalidité, surendettement, fin de droits au chômage, cessation d'activité non salariée suite à liquidation judiciaire, achat de la résidence principale",
    legalReference: "Art. L224-4 code monétaire et financier",
    sourceLabel: "Service-Public.fr",
    sourceUrl: "https://www.service-public.fr/particuliers/vosdroits/F35223",
    validFrom: "2019-10-01",
    validUntil: null,
    notes:
      "Liste FERMÉE : aucun autre événement (mariage, divorce, naissance...) n'ouvre droit au déblocage anticipé — seul le décès du conjoint/partenaire de PACS y figure, pas le mariage. Aucune durée de détention minimale n'est exigée pour invoquer un de ces cas (contrairement à l'assurance-vie et son palier des 8 ans) : le déblocage est possible dès le lendemain de l'ouverture si l'événement survient. L'achat de la résidence principale n'est ouvert qu'aux PER (pas aux anciens contrats Madelin retraite d'avant 2019, qui ne prévoyaient qu'une sortie en rente viagère, sans ce cas de déblocage).",
  },
  {
    id: "age-legal-retraite",
    category: "epargne_retraite_dirigeant",
    label: "Âge légal de départ à la retraite (sortie normale du PER)",
    value: "62 à 64 ans selon l'année de naissance (relèvement progressif)",
    legalReference: "Loi n°2023-270 du 14 avril 2023 (réforme des retraites)",
    sourceLabel: "Service-Public.fr / Assurance retraite",
    sourceUrl: "https://www.service-public.fr/particuliers/vosdroits/F31200",
    validFrom: "2023-09-01",
    validUntil: null,
    notes:
      "Relèvement progressif de 62 à 64 ans par génération, jusqu'à atteindre 64 ans pour les personnes nées à partir de 1968. Hors cas de déblocage anticipé, le PER n'est liquidable qu'à cet âge légal ou lors de la liquidation effective de la pension d'un régime obligatoire si l'activité se poursuit au-delà.",
  },
  {
    id: "credit-impot-irve",
    category: "fiscalite_vehicule_societe",
    label: "Crédit d'impôt pour l'achat et l'installation d'une borne de recharge (IRVE)",
    value: "75% du prix de revient TTC, plafonné à 20 000€ par système de charge",
    legalReference: "Art. 200 quater C CGI",
    sourceLabel: "impots.gouv.fr / economie.gouv.fr",
    sourceUrl: "https://www.economie.gouv.fr/entreprises/credit-impot-borne-recharge-vehicules-electriques",
    validFrom: "2021-01-01",
    validUntil: "2026-12-31",
    notes:
      "Dispositif prorogé par les lois de finances successives — vérifier la reconduction pour 2026/2027 avant application. S'impute directement sur l'IS dû (crédit d'impôt), en plus de la déductibilité normale de l'amortissement du solde non couvert.",
  },
  {
    id: "indemnite-recharge-domicile",
    category: "fiscalite_vehicule_societe",
    label: "Indemnité de recharge à domicile d'un véhicule de fonction électrique",
    value: "Forfait mensuel exonéré de charges sociales (ordre de grandeur ≈ 30€/mois), ou remboursement au réel sur justificatifs",
    legalReference: "BOSS (Bulletin officiel de la sécurité sociale) — frais professionnels, rubrique véhicules électriques",
    sourceLabel: "URSSAF",
    sourceUrl: "https://boss.gouv.fr/portail/accueil/remuneration/frais-professionnels.html",
    validFrom: "2023-01-01",
    validUntil: "2026-12-31",
    notes:
      "Le forfait exact dépend de la présence ou non d'un compteur dédié permettant de mesurer précisément la consommation liée à la recharge du véhicule — à défaut, un forfait simplifié s'applique. Valeur retenue ici à titre d'ordre de grandeur, à ajuster selon la situation réelle et le barème URSSAF en vigueur.",
  },
  {
    id: "interessement-forfait-social-pacte",
    category: "remuneration_dirigeant",
    label: "Exonération de forfait social sur l'intéressement (loi PACTE)",
    value: "0% pour les entreprises de moins de 250 salariés (au lieu de 20%)",
    legalReference: "Art. 16 loi n°2019-486 du 22 mai 2019 (loi PACTE)",
    sourceLabel: "Service-Public.fr / URSSAF",
    sourceUrl: "https://www.service-public.fr/professionnels-entreprises/vosdroits/F32440",
    validFrom: "2019-01-01",
    validUntil: null,
    notes:
      "Depuis la loi PACTE, le dirigeant d'une société de moins de 250 salariés (y compris sans salarié) peut lui-même bénéficier de l'intéressement mis en place dans son entreprise, au même titre que ses salariés — auparavant réservé aux seuls salariés.",
  },
  {
    id: "aga-regime-simplifie",
    category: "remuneration_dirigeant",
    label: "Attribution Gratuite d'Actions (AGA) — régime simplifié retenu par le simulateur",
    value: "Gain d'acquisition et gain de cession imposés au PFU (30%) ; contribution patronale de 20% exonérée pour les PME n'ayant jamais distribué de dividendes",
    legalReference: "Art. L225-197-1 code de commerce ; art. 80 quaterdecies et 200 A CGI ; art. L137-13 CSS",
    sourceLabel: "impots.gouv.fr / Bpifrance Création",
    sourceUrl: "https://www.impots.gouv.fr/particulier/actions-gratuites",
    validFrom: "2018-01-01",
    validUntil: null,
    notes:
      "Réservé aux sociétés par actions (SAS/SASU) — impossible en EURL/SARL. RÉGIME PARTICULIÈREMENT COMPLEXE, simplifié ici au cas le plus courant : le PFU est un choix par défaut, une option pour le barème progressif avec abattements pour durée de détention existe et peut être plus favorable selon les cas ; une contribution salariale spécifique de 10% s'ajoute au-delà de 300 000€ de gain (non modélisée). Avis d'un expert-comptable fortement recommandé avant toute décision.",
  },
  {
    id: "materiel-avantage-en-nature",
    category: "materiel_professionnel",
    label: "Avantage en nature (AEN) sur un matériel professionnel à usage mixte",
    value: "Évalué au prorata de l'usage privé, sur la base du coût de revient/durée d'amortissement (ou du loyer LOA)",
    legalReference: "BOI-RSA-BASE-30-50",
    sourceLabel: "BOFiP-Impôts",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1512-PGP.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Même principe général que l'AEN véhicule (mise à disposition d'un bien de l'entreprise à usage personnel), mais sans abattement spécifique (celui du véhicule électrique ne s'applique qu'aux véhicules). Nécessite un usage privé réel et documenté pour être opposable — sinon la déductibilité de la charge société elle-même peut être remise en cause (acte anormal de gestion).",
  },
];

export function getRule(id: string): TaxRule | undefined {
  return TAX_RULES.find((r) => r.id === id);
}

export function getRulesByCategory(category: RuleCategory): TaxRule[] {
  return TAX_RULES.filter((r) => r.category === category);
}

export type RuleStatus = "active" | "expiring_soon" | "expired";

/** Statut d'une règle à une date donnée (par défaut aujourd'hui). "Bientôt expirée" = échéance sous 90 jours. */
export function getRuleStatus(rule: TaxRule, atDate: Date = new Date()): RuleStatus {
  if (!rule.validUntil) return "active";
  const until = new Date(rule.validUntil);
  const diffDays = (until.getTime() - atDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "expired";
  if (diffDays <= 90) return "expiring_soon";
  return "active";
}
