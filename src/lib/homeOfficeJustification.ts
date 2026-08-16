// Note justificative de l'indemnité d'occupation du domicile, destinée à être produite en cas de
// contrôle URSSAF ou fiscal.
//
// Ce n'est pas un export de simulation : c'est le document qu'un inspecteur attend pour comprendre
// COMMENT le montant a été déterminé, et vérifier que chaque étape repose sur un fondement et sur
// des pièces. Il suit donc l'ordre d'un raisonnement de contrôle plutôt que celui du formulaire :
//
//   1. les parties, le bien et la période — qui, quoi, depuis quand ;
//   2. le fondement juridique invoqué, article par article ;
//   3. la détermination de la quote-part professionnelle, surface par surface ;
//   4. la valeur locative retenue et sa source ;
//   5. la ventilation poste par poste — valeur locative et charges — avec leur quote-part ;
//   6. le montant obtenu, ventilé entre jouissance et charges, et son traitement déclaratif ;
//   7. la liste des justificatifs tenus à disposition.
//
// Le format de sortie est celui de `PrintableReport` : « — Titre — » pour une section, une
// tabulation en tête pour une ligne de tableau (rendue en chasse fixe à l'impression).

import { type HomeOfficeInputs, PLAFOND_DEFICIT_FONCIER_REVENU_GLOBAL, computeHomeOffice } from "./homeOffice";
import { LOYERS_VILLES } from "./loyersVille";
import { formatEUR, formatPercent } from "./format";

/** Espace réservé pour les mentions que l'utilisateur n'a pas renseignées : le document reste utilisable. */
const A_COMPLETER = "……………………………………";

function champ(valeur: string): string {
  return valeur.trim().length > 0 ? valeur.trim() : A_COMPLETER;
}

function dateFr(iso: string): string {
  if (!iso) return A_COMPLETER;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR");
}

/** Ligne de tableau : libellé à gauche sur une largeur fixe, colonnes chiffrées cadrées à droite. */
function ligne(libelle: string, ...colonnes: string[]): string {
  const gauche = libelle.length > 42 ? `${libelle.slice(0, 41)}…` : libelle.padEnd(42, " ");
  return `\t${gauche}${colonnes.map((c) => c.padStart(16, " ")).join("")}`;
}

function separateur(): string {
  return `\t${"-".repeat(42 + 16 * 3)}`;
}

