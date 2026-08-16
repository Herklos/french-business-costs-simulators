// Suite combinatoire du simulateur de bureau à domicile : plutôt que de vérifier des cas isolés, on
// balaie le produit cartésien des principaux réglages et on assène sur CHAQUE combinaison un jeu
// d'invariants qui doivent tenir quelles que soient les options.
//
// C'est le filet qui manque le plus à ce simulateur : ses bugs passés — TEOM déduite du revenu
// foncier alors qu'elle ne l'est pas, déficit foncier écrasé par un Math.max(0, ...), quote-part
// proratisée deux fois — violaient tous un invariant simple, qu'aucun test ne formulait.

import { describe, expect, it, vi } from "vitest";
import {
  type HomeOfficeInputs,
  type RegimeFoncier,
  type StatutOccupant,
  type TypeLogement,
  ABATTEMENT_MICRO_FONCIER,
  CHARGES_NON_DEDUCTIBLES_FONCIER,
  PLAFOND_DEFICIT_FONCIER_REVENU_GLOBAL,
  PLAFOND_MICRO_FONCIER,
  PRELEVEMENTS_SOCIAUX_FONCIER,
  computeHomeOffice,
  createDefaultHomeOfficeInputs,
} from "./homeOffice";
import { computeIS } from "./corporateTax";

// Le produit cartésien dépasse le délai par défaut de 5 s sur une machine chargée.
vi.setConfig({ testTimeout: 60_000 });

/** Axes balayés. Volontairement resserrés à ce qui interagit réellement dans le moteur. */
const AXES = {
  statutOccupant: ["proprietaire", "locataire"] as StatutOccupant[],
  typeLogement: ["appartement", "maison"] as TypeLogement[],
  regimeFoncier: ["micro", "reel"] as RegimeFoncier[],
  impositionSociete: ["IS", "IR"] as const,
  empruntEnCours: [false, true],
  loyerAutoDepuisPrixM2: [false, true],
  formalisation: ["indemnite", "bail_professionnel"] as const,
  // Petit bureau / pièce entière / surface qui sature la quote-part à 100 %.
  surfaceBureauM2: [8, 24, 200],
  // Sans annexes / avec annexes pondérées.
  annexes: [0, 6],
  // Société déficitaire / peu profitable / très profitable : couvre le plafonnement de l'économie
  // d'IS et les deux tranches du barème.
  beneficeAvantChargePrevisionnel: [0, 30000, 250000],
  // Sous et au-dessus du plafond micro-foncier, qui force la bascule au réel.
  autresRevenusFonciersFoyer: [0, 40000],
};

type Combo = {
  [K in keyof typeof AXES]: (typeof AXES)[K][number];
};

function* combinaisons(): Generator<Combo> {
  for (const statutOccupant of AXES.statutOccupant)
    for (const typeLogement of AXES.typeLogement)
      for (const regimeFoncier of AXES.regimeFoncier)
        for (const impositionSociete of AXES.impositionSociete)
          for (const empruntEnCours of AXES.empruntEnCours)
            for (const loyerAutoDepuisPrixM2 of AXES.loyerAutoDepuisPrixM2)
              for (const formalisation of AXES.formalisation)
                for (const surfaceBureauM2 of AXES.surfaceBureauM2)
                  for (const annexes of AXES.annexes)
                    for (const beneficeAvantChargePrevisionnel of AXES.beneficeAvantChargePrevisionnel)
                      for (const autresRevenusFonciersFoyer of AXES.autresRevenusFonciersFoyer)
                        yield {
                          statutOccupant,
                          typeLogement,
                          regimeFoncier,
                          impositionSociete,
                          empruntEnCours,
                          loyerAutoDepuisPrixM2,
                          formalisation,
                          surfaceBureauM2,
                          annexes,
                          beneficeAvantChargePrevisionnel,
                          autresRevenusFonciersFoyer,
                        } as Combo;
}

