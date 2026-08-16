import { describe, expect, it } from "vitest";
import { type SimulationInputs, computeSimulation, createDefaultInputs } from "./simulator";
import { buildVehiculeJustification } from "./vehiculeJustification";
import { formatEUR } from "./format";

// Modèles réels du registre : l'un franchit le seuil d'éco-score, l'autre non.
const MODELE_ELIGIBLE = "tesla-model-y-berlin";
const MODELE_NON_ELIGIBLE = "tesla-model-3";

function inputs(patch: Partial<SimulationInputs> = {}): SimulationInputs {
  const base = createDefaultInputs();
  return {
    ...base,
    personalTaxProfile: { ...base.personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    ...patch,
  };
}

/** LOA calquée sur une offre réelle, dans une société modeste : le cas où la proportionnalité compte. */
function loaElectrique(patch: Partial<SimulationInputs> = {}): SimulationInputs {
  const base = createDefaultInputs();
  return inputs({
    financingMode: "loa",
    vehiclePrice: 45000,
    isElectric: true,
    isEcoScoreEligible: true,
    privateUsePercent: 90,
    totalKmAnnual: 10000,
    chiffreAffairesPrevisionnel: 50000,
    beneficeAvantChargePrevisionnel: 20000,
    financing: {
      ...base.financing,
      loa: {
        ...base.financing.loa,
        premierLoyerMajore: 250,
        loyerMensuel: 491,
        dureeMois: 48,
        valeurOptionAchat: 20722,
        leveeOption: false,
      },
    },
    ...patch,
  });
}

describe("buildVehiculeJustification — structure du document", () => {
  it("comporte les huit sections attendues, dans l'ordre d'un raisonnement de contrôle", () => {
    const doc = buildVehiculeJustification(inputs());
    const sections = doc.split("\n").filter((l) => /^— .+ —$/.test(l.trim()));
    expect(sections).toEqual([
      "— 1. Parties, véhicule et contrat —",
      "— 2. Fondement juridique —",
      "— 3. Qualification retenue et usage —",
      "— 4. Évaluation de l'avantage en nature, au réel —",
      "— 5. Traitement déclaratif —",
      "— 6. Justification du choix du véhicule —",
      "— 7. Justificatifs tenus à disposition —",
      "— 8. Attestation —",
    ]);
  });

  it("cite nommément chaque fondement juridique invoqué", () => {
    const doc = buildVehiculeJustification(inputs());
    for (const reference of ["39-1-1°", "39-4", "L223-19", "L227-10", "L241-3", "L102 B"]) {
      expect(doc, reference).toContain(reference);
    }
  });

  it("se termine par une attestation et un espace de signature des deux parties", () => {
    const doc = buildVehiculeJustification(
      inputs({ nomDirigeant: "A. Dupont", denominationSociete: "ACME EURL" }),
    );
    expect(doc).toContain("Le soussigné atteste");
    expect(doc).toContain("Le bénéficiaire — A. Dupont");
    expect(doc).toContain("Pour la société — ACME EURL");
  });

  it("porte la mention d'usage : ce n'est ni un avis juridique ni une attestation comptable", () => {
    expect(buildVehiculeJustification(inputs())).toContain("ne constitue ni un avis juridique");
  });

  it("laisse des pointillés à compléter plutôt qu'un vide, quand rien n'est saisi", () => {
    const doc = buildVehiculeJustification(inputs());
    expect(doc).toContain("……………");
    // Aucune mention ne doit rester ouverte sur un « : » suivi de rien — hors les emplacements de
    // signature, où le vide est précisément ce qu'on attend du lecteur.
    for (const l of doc.split("\n")) {
      if (l.trimEnd() === "Date et signature :") continue;
      expect(l.trimEnd(), l).not.toMatch(/:\s*$/);
    }
  });

  it("reprend les identités et la date saisies", () => {
    const doc = buildVehiculeJustification(
      inputs({
        nomDirigeant: "Camille Martin",
        denominationSociete: "Studio Bleu EURL",
        immatriculation: "AB-123-CD",
        dateMiseADisposition: "2026-03-01",
      }),
    );
    expect(doc).toContain("Camille Martin");
    expect(doc).toContain("Studio Bleu EURL");
    expect(doc).toContain("AB-123-CD");
    expect(doc).toContain("01/03/2026");
  });
});

describe("buildVehiculeJustification — méthode d'évaluation selon le statut", () => {
  it("un gérant majoritaire est motivé par l'exclusion du forfait, liste limitative à l'appui", () => {
    const doc = buildVehiculeJustification(inputs({ companyType: "EURL", gerantMajoritaire: true }));
    expect(computeSimulation(inputs({ companyType: "EURL", gerantMajoritaire: true })).dirigeantStatus).toBe("TNS");
    expect(doc).toContain("BOI-RSA-GER-20");
    expect(doc).toContain("VALEUR RÉELLE");
    // La liste des dirigeants admis au forfait est le seul argument décisif : c'est l'absence du
    // gérant majoritaire dans cette énumération qui ferme la méthode forfaitaire.
    expect(doc).toContain("gérants minoritaires ou égalitaires");
    expect(doc).toContain("Le gérant majoritaire n'y figure pas");
  });

  it("un dirigeant assimilé salarié se voit rappeler que le forfait lui reste ouvert", () => {
    const sim = inputs({ companyType: "SASU" });
    expect(computeSimulation(sim).dirigeantStatus).toBe("ASSIMILE_SALARIE");
    const doc = buildVehiculeJustification(sim);
    expect(doc).toContain("peut voir son avantage évalué au forfait");
    expect(doc).not.toContain("Le gérant majoritaire n'y figure pas");
  });
});

describe("buildVehiculeJustification — évaluation de l'avantage", () => {
  it("le montant déclaré est celui que calcule le moteur", () => {
    const sim = loaElectrique();
    const r = computeSimulation(sim);
    const doc = buildVehiculeJustification(sim);
    const chiffres = (s: string) => s.replace(/\D/g, "");
    const total = doc.split("\n").find((l) => l.includes("AVANTAGE EN NATURE DÉCLARÉ"));
    expect(total).toBeDefined();
    expect(chiffres(total ?? "")).toContain(chiffres(String(Math.round(r.aenNet))));
  });

  it("un véhicule loué écarte explicitement le cumul du taux forfaitaire et de la proratisation", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("ne se cumule pas avec une proratisation kilométrique");
    expect(doc).toContain("Coût global annuel de la location");
  });

  it("un véhicule acheté détaille son amortissement plutôt qu'un coût de location", () => {
    const doc = buildVehiculeJustification(loaElectrique({ financingMode: "comptant" }));
    expect(doc).toContain("Amortissement annuel");
    expect(doc).not.toContain("Coût global annuel de la location");
  });

  it("le kilométrage professionnel et privé se recompose en total saisi", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("1000 km");
    expect(doc).toContain("9000 km");
    expect(doc).toContain("10000 km");
  });

  it("un usage privé prépondérant est assumé, pas dissimulé", () => {
    expect(buildVehiculeJustification(loaElectrique({ privateUsePercent: 90 }))).toContain(
      "Sa prépondérance est assumée",
    );
    expect(buildVehiculeJustification(loaElectrique({ privateUsePercent: 20 }))).not.toContain(
      "Sa prépondérance est assumée",
    );
  });

  it("l'abattement mentionné est celui de la méthode réelle, jamais celui du forfait", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("50 % de l'avantage, plafonné");
    expect(doc).not.toContain("70 %");
  });

  it("signale l'écrêtement quand le plafond « équivalent achat » a mordu, et se tait sinon", () => {
    const base = createDefaultInputs();
    const chere = loaElectrique({
      financing: { ...base.financing, loa: { ...base.financing.loa, premierLoyerMajore: 0, loyerMensuel: 1200, dureeMois: 48 } },
    });
    expect(computeSimulation(chere).aenPlafonneParEquivalentAchat).toBe(true);
    expect(buildVehiculeJustification(chere)).toContain("excède la base qu'aurait produite l'acquisition");
    expect(buildVehiculeJustification(loaElectrique())).not.toContain("excède la base qu'aurait produite l'acquisition");
  });
});