export function buildUrssafJustification(sim: HomeOfficeInputs): string {
  const r = computeHomeOffice(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  const ville = LOYERS_VILLES.find((v) => v.id === sim.ville)?.label;
  const quotePart = formatPercent(r.quotePartSurface);
  // La somme versée recouvre deux natures juridiques distinctes, que le total confond : la
  // contrepartie de la jouissance des locaux, et le remboursement de charges effectivement
  // supportées. Un local mixte impose de ventiler les dépenses selon leur caractère professionnel
  // ou privé (BOI-BNC-BASE-40-60-30) : présenter le tout comme un « loyer » d'un seul tenant
  // masquerait cette ventilation, qui est précisément ce qu'un contrôle vient vérifier.
  const partLoyer = r.loyerAnnuelBureauRetenu;
  const partCharges = Math.max(0, r.indemniteAnnuelleBrute - partLoyer);

  push("Note justificative — indemnité d'occupation du domicile à des fins professionnelles");
  push(`Établie le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");

  push("— 1. Parties, bien et période —");
  push(`Bénéficiaire de l'indemnité (occupant) : ${champ(sim.nomDirigeant)}`);
  push(`Société versante : ${champ(sim.denominationSociete)}`);
  push(`Adresse du bien : ${champ(sim.adresseLogement)}${ville ? ` (commune de référence : ${ville})` : ""}`);
  push(
    `Statut de l'occupant : ${sim.statutOccupant === "locataire" ? "locataire" : "propriétaire"} · Nature du bien : ${sim.typeLogement === "maison" ? "maison individuelle" : "appartement en immeuble collectif"}`,
  );
  push(
    `Formalisation : ${sim.formalisation === "bail_professionnel" ? "bail professionnel conclu entre les parties" : "convention de mise à disposition (indemnité d'occupation)"}`,
  );
  push(`Date de prise d'effet : ${dateFr(sim.dateEffet)}`);
  push("");

  push("— 2. Fondement juridique —");
  push(
    "Art. L631-7-3 du code de la construction et de l'habitation — l'exercice d'une activité professionnelle est autorisé dans une partie d'un local d'habitation dès lors qu'il est le fait des seuls occupants y ayant leur résidence principale, qu'il n'entraîne ni réception de clientèle ni de marchandises, et qu'aucune stipulation du bail ou du règlement de copropriété ne s'y oppose.",
  );
  push(
    "Art. 39-1-1° du code général des impôts — la charge supportée par la société est déductible dès lors qu'elle est engagée dans l'intérêt de l'exploitation et n'est pas excessive au regard du service rendu. Le montant retenu ci-après est aligné sur la valeur locative de marché de la commune (cf. § 4).",
  );
  push(
    "BOI-RSA-BASE-30-50-30-30 — lorsqu'un local est exclusivement affecté à l'usage professionnel, les charges y afférentes sont retenues en totalité ; lorsqu'une pièce est également affectée à un autre usage, la déduction s'opère au prorata de l'usage professionnel. Ce principe fonde la pondération appliquée aux annexes au § 3.",
  );
  push(
    "BOI-BNC-BASE-40-60-30 — une dépense à caractère mixte, privé et professionnel, donne lieu à ventilation pour déterminer la part afférente à l'activité.",
  );
  push(
    "Art. 31, I-1° CGI — charges déductibles du revenu foncier au régime réel. Il est rappelé que la taxe d'enlèvement des ordures ménagères, bien que figurant sur l'avis de taxe foncière, n'est pas déductible du revenu foncier (BOI-RFPI-BASE-20-50) : elle est ici exclue de la déduction.",
  );
  push("");

  push("— 3. Détermination de la quote-part professionnelle —");
  push("Surfaces mesurées, reportées sur le plan coté annexé à la présente note.");
  push("");
  push(ligne("Local", "Surface", "Usage pro", "Retenu"));
  push(separateur());
  push(
    ligne(
      "Pièce dédiée à l'activité",
      `${sim.surfaceBureauM2} m²`,
      "100 %",
      `${Math.round(sim.surfaceBureauM2 * 100) / 100} m²`,
    ),
  );
  for (const annexe of sim.surfacesAnnexes) {
    if (!annexe.enabled || annexe.surfaceM2 <= 0) continue;
    const retenu = Math.round(annexe.surfaceM2 * Math.min(1, Math.max(0, annexe.coefficientPro)) * 100) / 100;
    push(
      ligne(
        `${annexe.label} (usage mixte)`,
        `${annexe.surfaceM2} m²`,
        formatPercent(annexe.coefficientPro),
        `${retenu} m²`,
      ),
    );
  }
  push(separateur());
  push(
    ligne(
      "Surface professionnelle retenue",
      "",
      "",
      `${Math.round(r.surfaceProfessionnelleTotale * 100) / 100} m²`,
    ),
  );
  push(ligne("Surface totale du logement", "", "", `${sim.surfaceTotaleM2} m²`));
  push(ligne("QUOTE-PART PROFESSIONNELLE", "", "", quotePart));
  push("");
  if (r.surfaceAnnexeRetenue > 0) {
    push(
      "Les annexes d'usage mixte (circulation desservant le bureau, sanitaires) sont retenues pour une fraction seulement de leur surface, conformément au principe de ventilation rappelé au § 2. Elles figurent par ailleurs, pour leur totalité, au dénominateur.",
    );
  }
  push(
    `La quote-part retenue s'établit à ${quotePart} de la surface du logement. Elle ne résulte pas de l'application d'un pourcentage choisi a priori, mais du relevé des surfaces effectivement affectées à l'activité, pondérées prudemment pour celles dont l'usage est mixte. Elle est vérifiable sur le plan coté annexé.`,
  );
  if (r.depasseToleranceSurface) {
    push(
      `Cette quote-part dépasse le repère interne de ${formatPercent(sim.toleranceSurfaceBureau)} que les parties se sont donné. Ce repère n'est pas une norme légale — aucun texte ne fixe de plafond général —, mais un seuil de vigilance : au-delà, l'affectation professionnelle est d'autant plus attendue qu'elle soit établie par des éléments matériels. Elle l'est ici par les pièces listées au § 7.`,
    );
  }
  push("");

  push("— 4. Valeur locative retenue —");
  if (sim.loyerAutoDepuisPrixM2) {
    push(
      `Valeur locative de marché retenue : ${sim.loyerMarcheM2Mensuel} €/m²/mois hors charges${ville ? `, correspondant à la médiane observée sur la commune de ${ville}` : ""}.`,
    );
    push(
      `Application : ${sim.loyerMarcheM2Mensuel} €/m²/mois × ${sim.surfaceTotaleM2} m² × 12 = ${formatEUR(r.loyerAnnuelLogementRetenu)}/an pour le logement entier, dont ${formatEUR(r.loyerAnnuelBureauRetenu)}/an au titre de la surface professionnelle.`,
    );
    push(
      "Référence : indicateurs de loyers d'annonce par commune publiés par l'ANIL sur data.gouv.fr (« carte des loyers ») et observatoires locaux des loyers. Des annonces comparables, datées du mois de fixation du loyer, sont conservées au dossier.",
    );
  } else {
    push(
      `Loyer réellement supporté pour le logement : ${formatEUR(r.loyerAnnuelLogementRetenu)}/an, dont ${formatEUR(r.loyerAnnuelBureauRetenu)}/an au titre de la surface professionnelle après application de la quote-part.`,
    );
    push("Référence : quittances de loyer ou titre de propriété, conservés au dossier.");
  }
  push("");

  push("— 5. Ventilation poste par poste : valeur locative et charges —");
  push(
    "Le local étant à usage mixte, chaque dépense est ventilée entre sa part professionnelle et sa part privée, conformément au principe rappelé au § 2. Montants annuels réellement supportés, justifiés par les pièces listées au § 7.",
  );
  push("");
  push(ligne("Poste", "Montant annuel", "Quote-part", "Retenu"));
  push(separateur());
  for (const c of r.chargeLinesEffectives) {
    if (!c.enabled || c.montantAnnuel <= 0) continue;
    push(
      ligne(c.label, formatEUR(c.montantAnnuel), quotePart, formatEUR(c.montantAnnuel * r.quotePartSurface)),
    );
  }
  push(separateur());
  push(
    ligne(
      "TOTAL",
      formatEUR(r.totalChargesRetenuesAnnuel),
      quotePart,
      formatEUR(r.indemniteAnnuelleBrute),
    ),
  );
  push("");
  // Deux composantes de nature différente, que la somme masque : la contrepartie de la jouissance
  // des locaux d'une part, le remboursement de dépenses réellement engagées d'autre part.
  push(
    ligne("dont contrepartie de la mise à disposition", "", "", formatEUR(partLoyer)),
  );
  push(ligne("dont remboursement de charges", "", "", formatEUR(partCharges)));
  push("");

  push("— 6. Montant dû et traitement déclaratif —");
  push(
    `La somme versée n'est pas un loyer forfaitaire : elle se décompose en deux éléments de nature distincte, dont chacun se justifie séparément.`,
  );
  push(
    ligne("Contrepartie de la mise à disposition", "", "", `${formatEUR(partLoyer)}/an`),
  );
  push(ligne("Remboursement de charges professionnelles", "", "", `${formatEUR(partCharges)}/an`));
  push(separateur());
  push(ligne("TOTAL DÛ", "", "", `${formatEUR(r.indemniteAnnuelleBrute)}/an`));
  push("");
  push(
    `Soit ${formatEUR(r.indemniteAnnuelleBrute / 12)} par mois, dont ${formatEUR(partLoyer / 12)} au titre de la jouissance des locaux et ${formatEUR(partCharges / 12)} au titre des charges. La première composante correspond à la quote-part professionnelle de la valeur locative établie au § 4 ; la seconde au remboursement, dans la même proportion, de dépenses effectivement engagées et justifiées, énumérées au § 5.`,
  );
  push(
    `Côté société : charge déductible du résultat, engagée dans l'intérêt de l'exploitation. Coût net après économie d'impôt : ${formatEUR(r.coutNetSociete)}/an.`,
  );
  push(
    `Côté bénéficiaire : revenu foncier déclaré au régime ${r.regimeEffectif === "micro" ? "micro-foncier (abattement forfaitaire de 30 %)" : "réel (charges effectives déduites)"}${!r.eligibleMicroFoncier ? ", le plafond de 15 000 € de revenus fonciers bruts du foyer étant dépassé" : ", le plafond de 15 000 € de revenus fonciers bruts du foyer — tous biens confondus, et non pour ce seul bien — n'étant pas atteint"}.`,
  );
  push(
    `Base imposable : ${formatEUR(r.baseImposableFonciere)} · Impôt sur le revenu : ${formatEUR(r.irDu)} · Prélèvements sociaux (17,2 %) : ${formatEUR(r.prelevementsSociaux)}.`,
  );
  if (r.interetsEmpruntDeduits > 0) {
    push(
      `Intérêts, frais et assurance d'emprunt déduits au prorata de la surface professionnelle : ${formatEUR(r.interetsEmpruntDeduits)}/an (art. 31, I-1°-d CGI).`,
    );
  }
  if (r.deficitFoncierTotal > 0) {
    push(
      `Déficit foncier constaté : ${formatEUR(r.deficitFoncierTotal)}, dont ${formatEUR(r.deficitImputableRevenuGlobal)} imputables sur le revenu global dans la limite annuelle de ${formatEUR(PLAFOND_DEFICIT_FONCIER_REVENU_GLOBAL)} et ${formatEUR(r.deficitReportableFoncier)} reportables sur les revenus fonciers des dix années suivantes (art. 156, I-3° CGI).`,
    );
  }
  push(
    "Les deux composantes sont versées par virement du compte de la société vers le compte personnel du bénéficiaire, sur une périodicité régulière, et comptabilisées distinctement.",
  );
  // Une note qui revendique une surface exclusivement professionnelle sans en tirer les
  // conséquences en matière de CFE se contredit elle-même : les deux déclarations se lisent
  // ensemble, et l'incohérence est précisément ce qu'un vérificateur relève.
  push(
    "La société est par ailleurs redevable de la cotisation foncière des entreprises au titre de l'établissement déclaré à cette adresse (art. 1447 et 1647 D CGI). La surface professionnelle retenue au § 3 est celle déclarée à ce titre : les deux déclarations sont cohérentes entre elles.",
  );
  push("");

  push("— 7. Justificatifs tenus à disposition —");
  const pieces = [
    sim.formalisation === "bail_professionnel"
      ? "Bail professionnel signé par les deux parties, désignant la surface louée"
      : "Convention de mise à disposition signée par les deux parties, désignant la surface concernée",
    "Décision de l'organe compétent autorisant la convention (procès-verbal)",
    "Plan coté du logement faisant apparaître la pièce dédiée et les annexes retenues",
    "Photographies de la pièce dédiée aménagée en bureau",
    "Titre de propriété ou bail d'habitation, et quittances de loyer le cas échéant",
    "Avis de taxe foncière de l'année",
    "Factures d'énergie, d'eau et d'abonnements de l'année",
    "Appels de fonds et décomptes de charges de copropriété",
    "Échéancier d'assurance habitation",
    "Relevés bancaires attestant des virements effectifs de l'indemnité",
    "Quittances ou reçus établis par le bénéficiaire",
  ];
  if (sim.empruntEnCours) {
    pieces.push("Tableau d'amortissement de l'emprunt et échéancier d'assurance emprunteur");
  }
  if (sim.loyerAutoDepuisPrixM2) {
    pieces.push("Annonces locatives comparables, datées, ayant servi à fixer la valeur locative");
  }
  for (const piece of pieces) push(`  • ${piece}`);
  push("");

  push("— 8. Attestation —");
  push(
    "Le soussigné atteste que les surfaces et les montants figurant dans la présente note correspondent à la réalité de l'occupation et des charges supportées, et que les pièces justificatives énumérées au § 7 peuvent être produites à première demande.",
  );
  push("");
  push(`Fait à ${A_COMPLETER}, le ${A_COMPLETER}`);
  push("");
  push(`Le bénéficiaire — ${champ(sim.nomDirigeant)}          Pour la société — ${champ(sim.denominationSociete)}`);
  push("");
  push("");
  push(
    "Document généré par un simulateur d'aide à la décision. Il ne constitue ni un avis juridique ni une attestation d'expert-comptable, et ne dispense pas de faire valider le montage par un professionnel.",
  );

  return lines.join("\n");
}