function inputsFor(combo: Combo): HomeOfficeInputs {
  const defauts = createDefaultHomeOfficeInputs();
  return {
    ...defauts,
    statutOccupant: combo.statutOccupant,
    typeLogement: combo.typeLogement,
    regimeFoncier: combo.regimeFoncier,
    impositionSociete: combo.impositionSociete,
    empruntEnCours: combo.empruntEnCours,
    loyerAutoDepuisPrixM2: combo.loyerAutoDepuisPrixM2,
    formalisation: combo.formalisation,
    surfaceTotaleM2: 80,
    surfaceBureauM2: combo.surfaceBureauM2,
    surfacesAnnexes: defauts.surfacesAnnexes.map((a) => ({ ...a, surfaceM2: combo.annexes, coefficientPro: 0.5 })),
    beneficeAvantChargePrevisionnel: combo.beneficeAvantChargePrevisionnel,
    autresRevenusFonciersFoyer: combo.autresRevenusFonciersFoyer,
    // Emprunt volontairement lourd : c'est ce qui déclenche le déficit foncier et l'écart de régime.
    interetsEmpruntAnnuels: 24000,
    assuranceEmpruntAnnuelle: 900,
    fraisMiseEnPlaceBail: 800,
    // Toutes les lignes activées, TEOM comprise : c'est le seul moyen de tester son exclusion de la
    // déduction foncière sur toutes les combinaisons.
    chargeLines: defauts.chargeLines.map((c) => ({ ...c, enabled: true })),
    // TMI fixé pour rendre les identités arithmétiques vérifiables sans rejouer le barème.
    personalTaxProfile: { ...defauts.personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
  };
}

const TOUTES = [...combinaisons()];

describe("homeOffice — invariants sur toutes les combinaisons", () => {
  it(`balaie un nombre significatif de combinaisons (${TOUTES.length})`, () => {
    expect(TOUTES.length).toBeGreaterThan(1000);
  });

  it("ne produit jamais de NaN ni d'infini, sur aucun résultat", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      for (const [cle, valeur] of Object.entries(r)) {
        if (typeof valeur === "number") {
          expect(Number.isFinite(valeur), `${cle} — ${JSON.stringify(combo)}`).toBe(true);
        }
      }
    }
  });

  it("la quote-part reste dans [0, 1] et vaut surface pro ÷ surface totale", () => {
    for (const combo of TOUTES) {
      const inputs = inputsFor(combo);
      const r = computeHomeOffice(inputs);
      expect(r.quotePartSurface).toBeGreaterThanOrEqual(0);
      expect(r.quotePartSurface).toBeLessThanOrEqual(1);
      expect(r.quotePartSurface).toBeCloseTo(
        Math.min(1, r.surfaceProfessionnelleTotale / inputs.surfaceTotaleM2),
        9,
      );
    }
  });

  it("surface professionnelle = bureau + annexes pondérées, jamais autre chose", () => {
    for (const combo of TOUTES) {
      const inputs = inputsFor(combo);
      const r = computeHomeOffice(inputs);
      const attendu = inputs.surfacesAnnexes.reduce(
        (s, a) => s + (a.enabled ? a.surfaceM2 * a.coefficientPro : 0),
        0,
      );
      expect(r.surfaceAnnexeRetenue).toBeCloseTo(attendu, 9);
      expect(r.surfaceProfessionnelleTotale).toBeCloseTo(inputs.surfaceBureauM2 + attendu, 9);
    }
  });

  it("indemnité brute = charges retenues × quote-part, et jamais négative", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.indemniteAnnuelleBrute).toBeGreaterThanOrEqual(0);
      expect(r.indemniteAnnuelleBrute).toBeCloseTo(r.totalChargesRetenuesAnnuel * r.quotePartSurface, 6);
    }
  });

  it("le loyer imputé au bureau est la quote-part du loyer du logement entier", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.loyerAnnuelBureauRetenu).toBeCloseTo(r.loyerAnnuelLogementRetenu * r.quotePartSurface, 6);
    }
  });
});