describe("buildVehiculeJustification — justification du choix électrique", () => {
  it("chiffre les effets du choix électrique en regard d'un thermique de référence", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("Taxes annuelles CO2 et polluants");
    expect(doc).toContain("Plafond de déduction art. 39-4 CGI");
    expect(doc).toContain("Malus écologique à l'immatriculation");
    // Le terme de comparaison doit être nommé : un montant « évité » sans référence explicite ne
    // veut rien dire.
    expect(doc).toContain("140 g de CO2 par kilomètre, pris comme terme de comparaison");
  });

  it("oppose bien les deux plafonds de l'art. 39-4 CGI", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    // Comparaison via le formateur : les montants portent des espaces insécables.
    expect(doc).toContain(formatEUR(30000));
    expect(doc).toContain(formatEUR(18300));
    expect(doc).toContain(`${formatEUR(11700)} de base déductible`);
  });

  it("un véhicule thermique n'invoque évidemment aucun de ces avantages", () => {
    const doc = buildVehiculeJustification(loaElectrique({ isElectric: false, co2EmissionsGkm: 140 }));
    expect(doc).not.toContain("procède de motifs économiques vérifiables");
    expect(doc).toContain("g de CO2 par kilomètre");
    expect(doc).toContain("aurait bénéficié d'un plafond");
  });

  it("un modèle listé ADEME est justifié par son éco-score, avec la date d'appréciation", () => {
    const doc = buildVehiculeJustification(loaElectrique({ vehicleModelId: MODELE_ELIGIBLE }));
    expect(doc).toContain("VÉHICULE ÉLIGIBLE À L'ÉCO-SCORE");
    // L'éligibilité varie d'une version et d'un millésime à l'autre au sein d'une même gamme : le
    // document doit exiger l'identification précise du véhicule, pas se contenter du nom du modèle.
    expect(doc).toContain("NE SE PRÉSUME PAS DU NOM DU MODÈLE");
    expect(doc).toContain("type-variante-version");
    expect(doc).toContain("liste publiée par l'ADEME");
  });

  it("un modèle non listé le dit franchement plutôt que de le taire", () => {
    const doc = buildVehiculeJustification(loaElectrique({ vehicleModelId: MODELE_NON_ELIGIBLE }));
    expect(doc).toContain("n'atteint pas le seuil de score environnemental");
    expect(doc).toContain("assumée et documentée plutôt que présumée");
  });

  it("la pièce ADEME ne figure aux justificatifs que si le modèle en dépend", () => {
    expect(buildVehiculeJustification(loaElectrique({ vehicleModelId: MODELE_ELIGIBLE }))).toContain(
      "Extrait daté de la liste ADEME",
    );
    expect(buildVehiculeJustification(loaElectrique({ vehicleModelId: MODELE_NON_ELIGIBLE }))).not.toContain(
      "Extrait daté de la liste ADEME",
    );
  });
});

