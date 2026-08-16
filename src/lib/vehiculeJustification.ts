// Note justificative de la mise à disposition d'un véhicule de société au dirigeant, destinée à
// être produite en cas de contrôle URSSAF ou fiscal.
//
// Même intention que la note d'indemnité d'occupation du domicile : ce n'est pas un export de
// simulation mais le document qu'un inspecteur attend pour comprendre COMMENT le montant a été
// déterminé, et vérifier que chaque étape repose sur un fondement et sur des pièces. Elle suit donc
// l'ordre d'un raisonnement de contrôle :
//
//   1. les parties, le véhicule et le contrat — qui, quoi, depuis quand ;
//   2. le fondement juridique invoqué, article par article ;
//   3. la qualification retenue : véhicule de fonction, usage privé autorisé ;
//   4. l'évaluation de l'avantage en nature, poste par poste ;
//   5. le traitement déclaratif de part et d'autre ;
//   6. la justification du choix du véhicule — motorisation et proportionnalité ;
//   7. les justificatifs tenus à disposition ;
//   8. l'attestation.
//
// La section 6 est celle qui distingue cette note de la précédente. Un contrôle sur un véhicule ne
// porte pas seulement sur le calcul de l'avantage : il porte sur la décision d'engager la dépense.
// Deux questions y sont traitées de front — pourquoi ce véhicule, et pourquoi ce prix au regard des
// ressources de la société — parce que ce sont celles qui se posent réellement.

import { type SimulationInputs, computeSimulation } from "./simulator";
import type { FinancingMode } from "./financing";
import { estimateAnnualVehicleTax } from "./vehicleTaxes";
import { getVehicleModel } from "./vehicleModels";
import { formatEUR, formatPercent } from "./format";

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
  const gauche = libelle.length > 46 ? `${libelle.slice(0, 45)}…` : libelle.padEnd(46, " ");
  return `\t${gauche}${colonnes.map((c) => c.padStart(18, " ")).join("")}`;
}

function separateur(): string {
  return `\t${"-".repeat(46 + 18 * 2)}`;
}

const MODE_LABELS: Record<FinancingMode, string> = {
  comptant: "acquisition au comptant",
  credit: "acquisition financée par crédit",
  loa: "location avec option d'achat (LOA)",
  lld: "location longue durée (LLD)",
};

const EST_LOUE = (mode: FinancingMode) => mode === "loa" || mode === "lld";