describe("homeOffice — invariants du régime foncier", () => {
  it("l'éligibilité au micro suit strictement le plafond de 15 000 €", () => {
    for (const combo of TOUTES) {
      const inputs = inputsFor(combo);
      const r = computeHomeOffice(inputs);
      const total = r.indemniteAnnuelleBrute + inputs.autresRevenusFonciersFoyer;
      expect(r.eligibleMicroFoncier, JSON.stringify(combo)).toBe(total <= PLAFOND_MICRO_FONCIER);
    }
  });

  it("hors plafond, le régime effectif bascule au réel quoi qu'ait choisi l'utilisateur", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      if (!r.eligibleMicroFoncier) expect(r.regimeEffectif).toBe("reel");
      else expect(r.regimeEffectif).toBe(combo.regimeFoncier);
    }
  });

  it("la base imposée est celle du régime effectif, et jamais négative", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.baseImposableFonciere).toBeGreaterThanOrEqual(0);
      expect(r.baseImposableFonciere).toBeCloseTo(r.regimeEffectif === "micro" ? r.baseMicro : r.baseReel, 6);
    }
  });

  it("le point de bascule est toujours l'abattement forfaitaire de 30 %", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.seuilBasculeReel).toBeCloseTo(r.indemniteAnnuelleBrute * ABATTEMENT_MICRO_FONCIER, 6);
      expect(r.baseMicro).toBeCloseTo(r.indemniteAnnuelleBrute - r.seuilBasculeReel, 6);
    }
  });

  it("le régime optimal est bien le moins coûteux des deux, quand le choix existe", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      if (!r.eligibleMicroFoncier) {
        expect(r.regimeOptimal).toBe("reel");
        continue;
      }
      expect(r.regimeOptimal).toBe(r.coutFiscalMicro <= r.coutFiscalReel ? "micro" : "reel");
      expect(r.gainRegimeOptimal).toBeCloseTo(Math.abs(r.coutFiscalMicro - r.coutFiscalReel), 6);
      expect(r.gainRegimeOptimal).toBeGreaterThanOrEqual(0);
    }
  });

  it("la TEOM est dans l'assiette de l'indemnité mais jamais dans la déduction foncière", () => {
    for (const combo of TOUTES) {
      const inputs = inputsFor(combo);
      const r = computeHomeOffice(inputs);
      const teom = r.chargeLinesEffectives.find((c) => c.id === "taxeOrduresMenageres");
      expect(teom?.enabled).toBe(true);
      const deductiblesAttendues =
        r.chargeLinesEffectives
          .filter((c) => c.enabled && c.id !== "loyer" && !CHARGES_NON_DEDUCTIBLES_FONCIER.has(c.id))
          .reduce((s, c) => s + c.montantAnnuel, 0) * r.quotePartSurface;
      // `chargesDeductiblesReel` chiffre le SCÉNARIO réel : il inclut l'emprunt même quand le micro
      // est sélectionné, puisqu'il sert à comparer les deux régimes.
      const empruntAttendu =
        combo.empruntEnCours && combo.statutOccupant === "proprietaire"
          ? (inputs.interetsEmpruntAnnuels + inputs.assuranceEmpruntAnnuelle) * r.quotePartSurface
          : 0;
      expect(r.chargesDeductiblesReel, JSON.stringify(combo)).toBeCloseTo(deductiblesAttendues + empruntAttendu, 6);
    }
  });

  it("les charges déductibles du scénario réel ne dépendent jamais du régime sélectionné", () => {
    for (const combo of TOUTES) {
      const inputs = inputsFor(combo);
      const enMicro = computeHomeOffice({ ...inputs, regimeFoncier: "micro" });
      const enReel = computeHomeOffice({ ...inputs, regimeFoncier: "reel" });
      expect(enMicro.chargesDeductiblesReel).toBeCloseTo(enReel.chargesDeductiblesReel, 6);
      expect(enMicro.baseReel).toBeCloseTo(enReel.baseReel, 6);
      expect(enMicro.baseMicro).toBeCloseTo(enReel.baseMicro, 6);
    }
  });

  it("les intérêts ne sont déduits qu'au réel, propriétaire, emprunt déclaré", () => {
    for (const combo of TOUTES) {
      const inputs = inputsFor(combo);
      const r = computeHomeOffice(inputs);
      const eligible = r.regimeEffectif === "reel" && combo.empruntEnCours && combo.statutOccupant === "proprietaire";
      if (!eligible) {
        expect(r.interetsEmpruntDeduits, JSON.stringify(combo)).toBe(0);
      } else {
        expect(r.interetsEmpruntDeduits).toBeCloseTo(
          (inputs.interetsEmpruntAnnuels + inputs.assuranceEmpruntAnnuelle) * r.quotePartSurface,
          6,
        );
      }
    }
  });
});