describe("buildVehiculeJustification — proportionnalité", () => {
  it("rapporte le coût du véhicule aux ressources de la société", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("Chiffre d'affaires prévisionnel");
    expect(doc).toContain("Bénéfice avant charges du véhicule");
    expect(doc).toContain("Bénéfice résiduel après le véhicule");
  });

  it("rappelle qu'aucun seuil de prix ne rend une dépense abusive en soi", () => {
    expect(buildVehiculeJustification(loaElectrique())).toContain(
      "aucun seuil de prix ne rend une dépense abusive par elle-même",
    );
  });

  it("alerte quand le véhicule absorbe plus de la moitié du bénéfice", () => {
    const doc = buildVehiculeJustification(loaElectrique({ beneficeAvantChargePrevisionnel: 9000 }));
    expect(doc).toContain("Ce rapport est élevé");
  });

  it("rassure quand la société conserve un bénéfice confortable", () => {
    const doc = buildVehiculeJustification(loaElectrique({ beneficeAvantChargePrevisionnel: 120000 }));
    expect(doc).toContain("La société conserve un bénéfice");
    expect(doc).not.toContain("Ce rapport est élevé");
  });

  it("un chiffre d'affaires nul ne produit pas de pourcentage aberrant", () => {
    const doc = buildVehiculeJustification(
      loaElectrique({ chiffreAffairesPrevisionnel: 0, beneficeAvantChargePrevisionnel: 0 }),
    );
    expect(doc).not.toContain("NaN");
    expect(doc).not.toContain("Infinity");
  });
});

describe("buildVehiculeJustification — traitement déclaratif", () => {
  it("expose l'hypothèse de déduction retenue plutôt que de laisser un montant inexpliqué", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("limitée à la quote-part professionnelle");
    expect(doc).toContain("hypothèse de prudence");
    expect(doc).toContain("le traitement le moins favorable à la société");
  });

  it("mentionne la réintégration de l'art. 39-4 CGI quand elle existe, et son absence sinon", () => {
    expect(computeSimulation(loaElectrique()).reintegrationFiscaleCO2).toBeGreaterThan(0);
    expect(buildVehiculeJustification(loaElectrique())).toContain("Réintégration extra-comptable");
    const bonMarche = buildVehiculeJustification(loaElectrique({ vehiclePrice: 20000 }));
    expect(bonMarche).toContain("Aucune réintégration");
  });

  it("rappelle l'exclusion du droit à déduction de la TVA en l'absence de contrepartie", () => {
    const doc = buildVehiculeJustification(loaElectrique({ tvaRecuperableVehicule: false }));
    expect(doc).toContain("exclue du droit à déduction");
  });

  it("adapte la liste des pièces au mode de détention", () => {
    expect(buildVehiculeJustification(loaElectrique())).toContain("Contrat de location signé");
    expect(buildVehiculeJustification(loaElectrique())).toContain("Attestation du loueur");
    const achat = buildVehiculeJustification(loaElectrique({ financingMode: "comptant" }));
    expect(achat).toContain("Facture d'acquisition");
    expect(achat).not.toContain("Attestation du loueur");
  });
});