export function buildVehiculeJustification(sim: SimulationInputs): string {
  const r = computeSimulation(sim);
  const lines: string[] = [];
  const push = (line = "") => lines.push(line);

  const modele = sim.vehicleModelId ? getVehicleModel(sim.vehicleModelId) : undefined;
  const loue = EST_LOUE(sim.financingMode);
  const partPrivee = Math.min(100, Math.max(0, sim.privateUsePercent));
  const estTNS = r.dirigeantStatus === "TNS";

  push("Note justificative — mise à disposition d'un véhicule au dirigeant");
  push(`Établie le ${new Date().toLocaleDateString("fr-FR")}`);
  push("");

  push("— 1. Parties, véhicule et contrat —");
  push(`Société détentrice du contrat : ${champ(sim.denominationSociete)}`);
  push(`Bénéficiaire de la mise à disposition : ${champ(sim.nomDirigeant)}`);
  // « Gérant majoritaire » décrit une SARL à plusieurs associés ; dans une société unipersonnelle,
  // « associé unique » est à la fois plus exact et plus précis pour le lecteur.
  const unipersonnelle = sim.companyType === "EURL" || sim.companyType === "SASU";
  const qualiteBeneficiaire = estTNS
    ? `gérant ${unipersonnelle ? "associé unique" : "majoritaire"} — travailleur non salarié, rémunération relevant de l'art. 62 CGI`
    : `${unipersonnelle ? "président associé unique" : "dirigeant"} assimilé salarié, affilié au régime général`;
  push(`Statut du bénéficiaire : ${qualiteBeneficiaire}`);
  push(`Véhicule : ${modele ? modele.label : A_COMPLETER} — immatriculation ${champ(sim.immatriculation)}`);
  push(
    `Motorisation : ${sim.isElectric ? "100 % électrique (0 g CO2/km)" : `thermique ou hybride, ${sim.co2EmissionsGkm} g CO2/km (WLTP)`}`,
  );
  push(`Prix TTC de référence : ${formatEUR(sim.vehiclePrice)}`);
  push(`Mode de détention : ${MODE_LABELS[sim.financingMode]}`);
  push(`Date de mise à disposition : ${dateFr(sim.dateMiseADisposition)}`);
  push("");

  push("— 2. Fondement juridique —");
  push(
    "Art. 39-1-1° du code général des impôts — les dépenses afférentes au véhicule sont déductibles du résultat en tant que charges engagées dans l'intérêt de l'exploitation. La contrepartie de la société n'est pas ici l'usage professionnel du véhicule mais la rémunération de son dirigeant : le véhicule est un élément de sa rémunération, et l'avantage correspondant est déclaré comme tel (cf. § 3 et § 5).",
  );
  push(
    "Art. 39-4 du code général des impôts — la fraction du prix d'acquisition, ou du loyer correspondant à l'amortissement pratiqué par le loueur, excédant le plafond légal n'est pas déductible et fait l'objet d'une réintégration extra-comptable. Ce plafond dépend des émissions de CO2 du véhicule.",
  );
  push(
    estTNS
      ? "Art. 62 CGI et BOI-RSA-GER-20 — les avantages en nature alloués à un gérant majoritaire sont évalués d'après leur VALEUR RÉELLE. Il n'existe pas, pour ces dirigeants, de modalité forfaitaire d'évaluation : l'arrêté du 25 février 2025 vise les salariés affiliés au régime général, et la tolérance admettant l'évaluation forfaitaire en l'absence de cumul d'un contrat de travail avec le mandat social énumère limitativement les gérants minoritaires ou égalitaires de SARL et SELARL, les présidents du conseil d'administration et les directeurs généraux de SA et SELAFA. Le gérant majoritaire n'y figure pas. L'évaluation ci-après est donc conduite au réel."
      : "Arrêté du 25 février 2025 et BOI-RSA-BASE-20-20 — le dirigeant relevant du régime général peut voir son avantage évalué au forfait ou d'après les dépenses réellement engagées, la tolérance administrative admettant l'évaluation forfaitaire même en l'absence de cumul d'un contrat de travail avec le mandat social. L'évaluation ci-après est conduite au réel, méthode dont la charge probatoire est la plus lourde et le résultat le plus vérifiable.",
  );
  push(
    "Art. L223-19 (SARL et EURL) et L227-10 (SAS) du code de commerce — la mise à disposition consentie au dirigeant constitue une convention entre la société et lui. Lorsque la société ne comprend qu'un associé unique et que la convention est conclue avec celui-ci, aucun rapport spécial n'est requis : il en est seulement fait mention au registre des décisions, mention qui conditionne l'opposabilité de la convention.",
  );
  push(
    "Art. L241-3, 4° du code de commerce — l'abus de biens sociaux suppose la réunion d'un usage contraire à l'intérêt social, d'une finalité personnelle et de la MAUVAISE FOI du dirigeant. Aucun texte ne fixe de proportion d'usage privé au-delà de laquelle l'infraction serait constituée. La mise à disposition est ici autorisée par une décision préalable de l'organe compétent, l'usage privé est reconnu, et l'avantage correspondant est déclaré selon les règles applicables. Ces éléments établissent la transparence de l'opération et concourent à écarter la mauvaise foi, SANS PRÉJUGER de l'appréciation globale de son intérêt social, qui relève d'un examen d'ensemble de la situation de la société (cf. § 6).",
  );
  push("");

  push("— 3. Qualification retenue et usage —");
  push(
    "Le véhicule est qualifié de VÉHICULE DE FONCTION : il est mis à la disposition permanente du bénéficiaire, qui est expressément autorisé à en faire un usage privé. Cette autorisation est constatée par la décision sociale visée au § 7.",
  );
  push("");
  push(ligne("Usage", "Kilométrage annuel", "Part"));
  push(separateur());
  push(
    ligne(
      "Déplacements professionnels",
      `${Math.round(r.proKmAnnual)} km`,
      formatPercent(1 - partPrivee / 100),
    ),
  );
  push(ligne("Usage privé", `${Math.round(r.privateKmAnnual)} km`, formatPercent(partPrivee / 100)));
  push(separateur());
  push(ligne("TOTAL", `${sim.totalKmAnnual} km`, "100 %"));
  push("");
  if (partPrivee >= 100) {
    // À usage exclusivement privé, l'argument tiré du besoin professionnel n'existe plus. Le taire
    // serait la faiblesse du dossier ; l'assumer en déplaçant la justification sur le terrain de la
    // rémunération est à la fois plus exact et plus solide.
    push(
      "AUCUN USAGE PROFESSIONNEL N'EST DÉCLARÉ, et cette note ne prétend pas le contraire. Le véhicule n'est pas justifié comme un outil de travail : il constitue, en totalité, un ÉLÉMENT DE RÉMUNÉRATION du dirigeant, consenti sous forme d'avantage en nature. Sa déductibilité ne repose donc pas sur un besoin professionnel — qui serait ici inexistant — mais sur l'art. 39-1-1° CGI, qui admet en charge les rémunérations indirectes.",
    );
    push(
      "Trois conséquences en découlent, assumées comme telles. L'avantage en nature est déclaré pour la TOTALITÉ du coût du véhicule, sans proratisation. Le caractère non excessif de la rémunération globale du dirigeant, avantage compris, devient le seul terrain sur lequel l'opération se défend : il est examiné au § 6. Et aucun frais de déplacement professionnel ni aucune indemnité kilométrique ne peuvent être réclamés au titre de ce véhicule.",
    );
    push(
      "Un relevé kilométrique reste tenu et conservé : il documente l'absence d'usage professionnel autant qu'il en établirait la réalité, et c'est la cohérence entre ce relevé et l'avantage déclaré qui est vérifiable.",
    );
  } else {
    push(
      `L'usage privé est déclaré pour sa part réelle, sans minoration. ${partPrivee >= 80 ? "Sa prépondérance est assumée : elle ne fait pas obstacle à la mise à disposition, dès lors que l'avantage correspondant est intégralement déclaré et que le véhicule est traité pour ce qu'il est — un élément de rémunération. " : ""}Un relevé kilométrique est tenu et conservé.`,
    );
  }
  push("");

  push("— 4. Évaluation de l'avantage en nature, au réel —");
  push(
    loue
      ? "Le véhicule étant loué, le coût global annuel TTC de la location se substitue à l'amortissement. Il est retenu pour son montant intégral, puis proratisé par la part de kilométrage privé. Le taux forfaitaire applicable aux véhicules loués n'intervient pas ici : il relève de l'autre méthode d'évaluation, qu'il représente à lui seul, et ne se cumule pas avec une proratisation kilométrique."
      : `Le véhicule étant acquis, la base comprend l'amortissement annuel — ${formatPercent(r.amortRate)} du prix TTC, le véhicule ayant ${sim.vehicleOverFiveYears ? "plus" : "moins"} de cinq ans — ainsi que l'assurance et l'entretien. Le total est proratisé par la part de kilométrage privé.`,
  );
  push("");
  push(ligne("Poste", "Montant annuel", "Retenu"));
  push(separateur());
  if (loue) {
    push(
      ligne(
        "Coût global annuel de la location",
        formatEUR(r.aenBaseAvantPlafond - sim.annualInsurance - sim.annualMaintenance),
        "",
      ),
    );
  } else {
    push(ligne("Amortissement annuel", formatEUR(r.amortAnnual), ""));
  }
  push(ligne("Assurance", formatEUR(sim.annualInsurance), ""));
  push(ligne("Entretien", formatEUR(sim.annualMaintenance), ""));
  push(separateur());
  push(ligne("Base annuelle", formatEUR(r.aenBaseAnnualCosts), ""));
  if (r.aenPlafonneParEquivalentAchat) {
    push(
      ligne(
        "dont écrêtement (plafond équivalent achat)",
        formatEUR(r.aenBaseAvantPlafond - r.aenBaseAnnualCosts),
        "",
      ),
    );
  }
  push(ligne(`× part d'usage privé (${formatPercent(partPrivee / 100)})`, "", formatEUR(r.aenBrut)));
  if (!sim.isElectric && sim.annualFuelPrivateCost > 0) {
    push(ligne("+ carburant d'usage privé pris en charge", formatEUR(sim.annualFuelPrivateCost), ""));
  }
  if (r.abattement > 0) {
    push(ligne("− abattement véhicule électrique éligible", "", `− ${formatEUR(r.abattement)}`));
  }
  if (r.participationAnnual > 0) {
    push(ligne("− participation financière du bénéficiaire", "", `− ${formatEUR(r.participationAnnual)}`));
  }
  push(separateur());
  push(ligne("AVANTAGE EN NATURE DÉCLARÉ", "", `${formatEUR(r.aenNet)}/an`));
  push("");
  if (r.aenPlafonneParEquivalentAchat) {
    push(
      `Le coût de la location, ${formatEUR(r.aenBaseAvantPlafond)}, excède la base qu'aurait produite l'acquisition du même véhicule. L'avantage est en conséquence ramené à cette dernière, conformément au plafonnement institué par l'arrêté du 25 février 2025 pour les véhicules loués.`,
    );
  }
  if (r.abattement > 0) {
    push(
      `L'abattement retenu est celui de la méthode réelle — 50 % de l'avantage, plafonné à ${formatEUR(2026.3)} — et non celui de la méthode forfaitaire, plus favorable mais indissociable de cette dernière. Les frais d'électricité engagés pour la recharge ne sont, en tout état de cause, pas pris en compte dans l'évaluation.`,
    );
    if (estTNS) {
      // Point réellement discuté : l'arrêté qui institue cet abattement vise les salariés du régime
      // général. Les commentateurs professionnels divergent sur son extension à un TNS. Le simuler
      // sans le dire donnerait à un chiffre incertain l'apparence d'un acquis.
      push(
        "RÉSERVE EXPRESSE SUR CE POINT. L'arrêté du 25 février 2025, qui institue cet abattement, vise les salariés affiliés au régime général et au régime agricole ; le bénéficiaire relevant du régime des travailleurs non salariés en est hors du champ. Les commentateurs professionnels divergent sur son extension à un gérant relevant de l'art. 62 CGI, certains l'appliquant à l'évaluation au réel, d'autres la réservant aux salariés et assimilés. L'abattement est retenu ici parce qu'il correspond à la pratique la plus répandue, mais il n'est pas acquis : à défaut de validation par le conseil de la société ou par un rescrit social, l'avantage devrait être porté à " +
          `${formatEUR(r.aenNet + r.abattement)}/an. C'est le seul poste de la présente note dont le fondement soit discuté.`,
      );
    }
  }
  push("");

  push("— 5. Traitement déclaratif —");
  push(
    `Côté bénéficiaire : l'avantage de ${formatEUR(r.aenNet)} est intégré à sa rémunération.`,
  );
  push(
    `Estimation des prélèvements correspondants : ${formatEUR(r.cotisationsTNS)} de cotisations sociales et ${formatEUR(r.irEstimee)} d'impôt sur le revenu, soit ${formatEUR(r.coutTotalGerantSociete)}/an. Ces montants reposent sur un taux global de cotisations de ${formatPercent(sim.tnsContributionRate)} et un taux marginal d'imposition de ${formatPercent(r.tauxIRUtilise)} retenus par hypothèse : ils situent l'ordre de grandeur et ne se substituent pas au calcul de l'organisme social, qui dépend de l'assiette effective, de la rémunération et des cotisations déjà appelées.`,
  );
  push(
    `Côté société : décaissement annuel de ${formatEUR(r.companyCashBaseAnnual)}. La déduction retenue est limitée à la quote-part professionnelle, soit ${formatEUR(r.quotePartProfessionnelleDeductible)}. Coût net après économie d'impôt : ${formatEUR(r.coutNetSociete)}/an.`,
  );
  push(
    "Cette limitation est une hypothèse de prudence, et non une contrainte légale : l'art. 39-1-1° CGI rend déductibles les rémunérations directes comme indirectes, avantages en nature compris, dès lors qu'elles correspondent à un travail effectif et ne sont pas excessives au regard du service rendu. La prise en charge du véhicule peut donc constituer une rémunération indirecte déductible à ce titre. Cette qualification ne lève toutefois AUCUNE des limitations propres aux véhicules de tourisme — plafond de l'art. 39-4 CGI, exclusion du droit à déduction de la TVA, taxes annuelles —, qui continuent de s'appliquer indépendamment. Le chiffrage ci-dessus retient le traitement le moins favorable à la société, ce qui ne peut pas la desservir en cas de contrôle.",
  );
  if (r.reintegrationFiscaleCO2 > 0) {
    push(
      `Réintégration extra-comptable au titre de l'art. 39-4 CGI : ${formatEUR(r.reintegrationFiscaleCO2)}/an, correspondant à la fraction ${loue ? "du loyer" : "de l'amortissement"} excédant le plafond de ${formatEUR(r.plafondAmortissementDeductible)} applicable à ce véhicule.`,
    );
  } else {
    push(
      `Aucune réintégration au titre de l'art. 39-4 CGI : le prix du véhicule n'excède pas le plafond de ${formatEUR(r.plafondAmortissementDeductible)} applicable à sa motorisation.`,
    );
  }
  push(
    r.annualVehicleTax > 0
      ? `Taxes annuelles sur l'affectation du véhicule à des fins économiques : ${formatEUR(r.annualVehicleTax)}/an, sous réserve des caractéristiques exactes portées au certificat d'immatriculation.`
      : "Taxes annuelles sur l'affectation du véhicule à des fins économiques : néant, le véhicule fonctionnant exclusivement à l'électricité (cf. § 6) — sous réserve de confirmation à partir du certificat d'immatriculation et de l'affectation effective du véhicule.",
  );
  push(
    r.tvaDeductible > 0
      ? `TVA déduite : ${formatEUR(r.tvaDeductible)}/an, au titre de la mise à disposition consentie à titre onéreux — la participation financière du bénéficiaire constituant la contrepartie qui fait entrer l'opération dans le champ.`
      : "TVA : aucune déduction n'est pratiquée. La TVA grevant l'acquisition ou la location d'un véhicule de tourisme est exclue du droit à déduction, et le calcul est conduit toutes taxes comprises.",
  );
  push("");

  push("— 6. Justification du choix du véhicule —");
  if (sim.isElectric) {
    push(
      "MOTORISATION. Le choix d'un véhicule 100 % électrique procède de motifs économiques vérifiables, indépendants de toute considération personnelle. Le tableau ci-dessous en chiffre les effets, en regard d'un véhicule thermique comparable émettant 140 g de CO2 par kilomètre, pris comme terme de comparaison.",
    );
    push("");
    push(ligne("Effet du choix électrique", "Électrique", "Thermique 140 g"));
    push(separateur());
    push(
      ligne(
        "Taxes annuelles CO2 et polluants",
        "0 €",
        formatEUR(estimateAnnualVehicleTax(140, false)),
      ),
    );
    push(
      ligne(
        "Plafond de déduction art. 39-4 CGI",
        formatEUR(r.plafondAmortissementDeductible),
        formatEUR(18300),
      ),
    );
    push(ligne("Malus écologique à l'immatriculation", "0 €", "selon barème"));
    push(
      ligne(
        "Abattement sur l'avantage en nature",
        r.abattement > 0 ? formatEUR(r.abattement) : "aucun",
        "sans objet",
      ),
    );
    push("");
    push(
      `Les taxes annuelles sur l'affectation des véhicules de tourisme à des fins économiques ne s'appliquent pas à un véhicule fonctionnant exclusivement à l'électricité : la taxe assise sur les émissions de CO2 est nulle par construction, et l'exonération de la taxe sur les polluants atmosphériques est acquise. Le plafond de déduction de l'art. 39-4 CGI est par ailleurs porté à ${formatEUR(30000)} pour un véhicule émettant moins de 20 g de CO2 par kilomètre, contre ${formatEUR(18300)} pour un véhicule thermique ordinaire — un écart de ${formatEUR(11700)} de base déductible.`,
    );
    if (modele) {
      push("");
      push(
        modele.ecoScoreEligible
          ? `VÉHICULE ÉLIGIBLE À L'ÉCO-SCORE. Le modèle retenu — ${modele.label} — figure parmi les véhicules dont le score environnemental atteint le seuil requis, condition à laquelle l'arrêté du 25 février 2025 subordonne l'abattement applicable à l'avantage en nature. Elle procure ici ${formatEUR(r.abattement)} d'abattement annuel.\n\n` +
            "L'ÉLIGIBILITÉ NE SE PRÉSUME PAS DU NOM DU MODÈLE. Elle s'apprécie au jour de la mise à disposition et dépend du site d'assemblage et de la filière batterie, qui varient d'une version et d'un millésime à l'autre au sein d'une même gamme. Le dossier identifie donc la VERSION EXACTE, le type-variante-version porté au certificat d'immatriculation et le numéro d'identification du véhicule, et conserve l'extrait daté de la liste publiée par l'ADEME établissant l'éligibilité de cette version précise à cette date."
          : `ÉCO-SCORE. Le modèle retenu — ${modele.label} — n'atteint pas le seuil de score environnemental auquel l'arrêté du 25 février 2025 subordonne l'abattement sur l'avantage en nature. Aucun abattement n'est donc pratiqué, ce qui majore l'avantage déclaré et les prélèvements correspondants. Cette absence est assumée et documentée plutôt que présumée.`,
      );
    }
  } else {
    push(
      `MOTORISATION. Le véhicule retenu émet ${sim.co2EmissionsGkm} g de CO2 par kilomètre. Le plafond de déduction de l'art. 39-4 CGI applicable s'établit en conséquence à ${formatEUR(r.plafondAmortissementDeductible)}, et les taxes annuelles sur l'affectation du véhicule à des fins économiques sont dues à hauteur de ${formatEUR(r.annualVehicleTax)}/an. Un véhicule 100 % électrique en aurait été exonéré et aurait bénéficié d'un plafond de ${formatEUR(30000)} : l'écart est assumé au vu des contraintes d'usage.`,
    );
  }
  push("");

  // Le second volet de la justification : la proportionnalité. C'est la question qui se pose
  // réellement quand une société modeste engage une dépense importante, et à laquelle le seul
  // calcul de l'avantage ne répond pas.
  const coutGlobalAnnuel = r.coutNetSociete;
  const partCA = sim.chiffreAffairesPrevisionnel > 0 ? coutGlobalAnnuel / sim.chiffreAffairesPrevisionnel : 0;
  const partBenefice =
    sim.beneficeAvantChargePrevisionnel > 0 ? coutGlobalAnnuel / sim.beneficeAvantChargePrevisionnel : 0;
  const beneficeResiduel = sim.beneficeAvantChargePrevisionnel - coutGlobalAnnuel;
  push(
    "PROPORTIONNALITÉ. Le caractère non excessif d'un avantage consenti au dirigeant s'apprécie au regard des ressources et de la situation financière de la société, et non dans l'absolu : aucun seuil de prix ne rend une dépense abusive par elle-même.",
  );
  push("");
  push(ligne("Rapportement du coût du véhicule", "Montant", "Part"));
  push(separateur());
  push(ligne("Coût net annuel pour la société", formatEUR(coutGlobalAnnuel), ""));
  push(
    ligne(
      "Chiffre d'affaires prévisionnel",
      formatEUR(sim.chiffreAffairesPrevisionnel),
      formatPercent(partCA),
    ),
  );
  push(
    ligne(
      "Bénéfice avant charges du véhicule",
      formatEUR(sim.beneficeAvantChargePrevisionnel),
      formatPercent(partBenefice),
    ),
  );
  push(ligne("Bénéfice résiduel après le véhicule", formatEUR(beneficeResiduel), ""));
  push("");
  // Trois situations, et non deux : le cas où la dépense excède le bénéfice disponible était
  // jusqu'ici traité comme un simple « rapport élevé », alors qu'il change la nature de la
  // discussion — la société ne se prive plus d'une part de son résultat, elle le supprime.
  if (beneficeResiduel < 0) {
    push(
      `La dépense excède le bénéfice disponible : sa prise en charge creuse un déficit de ${formatEUR(-beneficeResiduel)}. C'est la configuration la plus exposée, et l'argument tiré du maintien d'un bénéfice résiduel n'est pas disponible. Elle ne rend pas l'opération irrégulière — aucun texte n'interdit à une société d'être déficitaire — mais impose de la justifier autrement : par la trésorerie disponible, par le caractère non récurrent de l'exercice, ou par un prévisionnel documenté montrant que la charge est soutenable. À défaut, la rémunération globale du dirigeant, avantage compris, s'expose à être jugée excessive au regard des ressources de la société.`,
    );
  } else if (partBenefice > 0.5) {
    push(
      "Ce rapport est élevé : la dépense absorbe plus de la moitié du bénéfice disponible. Elle appelle une justification renforcée par la trésorerie et la rentabilité de la société, le bénéfice résiduel restant toutefois positif.",
    );
  } else {
    push(
      "La société conserve un bénéfice après prise en charge du véhicule : elle n'est pas privée de ses ressources au profit de son dirigeant, ce qui constitue l'élément central de l'appréciation de l'intérêt social.",
    );
  }
  push("");

  push("— 7. Justificatifs tenus à disposition —");
  const pieces = [
    loue
      ? "Contrat de location signé, avec l'échéancier des loyers et, le cas échéant, la valeur de l'option d'achat"
      : "Facture d'acquisition du véhicule et tableau d'amortissement comptable",
    "Décision de l'organe compétent qualifiant la mise à disposition d'élément de rémunération et autorisant expressément l'usage privé",
    "Mention de la convention au registre des décisions de l'associé unique (art. L223-19 code de commerce)",
    "Certificat d'immatriculation du véhicule",
    "Relevé kilométrique annuel distinguant usage professionnel et usage privé",
    "Attestation d'assurance et factures d'entretien de l'exercice",
    "Bulletins ou déclarations faisant apparaître l'avantage en nature déclaré",
  ];
  if (loue) {
    pieces.push(
      "Attestation du loueur indiquant le prix d'achat TTC du véhicule, nécessaire à l'application du plafonnement de l'avantage",
    );
  }
  if (sim.isElectric && modele?.ecoScoreEligible) {
    pieces.push(
      "Extrait daté de la liste ADEME établissant l'éligibilité de la version exacte du véhicule (type-variante-version et numéro d'identification) à la date de mise à disposition",
    );
  }
  if (r.participationAnnual > 0) {
    pieces.push("Justificatifs des versements de la participation financière du bénéficiaire");
  }
  for (const piece of pieces) push(`• ${piece}`);
  push("");
  push("Ces pièces sont conservées pendant six ans à compter de la dernière opération (art. L102 B du livre des procédures fiscales).");
  push("");

  push("— 8. Attestation —");
  push(
    "Le soussigné atteste que le kilométrage, les montants et la répartition d'usage figurant à la présente note correspondent à la réalité de l'exploitation, et que les pièces énumérées au § 7 peuvent être produites à première demande.",
  );
  push("");
  push(`Le bénéficiaire — ${champ(sim.nomDirigeant)}`);
  push("Date et signature :");
  push("");
  push(`Pour la société — ${champ(sim.denominationSociete)}`);
  push("Date et signature :");
  push("");
  push(
    "La présente note est établie à partir d'une simulation. Elle ne constitue ni un avis juridique ni une attestation comptable, et ne dispense pas de faire valider le traitement retenu par un professionnel.",
  );

  return lines.join("\n");
}