describe("homeOffice — invariants du déficit foncier", () => {
  it("imputable + reportable = déficit total, sans perte ni création", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.deficitFoncierTotal).toBeGreaterThanOrEqual(0);
      expect(r.deficitImputableRevenuGlobal).toBeGreaterThanOrEqual(0);
      expect(r.deficitReportableFoncier).toBeGreaterThanOrEqual(0);
      expect(r.deficitImputableRevenuGlobal + r.deficitReportableFoncier).toBeCloseTo(r.deficitFoncierTotal, 6);
    }
  });

  it("l'imputation immédiate ne dépasse jamais le plafond légal", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.deficitImputableRevenuGlobal).toBeLessThanOrEqual(PLAFOND_DEFICIT_FONCIER_REVENU_GLOBAL);
    }
  });

  it("déficit et base imposable réelle ne coexistent jamais", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      if (r.deficitFoncierTotal > 0) expect(r.baseReel, JSON.stringify(combo)).toBe(0);
      if (r.baseReel > 0) expect(r.deficitFoncierTotal).toBe(0);
    }
  });

  it("le déficit ne procure aucune économie hors régime réel", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      if (r.regimeEffectif !== "reel") expect(r.economieIRDeficitFoncier).toBe(0);
    }
  });
});

describe("homeOffice — identités comptables", () => {
  it("IR et prélèvements sociaux se déduisent de la base au taux attendu", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.irDu).toBeCloseTo(r.baseImposableFonciere * r.tauxIRUtilise, 6);
      expect(r.prelevementsSociaux).toBeCloseTo(r.baseImposableFonciere * PRELEVEMENTS_SOCIAUX_FONCIER, 6);
    }
  });

  it("coût fiscal du dirigeant = IR + PS − économie de déficit imputé", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.coutFiscalGerant).toBeCloseTo(r.irDu + r.prelevementsSociaux - r.economieIRDeficitFoncier, 6);
    }
  });

  it("gain net du dirigeant = indemnité − coût fiscal", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.gainNetGerant).toBeCloseTo(r.indemniteAnnuelleBrute - r.coutFiscalGerant, 6);
    }
  });

  it("les frais de mise en place ne pèsent que sur la 1re année, et seulement en bail réel", () => {
    for (const combo of TOUTES) {
      const inputs = inputsFor(combo);
      const r = computeHomeOffice(inputs);
      const frais = combo.formalisation === "bail_professionnel" ? inputs.fraisMiseEnPlaceBail : 0;
      expect(r.gainNetGerantAnnee1).toBeCloseTo(r.gainNetGerant - frais, 6);
    }
  });

  it("coût net société = indemnité − économie d'impôt, l'économie ne dépassant jamais l'indemnité", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.economieImpotSociete).toBeGreaterThanOrEqual(0);
      expect(r.economieImpotSociete).toBeLessThanOrEqual(r.indemniteAnnuelleBrute + 1e-6);
      expect(r.coutNetSociete).toBeCloseTo(r.indemniteAnnuelleBrute - r.economieImpotSociete, 6);
    }
  });

  it("les deux formulations du coût net global coïncident", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.coutNetGlobal).toBeCloseTo(r.coutFiscalGerant - r.economieImpotSociete, 6);
      expect(r.coutNetGlobal).toBeCloseTo(r.coutNetSociete - r.gainNetGerant, 6);
    }
  });

  it("l'économie d'IS suit le barème progressif et le plafonnement par le bénéfice", () => {
    for (const combo of TOUTES) {
      if (combo.impositionSociete !== "IS") continue;
      const inputs = inputsFor(combo);
      const r = computeHomeOffice(inputs);
      const isAvant = computeIS(inputs.beneficeAvantChargePrevisionnel, inputs.eligibleTauxReduitPME, inputs.corporateTaxRate);
      const isApres = computeIS(
        inputs.beneficeAvantChargePrevisionnel - r.indemniteAnnuelleBrute,
        inputs.eligibleTauxReduitPME,
        inputs.corporateTaxRate,
      );
      expect(r.economieImpotSociete).toBeCloseTo(Math.max(0, isAvant - isApres), 6);
      // Une société sans bénéfice ne récupère rien immédiatement.
      if (inputs.beneficeAvantChargePrevisionnel === 0) expect(r.economieImpotSociete).toBe(0);
    }
  });

  it("l'économie vaut le taux marginal du foyer en régime translucide", () => {
    for (const combo of TOUTES) {
      if (combo.impositionSociete !== "IR") continue;
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.economieImpotSociete).toBeCloseTo(r.indemniteAnnuelleBrute * r.tauxIRUtilise, 6);
    }
  });

  it("la comparaison au bureau externe est cohérente et jamais négative en coût", () => {
    for (const combo of TOUTES) {
      const r = computeHomeOffice(inputsFor(combo));
      expect(r.coutBureauExterneAnnuel).toBeGreaterThanOrEqual(0);
      expect(r.economieVsBureauExterne).toBeCloseTo(r.coutBureauExterneAnnuel - r.coutNetSociete, 6);
    }
  });
});

