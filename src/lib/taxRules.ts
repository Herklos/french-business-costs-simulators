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
  | "epargne_retraite_dirigeant"
  | "holding_montage_patrimonial";

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
    value: "Coût global annuel TTC de la location + assurance + entretien, proratisé par le kilométrage privé",
    legalReference: "BOI-RSA-BASE-30-50-30 ; arrêté du 25 février 2025, art. 3",
    sourceLabel: "URSSAF — les avantages en nature",
    sourceUrl: "https://www.urssaf.fr/accueil/employeur/cotisations/avantages-en-nature.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Le coût global annuel de la location se substitue à l'amortissement (20 %/10 %) lorsque le véhicule n'est pas acheté par la société. Il est retenu POUR SON MONTANT INTÉGRAL, puis proratisé par la part de kilométrage privé.\n\n" +
      "Attention à une confusion très répandue : les 30 % (portés à 50 % pour les véhicules mis à disposition depuis le 1er février 2025) que l'on lit partout à propos des véhicules loués relèvent de la méthode FORFAITAIRE. Ce taux s'applique au coût global annuel et représente à lui seul l'usage privé présumé : il n'est jamais suivi d'une proratisation kilométrique. Combiner les deux — appliquer 30 % puis la part d'usage privé — réduirait deux fois la même assiette pour le même motif et diviserait l'avantage par plus de trois. Les deux méthodes s'excluent : soit le forfait, soit le réel.",
  },
  {
    id: "aen-vehicule-loue-plafond-equivalent-achat",
    category: "aen_vehicule",
    label: "Plafonnement de l'AEN d'un véhicule loué au niveau d'un véhicule acheté",
    value: "L'avantage retenu ne peut excéder celui qui aurait été évalué si l'employeur avait acheté le véhicule",
    legalReference: "Arrêté du 25 février 2025, art. 3",
    sourceLabel: "Légifrance",
    sourceUrl: "https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000051254043",
    validFrom: "2025-02-01",
    validUntil: null,
    notes:
      "Nouveauté applicable aux véhicules mis à disposition à compter du 1er février 2025. Le prix de référence est le prix d'achat TTC du véhicule par le loueur, rabais compris dans la limite de 30 % du prix conseillé par le constructeur au jour du début du contrat ; les loueurs et crédit-bailleurs sont tenus de communiquer cet élément à l'entreprise locataire. À défaut de le connaître, le simulateur retient le prix du véhicule saisi.\n\n" +
      "Le plafond ne mord que sur les locations courtes et chères, dont le loyer annuel dépasse l'annuité d'amortissement qu'aurait produite un achat (20 % du prix, 10 % au-delà de cinq ans) : une LOA à 500 €/mois sur un véhicule de 45 000 € en reste très loin, une LOA à 900 €/mois sur le même véhicule le franchit.",
  },
  {
    id: "aen-methode-reelle-obligatoire-tns",
    category: "aen_vehicule",
    label: "Méthode d'évaluation obligatoire pour les gérants majoritaires TNS",
    value: "Valeur réelle uniquement (barème forfaitaire exclu)",
    legalReference: "Art. 62 CGI ; BOI-RSA-GER-20 ; arrêté du 25 février 2025 (champ : salariés et assimilés)",
    sourceLabel: "BOFiP-Impôts (BOI-RSA-GER-20)",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/6347-PGP.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Deux fondements convergents, l'un fiscal et l'autre social. Fiscalement, le BOFiP énonce que les avantages en nature concédés au dirigeant relevant de l'article 62 du CGI — dont le gérant majoritaire de SARL/EURL — sont TOUJOURS à évaluer selon leur valeur réelle, et qu'il n'existe pas de modalités forfaitaires d'évaluation comme pour les rémunérations allouées aux salariés (BOI-RSA-GER-20). Socialement, l'arrêté du 25 février 2025 qui fixe les barèmes forfaitaires vise expressément « les salariés affiliés au régime général et les salariés affiliés au régime agricole » : un TNS est hors de son champ.\n\n" +
      "Conséquence pratique souvent mal comprise : l'abattement renforcé de 70 % (plafond 4 641,60 € en 2026) pour véhicule électrique éligible est indissociable de la méthode forfaitaire, donc inaccessible à un gérant majoritaire. Seul l'abattement réel de 50 % (plafond 2 026,30 €, cf. règle dédiée) lui est ouvert, quelle que soit la valeur du véhicule.\n\n" +
      "L'OBJECTION LA PLUS FRÉQUENTE, ET SA RÉPONSE. Le BOFiP admet effectivement que l'avantage soit évalué forfaitairement « même en l'absence de cumul d'un contrat de travail avec le mandat social ». On en déduit parfois que tout dirigeant y a droit. C'est un contresens : cette tolérance vise les mandataires sociaux qui, faute de contrat de travail, pourraient croire le forfait salarial hors de leur portée alors qu'ils relèvent du régime général. Le BOFiP les ÉNUMÈRE LIMITATIVEMENT — gérants minoritaires ou égalitaires de SARL et SELARL, présidents du conseil d'administration, directeurs généraux et directeurs généraux délégués de SA et SELAFA. Le gérant majoritaire n'y figure pas, et ne peut pas y figurer : il n'est pas affilié au régime général. « Sans contrat de travail » ne signifie pas « travailleur non salarié ».\n\n" +
      "C'est la confusion la plus fréquente sur ce sujet, et elle change le coût du montage du simple au triple : sur une LOA à 491 €/mois avec 90 % d'usage privé, le forfait donnerait environ 900 € d'avantage après abattement renforcé, le réel environ 4 700 €.",
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
    id: "credit-impot-services-a-la-personne",
    category: "impot_revenu",
    label: "Crédit d'impôt pour l'emploi d'un salarié à domicile",
    value: "50 % des dépenses, plafond 12 000 € majoré de 1 500 € par enfant à charge (maximum 15 000 €), ou 20 000 € en cas d'invalidité",
    legalReference: "Art. 199 sexdecies CGI",
    sourceLabel: "Légifrance / economie.gouv.fr",
    sourceUrl: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054251333",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "Couvre le ménage, la garde d'enfants AU DOMICILE, le jardinage, le petit bricolage et le soutien scolaire, que le salarié soit employé directement ou par un organisme agréé.\n\n" +
      "C'EST LE PLAFOND, PAS LE TAUX, QUI DÉCIDE. Le taux de 50 % est connu de tous ; le plafond l'est beaucoup moins. Il s'établit à 12 000 € de dépenses, majoré de 1 500 € par enfant à charge et par membre du foyer de plus de 65 ans, sans pouvoir dépasser 15 000 €. Une situation d'invalidité dans le foyer — carte mobilité inclusion « invalidité », pension de 3e catégorie, complément d'AEEH — le porte à 20 000 €, mais supprime en contrepartie toute majoration.\n\n" +
      "VÉRITABLE CRÉDIT, non simple réduction : si son montant excède l'impôt dû, l'excédent est remboursé par virement plutôt que perdu.\n\n" +
      "SANS EFFET SUR LES SIMULATIONS, et c'est le point que le simulateur tient à rendre explicite : un crédit d'impôt s'impute sur l'impôt DÛ, pas sur le revenu imposable. Il ne déplace aucune tranche et ne modifie donc pas le taux marginal appliqué à un euro de rémunération, d'avantage en nature ou d'indemnité d'occupation supplémentaire.",
  },
  {
    id: "credit-impot-garde-jeunes-enfants",
    category: "impot_revenu",
    label: "Crédit d'impôt pour frais de garde des jeunes enfants hors du domicile",
    value: "50 % des dépenses, plafond 3 500 € par enfant de moins de 6 ans (moitié en garde alternée)",
    legalReference: "Art. 200 quater B CGI",
    sourceLabel: "Légifrance / BOI-IR-RICI-300",
    sourceUrl: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000051213135",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "Vise la garde HORS DU DOMICILE : crèche, halte-garderie, garderie périscolaire, assistante maternelle agréée. La garde au domicile relève de l'autre dispositif (art. 199 sexdecies), avec son propre plafond — les deux ne se cumulent pas sur une même dépense.\n\n" +
      "Le plafond de 3 500 € s'apprécie PAR ENFANT de moins de six ans au 1er janvier de l'année d'imposition, et non globalement : le crédit maximal atteint donc 1 750 € par enfant. Il est réduit de moitié lorsque l'enfant est réputé à charge égale de ses deux parents.\n\n" +
      "Les dépenses retenues sont nettes des aides perçues, notamment le complément de libre choix du mode de garde. Comme le précédent, c'est un véritable crédit : l'excédent est restitué. Et comme lui, il ne modifie pas le taux marginal d'imposition du foyer.",
  },
  {
    id: "coworking-deplacement-professionnel-vs-trajet-habituel",
    category: "fiscalite_vehicule_societe",
    label: "Trajet vers un espace de coworking : déplacement professionnel ou trajet domicile-travail ?",
    value:
      "Occasionnel/ponctuel → déplacement professionnel (usage PRO, IK exonérées sans plafond) | Régulier/stable → lieu de travail habituel (trajet domicile-travail, usage PRIVÉ pour l'AEN, plafond fiscal 40 km pour l'IK)",
    legalReference: "Notion jurisprudentielle de « lieu de travail habituel » ; BOI-RSA-BASE-30-50-30-20 ; BOI-BNC-BASE-40-60-40-10",
    sourceLabel: "Cass. soc. ; BOFiP-Impôts",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/2161-PGP.html/identifiant=BOI-RSA-BASE-30-50-30-20-20170224",
    validFrom: "2009-03-31",
    validUntil: null,
    notes:
      "Aucun texte ne vise spécifiquement le coworking : le régime applicable dépend uniquement de la RÉGULARITÉ d'usage du lieu, pas de sa nature — et cette qualification joue sur DEUX volets du simulateur, pas seulement les IK : le remboursement IK (achat personnel) ET la part professionnelle/privée d'un véhicule acheté ou loué par la société (usage, AEN).\n\n" +
      "CE QUI RENTRE (déplacement professionnel — usage PRO) :\n" +
      "— Usage ponctuel/occasionnel d'un espace de coworking : RDV client, journée isolée, alternance entre plusieurs lieux selon les besoins, événement professionnel, réunion d'équipe ponctuelle.\n" +
      "— Le critère retenu par la jurisprudence est l'absence de stabilité : le lieu ne devient pas le lieu de travail habituel tant que l'usage reste occasionnel et non récurrent selon un schéma fixe.\n" +
      "— Par analogie avec la règle des « 3 mois » appliquée aux salariés en mission chez un client (portage salarial, intérim IT) : durant une période d'usage encore temporaire, le trajet reste qualifié de déplacement professionnel.\n" +
      "— Conséquence achat personnel + IK : la société peut rembourser au barème kilométrique, exonéré de cotisations, sans plafond de distance.\n" +
      "— Conséquence voiture de société : ce trajet compte comme kilométrage PROFESSIONNEL dans le curseur « % d'usage privé » du simulateur — il n'alourdit donc pas l'AEN.\n\n" +
      "CE QUI NE RENTRE PAS (trajet domicile-travail ordinaire — usage PRIVÉ) :\n" +
      "— Usage régulier et stable du même coworking (plusieurs fois par semaine, de façon durable) : il devient le « lieu de travail habituel » au sens de la jurisprudence Cass. soc., 31 mars 2009, n°08-40.367 (« en cas de changements de lieux de travail, doit être retenu comme lieu de travail habituel le dernier lieu où, dans l'intention commune des parties, le salarié était appelé à exercer son activité de façon stable et durable »).\n" +
      "— Par analogie, Cass. soc., 6 mai 1985, n°83-15.748 : un salarié affecté à un « poste fixe » chez une entreprise tierce est considéré exercer son activité à son « lieu de travail habituel » (régime social des repas sédentaires, pas du déplacement).\n" +
      "— Conséquence fiscale, achat personnel + IK (dirigeant, frais réels) : la déduction du trajet domicile-coworking est plafonnée à 40 km aller (80 km A/R) sauf justification du caractère normal d'une distance supérieure (contraintes familiales, professionnelles, absence de transports en commun...). Au-delà des dispositifs encadrés existants (prime transport carburant plafonnée, forfait mobilités durables ~800-900 €/an en 2026, prise en charge 50% d'un abonnement transport en commun), un remboursement IK régulier de ce trajet est en principe réintégré dans l'assiette des cotisations sociales et de l'IR — requalifiable en complément de rémunération déguisé.\n" +
      "— Conséquence voiture de société (AEN) : le trajet domicile-« lieu de travail habituel » est en principe un usage PRIVÉ du véhicule (comme n'importe quel trajet domicile-siège), à intégrer dans le kilométrage privé du curseur « % d'usage privé » — il augmente donc l'AEN et, en cas de proportion très majoritaire, le risque d'abus de biens sociaux (cf. règle « risque-abus-biens-sociaux-usage-prive »).\n\n" +
      "VIGILANCE DIRIGEANT TNS : le risque de requalification par l'URSSAF est particulièrement surveillé chez les dirigeants/associés, où les IK ne doivent jamais servir de complément de revenu mais uniquement compenser une dépense réelle engagée pour les besoins de l'activité. Le simulateur ne modélise pas cette distinction automatiquement (barème IK et curseur d'usage identiques quel que soit le caractère occasionnel ou habituel du trajet) : à l'utilisateur d'apprécier, au cas par cas, si son usage du coworking relève de l'un ou l'autre régime avant d'en tenir compte dans son % d'usage privé ou ses IK.",
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
      "Réduit le prix d'achat effectif si perçu par la société. Le champ « aide à l'achat perçue » du simulateur permet de le renseigner à titre informatif (affiché dans l'export), mais il reste à déduire manuellement du « prix d'achat TTC » saisi si la société en a déjà bénéficié — pour ne pas fausser la base de calcul de l'AEN/amortissement si le prix saisi est déjà net. À ne pas confondre avec le « Coup de pouce véhicules particuliers électriques » (cf. règle « cee-coup-de-pouce-vehicule-electrique »), un dispositif CEE DISTINCT, réservé aux personnes physiques et non cumulable de la même façon avec un achat société.",
  },
  {
    id: "cee-coup-de-pouce-vehicule-electrique",
    category: "fiscalite_vehicule_societe",
    label: "Prime CEE « Coup de pouce véhicules particuliers électriques »",
    value: "Selon modèle et revenu du foyer — ex. Tesla Model Y : 3 600€ à 5 700€ ; Renault Megane/Scenic E-Tech : 4 830€ à 8 240€",
    legalReference: "Dispositif des certificats d'économies d'énergie (CEE) — fiche standardisée TRA-EQ-",
    sourceLabel: "economie.gouv.fr",
    sourceUrl: "https://www.economie.gouv.fr/particuliers/voyager-et-se-deplacer/achat-dun-vehicule-electrique-pouvez-vous-beneficier-de-la-prime-coup-de-pouce-vehicules-particuliers-electriques",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "RÉSERVÉ AUX PERSONNES PHYSIQUES (particuliers) : une société ne peut PAS bénéficier de ce dispositif spécifique pour un achat de véhicule de société — le simulateur ne le déduit donc jamais du prix côté société, quel que soit le paramétrage. Les entreprises/personnes morales peuvent en revanche bénéficier d'une prime CEE distincte pour véhicules professionnels (achat ou location ≥24 mois), sans condition de score environnemental — non modélisée ici (montants et conditions différents, non communiqués). Palier déterminé par le revenu fiscal de référence du foyer (plus le revenu est modeste, plus la prime est élevée) — montants bonifiés depuis le 01/10/2025 si la batterie et ses cellules sont assemblées en zone économique européenne. Montants exacts par modèle/finition à vérifier au moment de l'achat, le dispositif évoluant fréquemment.",
  },
  {
    id: "bonus-reprise-constructeur",
    category: "fiscalite_vehicule_societe",
    label: "Bonus de reprise commercial constructeur (état + reprise d'un ancien véhicule)",
    value: "Offre commerciale privée du constructeur, variable selon modèle/finition et période — ex. Tesla : 3 000€ à 5 000€ constatés 2026",
    legalReference: "Offre commerciale privée (non réglementaire)",
    sourceLabel: "Communication constructeur (Tesla, Renault...)",
    validFrom: "2026-01-01",
    validUntil: null,
    notes:
      "Contrairement à la prime CEE ci-dessus, il ne s'agit PAS d'un dispositif d'État mais d'une remise commerciale du constructeur — généralement ouverte aux achats professionnels (flotte d'entreprise) aussi, mais les conditions exactes (montant, éligibilité pro/particulier, période de validité) varient et doivent être confirmées au cas par cas avec le concessionnaire au moment de l'achat. Le simulateur laisse ce choix à l'utilisateur (case « applicable à un achat société »).",
  },
  {
    id: "tva-vehicule-carburant",
    category: "fiscalite_vehicule_societe",
    label: "TVA récupérable sur véhicule et carburant",
    value: "Véhicule de tourisme : 0% récupérable (sauf mise à disposition avec participation financière réelle, cf. règle dédiée) · Carburant : 80% récupérable · Électricité de recharge : 100% récupérable",
    legalReference: "Art. 206, IV, 2, 6° et 8° annexe II CGI ; BOI-TVA-DED-30-30-20 et BOI-TVA-DED-30-30-70",
    sourceLabel: "BOFiP-Impôts",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1186-PGP.html",
    validFrom: "2025-04-30",
    validUntil: "2026-12-31",
    notes:
      "PRINCIPE : la TVA grevant l'acquisition ou les loyers d'un véhicule conçu pour le transport de personnes (catégorie M, « véhicule de tourisme ») n'est pas déductible. L'exclusion s'apprécie sur la CONCEPTION du véhicule, pas sur son usage : elle ne dépend ni de la motorisation — un véhicule électrique y est soumis comme un thermique — ni du kilométrage professionnel.\n\n" +
      "PAS DE PRORATA, c'est l'erreur la plus répandue : un véhicule utilisé à 10 % professionnellement n'ouvre pas droit à 10 % de déduction. L'exclusion est totale ou elle n'est pas. Le prorata d'usage professionnel gouverne la déductibilité de la CHARGE à l'IS, jamais celle de la TVA.\n\n" +
      "PÉRIMÈTRE DE L'EXCLUSION : elle s'étend aux loyers, au premier loyer majoré, au prix de levée de l'option d'achat, et aux prestations afférentes au véhicule — dont l'entretien et les réparations, qui suivent le sort du bien auquel elles se rapportent (BOI-TVA-DED-30-30-70).\n\n" +
      "EXCEPTIONS : véhicules utilitaires (VU), transport public de voyageurs, taxis et VTC, auto-écoles, véhicules affectés à une véritable activité de location. Cette dernière exception suppose une activité de location réelle : une convention interne mettant le véhicule à disposition du dirigeant ne transforme pas la société en loueur, l'administration s'attachant à l'activité effective et à l'affectation du véhicule. Une variante encadrée existe toutefois depuis le 30/04/2025 en cas de participation financière réelle : cf. règle « tva-vehicule-fonction-participation-financiere ».\n\n" +
      "L'ÉLECTRICITÉ DE RECHARGE ÉCHAPPE À TOUT CELA : ce n'est pas une dépense afférente au véhicule exclu mais une dépense d'énergie, déductible à 100% (art. 206, IV, 2, 8° annexe II CGI), contre 80% pour l'essence et le gazole. Un avantage supplémentaire de l'électrique, souvent oublié — non modélisé par le simulateur, qui ne chiffre pas la recharge côté société.\n\n" +
      "CE QUE LE SIMULATEUR MODÉLISE : la TVA du véhicule (loyers ou amortissement) et de l'entretien, uniquement lorsque l'option de participation financière est activée. En dehors de ce cas, tous les montants sont traités TTC, sans récupération.",
  },
  {
    id: "deduction-exceptionnelle-vehicules-electriques-lourds",
    category: "fiscalite_vehicule_societe",
    label: "Déduction exceptionnelle « énergies propres » — inapplicable à une voiture particulière",
    value: "20 % à 60 % de déduction supplémentaire, réservée aux véhicules d'un PTAC ≥ 2,6 tonnes",
    legalReference: "Art. 39 decies A CGI ; loi n°2025-127 du 14 février 2025 de finances pour 2025, art. 77",
    sourceLabel: "BOFiP-Impôts (BOI-BIC-BASE-100-20)",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/10079-PGP.html",
    validFrom: "2025-01-01",
    validUntil: "2030-12-31",
    notes:
      "Règle inscrite ici pour DÉMENTIR une confusion fréquente, pas pour être appliquée. On entend souvent qu'« un véhicule électrique bénéficie d'un suramortissement » : c'est vrai, mais le dispositif de l'art. 39 decies A vise les POIDS LOURDS et les VÉHICULES UTILITAIRES LÉGERS d'un poids total autorisé en charge d'au moins 2,6 tonnes. Une voiture particulière, fût-elle électrique et lourde, en est exclue par sa catégorie.\n\n" +
      "Depuis le 1er janvier 2025, la déduction se calcule au surplus sur le SURCOÛT par rapport à un véhicule équivalent, et non sur le prix d'acquisition — et reste subordonnée au respect de l'encadrement européen des aides d'État. Le simulateur ne le modélise donc pas : l'invoquer dans une note justificative pour un véhicule de tourisme serait une erreur.",
  },
  {
    id: "tva-vehicule-fonction-participation-financiere",
    category: "fiscalite_vehicule_societe",
    label: "TVA déductible sur un véhicule de fonction en cas de participation financière du dirigeant",
    value: "TVA sur l'achat/les loyers déductible si la mise à disposition est facturée à un prix de marché (sinon 0%)",
    legalReference: "CJUE, 20 janvier 2021, QM, C-288/19 ; rescrit BOI-RES-TVA-000161 du 30 avril 2025 ; art. 256 CGI",
    sourceLabel: "BOFiP-Impôts (rescrit BOI-RES-TVA-000161)",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/14347-PGP.html/identifiant=BOI-RES-TVA-000161-20250430",
    validFrom: "2025-04-30",
    validUntil: null,
    notes:
      "MÉCANISME : si la société facture au dirigeant une contrepartie financière réelle pour l'usage privé du véhicule, cette mise à disposition devient une PRESTATION DE SERVICES À TITRE ONÉREUX soumise à TVA. La société collecte alors de la TVA sur cette participation, mais récupère en contrepartie la TVA sur le prix d'achat ou sur les loyers du véhicule — alors même que l'usage est privé.\n\n" +
      "POINT DÉCISIF, SOURCE DE LA PLUPART DES ERREURS : déclarer un AVANTAGE EN NATURE sur le bulletin de paie NE CONSTITUE PAS une contrepartie. Le rescrit est explicite : l'octroi d'un avantage en nature constaté sur le bulletin, sans contrepartie réelle fournie par le bénéficiaire, N'OUVRE PAS le droit à déduction. Le dirigeant doit véritablement s'appauvrir.\n\n" +
      "FORMES DE CONTREPARTIE ADMISES par le rescrit : (1) un paiement effectif par le bénéficiaire ; (2) une retenue sur le salaire brut ou net ; (3) le renoncement à un avantage contractuel (points/crédits convertibles en rémunération supplémentaire). Le principe commun : le bénéficiaire renonce à une part de sa rémunération monétaire en échange d'un avantage individualisé.\n\n" +
      "CONDITION DE MONTANT : la contrepartie doit être RÉELLE et non symbolique. Les praticiens recommandent de l'aligner sur le prix du marché — proche de ce qu'un loueur professionnel facturerait pour un véhicule similaire — à double titre : pour caractériser le lien direct exigé par la CJUE, et pour prévenir une réévaluation de la base d'imposition, le dirigeant étant une partie liée à la société.\n\n" +
      "AUTRE CONDITION, PRÉALABLE : la société doit être elle-même redevable de la TVA. Une société en franchise en base, ou dont l'activité est exonérée (certaines professions médicales, para-médicales, d'assurance...), ne récupère rien, quelle que soit la participation versée.\n\n" +
      "INTÉRÊT : dans de nombreux cas, la TVA récupérée sur le prix/les loyers excède la TVA collectée sur la participation, générant un gain net pour la société.\n\n" +
      "ATTENTION À NE PAS CONFONDRE deux effets opposés de la participation financière, tous deux modélisés par le simulateur : (1) côté AEN, elle RÉDUIT l'avantage en nature imposable ; (2) côté TVA, elle OUVRE le droit à déduction sur le véhicule.\n\n" +
      "PÉRIMÈTRE MODÉLISÉ (case « Participation facturée au prix de marché → récupérer la TVA », section Optimisations) : TVA récupérée sur le véhicule — loyer annuel en LOA/LLD, amortissement annuel en comptant/crédit (étaler la TVA du prix d'achat sur la durée d'amortissement en restitue bien 100% au total) — et sur l'entretien, qui suit le régime du véhicule. L'assurance en est exclue (opération exonérée de TVA, art. 261 C CGI), de même que les taxes annuelles. En contrepartie, la société collecte la TVA sur la participation encaissée : celle-ci est reversée au Trésor, et la participation n'est donc imposée à l'IS que sur sa base HT. L'option est automatiquement neutralisée si aucune participation n'est versée. N'affecte que les options « Société » : un achat personnel n'ouvre aucun droit à déduction.\n\n" +
      "CAS PARTICULIERS PRIS EN CHARGE :\n" +
      "— Véhicule d'occasion acheté à un particulier ou sous le régime de la marge : le prix ne contient aucune TVA récupérable. Répondre « Non » au champ « Le prix d'achat contient-il de la TVA récupérable ? » retire alors la composante véhicule de la base, en ne conservant que l'entretien (facturé avec TVA par le garage quelle que soit l'origine du véhicule). Sans effet en LOA/LLD, dont les loyers sont toujours facturés avec TVA par un loueur assujetti.\n" +
      "— Levée de l'option d'achat en LOA : le rachat est facturé TVA comprise par le loueur. Sa TVA est récupérée et annualisée sur la durée du contrat, comme l'est la valeur résiduelle en comptant/crédit. Le coût du rachat lui-même reste hors coût annuel (paiement unique compensé par la valeur du véhicule alors acquis) : la TVA récupérée en est donc bien l'effet incrémental net.\n" +
      "— Offre LLD « tout compris » : le champ « Loyer tout compris » du mode LLD neutralise assurance et entretien POUR CE SEUL MODE, dans le coût comme dans les bases d'AEN et de TVA. Les montants saisis restent utilisés par les modes comptant, crédit et LOA, où ces charges sont réellement supportées en plus du financement.\n\n" +
      "À valider avec un expert-comptable avant de mettre en place le dispositif (facturation, mentions obligatoires, cohérence de la participation avec le prix de marché, régularisations éventuelles en cas de revente).",
  },
  {
    id: "cout-sortie-resultat-pfu",
    category: "remuneration_dirigeant",
    label: "Coût de sortie du résultat vers le patrimoine du dirigeant (PFU)",
    value: "30 % sur les dividendes (12,8 % d'IR forfaitaire + 17,2 % de prélèvements sociaux)",
    legalReference: "Art. 200 A CGI (prélèvement forfaitaire unique) ; art. L136-6 CSS",
    sourceLabel: "Service-Public Entreprendre",
    sourceUrl: "https://entreprendre.service-public.gouv.fr/vosdroits/F32963",
    validFrom: "2018-01-01",
    validUntil: null,
    notes:
      "POURQUOI CETTE RÈGLE FIGURE DANS UN SIMULATEUR DE VÉHICULE : tout comparatif « coût global consolidé » additionne les euros de la société et ceux du dirigeant à parité. C'est une hypothèse implicite, et elle n'est vraie que si le résultat de la société reste investi dans l'entreprise.\n\n" +
      "Si le dirigeant destine ce résultat à son patrimoine, une charge supportée par la société ne l'ampute pas d'un euro de patrimoine personnel mais de la fraction qui lui serait effectivement parvenue, soit 70 % après PFU. Une charge logée dans la société pèse donc MOINS qu'une charge payée avec de l'argent déjà net — ce que le point de vue « poche du dirigeant » du comparatif restitue.\n\n" +
      "CONSÉQUENCE PRATIQUE : ce changement de point de vue peut RENVERSER le classement des options, en particulier à usage privé élevé, où le scénario « achat personnel » l'emporte au coût consolidé tandis que le scénario « société » l'emporte une fois le coût de sortie pris en compte. Aucun des deux classements n'est faux : ils répondent à des questions différentes. Le taux est paramétrable — le mettre à 0 revient au coût consolidé.\n\n" +
      "LIMITE : le PFU de 30 % est le régime de droit commun des dividendes. L'option pour le barème progressif, la fiscalité propre aux dirigeants majoritaires de SARL (fraction de dividendes soumise à cotisations au-delà de 10 % du capital), ou une sortie par rémunération plutôt que par dividendes, conduiraient à un coût de sortie différent — d'où le caractère éditable du taux.",
  },
  {
    id: "participation-financiere-deduction-aen",
    category: "aen_vehicule",
    label: "Participation financière du bénéficiaire : déduction de l'avantage en nature",
    value: "Vient en déduction de la valeur de l'AEN, jusqu'à l'annuler si elle l'égale",
    legalReference: "Art. R242-1 CSS ; BOI-RSA-BASE-30-50-30 ; rescrit BOI-RES-TVA-000161 (formes de contrepartie)",
    sourceLabel: "URSSAF",
    sourceUrl: "https://www.urssaf.fr/accueil/employeur/cotisations/avantages-en-nature.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "PRINCIPE : un avantage en nature est constitué lorsque le bénéficiaire dispose d'un bien gratuitement OU moyennant une participation inférieure à sa valeur réelle. La participation qu'il verse vient donc en déduction de la valeur de l'avantage, et l'annule lorsqu'elle l'égale — il n'y a alors plus d'assiette à soumettre à cotisations.\n\n" +
      "MODALITÉS DE VERSEMENT ADMISES, d'après le rescrit BOI-RES-TVA-000161 : paiement effectif, retenue sur le salaire net ou brut, renoncement à un avantage contractuel convertible en rémunération. En pratique de paie, la retenue s'opère sur le NET à payer, « sans modifier le brut soumis à charges ».\n\n" +
      "POINT DE VIGILANCE MODÉLISÉ PAR LE SIMULATEUR : une réduction de la rémunération BRUTE ne s'impute pas, en plus, sur l'avantage en nature. Le sacrifice est alors déjà porté par la rémunération amputée ; le déduire une seconde fois de l'avantage retrancherait deux fois un sacrifice unique de l'assiette du bénéficiaire. Le simulateur n'impute donc la participation sur l'AEN que pour les modalités prélevées sur des ressources nettes.\n\n" +
      "LIMITE : l'URSSAF peut requalifier si la proportion entre les frais réellement engagés par l'entreprise et la participation demandée est manifestement disproportionnée, ou si la participation n'est pas réellement supportée par le bénéficiaire (cf. règle « risque-abus-droit-participation-compensee »).",
  },
  {
    id: "renonciation-remuneration-inopposable-urssaf",
    category: "risques_juridiques",
    label: "Renonciation à une rémunération déjà due : inopposable à l'URSSAF",
    value: "Les cotisations restent dues sur la rémunération abandonnée",
    legalReference: "Jurisprudence Cour de cassation (chambre civile 2e / sociale) ; art. L242-1 CSS",
    sourceLabel: "LégiSocial",
    sourceUrl:
      "https://www.legisocial.fr/jurisprudences-sociales/369-la-remuneration-dun-dirigeant-doit-etre-soumise-cotisations-meme-sil-y-renonce-par-la-suite.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "DISTINCTION DÉTERMINANTE pour qui envisage de financer une participation en réduisant sa rémunération.\n\n" +
      "— RÉDUCTION DÉCIDÉE POUR L'AVENIR : la rémunération future est abaissée par décision de l'organe social AVANT d'être due. Rien n'étant dû, rien n'est cotisé ni imposé. C'est la seule voie qui produise réellement l'économie.\n\n" +
      "— RENONCIATION APRÈS COUP : le dirigeant renonce à encaisser une rémunération déjà due. La Cour de cassation juge cette renonciation INOPPOSABLE À L'URSSAF : les cotisations restent dues sur la somme abandonnée, l'économie sociale disparaît. L'administration fiscale peut en outre y voir une minoration artificielle de l'IS et de l'IR.\n\n" +
      "Le simulateur ne chiffre que la première voie. Si le montage envisagé relève de la seconde, retenir une modalité de versement « sur ressources nettes », dont le coût correspond au montant effectivement versé.",
  },
  {
    id: "risque-abus-droit-participation-compensee",
    category: "risques_juridiques",
    label: "Risque d'abus de droit : participation compensée par une augmentation de rémunération",
    value: "Montage circulaire — requalification possible sur le fondement de l'art. L64 A LPF (but principalement fiscal)",
    legalReference: "Art. L64 et L64 A du Livre des procédures fiscales ; art. R242-1 CSS (contrepartie réelle)",
    sourceLabel: "BOFiP-Impôts (BOI-CF-IOR-30-20)",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/12049-PGP.html/identifiant=BOI-CF-IOR-30-20-20200131",
    validFrom: "2021-01-01",
    validUntil: null,
    notes:
      "LA PARTICIPATION EN ELLE-MÊME EST PARFAITEMENT RÉGULIÈRE : l'URSSAF prévoit expressément que la participation financière versée par le bénéficiaire vient en déduction de la valeur de l'avantage en nature, jusqu'à l'annuler si elle l'égale.\n\n" +
      "CE QUI POSE PROBLÈME, c'est de la faire financer par la société elle-même au moyen d'une augmentation de rémunération calibrée sur son montant. L'opération devient CIRCULAIRE : la société verse une rémunération majorée qui lui revient aussitôt sous forme de participation, sans autre effet net que la disparition de l'avantage en nature. Trois risques distincts en découlent :\n\n" +
      "1. ABUS DE DROIT FISCAL. Depuis 2021, l'art. L64 A LPF permet d'écarter un montage poursuivant un but PRINCIPALEMENT fiscal — et non plus seulement exclusivement, comme l'exige l'art. L64. Ce seuil abaissé vise précisément les opérations dont le but réel ne correspond pas à l'apparence juridique. Une augmentation de rémunération dont le montant épouse celui de la participation, décidée au même moment, sans justification propre (revalorisation, évolution des fonctions, comparaison de marché), expose à cette requalification. Sur le fondement de l'art. L64 (but exclusivement fiscal), la majoration est en outre de 80 %.\n\n" +
      "2. REQUALIFICATION SOCIALE. La déduction de l'avantage en nature suppose une participation RÉELLE du bénéficiaire, c'est-à-dire un appauvrissement effectif. Si la société lui fournit par ailleurs les fonds correspondants, cet appauvrissement est neutralisé et l'URSSAF peut refuser la déduction, réintégrant l'avantage en nature pour sa valeur pleine avec les cotisations afférentes.\n\n" +
      "3. PERTE DU DROIT À DÉDUCTION DE TVA. Le rescrit BOI-RES-TVA-000161 exige que le bénéficiaire s'appauvrisse réellement. Une participation intégralement refinancée par l'employeur ne caractérise plus la contrepartie exigée : le droit à déduction ouvert par le dispositif tomberait avec elle.\n\n" +
      "À NOTER, INDÉPENDAMMENT DU RISQUE JURIDIQUE : le montage est de toute façon perdant. Le coût chargé de l'augmentation excède largement les cotisations et l'IR que la disparition de l'avantage permet d'éviter — le simulateur le vérifie sur toutes les combinaisons testées. Il déplace la charge du dirigeant vers la société en l'alourdissant au passage.\n\n" +
      "CE QUI RESTE RÉGULIER : une augmentation de rémunération décidée pour ses propres motifs, documentée comme telle, et une participation versée par ailleurs. C'est la CALIBRATION de l'une sur l'autre et leur simultanéité qui caractérisent le montage artificiel, non le fait d'augmenter une rémunération.",
  },
  {
    id: "vehicule-fonction-vs-vehicule-service",
    category: "fiscalite_vehicule_societe",
    label: "Véhicule de fonction (élément de rémunération) vs véhicule de service (outil de travail)",
    value: "Véhicule de fonction : usage privé autorisé sans limite, aucun besoin professionnel à justifier, AEN obligatoire",
    legalReference: "Art. 39-1-1° CGI (rémunérations déductibles, y compris avantages en nature)",
    sourceLabel: "Legalstart / BOFiP-Impôts",
    sourceUrl: "https://www.legalstart.fr/fiches-pratiques/vehicule-professionnel/difference-vehicule-fonction-et-service/",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "DISTINCTION FONDAMENTALE, souvent ignorée, qui change la façon de justifier le véhicule quand l'usage professionnel est faible ou nul :\n\n" +
      "— VÉHICULE DE SERVICE : outil de travail. L'usage privé est en principe exclu (restitution hors temps de travail). Sa déductibilité repose sur le BESOIN PROFESSIONNEL, qu'il faut pouvoir prouver (missions, clients, chantiers). Sans usage pro réel, cette qualification ne tient pas.\n\n" +
      "— VÉHICULE DE FONCTION : ÉLÉMENT DE RÉMUNÉRATION. Mis à disposition de façon permanente, l'usage privé est autorisé, y compris exclusif. Sa déductibilité ne repose PAS sur un besoin professionnel mais sur l'art. 39-1-1° CGI, qui rend déductibles « les rémunérations directes ou indirectes, y compris les indemnités, allocations, AVANTAGES EN NATURE et remboursements de frais », dès lors qu'elles correspondent à un travail effectif et ne sont pas excessives.\n\n" +
      "CONSÉQUENCE PRATIQUE : un dirigeant sans déplacement professionnel ne doit pas chercher à justifier un « besoin pro » inexistant, mais à qualifier et formaliser le véhicule comme un complément de rémunération (cf. règles « vehicule-fonction-formalisme-organe-social » et « remuneration-globale-non-excessive »). L'AEN doit alors être déclaré à 100% de l'usage privé réel, sans minoration.\n\n" +
      "Un véhicule de fonction ne peut plus être retiré unilatéralement par la société sans compenser la perte de rémunération correspondante : c'est la contrepartie de cette qualification.",
  },
  {
    id: "vehicule-fonction-formalisme-organe-social",
    category: "fiscalite_vehicule_societe",
    label: "Formalisme obligatoire : décision d'organe social / convention réglementée",
    value: "PV d'AG ou registre des décisions de l'associé unique mentionnant la mise à disposition comme élément de rémunération",
    legalReference: "Art. L227-10 (SAS) et L223-19 (SARL) code de commerce ; CE 9e-10e ch., 4 oct. 2023, n° 466887, Sté Collectivision",
    sourceLabel: "Conseil d'État / Legalstart",
    sourceUrl: "https://www.legifrance.gouv.fr/ceta/id/CETATEXT000048157006",
    validFrom: "2023-10-04",
    validUntil: null,
    notes:
      "C'EST LE POINT LE PLUS IMPORTANT quand l'usage privé est majoritaire ou exclusif — plus important que le carnet de bord.\n\n" +
      "FONDEMENT JURISPRUDENTIEL : par la décision Sté Collectivision (CE, 4 oct. 2023, n° 466887), le Conseil d'État juge que « le choix d'un mode de rémunération indirect ne caractérise pas en lui-même un appauvrissement à des fins étrangères à l'intérêt de la société », dès lors que la société établit que SES ORGANES SOCIAUX COMPÉTENTS ONT ENTENDU rémunérer indirectement le dirigeant — le versement n'étant alors pas dépourvu de contrepartie pour elle. Cette décision porte sur des honoraires de management fees, mais le raisonnement s'applique par analogie à tout mode de rémunération indirecte, dont l'avantage en nature véhicule : la contrepartie pour la société n'est pas « le véhicule sert l'activité » mais « le véhicule rémunère le dirigeant ». Encore faut-il pouvoir le prouver, d'où l'exigence d'un écrit.\n\n" +
      "CE QU'IL FAUT FAIRE :\n" +
      "— SASU / EURL (associé unique dirigeant) : la procédure d'approbation ne s'applique pas et aucun rapport spécial n'est requis, mais l'art. L223-19, dernier alinéa, du code de commerce impose qu'« il en est seulement fait mention au registre des décisions » de l'associé unique. Cette mention n'est pas une formalité d'archivage : c'est la seule trace qui rende la convention opposable, et son absence est ce qui transforme un avantage régulier en avantage occulte.\n" +
      "— SAS / SARL pluripersonnelles : convention réglementée (art. L227-10 / L223-19 c. com.), déclarée et soumise au vote des associés.\n" +
      "— Contenu à faire figurer : mise à disposition permanente, usage privé expressément autorisé et sans restriction, qualification explicite d'ÉLÉMENT DE RÉMUNÉRATION, méthode d'évaluation de l'AEN retenue.\n\n" +
      "SANCTION DU DÉFAUT : responsabilité personnelle du dirigeant sur les conséquences dommageables de la convention, et risque de requalification en distribution déguisée (taxation en revenus de capitaux mobiliers chez le dirigeant, perte des abattements salaires).",
  },
  {
    id: "remuneration-globale-non-excessive",
    category: "fiscalite_vehicule_societe",
    label: "Limite : caractère non excessif de la rémunération globale (salaire + AEN véhicule)",
    value: "Déductible si correspond à un travail effectif ET non excessive eu égard à l'importance du service rendu",
    legalReference: "Art. 39-1-1° CGI",
    sourceLabel: "Implid / Actu-Juridique",
    sourceUrl: "https://www.implid.com/article/remuneration-excessive-des-dirigeants-quelles-consequences-fiscales",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "C'est le principal risque résiduel une fois le véhicule correctement qualifié et formalisé : ce n'est plus l'existence de l'avantage qui est attaquable, mais son MONTANT rapporté à l'ensemble de la rémunération.\n\n" +
      "CRITÈRES RETENUS PAR L'ADMINISTRATION : niveau de rémunération de personnes occupant un emploi analogue (même secteur, même taille d'entreprise), importance de la rémunération rapportée aux bénéfices sociaux, comparaison avec les salaires des autres membres du personnel, qualification professionnelle et travail réellement fourni.\n\n" +
      "DOUBLE PEINE EN CAS DE REDRESSEMENT : la fraction jugée excessive est (1) réintégrée au résultat imposable de la société — perte de la déduction — ET (2) taxée chez le dirigeant en revenus de capitaux mobiliers au lieu des traitements et salaires, ce qui lui fait perdre automatiquement l'abattement de 10% pour frais professionnels.\n\n" +
      "EN PRATIQUE : additionner rémunération versée + AEN véhicule et vérifier que le total reste cohérent avec le marché et avec le résultat de la société. Un AEN véhicule important sur une société à faible bénéfice est le profil le plus exposé.",
  },
  {
    id: "aen-forfaitaire-assimile-salarie",
    category: "aen_vehicule",
    label: "Méthode forfaitaire — alternative disponible pour les dirigeants assimilés salariés",
    value:
      "Acheté : 15 % du prix TTC (10 % si > 5 ans), 20 % si l'employeur paie le carburant. Loué : 50 % du coût global annuel, 67 % avec le carburant.",
    legalReference: "Arrêté du 25 février 2025 (barèmes forfaitaires AEN véhicule)",
    sourceLabel: "URSSAF",
    sourceUrl: "https://www.urssaf.fr/accueil/employeur/cotisations/avantages-en-nature.html",
    validFrom: "2025-02-01",
    validUntil: "2027-12-31",
    notes:
      "Taux relevés par l'arrêté du 25 février 2025 pour les véhicules mis à disposition à compter du 1er février 2025 : les anciens taux (9 %/12 % à l'achat, 30 %/40 % en location) restent applicables aux véhicules mis à disposition avant cette date. Un barème encore largement cité comme s'il était en vigueur.\n\n" +
      "Le forfait s'applique au coût global annuel SANS proratisation kilométrique : il représente à lui seul l'usage privé présumé. Il n'est ouvert qu'aux dirigeants relevant du régime général — président de SAS/SASU, gérant minoritaire ou égalitaire — et jamais à un gérant majoritaire TNS (cf. règle dédiée). Le simulateur applique uniformément la méthode réelle ; comparer manuellement avec ce barème si le statut est « assimilé salarié », le forfait étant souvent plus favorable dès que l'usage privé dépasse la moitié du kilométrage.",
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
    id: "foncier-charges-deductibles-regime-reel",
    category: "revenus_fonciers",
    label: "Charges déductibles du revenu foncier au régime réel, dont les intérêts d'emprunt",
    value: "Charges réelles au prorata de la surface professionnelle — les intérêts d'emprunt en font partie",
    legalReference: "Art. 31, I-1° CGI (dont d : intérêts des dettes contractées pour l'acquisition du bien)",
    sourceLabel: "BOFiP-Impôts — RFPI, charges déductibles",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1876-PGP.html",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Le choix du régime est structurant : le micro-foncier applique un abattement forfaitaire de 30 % qui REMPLACE toute déduction, tandis que le régime réel déduit les charges effectives. Un propriétaire encore lourdement endetté a donc souvent intérêt au réel, un propriétaire sans emprunt au micro.\n\n" +
      "CE QUI EST DÉDUCTIBLE (art. 31, I-1° CGI) : intérêts d'emprunt ET assurance emprunteur adossée à ce prêt (même ligne 250 de la 2044, cf. BOI-RFPI-BASE-20-60), primes d'assurance, dépenses de réparation, d'entretien et d'amélioration — à l'exclusion des travaux de construction, reconstruction ou agrandissement —, frais de gestion, charges de copropriété non récupérables, et taxe foncière.\n\n" +
      "CE QUI NE L'EST PAS, malgré les apparences : la TAXE D'ENLÈVEMENT DES ORDURES MÉNAGÈRES. Elle figure pourtant sur l'avis de taxe foncière, mais c'est une charge récupérable auprès du locataire, donc exclue (BOI-RFPI-BASE-20-50). La taxe foncière reste déductible, TEOM déduite. Le simulateur applique cette exclusion : la TEOM entre dans l'assiette de l'indemnité — c'est une charge réellement supportée — mais pas dans la déduction au réel.\n\n" +
      "COMMENT ARBITRER : le réel l'emporte dès que les charges déductibles dépassent l'abattement forfaitaire de 30 % des revenus bruts. ATTENTION, l'option pour le réel est IRRÉVOCABLE PENDANT 3 ANS : elle se juge sur trois exercices, pas sur l'année en cours — les intérêts d'un emprunt décroissent à mesure qu'il s'amortit, et de gros travaux ne se répètent pas. Le micro-foncier n'est par ailleurs ouvert que si l'ensemble des revenus fonciers bruts du FOYER reste sous 15 000 €.\n\n" +
      "POURQUOI LES INTÉRÊTS NE S'AJOUTENT PAS À L'INDEMNITÉ : le loyer de marché rémunère déjà la mise à disposition du bien, coût du capital compris. Les ajouter à la base de l'indemnité les compterait une seconde fois et exposerait la fraction excédentaire à une requalification (cf. règle « domicile-loyer-coherent-avec-le-marche »). Le simulateur les traite donc uniquement en déduction du revenu foncier, au prorata de la surface professionnelle — comme la doctrine l'admet pour un cabinet occupant 10 % de la surface, qui déduit 10 % des intérêts.",
  },
  {
    id: "domicile-loyer-coherent-avec-le-marche",
    category: "revenus_fonciers",
    label: "Le loyer ou l'indemnité d'occupation doit être cohérent avec le marché local",
    value: "Prix au m² du marché local × surface du bureau — un loyer surévalué est requalifié",
    legalReference: "Art. 39-1-1° CGI (charge non excessive) et art. 109-1-2° CGI (revenus distribués)",
    sourceLabel: "Carte des loyers ANIL / data.gouv.fr et observatoires locaux des loyers",
    sourceUrl:
      "https://www.data.gouv.fr/datasets/carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Une charge n'est déductible que si elle est engagée dans l'intérêt de l'exploitation et n'est pas excessive (art. 39-1-1° CGI). La fraction excédant la valeur de marché est réintégrée au résultat de la société ET imposée chez le dirigeant comme revenu distribué (art. 109-1-2° CGI) — double sanction.\n\n" +
      "COMMENT LE JUSTIFIER : la référence attendue est le prix au m² de locaux comparables (même commune, même quartier, surface équivalente). Deux ou trois annonces datées et archivées au moment de la fixation du loyer constituent la preuve la plus simple ; la « carte des loyers » ANIL (indicateurs communaux publiés annuellement sur data.gouv.fr à partir de plus de 9 millions d'annonces) et les observatoires locaux des loyers fournissent une référence publique complémentaire. ATTENTION : les indicateurs ANIL sont publiés CHARGES COMPRISES — retenir une valeur hors charges dès lors que les charges du logement sont facturées séparément, sous peine de les compter deux fois.\n\n" +
      "ORDRE DE GRANDEUR PRUDENT souvent retenu en pratique : au-delà de ~200 €/m²/an (soit ~3 000 €/an pour 15 m²), un loyer appelle une justification documentée solide.\n\n" +
      "Le simulateur calcule le loyer comme prix au m²/mois × surface du bureau × 12, à partir d'une médiane indicative par ville qui reste modifiable.",
  },
  {
    id: "domicile-charges-reelles-justificatifs",
    category: "revenus_fonciers",
    label: "Charges du logement refacturées : montants réels et justificatifs conservés",
    value: "Factures, avis de taxe foncière et appels de fonds — les moyennes statistiques ne sont pas opposables",
    legalReference: "Art. 39-1 CGI (justification des charges) et art. L102 B LPF (conservation 6 ans)",
    sourceLabel: "Compta-online — frais eau/EDF au domicile du gérant",
    sourceUrl: "https://www.compta-online.com/frais-eau-edf-etc-sur-siege-social-domicile-gerant-t29552",
    validFrom: "2020-01-01",
    validUntil: null,
    notes:
      "Les montants pré-remplis par le simulateur sont des ordres de grandeur statistiques 2025-2026 (factures d'énergie, prix moyen de l'eau au m³, baromètres d'assurance habitation et de charges de copropriété, moyenne de taxe foncière). Ils servent à dimensionner l'indemnité sans la sous-évaluer, PAS à la justifier : seuls les documents réels — factures d'énergie et d'eau, quittance ou avis de taxe foncière, appels de fonds de copropriété, échéancier d'assurance — sont opposables, et doivent être conservés 6 ans (art. L102 B LPF).\n\n" +
      "PIÈGES DE DOUBLE COMPTE : (1) un abonnement internet déjà refacturé à la société comme frais professionnel ne doit pas être réintégré ici ; (2) l'eau est souvent déjà incluse dans les charges de copropriété ; (3) si le logement est chauffé à l'électricité, ne pas remplir à la fois « Électricité » et « Chauffage » ; (4) un locataire n'acquitte pas la taxe foncière et supporte une assurance habitation moins chère qu'un propriétaire.",
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
      "Il n'existe aucun pourcentage légal d'usage privé « interdit » : l'infraction suppose TROIS conditions CUMULATIVES — usage anormal, avantage personnel, et MAUVAISE FOI du dirigeant.\n\n" +
      "CE QUI DÉCLENCHE RÉELLEMENT LES POURSUITES : un usage privé « exclusivement privé NON DÉCLARÉ ». C'est la dissimulation, pas l'usage privé en lui-même, qui caractérise l'infraction. À l'inverse, des faits commis sans dissimulation, conformément à une convention prévoyant expressément une contrepartie personnelle au dirigeant, excluent la mauvaise foi — donc l'infraction. La prescription de l'ABS court d'ailleurs à compter de la présentation des comptes annuels faisant apparaître la dépense, SAUF dissimulation : preuve a contrario que l'inscription transparente en comptabilité est la protection.\n\n" +
      "AUTREMENT DIT : ce qui protège n'est pas la discrétion mais la TRANSPARENCE FORMALISÉE. Un usage 100% privé, intégralement déclaré en AEN et voté par les organes sociaux, relève de la rémunération et non de l'ABS (cf. règles « vehicule-fonction-vs-vehicule-service » et « vehicule-fonction-formalisme-organe-social »). Le risque bascule alors du terrain pénal vers le seul terrain fiscal du caractère excessif de la rémunération (cf. règle « remuneration-globale-non-excessive »).\n\n" +
      "SE PRÉMUNIR (par ordre d'importance) : (1) décision d'organe social qualifiant le véhicule d'élément de rémunération ; (2) AEN déclaré à 100% de l'usage privé réel, sans minoration ; (3) cohérence de tous les documents entre eux ; (4) carnet de bord — utile même sans usage pro, car un registre montrant honnêtement ~100% privé prouve la bonne foi et la cohérence avec l'AEN déclaré, bien mieux qu'un registre absent ou gonflé.",
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
    id: "domicile-cfe-surface-professionnelle",
    category: "revenus_fonciers",
    label: "Cotisation foncière des entreprises due sur la partie du logement affectée à l'activité",
    value: "Base = valeur locative des locaux professionnels, avec une cotisation minimum assise sur le chiffre d'affaires N-2",
    legalReference: "Art. 1447, 1467 et 1647 D CGI",
    sourceLabel: "economie.gouv.fr",
    sourceUrl:
      "https://www.economie.gouv.fr/entreprises/gerer-sa-fiscalite-et-ses-impots/autres-impots-et-taxes/tout-savoir-sur-la-cotisation-fonciere-des-entreprises-cfe",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    notes:
      "CONSÉQUENCE RAREMENT ANTICIPÉE de l'indemnité d'occupation. Domicilier la société chez son dirigeant et lui verser une indemnité pour une pièce dédiée revient à déclarer un établissement à cette adresse : la CFE y est due, en plus de la taxe foncière déjà supportée par le propriétaire.\n\n" +
      "C'est surtout une question de COHÉRENCE. On ne peut pas soutenir devant un vérificateur qu'une pièce est exclusivement professionnelle pour justifier l'indemnité, et n'en tenir aucun compte pour la CFE : les deux déclarations se lisent ensemble. À l'inverse, un dirigeant qui déclare correctement sa surface professionnelle renforce, par cette cohérence même, la réalité de l'affectation qu'il invoque.\n\n" +
      "EN PRATIQUE, l'enjeu financier reste modeste. Lorsque la valeur locative de la fraction professionnelle est faible — ce qui est le cas d'une pièce dans un logement —, c'est la COTISATION MINIMUM de l'art. 1647 D CGI qui s'applique : son barème 2026 est assis sur le chiffre d'affaires de l'avant-dernière année, chaque commune votant un montant dans la fourchette légale (247 à 589 € pour un CA ≤ 10 000 €, 247 à 2 477 € entre 32 601 et 100 000 €, 247 à 7 669 € au-delà de 500 000 €).\n\n" +
      "ALLÉGEMENTS : exonération totale l'année de création de l'établissement, base réduite de moitié l'année suivante, et exonération permanente si le chiffre d'affaires de l'avant-dernière année n'excède pas 5 000 €.\n\n" +
      "NON CHIFFRÉ PAR LE SIMULATEUR : le montant dépend d'un taux et d'une base votés commune par commune, qu'aucune source nationale ne permet de reconstituer. Il est signalé pour être intégré au budget, pas estimé.\n\n" +
      "POINT VOISIN, hors du champ de ce simulateur : la fraction du bien affectée à l'activité peut, sous conditions, échapper à l'impôt sur la fortune immobilière au titre des biens professionnels (art. 975 CGI). Cela ne concerne que les patrimoines immobiliers taxables, au-delà de 1,3 M€.",
  },
  {
    id: "domicile-annexes-usage-mixte",
    category: "revenus_fonciers",
    label: "Annexes d'usage mixte : couloir, entrée et sanitaires comptés pour une fraction",
    value: "Ventilation au prorata de l'usage professionnel — usuellement 50 %, sans coefficient légal",
    legalReference: "BOI-RSA-BASE-30-50-30-30 (local exclusif vs mixte) et BOI-BNC-BASE-40-60-30 (dépenses mixtes)",
    sourceLabel: "BOFiP-Impôts / Réseau ARAPL",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/7671-PGP.html/identifiant=BOI-RSA-BASE-30-50-30-30-20170621",
    validFrom: "2017-06-21",
    validUntil: null,
    notes:
      "LE PRINCIPE : le BOFiP distingue le local EXCLUSIVEMENT affecté à l'usage professionnel — charges déductibles en totalité — de la pièce servant AUSSI à autre chose, qui donne lieu à une ventilation au prorata de l'usage professionnel. Une dépense ou une surface d'usage mixte ne se traite donc ni par zéro ni par la totalité, mais par une fraction justifiée.\n\n" +
      "CE QUI SE COMPTE : les annexes de circulation qui desservent le bureau (entrée, vestibule, couloir) et les sanitaires, retenus par convention de pratique à environ 50 %. C'est ce que fait tout bail de bureau réel, dont les mètres carrés facturés incluent circulations et sanitaires — un bureau sans accès ni WC ne se loue pas.\n\n" +
      "CE QUI NE SE COMPTE PAS : le séjour, les chambres, la cuisine, les balcons, caves et parkings. Soutenir que le logement entier est d'usage mixte ne passe pas : c'est le caractère RAISONNABLE de la ventilation qui est examiné.\n\n" +
      "AUCUN COEFFICIENT LÉGAL : les 50 % sont une convention professionnelle, pas une règle. La preuve attendue est un plan coté avec les surfaces annexes identifiées et leur pondération, conservé au dossier.\n\n" +
      "ATTENTION : ces annexes figurent DÉJÀ au dénominateur, dans la surface totale du logement. Les ajouter au numérateur fait donc mécaniquement monter la quote-part et peut faire franchir le seuil de justification renforcée (cf. règle « domicile-surface-bureau-tolerance-30-pourcent »).",
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
    id: "madelin-ayants-droit-plafond-unique",
    category: "protection_sociale_dirigeant",
    label: "Couverture des ayants droit d'un TNS (conjoint, enfants) — déductible dans le même plafond",
    value: "Cotisations des ayants droit déductibles, mais imputées sur l'unique plafond Madelin du dirigeant",
    legalReference: "Art. 154 bis CGI ; art. L144-1 code des assurances",
    sourceLabel: "Légifrance (art. 154 bis CGI)",
    sourceUrl: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000047288764",
    validFrom: "1994-02-11",
    validUntil: null,
    notes:
      "Les cotisations versées au titre du conjoint et des enfants sont déductibles à condition qu'ils soient ayants droit du TNS au même régime de sécurité sociale. Il n'existe AUCUNE enveloppe supplémentaire par personne couverte : le plafond (7% du PASS + 3,75% du bénéfice, limité à 3% de 8×PASS) est unique et commun à la santé et à la prévoyance. Étendre la couverture à la famille sature donc le plafond plus vite — c'est le seul effet mécanique à surveiller.",
  },
  {
    id: "mutuelle-taux-prise-en-charge-employeur",
    category: "protection_sociale_dirigeant",
    label: "Taux de prise en charge employeur — minimum et maximum légaux",
    value: "Salarié : 50% minimum, 100% possible. Ayants droit : aucun minimum, 0 à 100% au libre choix de l'employeur",
    legalReference: "Art. L911-7, II CSS (loi ANI n°2013-504 du 14 juin 2013)",
    sourceLabel: "URSSAF — mettre en place une complémentaire frais de santé",
    sourceUrl:
      "https://www.urssaf.fr/accueil/employeur/embaucher-gerer-salaries/embaucher/complementaire-frais-sante.html",
    validFrom: "2016-01-01",
    validUntil: null,
    notes:
      "L'article L911-7, II CSS impose à l'employeur d'assurer « au minimum la moitié du financement de cette couverture » — c'est un plancher, pas un plafond : une prise en charge à 100% est parfaitement légale. Cette obligation ne porte que sur le SALARIÉ lui-même : l'extension aux ayants droit n'est jamais imposée par la loi, et l'employeur qui choisit de la financer le fait au taux qu'il veut, de 0 à 100%. Attention : au-delà du financement, c'est le caractère obligatoire ou facultatif de l'affiliation des ayants droit qui décide du sort social de cette contribution (cf. règle dédiée).",
  },
  {
    id: "mutuelle-ayants-droit-caractere-obligatoire",
    category: "protection_sociale_dirigeant",
    label: "Extension aux ayants droit : obligatoire (exonérée) ou facultative (assujettie dès le 1er euro)",
    value:
      "Extension obligatoire → part patronale exclue de l'assiette dans le plafond ; extension facultative → part patronale assujettie intégralement",
    legalReference: "Art. L242-1, II-4° CSS ; art. R242-1-1 et R242-1-6 CSS",
    sourceLabel: "BOSS — Protection sociale complémentaire (opposable depuis le 1er septembre 2022)",
    sourceUrl: "https://boss.gouv.fr/portail/accueil/protection-sociale-complementaire.html",
    validFrom: "2022-09-01",
    validUntil: null,
    notes:
      "L'exclusion d'assiette de la contribution patronale suppose un régime « collectif et obligatoire ». Lorsque l'acte fondateur (accord collectif, référendum ou décision unilatérale) rend l'affiliation des ayants droit obligatoire pour toute la catégorie de personnel concernée, la part patronale qui la finance conserve ce caractère et bénéficie de l'exclusion, dans le plafond commun. Lorsque l'extension est laissée au libre choix du salarié, la part patronale correspondante est assujettie à cotisations dès le premier euro, sans consommer le plafond. C'est le paramètre qui pèse le plus lourd sur le coût réel d'une couverture familiale.",
  },
  {
    id: "mutuelle-csg-crds-part-patronale",
    category: "protection_sociale_dirigeant",
    label: "CSG/CRDS sur la part patronale de complémentaire santé et prévoyance",
    value: "9,7% (CSG 9,2% + CRDS 0,5%) sur la totalité de la contribution patronale, sans abattement de 1,75%",
    legalReference: "Art. L136-1-1, III-4° et L136-8 CSS ; art. 14 ordonnance n°96-50 (CRDS)",
    sourceLabel: "URSSAF — protection sociale complémentaire",
    sourceUrl:
      "https://www.urssaf.fr/accueil/employeur/dossiers-reglementaires/exonerations-de-cotisations/protection-sociale-complementair.html",
    validFrom: "2018-01-01",
    validUntil: null,
    notes:
      "L'exonération de cotisations de sécurité sociale ne vaut pas exonération de CSG/CRDS : la contribution patronale y reste assujettie intégralement, et l'abattement d'assiette pour frais professionnels de 1,75% ne s'y applique pas. Contribution précomptée sur le bulletin, donc supportée par le bénéficiaire — c'est le coût qui subsiste même quand tout tient dans le plafond d'exonération.",
  },
  {
    id: "mutuelle-forfait-social-prevoyance",
    category: "protection_sociale_dirigeant",
    label: "Forfait social de 8% sur la part patronale de prévoyance — à partir de 11 salariés",
    value: "8% de la contribution patronale exonérée ; exonération totale pour les employeurs de moins de 11 salariés",
    legalReference: "Art. L137-15 et L137-16 CSS",
    sourceLabel: "URSSAF — le forfait social",
    sourceUrl: "https://www.urssaf.fr/accueil/employeur/cotisations/liste-cotisations/forfait-social.html",
    validFrom: "2016-01-01",
    validUntil: null,
    notes:
      "Dû par l'employeur sur la fraction de contribution patronale exclue de l'assiette des cotisations. Les employeurs de moins de 11 salariés en sont dispensés (art. L137-15 CSS) — une société dont le dirigeant assimilé salarié est le seul affilié n'en doit donc aucun. Le franchissement du seuil ne produit effet qu'après cinq années civiles consécutives au-delà de 11 salariés (dispositif de neutralisation des effets de seuil).",
  },
  {
    id: "mutuelle-part-patronale-sante-imposable",
    category: "protection_sociale_dirigeant",
    label: "Part patronale « frais de santé » imposable à l'impôt sur le revenu du bénéficiaire",
    value: "Imposable dès le 1er euro pour les frais de santé ; non imposable dans le plafond pour la prévoyance",
    legalReference: "Art. 83, 1° quater CGI ; loi n°2013-1278 du 29 décembre 2013, art. 4",
    sourceLabel: "Légifrance (art. 83 CGI)",
    sourceUrl: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053545390",
    validFrom: "2013-01-01",
    validUntil: null,
    notes:
      "Depuis l'imposition des revenus 2013, la fraction de contribution patronale finançant des garanties de FRAIS DE SANTÉ constitue un complément de rémunération imposable pour le bénéficiaire, alors qu'elle reste exonérée de cotisations sociales dans le plafond — les deux traitements sont dissociés. La part finançant la prévoyance (incapacité, invalidité, décès) échappe en revanche à l'IR dans les limites de l'art. 83, et la part salariale d'un contrat obligatoire y reste déductible. Ces effets jouent en sens inverse et supposeraient de ventiler le budget entre santé et prévoyance : le simulateur ne les chiffre donc pas, et n'impose que la fraction réintégrée dans l'assiette sociale.",
  },
  {
    id: "mutuelle-collective-plafond-exoneration",
    category: "protection_sociale_dirigeant",
    label: "Plafond d'exonération sociale/fiscale de la mutuelle collective obligatoire (assimilé salarié)",
    value: "6% du PASS + 1,5% du salaire brut annuel, plafonné à 12% du PASS",
    legalReference: "Art. L242-1, II-4° et D242-1 CSS ; loi ANI du 11 janvier 2013 (généralisation au 1er janvier 2016)",
    sourceLabel: "URSSAF",
    sourceUrl: "https://www.urssaf.fr/accueil/employeur/dossiers-reglementaires/exonerations-de-cotisations/protection-sociale-complementair.html",
    validFrom: "2016-01-01",
    validUntil: "2026-12-31",
    notes:
      "Le plafond s'apprécie sur la seule CONTRIBUTION PATRONALE, et non sur la cotisation totale : ce que le salarié finance lui-même n'a jamais eu à être exclu d'une assiette. Au-delà, l'excédent est réintégré dans l'assiette des cotisations sociales et imposé comme un complément de rémunération. La fraction exonérée n'échappe pas pour autant à la CSG/CRDS ni, à partir de 11 salariés, au forfait social (cf. règles dédiées).",
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
      "PASS 2026 = 48 060€. Plafond nettement plus généreux que celui des salariés dès que le bénéfice dépasse le PASS. Le report des plafonds non utilisés des 3 années précédentes (cf. règle « per-report-plafonds-3-ans ») s'ajoute à ce plafond de base.",
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
      "Plafond individuel affiché sur l'avis d'imposition (« plafond épargne retraite »). Comme pour le TNS, le report des plafonds non utilisés des 3 années précédentes (cf. règle « per-report-plafonds-3-ans ») s'ajoute à ce plafond de base.",
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
    id: "per-report-plafonds-3-ans",
    category: "epargne_retraite_dirigeant",
    label: "Report des plafonds de déduction PER non utilisés des 3 années précédentes",
    value: "Le plafond disponible cumule le plafond de l'année en cours et les fractions non utilisées des 3 années précédentes",
    legalReference: "Art. 163 quatervicies CGI",
    sourceLabel: "impots.gouv.fr",
    sourceUrl: "https://www.impots.gouv.fr/particulier/questions/comment-fonctionne-le-plafond-de-versement-sur-un-plan-depargne-retraite",
    validFrom: "2019-10-01",
    validUntil: null,
    notes:
      "Le plafond disponible cumulé figure directement sur l'avis d'imposition (rubrique « plafond épargne retraite »). Modélisé ici par une saisie manuelle du montant cumulé non utilisé, sans reconstituer le détail année par année (simplification).",
  },
  {
    id: "per-vs-assurance-vie-fiscalite",
    category: "epargne_retraite_dirigeant",
    label: "Comparaison de fiscalité à la sortie : PER (sortie en capital) vs assurance-vie",
    value:
      "PER : part correspondant aux versements déduits taxée au barème de l'IR (sans abattement) + PFU 30% sur la plus-value · Assurance-vie : PFU 30% sur la plus-value (avant 8 ans), ou après 8 ans abattement annuel 4 600€/9 200€ puis taux réduit 7,5%+17,2% de PS sur le solde (encours <150k€)",
    legalReference: "Art. 158, 5° CGI (PER) ; art. 125-0 A CGI (assurance-vie)",
    sourceLabel: "impots.gouv.fr / Service-Public.fr",
    sourceUrl: "https://www.impots.gouv.fr/particulier/le-plan-depargne-retraite-individuel-perin",
    validFrom: "2019-10-01",
    validUntil: null,
    notes:
      "Comparaison fortement simplifiée dans le simulateur : un taux forfaitaire de 30% (PFU) est appliqué à la plus-value des deux enveloppes, sans modéliser l'abattement assurance-vie après 8 ans ni le taux réduit associé — l'assurance-vie y est donc probablement sous-évaluée dans la comparaison pour une détention longue. À affiner avec un conseiller en gestion de patrimoine pour une décision réelle.",
  },
  {
    id: "rente-viagere-conversion",
    category: "epargne_retraite_dirigeant",
    label: "Conversion du capital PER en rente viagère à la sortie",
    value: "Taux de conversion indicatif croissant avec l'âge de départ (≈3,5% à 60 ans à ≈6,2% à 75 ans)",
    legalReference: "Table de mortalité assureur (non réglementaire)",
    sourceLabel: "Estimation indicative — ordre de grandeur du marché",
    sourceUrl: "https://www.service-public.fr/particuliers/vosdroits/F35223",
    validFrom: "2019-10-01",
    validUntil: null,
    notes:
      "Les taux de conversion réels ne sont pas fixés par la loi : ils dépendent de l'assureur, de sa table de mortalité, du sexe de l'assuré et des options choisies (réversion, annuités garanties). La table utilisée ici est une estimation indicative à but pédagogique, à ne pas utiliser pour un chiffrage contractuel — demander un devis à l'assureur du contrat pour un montant fiable.",
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
  {
    id: "regime-mere-fille",
    category: "holding_montage_patrimonial",
    label: "Régime mère-fille — exonération d'IS sur les dividendes remontés à une holding",
    value: "Exonération à 95% (quote-part de frais et charges de 5% réintégrée et taxée à l'IS), sous condition de détention ≥5% du capital pendant ≥2 ans",
    legalReference: "Art. 145, 216 CGI",
    sourceLabel: "impots.gouv.fr / BOFiP-Impôts",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1438-PGP.html",
    validFrom: "2016-01-01",
    validUntil: null,
    notes:
      "Régime optionnel (sur choix exprimé dans la liasse fiscale de la holding), à ne pas confondre avec l'intégration fiscale (régime distinct, ≥95% de détention, permettant en plus la compensation des résultats du groupe). Si les conditions de détention ne sont pas remplies, le dividende reçu par la holding est imposé à l'IS pour son montant brut entier, sans aucune exonération.",
  },
  {
    id: "integration-fiscale-qpfc-reduite",
    category: "holding_montage_patrimonial",
    label: "Intégration fiscale — quote-part de frais et charges réduite sur les dividendes intra-groupe",
    value: "QPFC réduite à 1% (au lieu de 5% du régime mère-fille), sous condition de détention ≥95% du capital pendant ≥2 ans",
    legalReference: "Art. 216, I ; 223 A et suiv. CGI",
    sourceLabel: "impots.gouv.fr / BOFiP-Impôts",
    sourceUrl: "https://bofip.impots.gouv.fr/bofip/1438-PGP.html",
    validFrom: "2016-01-01",
    validUntil: null,
    notes:
      "L'intégration fiscale est un régime distinct du mère-fille (option formalisée pour 5 exercices, détention ≥95% au lieu de ≥5%), qui permet surtout de compenser les résultats (bénéfices et déficits) de toutes les sociétés du groupe au niveau de la holding tête de groupe — effet NON modélisé ici (nécessiterait de chiffrer une filiale déficitaire, hors du champ à deux sociétés de ce simulateur). Seul l'effet directement chiffrable est repris : depuis la loi de finances pour 2016 (mise en conformité avec l'arrêt Steria de la CJUE, qui a jugé discriminatoire l'ancienne neutralisation à 100% des dividendes intra-groupe), la QPFC du régime mère-fille est réduite à 1% au lieu de 5% pour les dividendes versés au sein d'un groupe intégré.",
  },
  {
    id: "pfu-dividendes",
    category: "holding_montage_patrimonial",
    label: "Prélèvement forfaitaire unique (PFU / flat tax) sur les dividendes perçus par une personne physique",
    value: "30% (12,8% d'impôt sur le revenu + 17,2% de prélèvements sociaux), taux par défaut",
    legalReference: "Art. 200 A CGI",
    sourceLabel: "impots.gouv.fr",
    sourceUrl: "https://www.impots.gouv.fr/particulier/le-prelevement-forfaitaire-unique-pfu",
    validFrom: "2018-01-01",
    validUntil: null,
    notes:
      "Une option pour le barème progressif de l'IR (avec abattement de 40% sur le montant du dividende) reste possible sur demande expresse et globale (portant sur tous les revenus de capitaux mobiliers du foyer de l'année), parfois plus avantageuse pour un foyer faiblement imposé — non modélisée ici, seul le PFU à 30% est retenu par simplification.",
  },
  {
    id: "holding-strategies-sortie-hors-perimetre",
    category: "holding_montage_patrimonial",
    label: "Stratégies de sortie optimisée d'une holding — hors périmètre de ce simulateur",
    value: "Apport-cession avec remploi (art. 150-0 B ter), donation avec purge de plus-value, conservation jusqu'au décès (effacement de la plus-value latente)",
    legalReference: "Art. 150-0 B ter CGI ; art. 150-0 D bis CGI (donation)",
    sourceLabel: "impots.gouv.fr",
    sourceUrl: "https://www.impots.gouv.fr/particulier/questions/quest-ce-que-larticle-150-0-b-ter-du-cgi",
    validFrom: "2017-01-01",
    validUntil: null,
    notes:
      "Ce simulateur ne modélise qu'une sortie simple par distribution finale taxée au PFU. Des montages plus sophistiqués (report d'imposition en cas de remploi du produit de cession dans une activité économique sous 2 ans, purge de la plus-value latente par donation avant cession, ou conservation des titres jusqu'au décès du dirigeant) peuvent réduire drastiquement, voire annuler, le coût de sortie réel — mais nécessitent un accompagnement par un avocat fiscaliste, hors du champ pédagogique de cet outil.",
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