describe("buildVehiculeJustification — robustesse", () => {
  const cas: [string, Partial<SimulationInputs>][] = [
    ["prix nul", { vehiclePrice: 0 }],
    ["kilométrage nul", { totalKmAnnual: 0 }],
    ["usage 100 % privé", { privateUsePercent: 100 }],
    ["usage 100 % professionnel", { privateUsePercent: 0 }],
    ["usage hors bornes", { privateUsePercent: 250 }],
    ["prix démesuré", { vehiclePrice: 5_000_000 }],
    ["société déficitaire", { beneficeAvantChargePrevisionnel: 0, chiffreAffairesPrevisionnel: 0 }],
    ["libellés très longs", { nomDirigeant: "X".repeat(200), denominationSociete: "Y".repeat(200) }],
  ];

  it.each(cas)("%s : produit un document non vide et sans valeur illisible", (_libelle, patch) => {
    const doc = buildVehiculeJustification(loaElectrique(patch));
    expect(doc.length).toBeGreaterThan(2000);
    for (const interdit of ["NaN", "undefined", "Infinity", "[object Object]"]) {
      expect(doc, interdit).not.toContain(interdit);
    }
  });

  it("les lignes de tableau sont alignées à largeur constante", () => {
    const lignes = buildVehiculeJustification(loaElectrique())
      .split("\n")
      .filter((l) => l.startsWith("\t") && !l.includes("---"));
    expect(lignes.length).toBeGreaterThan(5);
    const largeurs = new Set(lignes.map((l) => l.length));
    expect(largeurs.size, [...largeurs].join(", ")).toBe(1);
  });

  it("un libellé trop long est tronqué pour ne pas casser l'alignement", () => {
    const doc = buildVehiculeJustification(loaElectrique({ nomDirigeant: "Z".repeat(150) }));
    const lignes = doc.split("\n").filter((l) => l.startsWith("\t") && !l.includes("---"));
    expect(new Set(lignes.map((l) => l.length)).size).toBe(1);
  });

  it("les quatre modes de détention produisent chacun un document complet", () => {
    for (const mode of ["comptant", "credit", "loa", "lld"] as const) {
      const doc = buildVehiculeJustification(loaElectrique({ financingMode: mode }));
      expect(doc, mode).toContain("— 8. Attestation —");
      expect(doc, mode).not.toContain("NaN");
    }
  });
});

describe("buildVehiculeJustification — proportionnalité quand la dépense excède le bénéfice", () => {
  it("nomme le déficit créé plutôt que de parler d'un simple rapport élevé", () => {
    // Bénéfice volontairement inférieur au coût du véhicule : la société ne se prive plus d'une
    // part de son résultat, elle le supprime. Le document doit le dire.
    const sim = loaElectrique({ beneficeAvantChargePrevisionnel: 3000 });
    const r = computeSimulation(sim);
    expect(r.coutNetSociete).toBeGreaterThan(3000);
    const doc = buildVehiculeJustification(sim);
    expect(doc).toContain("excède le bénéfice disponible");
    expect(doc).toContain("creuse un déficit");
    expect(doc).not.toContain("La société conserve un bénéfice");
  });

  it("rappelle qu'un déficit ne rend pas l'opération irrégulière, mais déplace la justification", () => {
    const doc = buildVehiculeJustification(loaElectrique({ beneficeAvantChargePrevisionnel: 3000 }));
    expect(doc).toContain("ne rend pas l'opération irrégulière");
    expect(doc).toContain("trésorerie disponible");
  });

  it("les trois situations s'excluent deux à deux", () => {
    const phrases = ["excède le bénéfice disponible", "absorbe plus de la moitié", "conserve un bénéfice"];
    for (const benefice of [3000, 12000, 200000]) {
      const doc = buildVehiculeJustification(loaElectrique({ beneficeAvantChargePrevisionnel: benefice }));
      const presentes = phrases.filter((p) => doc.includes(p));
      expect(presentes, `bénéfice ${benefice} : ${presentes.join(" + ")}`).toHaveLength(1);
    }
  });
});