describe("homeOffice — monotonies et homogénéité", () => {
  const base = (): HomeOfficeInputs => ({
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 12,
    personalTaxProfile: { ...createDefaultHomeOfficeInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
  });

  it("agrandir le bureau ne peut jamais faire baisser l'indemnité", () => {
    let precedent = -1;
    for (const surfaceBureauM2 of [0, 4, 8, 12, 20, 40, 79, 80, 200]) {
      const r = computeHomeOffice({ ...base(), surfaceBureauM2 });
      expect(r.indemniteAnnuelleBrute, `${surfaceBureauM2} m²`).toBeGreaterThanOrEqual(precedent);
      precedent = r.indemniteAnnuelleBrute;
    }
  });

  it("augmenter le prix au m² ne peut jamais faire baisser l'indemnité", () => {
    let precedent = -1;
    for (const loyerMarcheM2Mensuel of [0, 5, 10, 16, 32, 60]) {
      const r = computeHomeOffice({ ...base(), loyerMarcheM2Mensuel, loyerAutoDepuisPrixM2: true });
      expect(r.indemniteAnnuelleBrute).toBeGreaterThanOrEqual(precedent);
      precedent = r.indemniteAnnuelleBrute;
    }
  });

  it("un TMI plus élevé coûte plus cher au dirigeant, à indemnité constante", () => {
    let precedent = -1;
    for (const tauxManuel of [0, 0.11, 0.3, 0.41, 0.45]) {
      const inputs = base();
      const r = computeHomeOffice({
        ...inputs,
        personalTaxProfile: { ...inputs.personalTaxProfile, mode: "manuel", tauxManuel },
      });
      expect(r.coutFiscalGerant, String(tauxManuel)).toBeGreaterThanOrEqual(precedent);
      precedent = r.coutFiscalGerant;
    }
  });

  it("doubler toutes les charges double l'indemnité (homogénéité de degré 1)", () => {
    const inputs = { ...base(), loyerAutoDepuisPrixM2: false };
    const simple = computeHomeOffice(inputs);
    const double = computeHomeOffice({
      ...inputs,
      chargeLines: inputs.chargeLines.map((c) => ({ ...c, montantAnnuel: c.montantAnnuel * 2 })),
    });
    expect(double.indemniteAnnuelleBrute).toBeCloseTo(2 * simple.indemniteAnnuelleBrute, 6);
    expect(double.quotePartSurface).toBeCloseTo(simple.quotePartSurface, 9);
  });

  it("les charges n'influencent jamais la quote-part de surface", () => {
    const inputs = base();
    const quotePart = computeHomeOffice(inputs).quotePartSurface;
    for (const facteur of [0, 0.5, 10]) {
      const r = computeHomeOffice({
        ...inputs,
        chargeLines: inputs.chargeLines.map((c) => ({ ...c, montantAnnuel: c.montantAnnuel * facteur })),
      });
      expect(r.quotePartSurface).toBeCloseTo(quotePart, 9);
    }
  });

  it("la somme des contributions poste par poste reconstitue l'indemnité", () => {
    const inputs = { ...base(), loyerAutoDepuisPrixM2: false };
    const r = computeHomeOffice(inputs);
    let cumul = 0;
    for (const ligne of r.chargeLinesEffectives) {
      if (!ligne.enabled) continue;
      cumul += ligne.montantAnnuel * r.quotePartSurface;
    }
    expect(cumul).toBeCloseTo(r.indemniteAnnuelleBrute, 6);
  });

  it("désactiver chaque poste un par un retire exactement sa contribution", () => {
    const inputs = { ...base(), loyerAutoDepuisPrixM2: false };
    const reference = computeHomeOffice(inputs);
    for (const ligne of reference.chargeLinesEffectives) {
      if (!ligne.enabled) continue;
      const sans = computeHomeOffice({
        ...inputs,
        chargeLines: inputs.chargeLines.map((c) => (c.id === ligne.id ? { ...c, enabled: false } : c)),
      });
      expect(reference.indemniteAnnuelleBrute - sans.indemniteAnnuelleBrute, ligne.id).toBeCloseTo(
        ligne.montantAnnuel * reference.quotePartSurface,
        6,
      );
    }
  });
});

describe("homeOffice — cas limites", () => {
  const cas: [string, Partial<HomeOfficeInputs>][] = [
    ["surface totale nulle", { surfaceTotaleM2: 0 }],
    ["bureau nul", { surfaceBureauM2: 0 }],
    ["bureau plus grand que le logement", { surfaceTotaleM2: 30, surfaceBureauM2: 90 }],
    ["surfaces négatives", { surfaceTotaleM2: -50, surfaceBureauM2: -10 }],
    ["prix au m² négatif", { loyerMarcheM2Mensuel: -20, loyerAutoDepuisPrixM2: true }],
    ["emprunt négatif", { empruntEnCours: true, interetsEmpruntAnnuels: -9000, assuranceEmpruntAnnuelle: -100 }],
    ["emprunt colossal", { empruntEnCours: true, interetsEmpruntAnnuels: 5_000_000, regimeFoncier: "reel" }],
    ["bénéfice société négatif", { beneficeAvantChargePrevisionnel: -100000 }],
    ["taux d'IS nul", { corporateTaxRate: 0 }],
    ["autres revenus fonciers énormes", { autresRevenusFonciersFoyer: 10_000_000 }],
    ["coworking à zéro jour", { typeComparaisonExterne: "coworking", coworkingJoursParMois: 0 }],
    ["toutes charges à zéro", {}],
  ];

  it.each(cas)("%s : aucun résultat aberrant", (_libelle, patch) => {
    const defauts = createDefaultHomeOfficeInputs();
    const inputs: HomeOfficeInputs = {
      ...defauts,
      personalTaxProfile: { ...defauts.personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
      ...patch,
    };
    const r = computeHomeOffice(inputs);

    for (const [cle, valeur] of Object.entries(r)) {
      if (typeof valeur === "number") expect(Number.isFinite(valeur), cle).toBe(true);
    }
    expect(r.quotePartSurface).toBeGreaterThanOrEqual(0);
    expect(r.quotePartSurface).toBeLessThanOrEqual(1);
    expect(r.indemniteAnnuelleBrute).toBeGreaterThanOrEqual(0);
    expect(r.baseImposableFonciere).toBeGreaterThanOrEqual(0);
    expect(r.totalChargesRetenuesAnnuel).toBeGreaterThanOrEqual(0);
    expect(r.economieImpotSociete).toBeGreaterThanOrEqual(0);
    expect(r.coutBureauExterneAnnuel).toBeGreaterThanOrEqual(0);
    expect(r.deficitImputableRevenuGlobal + r.deficitReportableFoncier).toBeCloseTo(r.deficitFoncierTotal, 6);
    expect(r.coutNetGlobal).toBeCloseTo(r.coutNetSociete - r.gainNetGerant, 6);
  });

  it("toutes charges désactivées : indemnité nulle et fiscalité nulle", () => {
    const defauts = createDefaultHomeOfficeInputs();
    const r = computeHomeOffice({
      ...defauts,
      chargeLines: defauts.chargeLines.map((c) => ({ ...c, enabled: false })),
    });
    expect(r.indemniteAnnuelleBrute).toBe(0);
    expect(r.baseImposableFonciere).toBe(0);
    expect(r.irDu).toBe(0);
    expect(r.prelevementsSociaux).toBe(0);
    expect(r.economieImpotSociete).toBe(0);
    expect(r.coutNetGlobal).toBe(0);
  });
});