describe("buildVehiculeJustification — usage exclusivement privé", () => {
  it("assume l'absence d'usage professionnel plutôt que de la passer sous silence", () => {
    const doc = buildVehiculeJustification(loaElectrique({ privateUsePercent: 100 }));
    expect(doc).toContain("AUCUN USAGE PROFESSIONNEL N'EST DÉCLARÉ");
    expect(doc).toContain("cette note ne prétend pas le contraire");
    expect(doc).toContain("ÉLÉMENT DE RÉMUNÉRATION");
  });

  it("déplace la justification du besoin professionnel vers la rémunération", () => {
    const doc = buildVehiculeJustification(loaElectrique({ privateUsePercent: 100 }));
    expect(doc).toContain("ne repose donc pas sur un besoin professionnel");
    expect(doc).toContain("39-1-1°");
    // Le seul terrain de défense restant est la proportionnalité de la rémunération globale.
    expect(doc).toContain("caractère non excessif de la rémunération globale");
  });

  it("tire les conséquences pratiques : aucune indemnité kilométrique possible", () => {
    const doc = buildVehiculeJustification(loaElectrique({ privateUsePercent: 100 }));
    expect(doc).toContain("aucune indemnité kilométrique");
  });

  it("un usage partiellement professionnel garde la formulation ordinaire", () => {
    const doc = buildVehiculeJustification(loaElectrique({ privateUsePercent: 90 }));
    expect(doc).not.toContain("AUCUN USAGE PROFESSIONNEL N'EST DÉCLARÉ");
    expect(doc).toContain("Sa prépondérance est assumée");
  });
});

describe("buildVehiculeJustification — réserves sur les points discutés", () => {
  it("signale que l'abattement électrique n'est pas acquis pour un TNS, et chiffre l'alternative", () => {
    const sim = loaElectrique({ companyType: "EURL", gerantMajoritaire: true });
    const r = computeSimulation(sim);
    expect(r.dirigeantStatus).toBe("TNS");
    expect(r.abattement).toBeGreaterThan(0);
    const doc = buildVehiculeJustification(sim);
    expect(doc).toContain("RÉSERVE EXPRESSE SUR CE POINT");
    expect(doc).toContain("hors du champ");
    expect(doc).toContain("le seul poste de la présente note dont le fondement soit discuté");
    // L'avantage sans abattement doit être chiffré, pour que la réserve soit exploitable.
    const chiffres = (s: string) => s.replace(/\D/g, "");
    const ligneReserve = doc.split("\n").find((l) => l.includes("RÉSERVE EXPRESSE"));
    expect(chiffres(ligneReserve ?? "")).toContain(chiffres(String(Math.round(r.aenNet + r.abattement))));
  });

  it("aucune réserve de ce type pour un assimilé salarié, qui est dans le champ du texte", () => {
    const doc = buildVehiculeJustification(loaElectrique({ companyType: "SASU" }));
    expect(doc).not.toContain("RÉSERVE EXPRESSE SUR CE POINT");
  });

  it("la transparence concourt à écarter la mauvaise foi sans trancher l'intérêt social", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("SANS PRÉJUGER");
    expect(doc).not.toContain("écartent la dissimulation");
  });

  it("la qualification en rémunération ne lève pas les limitations propres aux véhicules", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("ne lève toutefois AUCUNE des limitations propres aux véhicules de tourisme");
  });

  it("les prélèvements du bénéficiaire sont donnés comme des hypothèses de taux", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("retenus par hypothèse");
    expect(doc).toContain("ne se substituent pas au calcul de l'organisme social");
  });

  it("une société unipersonnelle désigne un associé unique, pas un gérant majoritaire", () => {
    expect(buildVehiculeJustification(loaElectrique({ companyType: "EURL" }))).toContain("gérant associé unique");
    expect(buildVehiculeJustification(loaElectrique({ companyType: "SASU" }))).toContain("président associé unique");
  });

  it("l'exonération de taxes annuelles est donnée sous réserve du certificat d'immatriculation", () => {
    const doc = buildVehiculeJustification(loaElectrique());
    expect(doc).toContain("sous réserve de confirmation à partir du certificat d'immatriculation");
  });
});
