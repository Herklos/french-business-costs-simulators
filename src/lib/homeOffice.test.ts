import { describe, expect, it } from "vitest";
import {
  type HomeOfficeInputs,
  type SurfaceAnnexe,
  CHAMPS_NON_PERSISTES,
  PLAFOND_DEFICIT_FONCIER_REVENU_GLOBAL,
  TOLERANCE_SURFACE_BUREAU_DEFAUT,
  applyHomeOfficeDraft,
  chargeLinesDeReference,
  computeHomeOffice,
  createDefaultHomeOfficeInputs,
  extractHomeOfficeDraft,
} from "./homeOffice";
import { montantReferenceCharge } from "./logementCharges";
import { findLoyerVille, prixM2Ville } from "./loyersVille";

function disableCharge(inputs: HomeOfficeInputs, id: string): HomeOfficeInputs {
  return { ...inputs, chargeLines: inputs.chargeLines.map((c) => (c.id === id ? { ...c, enabled: false } : c)) };
}

/**
 * Cas d'école entièrement calculables de tête. Les invariants des autres suites prouvent la
 * COHÉRENCE interne du moteur ; ces tests-ci prouvent qu'il donne les BONS nombres. Chaque valeur
 * attendue est écrite avec son calcul, pour qu'une divergence se diagnostique sans déboguer.
 */
describe("computeHomeOffice — cas d'école chiffrés à la main", () => {
  /**
   * Logement de 100 m², bureau de 20 m² → quote-part exactement 20 %.
   * Trois postes seulement : loyer 12 000, électricité 2 000, taxe foncière 1 000 = 15 000 €/an.
   * Indemnité = 15 000 × 20 % = 3 000 €/an.
   * TMI 30 %, société à l'IS, bénéfice 100 000 €, taux réduit PME applicable.
   */
  function casEcole(patch: Partial<HomeOfficeInputs> = {}): HomeOfficeInputs {
    const defauts = createDefaultHomeOfficeInputs();
    const montants: Record<string, number> = { loyer: 12000, electricite: 2000, taxeFonciere: 1000 };
    return {
      ...defauts,
      surfaceTotaleM2: 100,
      surfaceBureauM2: 20,
      surfacesAnnexes: defauts.surfacesAnnexes.map((a) => ({ ...a, surfaceM2: 0 })),
      loyerAutoDepuisPrixM2: false,
      chargeLines: defauts.chargeLines.map((c) => ({
        ...c,
        enabled: c.id in montants,
        montantAnnuel: montants[c.id] ?? 0,
      })),
      regimeFoncier: "micro",
      autresRevenusFonciersFoyer: 0,
      empruntEnCours: false,
      interetsEmpruntAnnuels: 0,
      assuranceEmpruntAnnuelle: 0,
      impositionSociete: "IS",
      beneficeAvantChargePrevisionnel: 100000,
      eligibleTauxReduitPME: true,
      corporateTaxRate: 0.25,
      formalisation: "indemnite",
      personalTaxProfile: { ...defauts.personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
      ...patch,
    };
  }

  it("quote-part et assiette : 20 m² / 100 m² sur 15 000 € de charges = 3 000 €", () => {
    const r = computeHomeOffice(casEcole());
    expect(r.quotePartSurface).toBeCloseTo(0.2, 9);
    expect(r.totalChargesRetenuesAnnuel).toBe(15000);
    expect(r.indemniteAnnuelleBrute).toBeCloseTo(3000, 6);
    expect(r.loyerAnnuelBureauRetenu).toBeCloseTo(12000 * 0.2, 6); // 2 400 €
  });

  it("micro-foncier : abattement 900, base 2 100, IR 630, PS 361,20 → coût fiscal 991,20", () => {
    const r = computeHomeOffice(casEcole({ regimeFoncier: "micro" }));
    expect(r.abattementApplique).toBeCloseTo(900, 6); // 3 000 × 30 %
    expect(r.baseImposableFonciere).toBeCloseTo(2100, 6);
    expect(r.irDu).toBeCloseTo(630, 6); // 2 100 × 30 %
    expect(r.prelevementsSociaux).toBeCloseTo(361.2, 6); // 2 100 × 17,2 %
    expect(r.coutFiscalGerant).toBeCloseTo(991.2, 6);
    expect(r.gainNetGerant).toBeCloseTo(2008.8, 6); // 3 000 − 991,20
  });

  it("régime réel : 600 € de charges déduites, base 2 400 → coût fiscal 1 132,80", () => {
    const r = computeHomeOffice(casEcole({ regimeFoncier: "reel" }));
    // Charges hors loyer : 2 000 + 1 000 = 3 000, ramenées au bureau par 20 % = 600.
    expect(r.chargesDeductiblesReel).toBeCloseTo(600, 6);
    expect(r.baseImposableFonciere).toBeCloseTo(2400, 6);
    expect(r.coutFiscalGerant).toBeCloseTo(2400 * 0.472, 6); // 1 132,80
  });

  it("le micro l'emporte ici de 141,60 €/an, et le simulateur le dit", () => {
    const r = computeHomeOffice(casEcole());
    expect(r.coutFiscalMicro).toBeCloseTo(991.2, 6);
    expect(r.coutFiscalReel).toBeCloseTo(1132.8, 6);
    expect(r.regimeOptimal).toBe("micro");
    expect(r.gainRegimeOptimal).toBeCloseTo(141.6, 6);
  });

  it("économie d'IS : 750 € — la charge tombe entièrement dans la tranche à 25 %", () => {
    const r = computeHomeOffice(casEcole());
    // IS sur 100 000 = 42 500 × 15 % + 57 500 × 25 % = 20 750.
    // IS sur 97 000 = 42 500 × 15 % + 54 500 × 25 % = 20 000. Écart : 750 = 3 000 × 25 %.
    expect(r.economieImpotSociete).toBeCloseTo(750, 6);
    expect(r.coutNetSociete).toBeCloseTo(2250, 6);
    expect(r.coutNetGlobal).toBeCloseTo(241.2, 6); // 991,20 − 750
  });

  it("bénéfice à cheval sur les deux tranches : l'économie suit le barème, pas un taux flat", () => {
    // Bénéfice 44 000 : la charge de 3 000 absorbe 1 500 à 25 % puis 1 500 à 15 %.
    const r = computeHomeOffice(casEcole({ beneficeAvantChargePrevisionnel: 44000 }));
    expect(r.economieImpotSociete).toBeCloseTo(1500 * 0.25 + 1500 * 0.15, 6); // 600
  });

  it("société sans taux réduit PME : économie au taux normal plein", () => {
    const r = computeHomeOffice(casEcole({ eligibleTauxReduitPME: false }));
    expect(r.economieImpotSociete).toBeCloseTo(3000 * 0.25, 6);
  });

  it("société translucide (IR) : économie au taux marginal du foyer", () => {
    const r = computeHomeOffice(casEcole({ impositionSociete: "IR" }));
    expect(r.economieImpotSociete).toBeCloseTo(3000 * 0.3, 6); // 900
  });

  it("déficit foncier : 20 000 € d'intérêts sur ce dossier donnent 1 600 € de déficit", () => {
    const r = computeHomeOffice(
      casEcole({ regimeFoncier: "reel", empruntEnCours: true, interetsEmpruntAnnuels: 20000 }),
    );
    // Intérêts imputés en premier : 20 000 × 20 % = 4 000 contre 3 000 d'indemnité → 1 000 de
    // déficit « emprunt », seulement reportable. Puis 600 d'autres charges → 600 imputables.
    expect(r.interetsEmpruntDeduits).toBeCloseTo(4000, 6);
    expect(r.deficitFoncierTotal).toBeCloseTo(1600, 6);
    expect(r.deficitImputableRevenuGlobal).toBeCloseTo(600, 6);
    expect(r.deficitReportableFoncier).toBeCloseTo(1000, 6);
    expect(r.economieIRDeficitFoncier).toBeCloseTo(180, 6); // 600 × 30 %
    expect(r.baseImposableFonciere).toBe(0);
    expect(r.coutFiscalGerant).toBeCloseTo(-180, 6);
    expect(r.gainNetGerant).toBeCloseTo(3180, 6);
  });

  it("annexes d'usage mixte : 10 m² à 40 % portent la quote-part de 20 % à 24 %", () => {
    const inputs = casEcole();
    const r = computeHomeOffice({
      ...inputs,
      surfacesAnnexes: inputs.surfacesAnnexes.map((a, i) =>
        i === 0 ? { ...a, surfaceM2: 10, coefficientPro: 0.4, enabled: true } : a,
      ),
    });
    expect(r.surfaceAnnexeRetenue).toBeCloseTo(4, 6);
    expect(r.surfaceProfessionnelleTotale).toBeCloseTo(24, 6);
    expect(r.quotePartSurface).toBeCloseTo(0.24, 9);
    expect(r.indemniteAnnuelleBrute).toBeCloseTo(3600, 6); // 15 000 × 24 %
  });

  it("loyer calculé : 25 €/m²/mois sur 100 m² donnent 30 000 €/an, dont 6 000 pour le bureau", () => {
    const r = computeHomeOffice(casEcole({ loyerAutoDepuisPrixM2: true, loyerMarcheM2Mensuel: 25 }));
    expect(r.loyerAnnuelLogementRetenu).toBeCloseTo(30000, 6);
    expect(r.loyerAnnuelBureauRetenu).toBeCloseTo(6000, 6); // 25 × 20 × 12
    expect(r.totalChargesRetenuesAnnuel).toBeCloseTo(33000, 6); // 30 000 + 2 000 + 1 000
    expect(r.indemniteAnnuelleBrute).toBeCloseTo(6600, 6);
  });

  it("bail professionnel : les frais de mise en place ne grèvent que la 1re année", () => {
    const r = computeHomeOffice(casEcole({ formalisation: "bail_professionnel", fraisMiseEnPlaceBail: 900 }));
    expect(r.gainNetGerant).toBeCloseTo(2008.8, 6);
    expect(r.gainNetGerantAnnee1).toBeCloseTo(1108.8, 6);
  });

  it("comparaison au bureau externe : location 400 €/mois → 4 800 €/an, économie 2 550 €", () => {
    const r = computeHomeOffice(casEcole({ typeComparaisonExterne: "location", loyerBureauExterneMensuel: 400 }));
    expect(r.coutBureauExterneAnnuel).toBeCloseTo(4800, 6);
    expect(r.economieVsBureauExterne).toBeCloseTo(4800 - 2250, 6);
  });

  it("comparaison au coworking : 30 €/jour × 15 jours × 12 = 5 400 €/an", () => {
    const r = computeHomeOffice(
      casEcole({ typeComparaisonExterne: "coworking", coworkingTarifJournalier: 30, coworkingJoursParMois: 15 }),
    );
    expect(r.coutBureauExterneAnnuel).toBeCloseTo(5400, 6);
  });

  it("la TEOM entre dans l'assiette sans entrer dans la déduction, sur un cas chiffré", () => {
    const inputs = casEcole({ regimeFoncier: "reel" });
    const avecTeom = computeHomeOffice({
      ...inputs,
      chargeLines: inputs.chargeLines.map((c) =>
        c.id === "taxeOrduresMenageres" ? { ...c, enabled: true, montantAnnuel: 500 } : c,
      ),
    });
    // +500 × 20 % = +100 d'indemnité, mais 0 de charge déductible en plus.
    expect(avecTeom.indemniteAnnuelleBrute).toBeCloseTo(3100, 6);
    expect(avecTeom.chargesDeductiblesReel).toBeCloseTo(600, 6);
    expect(avecTeom.baseImposableFonciere).toBeCloseTo(2500, 6);
  });

  it("plafond micro : au-delà de 15 000 € de revenus fonciers, le réel s'impose", () => {
    const sous = computeHomeOffice(casEcole({ autresRevenusFonciersFoyer: 11999 }));
    expect(sous.eligibleMicroFoncier).toBe(true); // 3 000 + 11 999 = 14 999
    const au = computeHomeOffice(casEcole({ autresRevenusFonciersFoyer: 12001 }));
    expect(au.eligibleMicroFoncier).toBe(false); // 3 000 + 12 001 = 15 001
    expect(au.regimeEffectif).toBe("reel");
  });
});

describe("computeHomeOffice — quote-part et charges", () => {
  it("la quote-part de surface est bornée à 100% même si le bureau dépasse le logement", () => {
    const inputs = { ...createDefaultHomeOfficeInputs(), surfaceTotaleM2: 50, surfaceBureauM2: 80 };
    const r = computeHomeOffice(inputs);
    expect(r.quotePartSurface).toBe(1);
  });

  it("surface totale nulle : quote-part nulle (division par zéro évitée)", () => {
    const inputs = { ...createDefaultHomeOfficeInputs(), surfaceTotaleM2: 0, surfaceBureauM2: 12 };
    const r = computeHomeOffice(inputs);
    expect(r.quotePartSurface).toBe(0);
    expect(r.indemniteAnnuelleBrute).toBe(0);
  });

  it("désactiver un poste de charge réduit l'indemnité annuelle brute", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const avecTout = computeHomeOffice(inputs);
    const sansElectricite = computeHomeOffice(disableCharge(inputs, "electricite"));
    expect(sansElectricite.indemniteAnnuelleBrute).toBeLessThan(avecTout.indemniteAnnuelleBrute);
  });

  it("désactiver toutes les charges donne une indemnité nulle", () => {
    let inputs = createDefaultHomeOfficeInputs();
    for (const c of inputs.chargeLines) {
      inputs = disableCharge(inputs, c.id);
    }
    const r = computeHomeOffice(inputs);
    expect(r.indemniteAnnuelleBrute).toBe(0);
    expect(r.totalChargesRetenuesAnnuel).toBe(0);
  });

  it("l'indemnité brute = charges retenues × quote-part de surface", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const r = computeHomeOffice(inputs);
    expect(r.indemniteAnnuelleBrute).toBeCloseTo(r.totalChargesRetenuesAnnuel * r.quotePartSurface, 6);
  });
});

describe("computeHomeOffice — surfaces annexes d'usage mixte", () => {
  const base: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 12,
  };

  function avecAnnexes(inputs: HomeOfficeInputs, annexes: Partial<SurfaceAnnexe>[]): HomeOfficeInputs {
    return {
      ...inputs,
      surfacesAnnexes: inputs.surfacesAnnexes.map((a, i) => ({ ...a, ...(annexes[i] ?? {}) })),
    };
  }

  it("aucune annexe renseignée par défaut : la quote-part est celle du seul bureau", () => {
    const r = computeHomeOffice(base);
    expect(r.surfaceAnnexeRetenue).toBe(0);
    expect(r.surfaceProfessionnelleTotale).toBe(12);
    expect(r.quotePartSurface).toBeCloseTo(12 / 80, 6);
  });

  it("une annexe est retenue pour surface × coefficient", () => {
    const r = computeHomeOffice(avecAnnexes(base, [{ surfaceM2: 6, coefficientPro: 0.5 }]));
    expect(r.surfaceAnnexeRetenue).toBeCloseTo(3, 6);
    expect(r.surfaceProfessionnelleTotale).toBeCloseTo(15, 6);
    expect(r.quotePartSurface).toBeCloseTo(15 / 80, 6);
  });

  it("les annexes s'additionnent", () => {
    const r = computeHomeOffice(
      avecAnnexes(base, [
        { surfaceM2: 4, coefficientPro: 0.5 },
        { surfaceM2: 6, coefficientPro: 0.5 },
        { surfaceM2: 2, coefficientPro: 1 },
      ]),
    );
    expect(r.surfaceAnnexeRetenue).toBeCloseTo(2 + 3 + 2, 6);
  });

  it("une annexe désactivée ne compte pas, même renseignée", () => {
    const r = computeHomeOffice(avecAnnexes(base, [{ surfaceM2: 10, coefficientPro: 1, enabled: false }]));
    expect(r.surfaceAnnexeRetenue).toBe(0);
  });

  it("un coefficient nul revient à ne pas compter l'annexe", () => {
    const r = computeHomeOffice(avecAnnexes(base, [{ surfaceM2: 10, coefficientPro: 0 }]));
    expect(r.surfaceAnnexeRetenue).toBe(0);
  });

  it("surfaces et coefficients hors bornes sont neutralisés", () => {
    const r = computeHomeOffice(
      avecAnnexes(base, [
        { surfaceM2: -10, coefficientPro: 0.5 },
        { surfaceM2: 6, coefficientPro: 5 },
        { surfaceM2: 4, coefficientPro: -3 },
      ]),
    );
    // La 1re est neutralisée, la 2e plafonnée à 100 %, la 3e ramenée à 0 %.
    expect(r.surfaceAnnexeRetenue).toBeCloseTo(6, 6);
  });

  it("les annexes augmentent l'indemnité proportionnellement à la quote-part gagnée", () => {
    const sans = computeHomeOffice(base);
    const avec = computeHomeOffice(avecAnnexes(base, [{ surfaceM2: 8, coefficientPro: 0.5 }]));
    expect(avec.quotePartSurface).toBeCloseTo(16 / 80, 6);
    expect(avec.indemniteAnnuelleBrute).toBeCloseTo(sans.indemniteAnnuelleBrute * (16 / 12), 6);
  });

  it("les annexes peuvent faire franchir le seuil de justification renforcée", () => {
    const sans = computeHomeOffice({ ...base, surfaceBureauM2: 22 });
    expect(sans.depasseToleranceSurface).toBe(false);
    const avec = computeHomeOffice(avecAnnexes({ ...base, surfaceBureauM2: 22 }, [{ surfaceM2: 8, coefficientPro: 0.5 }]));
    expect(avec.depasseToleranceSurface).toBe(true);
  });

  it("la quote-part reste bornée à 100 % même avec des annexes démesurées", () => {
    const r = computeHomeOffice(avecAnnexes(base, [{ surfaceM2: 500, coefficientPro: 1 }]));
    expect(r.quotePartSurface).toBe(1);
  });

  it("le loyer imputé au bureau suit la surface professionnelle TOTALE, annexes comprises", () => {
    const r = computeHomeOffice(avecAnnexes(base, [{ surfaceM2: 8, coefficientPro: 0.5 }]));
    expect(r.loyerAnnuelBureauRetenu).toBeCloseTo(r.loyerAnnuelLogementRetenu * (16 / 80), 6);
  });
});

describe("computeHomeOffice — loyer calculé depuis le prix au m² de la ville", () => {
  const base: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 12,
    loyerMarcheM2Mensuel: 16,
    loyerAutoDepuisPrixM2: true,
  };

  it("la ligne « loyer » porte la valeur locative du logement entier : prix au m² × surface totale × 12", () => {
    const r = computeHomeOffice(base);
    expect(r.loyerAnnuelLogementRetenu).toBeCloseTo(16 * 80 * 12, 6);
    expect(r.chargeLinesEffectives.find((c) => c.id === "loyer")?.montantAnnuel).toBeCloseTo(16 * 80 * 12, 6);
  });

  it("après quote-part, la part imputée au bureau vaut prix au m² × surface du BUREAU × 12", () => {
    const r = computeHomeOffice(base);
    expect(r.loyerAnnuelBureauRetenu).toBeCloseTo(16 * 12 * 12, 6);
  });

  it("la proratisation n'est pas appliquée deux fois au loyer", () => {
    const r = computeHomeOffice(base);
    // Le piège serait d'appliquer le prix au m² à la surface du bureau PUIS la quote-part :
    // on obtiendrait 16 × 12 × 12 × (12/80), soit huit fois moins.
    expect(r.loyerAnnuelBureauRetenu).not.toBeCloseTo(16 * 12 * 12 * (12 / 80), 6);
    expect(r.loyerAnnuelBureauRetenu / r.loyerAnnuelLogementRetenu).toBeCloseTo(r.quotePartSurface, 6);
  });

  it("le loyer imputé au bureau ne dépend pas de la surface totale du logement", () => {
    const petit = computeHomeOffice({ ...base, surfaceTotaleM2: 50 });
    const grand = computeHomeOffice({ ...base, surfaceTotaleM2: 150 });
    expect(petit.loyerAnnuelBureauRetenu).toBeCloseTo(grand.loyerAnnuelBureauRetenu, 6);
  });

  it("le loyer imputé au bureau est proportionnel à la surface du bureau", () => {
    const r1 = computeHomeOffice({ ...base, surfaceBureauM2: 10 });
    const r2 = computeHomeOffice({ ...base, surfaceBureauM2: 20 });
    expect(r2.loyerAnnuelBureauRetenu).toBeCloseTo(2 * r1.loyerAnnuelBureauRetenu, 6);
  });

  it("un prix au m² plus élevé augmente l'indemnité brute", () => {
    const parisien = computeHomeOffice({ ...base, loyerMarcheM2Mensuel: 32 });
    const lyonnais = computeHomeOffice({ ...base, loyerMarcheM2Mensuel: 16 });
    expect(parisien.indemniteAnnuelleBrute).toBeGreaterThan(lyonnais.indemniteAnnuelleBrute);
    expect(parisien.indemniteAnnuelleBrute - lyonnais.indemniteAnnuelleBrute).toBeCloseTo(16 * 12 * 12, 6);
  });

  it("en mode manuel, le montant saisi sur la ligne « loyer » est repris tel quel", () => {
    const manuel: HomeOfficeInputs = {
      ...base,
      loyerAutoDepuisPrixM2: false,
      chargeLines: base.chargeLines.map((c) => (c.id === "loyer" ? { ...c, montantAnnuel: 9000 } : c)),
    };
    const r = computeHomeOffice(manuel);
    expect(r.loyerAnnuelLogementRetenu).toBe(9000);
    expect(r.loyerAnnuelBureauRetenu).toBeCloseTo(9000 * r.quotePartSurface, 6);
  });

  it("en mode automatique, le montant saisi est ignoré mais conservé dans les entrées", () => {
    const inputs: HomeOfficeInputs = {
      ...base,
      chargeLines: base.chargeLines.map((c) => (c.id === "loyer" ? { ...c, montantAnnuel: 999999 } : c)),
    };
    const r = computeHomeOffice(inputs);
    expect(r.loyerAnnuelLogementRetenu).toBeCloseTo(16 * 80 * 12, 6);
    expect(inputs.chargeLines.find((c) => c.id === "loyer")?.montantAnnuel).toBe(999999);
  });

  it("désactiver la ligne « loyer » la sort de l'indemnité sans effacer sa valeur de marché", () => {
    const sansLoyer = computeHomeOffice({
      ...base,
      chargeLines: base.chargeLines.map((c) => (c.id === "loyer" ? { ...c, enabled: false } : c)),
    });
    const avecLoyer = computeHomeOffice(base);
    expect(sansLoyer.loyerAnnuelLogementRetenu).toBeCloseTo(avecLoyer.loyerAnnuelLogementRetenu, 6);
    expect(avecLoyer.indemniteAnnuelleBrute - sansLoyer.indemniteAnnuelleBrute).toBeCloseTo(
      avecLoyer.loyerAnnuelBureauRetenu,
      6,
    );
  });

  it("un prix au m² négatif ne produit pas de loyer négatif", () => {
    const r = computeHomeOffice({ ...base, loyerMarcheM2Mensuel: -20 });
    expect(r.loyerAnnuelLogementRetenu).toBe(0);
    expect(r.indemniteAnnuelleBrute).toBeGreaterThanOrEqual(0);
  });
});

describe("createDefaultHomeOfficeInputs — placeholders alignés sur les références", () => {
  it("le prix au m² par défaut correspond à la ville par défaut", () => {
    const inputs = createDefaultHomeOfficeInputs();
    expect(inputs.loyerMarcheM2Mensuel).toBe(prixM2Ville(inputs.ville));
  });

  it("la ville par défaut est Paris et pointe vers une entrée réelle de la table", () => {
    const inputs = createDefaultHomeOfficeInputs();
    expect(inputs.ville).toBe("paris");
    expect(findLoyerVille(inputs.ville)).toBeDefined();
  });

  it("chaque poste de charge est pré-rempli à sa valeur de référence", () => {
    const inputs = createDefaultHomeOfficeInputs();
    for (const ligne of inputs.chargeLines) {
      const reference = montantReferenceCharge(ligne.id, inputs.surfaceTotaleM2, inputs.statutOccupant, inputs.typeLogement);
      if (reference === undefined) continue; // le loyer, calculé depuis le prix au m²
      expect(ligne.montantAnnuel).toBe(reference);
    }
  });
});

describe("chargeLinesDeReference", () => {
  it("réaligne les montants sur les références sans toucher aux cases cochées", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const modifiees = inputs.chargeLines.map((c) => ({ ...c, montantAnnuel: 1, enabled: c.id === "eau" }));
    const realignees = chargeLinesDeReference(inputs.surfaceTotaleM2, inputs.statutOccupant, inputs.typeLogement, modifiees);
    for (const ligne of realignees) {
      expect(ligne.enabled).toBe(ligne.id === "eau");
      const reference = montantReferenceCharge(ligne.id, inputs.surfaceTotaleM2, inputs.statutOccupant, inputs.typeLogement);
      expect(ligne.montantAnnuel).toBe(reference ?? 1);
    }
  });

  it("passer de propriétaire à locataire annule la taxe foncière", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const locataire = chargeLinesDeReference(inputs.surfaceTotaleM2, "locataire", inputs.typeLogement, inputs.chargeLines);
    expect(locataire.find((c) => c.id === "taxeFonciere")?.montantAnnuel).toBe(0);
  });

  it("une surface plus grande augmente les postes proportionnels à la surface", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const petit = chargeLinesDeReference(40, "proprietaire", "appartement", inputs.chargeLines);
    const grand = chargeLinesDeReference(120, "proprietaire", "appartement", inputs.chargeLines);
    const chauffagePetit = petit.find((c) => c.id === "chauffage")?.montantAnnuel ?? 0;
    const chauffageGrand = grand.find((c) => c.id === "chauffage")?.montantAnnuel ?? 0;
    expect(chauffageGrand).toBeCloseTo(3 * chauffagePetit, 0);
    // ...mais laisse inchangés les postes forfaitaires.
    expect(petit.find((c) => c.id === "eau")?.montantAnnuel).toBe(grand.find((c) => c.id === "eau")?.montantAnnuel);
  });
});

describe("computeHomeOffice — seuil de tolérance de surface paramétrable", () => {
  const base: HomeOfficeInputs = { ...createDefaultHomeOfficeInputs(), surfaceTotaleM2: 80, surfaceBureauM2: 32 };

  it("le seuil par défaut est de 30 %", () => {
    expect(createDefaultHomeOfficeInputs().toleranceSurfaceBureau).toBe(TOLERANCE_SURFACE_BUREAU_DEFAUT);
    expect(TOLERANCE_SURFACE_BUREAU_DEFAUT).toBe(0.3);
  });

  it("la surface correspondant au seuil vaut surface totale × seuil", () => {
    expect(computeHomeOffice({ ...base, toleranceSurfaceBureau: 0.3 }).surfaceBureauTolerance).toBeCloseTo(24, 6);
    expect(computeHomeOffice({ ...base, toleranceSurfaceBureau: 0.5 }).surfaceBureauTolerance).toBeCloseTo(40, 6);
  });

  it("un bureau de 40 % dépasse un seuil à 30 % mais pas un seuil relevé à 50 %", () => {
    expect(computeHomeOffice({ ...base, toleranceSurfaceBureau: 0.3 }).depasseToleranceSurface).toBe(true);
    expect(computeHomeOffice({ ...base, toleranceSurfaceBureau: 0.5 }).depasseToleranceSurface).toBe(false);
  });

  it("atteindre exactement le seuil ne le dépasse pas", () => {
    const r = computeHomeOffice({ ...base, surfaceBureauM2: 24, toleranceSurfaceBureau: 0.3 });
    expect(r.quotePartSurface).toBeCloseTo(0.3, 6);
    expect(r.depasseToleranceSurface).toBe(false);
  });

  it("le seuil est purement indicatif : il ne change AUCUN montant calculé", () => {
    // C'est le point important : relever le curseur déplace l'alerte, jamais l'indemnité.
    const strict = computeHomeOffice({ ...base, toleranceSurfaceBureau: 0.1 });
    const laxiste = computeHomeOffice({ ...base, toleranceSurfaceBureau: 0.9 });
    expect(strict.indemniteAnnuelleBrute).toBeCloseTo(laxiste.indemniteAnnuelleBrute, 6);
    expect(strict.gainNetGerant).toBeCloseTo(laxiste.gainNetGerant, 6);
    expect(strict.coutNetSociete).toBeCloseTo(laxiste.coutNetSociete, 6);
  });

  it("porter le bureau au seuil augmente l'indemnité proportionnellement à la surface gagnée", () => {
    const petit = computeHomeOffice({ ...base, surfaceBureauM2: 12, toleranceSurfaceBureau: 0.3 });
    const auSeuil = computeHomeOffice({ ...base, surfaceBureauM2: 24, toleranceSurfaceBureau: 0.3 });
    expect(auSeuil.indemniteAnnuelleBrute).toBeCloseTo(2 * petit.indemniteAnnuelleBrute, 6);
    expect(auSeuil.depasseToleranceSurface).toBe(false);
  });

  it("un seuil hors bornes est ramené dans [0, 1] plutôt que de produire une surface absurde", () => {
    expect(computeHomeOffice({ ...base, toleranceSurfaceBureau: -0.5 }).surfaceBureauTolerance).toBe(0);
    expect(computeHomeOffice({ ...base, toleranceSurfaceBureau: 3 }).surfaceBureauTolerance).toBeCloseTo(80, 6);
  });

  it("un seuil nul signale tout bureau non nul comme dépassant", () => {
    expect(computeHomeOffice({ ...base, toleranceSurfaceBureau: 0 }).depasseToleranceSurface).toBe(true);
    expect(
      computeHomeOffice({ ...base, surfaceBureauM2: 0, toleranceSurfaceBureau: 0 }).depasseToleranceSurface,
    ).toBe(false);
  });
});

describe("persistance — partition exhaustive des champs", () => {
  it("TOUT champ de saisie est persisté, sauf ceux explicitement exclus", () => {
    // Garde-fou : un champ ajouté à HomeOfficeInputs sans décision explicite serait silencieusement
    // perdu d'une visite à l'autre. Ici, il apparaît forcément dans l'une des deux listes.
    const tous = Object.keys(createDefaultHomeOfficeInputs());
    const persistes = new Set(Object.keys(extractHomeOfficeDraft(createDefaultHomeOfficeInputs())));
    const exclus = new Set<string>(CHAMPS_NON_PERSISTES);
    for (const champ of tous) {
      expect(persistes.has(champ) !== exclus.has(champ), `${champ} doit être exactement dans une liste`).toBe(true);
    }
    expect(persistes.size + exclus.size).toBe(tous.length);
  });

  it("les seuls champs exclus sont l'identité du brouillon et le profil fiscal transversal", () => {
    expect([...CHAMPS_NON_PERSISTES].sort()).toEqual(["createdAt", "id", "personalTaxProfile"]);
  });

  it("les hypothèses de simulation sont bien mémorisées, elles aussi", () => {
    const persistes = Object.keys(extractHomeOfficeDraft(createDefaultHomeOfficeInputs()));
    for (const champ of [
      "regimeFoncier",
      "autresRevenusFonciersFoyer",
      "formalisation",
      "fraisMiseEnPlaceBail",
      "impositionSociete",
      "corporateTaxRate",
      "beneficeAvantChargePrevisionnel",
      "eligibleTauxReduitPME",
      "typeComparaisonExterne",
      "loyerBureauExterneMensuel",
      "coworkingTarifJournalier",
      "coworkingJoursParMois",
      "name",
      "country",
    ]) {
      expect(persistes, champ).toContain(champ);
    }
  });

  it("un aller-retour restitue à l'identique une saisie modifiée de bout en bout", () => {
    const modifie: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      name: "Mon bureau",
      regimeFoncier: "reel",
      autresRevenusFonciersFoyer: 4200,
      formalisation: "bail_professionnel",
      fraisMiseEnPlaceBail: 650,
      impositionSociete: "IR",
      corporateTaxRate: 0.15,
      beneficeAvantChargePrevisionnel: 88000,
      eligibleTauxReduitPME: false,
      typeComparaisonExterne: "coworking",
      loyerBureauExterneMensuel: 420,
      coworkingTarifJournalier: 31,
      coworkingJoursParMois: 14,
    };
    const restaure = applyHomeOfficeDraft(createDefaultHomeOfficeInputs(), extractHomeOfficeDraft(modifie));
    for (const champ of Object.keys(extractHomeOfficeDraft(modifie)) as (keyof HomeOfficeInputs)[]) {
      expect(restaure[champ], champ).toEqual(modifie[champ]);
    }
  });

  it("l'identité du brouillon et le profil fiscal ne sont jamais écrasés par le stockage", () => {
    const defauts = createDefaultHomeOfficeInputs();
    const restaure = applyHomeOfficeDraft(defauts, {
      id: "id-volé",
      createdAt: "1970-01-01",
      personalTaxProfile: { mode: "manuel", tauxManuel: 0.99 },
    });
    expect(restaure.id).toBe(defauts.id);
    expect(restaure.createdAt).toBe(defauts.createdAt);
    expect(restaure.personalTaxProfile).toEqual(defauts.personalTaxProfile);
  });

  it("un champ à choix fermé refuse une valeur inconnue", () => {
    const defauts = createDefaultHomeOfficeInputs();
    const restaure = applyHomeOfficeDraft(defauts, {
      regimeFoncier: "forfaitaire",
      formalisation: "poignée de main",
      impositionSociete: "TVA",
      typeComparaisonExterne: "télépathie",
    });
    expect(restaure.regimeFoncier).toBe(defauts.regimeFoncier);
    expect(restaure.formalisation).toBe(defauts.formalisation);
    expect(restaure.impositionSociete).toBe(defauts.impositionSociete);
    expect(restaure.typeComparaisonExterne).toBe(defauts.typeComparaisonExterne);
  });

  it("un taux hors [0, 1] retombe sur son défaut plutôt que d'être écrêté", () => {
    const defauts = createDefaultHomeOfficeInputs();
    const restaure = applyHomeOfficeDraft(defauts, { corporateTaxRate: 7, toleranceSurfaceBureau: 12 });
    expect(restaure.corporateTaxRate).toBe(defauts.corporateTaxRate);
    expect(restaure.toleranceSurfaceBureau).toBe(defauts.toleranceSurfaceBureau);
  });
});

describe("extractHomeOfficeDraft / applyHomeOfficeDraft", () => {
  it("un aller-retour complet restitue exactement les champs du logement", () => {
    const modifie: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      statutOccupant: "locataire",
      typeLogement: "maison",
      surfaceTotaleM2: 123,
      surfaceBureauM2: 27,
      toleranceSurfaceBureau: 0.42,
      ville: "nantes",
      loyerMarcheM2Mensuel: 12.5,
      loyerAutoDepuisPrixM2: false,
      interetsEmpruntAnnuels: 4200,
      chargeLines: createDefaultHomeOfficeInputs().chargeLines.map((c) => ({
        ...c,
        montantAnnuel: 777,
        enabled: false,
      })),
    };
    const restaure = applyHomeOfficeDraft(createDefaultHomeOfficeInputs(), extractHomeOfficeDraft(modifie));
    for (const champ of Object.keys(extractHomeOfficeDraft(modifie)) as (keyof HomeOfficeInputs)[]) {
      expect(restaure[champ], champ).toEqual(modifie[champ]);
    }
  });

  it("ne touche PAS aux champs qui sont des hypothèses de simulation", () => {
    const defauts = createDefaultHomeOfficeInputs();
    const restaure = applyHomeOfficeDraft(defauts, extractHomeOfficeDraft({ ...defauts, surfaceTotaleM2: 200 }));
    expect(restaure.regimeFoncier).toBe(defauts.regimeFoncier);
    expect(restaure.beneficeAvantChargePrevisionnel).toBe(defauts.beneficeAvantChargePrevisionnel);
    expect(restaure.formalisation).toBe(defauts.formalisation);
    expect(restaure.typeComparaisonExterne).toBe(defauts.typeComparaisonExterne);
    expect(restaure.personalTaxProfile).toEqual(defauts.personalTaxProfile);
    expect(restaure.id).toBe(defauts.id);
  });

  it("un profil absent ou non exploitable laisse les valeurs par défaut intactes", () => {
    const defauts = createDefaultHomeOfficeInputs();
    for (const valeur of [null, undefined, 42, "texte", []]) {
      const restaure = applyHomeOfficeDraft(defauts, valeur);
      expect(restaure.surfaceTotaleM2, String(valeur)).toBe(defauts.surfaceTotaleM2);
      expect(restaure.ville, String(valeur)).toBe(defauts.ville);
    }
  });

  it("un champ invalide retombe sur sa valeur par défaut sans emporter les autres", () => {
    const defauts = createDefaultHomeOfficeInputs();
    const restaure = applyHomeOfficeDraft(defauts, {
      surfaceTotaleM2: "quatre-vingts",
      surfaceBureauM2: -12,
      loyerMarcheM2Mensuel: Number.NaN,
      toleranceSurfaceBureau: 4,
      statutOccupant: "squatteur",
      typeLogement: "péniche",
      ville: "",
      loyerAutoDepuisPrixM2: "oui",
      interetsEmpruntAnnuels: Number.POSITIVE_INFINITY,
      // ...mais celui-ci est valide et doit bien être repris.
      chargeLines: [{ id: "eau", montantAnnuel: 999, enabled: false }],
    });
    expect(restaure.surfaceTotaleM2).toBe(defauts.surfaceTotaleM2);
    expect(restaure.surfaceBureauM2).toBe(defauts.surfaceBureauM2);
    expect(restaure.loyerMarcheM2Mensuel).toBe(defauts.loyerMarcheM2Mensuel);
    expect(restaure.toleranceSurfaceBureau).toBe(defauts.toleranceSurfaceBureau);
    expect(restaure.statutOccupant).toBe(defauts.statutOccupant);
    expect(restaure.typeLogement).toBe(defauts.typeLogement);
    expect(restaure.ville).toBe(defauts.ville);
    expect(restaure.loyerAutoDepuisPrixM2).toBe(defauts.loyerAutoDepuisPrixM2);
    expect(restaure.interetsEmpruntAnnuels).toBe(defauts.interetsEmpruntAnnuels);
    expect(restaure.chargeLines.find((c) => c.id === "eau")).toMatchObject({ montantAnnuel: 999, enabled: false });
  });

  it("un poste ajouté depuis la dernière visite apparaît à sa valeur de référence", () => {
    const defauts = createDefaultHomeOfficeInputs();
    // Profil enregistré par une version qui ne connaissait que deux postes.
    const restaure = applyHomeOfficeDraft(defauts, {
      chargeLines: [
        { id: "eau", montantAnnuel: 111, enabled: true },
        { id: "electricite", montantAnnuel: 222, enabled: true },
      ],
    });
    expect(restaure.chargeLines).toHaveLength(defauts.chargeLines.length);
    expect(restaure.chargeLines.find((c) => c.id === "eau")?.montantAnnuel).toBe(111);
    expect(restaure.chargeLines.find((c) => c.id === "chauffage")?.montantAnnuel).toBe(
      defauts.chargeLines.find((c) => c.id === "chauffage")?.montantAnnuel,
    );
  });

  it("un poste disparu du code n'est pas réintroduit par le stockage", () => {
    const defauts = createDefaultHomeOfficeInputs();
    const restaure = applyHomeOfficeDraft(defauts, {
      chargeLines: [{ id: "poste-supprime-en-2024", montantAnnuel: 5000, enabled: true }],
    });
    expect(restaure.chargeLines.some((c) => c.id === "poste-supprime-en-2024")).toBe(false);
    expect(restaure.chargeLines.map((c) => c.id)).toEqual(defauts.chargeLines.map((c) => c.id));
  });

  it("l'ordre et les libellés viennent du code, jamais du stockage", () => {
    const defauts = createDefaultHomeOfficeInputs();
    const restaure = applyHomeOfficeDraft(defauts, {
      chargeLines: [...defauts.chargeLines].reverse().map((c) => ({ ...c, label: "libellé périmé" })),
    });
    expect(restaure.chargeLines.map((c) => c.id)).toEqual(defauts.chargeLines.map((c) => c.id));
    expect(restaure.chargeLines.every((c) => c.label !== "libellé périmé")).toBe(true);
  });

  it("le profil restauré produit exactement le même calcul que la saisie d'origine", () => {
    const saisie: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeLogement: "maison",
      surfaceTotaleM2: 140,
      surfaceBureauM2: 25,
      ville: "bordeaux",
      loyerMarcheM2Mensuel: 14.5,
    };
    const restaure = applyHomeOfficeDraft(createDefaultHomeOfficeInputs(), extractHomeOfficeDraft(saisie));
    expect(computeHomeOffice(restaure).indemniteAnnuelleBrute).toBeCloseTo(
      computeHomeOffice(saisie).indemniteAnnuelleBrute,
      6,
    );
  });

  it("survit à un aller-retour par JSON, comme dans le stockage réel", () => {
    const saisie: HomeOfficeInputs = { ...createDefaultHomeOfficeInputs(), surfaceTotaleM2: 95, ville: "lille" };
    const viaJson = JSON.parse(JSON.stringify(extractHomeOfficeDraft(saisie)));
    const restaure = applyHomeOfficeDraft(createDefaultHomeOfficeInputs(), viaJson);
    expect(restaure.surfaceTotaleM2).toBe(95);
    expect(restaure.ville).toBe("lille");
  });
});

describe("computeHomeOffice — régime micro-foncier / réel", () => {
  it("bascule automatiquement en régime réel si le plafond micro-foncier (15 000€) est dépassé", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      regimeFoncier: "micro",
      autresRevenusFonciersFoyer: 20000, // dépasse déjà le plafond à lui seul
    };
    const r = computeHomeOffice(inputs);
    expect(r.eligibleMicroFoncier).toBe(false);
  });

  it("le régime micro-foncier applique un abattement de 30% sur l'indemnité brute", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      regimeFoncier: "micro",
      autresRevenusFonciersFoyer: 0,
    };
    const r = computeHomeOffice(inputs);
    expect(r.abattementApplique).toBeCloseTo(r.indemniteAnnuelleBrute * 0.3, 6);
    expect(r.baseImposableFonciere).toBeCloseTo(r.indemniteAnnuelleBrute * 0.7, 6);
  });
});

describe("computeHomeOffice — intérêts d'emprunt (art. 31, I-1°-d CGI)", () => {
  const avecEmprunt: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 20, // quote-part de 25 %, calcul lisible
    empruntEnCours: true,
    interetsEmpruntAnnuels: 6000,
  };

  it("au régime réel, seule la quote-part professionnelle des intérêts est déduite", () => {
    const r = computeHomeOffice({ ...avecEmprunt, regimeFoncier: "reel" });
    expect(r.interetsEmpruntDeduits).toBeCloseTo(6000 * 0.25, 6);
  });

  it("au micro-foncier, l'abattement forfaitaire remplace toute déduction d'intérêts", () => {
    const r = computeHomeOffice({ ...avecEmprunt, regimeFoncier: "micro", autresRevenusFonciersFoyer: 0 });
    expect(r.eligibleMicroFoncier).toBe(true);
    expect(r.interetsEmpruntDeduits).toBe(0);
  });

  it("les intérêts n'entrent JAMAIS dans la base de l'indemnité — le loyer rémunère déjà le bien", () => {
    const sans = computeHomeOffice({ ...avecEmprunt, interetsEmpruntAnnuels: 0, regimeFoncier: "reel" });
    const avec = computeHomeOffice({ ...avecEmprunt, regimeFoncier: "reel" });
    expect(avec.indemniteAnnuelleBrute).toBeCloseTo(sans.indemniteAnnuelleBrute, 6);
    expect(avec.totalChargesRetenuesAnnuel).toBeCloseTo(sans.totalChargesRetenuesAnnuel, 6);
    expect(avec.coutNetSociete).toBeCloseTo(sans.coutNetSociete, 6);
  });

  it("des intérêts déduits réduisent la base imposable et donc l'impôt du dirigeant", () => {
    const sans = computeHomeOffice({ ...avecEmprunt, interetsEmpruntAnnuels: 0, regimeFoncier: "reel" });
    const avec = computeHomeOffice({ ...avecEmprunt, regimeFoncier: "reel" });
    expect(avec.baseImposableFonciere).toBeLessThan(sans.baseImposableFonciere);
    expect(avec.coutFiscalGerant).toBeLessThan(sans.coutFiscalGerant);
    expect(avec.gainNetGerant).toBeGreaterThan(sans.gainNetGerant);
  });

  it("la base imposable ne devient jamais négative, même avec des intérêts colossaux", () => {
    const r = computeHomeOffice({ ...avecEmprunt, regimeFoncier: "reel", interetsEmpruntAnnuels: 500000 });
    expect(r.baseImposableFonciere).toBe(0);
    expect(r.irDu).toBe(0);
    expect(r.prelevementsSociaux).toBe(0);
  });

  it("des intérêts négatifs sont neutralisés plutôt que d'augmenter la base imposable", () => {
    const r = computeHomeOffice({ ...avecEmprunt, regimeFoncier: "reel", interetsEmpruntAnnuels: -5000 });
    expect(r.interetsEmpruntDeduits).toBe(0);
  });

  it("l'égalité coutNetGlobal = coût fiscal dirigeant − économie société tient avec des intérêts déduits", () => {
    const r = computeHomeOffice({ ...avecEmprunt, regimeFoncier: "reel" });
    expect(r.coutNetGlobal).toBeCloseTo(r.coutFiscalGerant - r.economieImpotSociete, 6);
    expect(r.coutNetGlobal).toBeCloseTo(r.coutNetSociete - r.gainNetGerant, 6);
  });
});

describe("computeHomeOffice — immeuble collectif vs maison individuelle", () => {
  it("les charges de copropriété disparaissent en maison après réalignement sur les références", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const maison: HomeOfficeInputs = {
      ...inputs,
      typeLogement: "maison",
      chargeLines: chargeLinesDeReference(inputs.surfaceTotaleM2, inputs.statutOccupant, "maison", inputs.chargeLines),
    };
    const r = computeHomeOffice(maison);
    expect(r.chargeLinesEffectives.find((c) => c.id === "entretienCopropriete")?.montantAnnuel).toBe(0);
    expect(r.chargeLinesEffectives.find((c) => c.id === "travauxEntretien")?.montantAnnuel).toBeGreaterThan(0);
  });

  it("le type de logement seul, sans réalignement, ne modifie aucun montant saisi", () => {
    // Il ne pilote que les VALEURS DE RÉFÉRENCE : basculer le bouton ne doit pas écraser en
    // silence des factures déjà renseignées.
    const inputs = createDefaultHomeOfficeInputs();
    const enMaison = computeHomeOffice({ ...inputs, typeLogement: "maison" });
    const enImmeuble = computeHomeOffice({ ...inputs, typeLogement: "appartement" });
    expect(enMaison.indemniteAnnuelleBrute).toBeCloseTo(enImmeuble.indemniteAnnuelleBrute, 6);
  });
});

describe("computeHomeOffice — postes de charge ajoutés", () => {
  it("la TEOM est désactivée par défaut, pour ne pas doubler la taxe foncière", () => {
    const inputs = createDefaultHomeOfficeInputs();
    expect(inputs.chargeLines.find((c) => c.id === "taxeOrduresMenageres")?.enabled).toBe(false);
  });

  it("activer la TEOM augmente l'indemnité de sa seule quote-part", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const teom = inputs.chargeLines.find((c) => c.id === "taxeOrduresMenageres")?.montantAnnuel ?? 0;
    expect(teom).toBeGreaterThan(0);
    const avec = computeHomeOffice({
      ...inputs,
      chargeLines: inputs.chargeLines.map((c) => (c.id === "taxeOrduresMenageres" ? { ...c, enabled: true } : c)),
    });
    const sans = computeHomeOffice(inputs);
    expect(avec.indemniteAnnuelleBrute - sans.indemniteAnnuelleBrute).toBeCloseTo(teom * sans.quotePartSurface, 6);
  });

  it("le ménage est pré-rempli à 0 : il n'ajoute rien tant qu'il n'est pas renseigné", () => {
    const inputs = createDefaultHomeOfficeInputs();
    expect(inputs.chargeLines.find((c) => c.id === "menageNettoyage")?.montantAnnuel).toBe(0);
  });

  it("internet et téléphone sont activés par défaut", () => {
    const inputs = createDefaultHomeOfficeInputs();
    expect(inputs.chargeLines.find((c) => c.id === "internetTelephone")?.enabled).toBe(true);
  });

  it("chaque poste activé contribue à l'indemnité à hauteur de sa quote-part, sans exception", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const reference = computeHomeOffice(inputs);
    for (const ligne of inputs.chargeLines) {
      if (!ligne.enabled) continue;
      const sansCePoste = computeHomeOffice(disableCharge(inputs, ligne.id));
      const attendu =
        ligne.id === "loyer" ? reference.loyerAnnuelBureauRetenu : ligne.montantAnnuel * reference.quotePartSurface;
      expect(reference.indemniteAnnuelleBrute - sansCePoste.indemniteAnnuelleBrute, ligne.id).toBeCloseTo(attendu, 6);
    }
  });
});

describe("computeHomeOffice — comparaison micro-foncier / réel", () => {
  const base: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 20,
    autresRevenusFonciersFoyer: 0,
  };

  it("les deux régimes sont chiffrés quel que soit celui qui est sélectionné", () => {
    const enMicro = computeHomeOffice({ ...base, regimeFoncier: "micro" });
    const enReel = computeHomeOffice({ ...base, regimeFoncier: "reel" });
    expect(enMicro.coutFiscalMicro).toBeCloseTo(enReel.coutFiscalMicro, 6);
    expect(enMicro.coutFiscalReel).toBeCloseTo(enReel.coutFiscalReel, 6);
    expect(enMicro.regimeOptimal).toBe(enReel.regimeOptimal);
  });

  it("le régime sélectionné détermine seul la base réellement imposée", () => {
    const enMicro = computeHomeOffice({ ...base, regimeFoncier: "micro" });
    const enReel = computeHomeOffice({ ...base, regimeFoncier: "reel" });
    expect(enMicro.baseImposableFonciere).toBeCloseTo(enMicro.baseMicro, 6);
    expect(enReel.baseImposableFonciere).toBeCloseTo(enReel.baseReel, 6);
  });

  it("le point de bascule est l'abattement forfaitaire de 30 %", () => {
    const r = computeHomeOffice(base);
    expect(r.seuilBasculeReel).toBeCloseTo(r.indemniteAnnuelleBrute * 0.3, 6);
  });

  it("le régime optimal est celui dont les charges dépassent — ou non — l'abattement", () => {
    const r = computeHomeOffice(base);
    expect(r.regimeOptimal).toBe(r.chargesDeductiblesReel > r.seuilBasculeReel ? "reel" : "micro");
  });

  it("un emprunt important fait basculer l'optimum vers le réel", () => {
    const sansEmprunt = computeHomeOffice({ ...base, empruntEnCours: true, interetsEmpruntAnnuels: 0 });
    const avecEmprunt = computeHomeOffice({ ...base, empruntEnCours: true, interetsEmpruntAnnuels: 40000 });
    expect(sansEmprunt.regimeOptimal).toBe("micro");
    expect(avecEmprunt.regimeOptimal).toBe("reel");
    expect(avecEmprunt.chargesDeductiblesReel).toBeGreaterThan(sansEmprunt.chargesDeductiblesReel);
  });

  it("l'écart annoncé est bien la différence entre les deux coûts fiscaux", () => {
    const r = computeHomeOffice({ ...base, empruntEnCours: true, interetsEmpruntAnnuels: 40000 });
    expect(r.gainRegimeOptimal).toBeCloseTo(Math.abs(r.coutFiscalMicro - r.coutFiscalReel), 6);
  });

  it("au-delà du plafond micro, le réel s'applique d'office et devient l'optimum par défaut", () => {
    const r = computeHomeOffice({ ...base, regimeFoncier: "micro", autresRevenusFonciersFoyer: 30000 });
    expect(r.eligibleMicroFoncier).toBe(false);
    expect(r.regimeEffectif).toBe("reel");
    expect(r.regimeOptimal).toBe("reel");
    expect(r.baseImposableFonciere).toBeCloseTo(r.baseReel, 6);
  });

  it("le régime effectif reflète la bascule d'office, pas la sélection de l'utilisateur", () => {
    expect(computeHomeOffice({ ...base, regimeFoncier: "micro" }).regimeEffectif).toBe("micro");
    expect(computeHomeOffice({ ...base, regimeFoncier: "reel" }).regimeEffectif).toBe("reel");
  });
});

describe("computeHomeOffice — charges exclues de la déduction foncière (art. 31 CGI)", () => {
  const base: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    regimeFoncier: "reel",
    surfaceTotaleM2: 80,
    surfaceBureauM2: 20,
  };

  function withTeom(inputs: HomeOfficeInputs, montantAnnuel: number): HomeOfficeInputs {
    return {
      ...inputs,
      chargeLines: inputs.chargeLines.map((c) =>
        c.id === "taxeOrduresMenageres" ? { ...c, enabled: true, montantAnnuel } : c,
      ),
    };
  }

  it("la TEOM entre dans l'assiette de l'indemnité — c'est une charge réellement supportée", () => {
    const avec = computeHomeOffice(withTeom(base, 400));
    const sans = computeHomeOffice(base);
    expect(avec.indemniteAnnuelleBrute - sans.indemniteAnnuelleBrute).toBeCloseTo(400 * avec.quotePartSurface, 6);
  });

  it("...mais reste exclue des charges déductibles au régime réel", () => {
    const avec = computeHomeOffice(withTeom(base, 400));
    const sans = computeHomeOffice(base);
    expect(avec.chargesDeductiblesReel).toBeCloseTo(sans.chargesDeductiblesReel, 6);
  });

  it("activer la TEOM augmente donc la base imposable au réel du plein montant de sa quote-part", () => {
    const avec = computeHomeOffice(withTeom(base, 400));
    const sans = computeHomeOffice(base);
    expect(avec.baseReel - sans.baseReel).toBeCloseTo(400 * avec.quotePartSurface, 6);
  });

  it("les autres postes, eux, sont bien déduits", () => {
    const majore = {
      ...base,
      chargeLines: base.chargeLines.map((c) =>
        c.id === "eau" ? { ...c, montantAnnuel: c.montantAnnuel + 400 } : c,
      ),
    };
    const r = computeHomeOffice(majore);
    const sans = computeHomeOffice(base);
    expect(r.chargesDeductiblesReel - sans.chargesDeductiblesReel).toBeCloseTo(400 * r.quotePartSurface, 6);
    // La base imposable ne bouge pas : le poste entre dans l'assiette ET dans la déduction.
    expect(r.baseReel).toBeCloseTo(sans.baseReel, 6);
  });
});

describe("computeHomeOffice — assurance emprunteur", () => {
  const base: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 20, // quote-part de 25 %
    regimeFoncier: "reel",
    empruntEnCours: true,
  };

  it("est déduite au réel comme les intérêts, au prorata de la surface professionnelle", () => {
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 4000, assuranceEmpruntAnnuelle: 800 });
    expect(r.interetsEmpruntDeduits).toBeCloseTo((4000 + 800) * 0.25, 6);
  });

  it("n'est pas prise en compte au micro-foncier", () => {
    const r = computeHomeOffice({ ...base, regimeFoncier: "micro", assuranceEmpruntAnnuelle: 800 });
    expect(r.interetsEmpruntDeduits).toBe(0);
  });

  it("n'entre jamais dans l'assiette de l'indemnité", () => {
    const avec = computeHomeOffice({ ...base, assuranceEmpruntAnnuelle: 800 });
    const sans = computeHomeOffice({ ...base, assuranceEmpruntAnnuelle: 0 });
    expect(avec.indemniteAnnuelleBrute).toBeCloseTo(sans.indemniteAnnuelleBrute, 6);
    expect(avec.coutNetSociete).toBeCloseTo(sans.coutNetSociete, 6);
  });

  it("une valeur négative est neutralisée", () => {
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 4000, assuranceEmpruntAnnuelle: -5000 });
    expect(r.interetsEmpruntDeduits).toBeCloseTo(4000 * 0.25, 6);
  });
});

describe("computeHomeOffice — emprunt en cours", () => {
  const base: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 20,
    regimeFoncier: "reel",
    interetsEmpruntAnnuels: 8000,
    assuranceEmpruntAnnuelle: 800,
  };

  it("sans emprunt déclaré, les montants saisis sont ignorés", () => {
    const r = computeHomeOffice({ ...base, empruntEnCours: false });
    expect(r.interetsEmpruntDeduits).toBe(0);
  });

  it("déclarer l'emprunt active la déduction", () => {
    const r = computeHomeOffice({ ...base, empruntEnCours: true });
    expect(r.interetsEmpruntDeduits).toBeCloseTo((8000 + 800) * 0.25, 6);
  });

  it("un locataire ne déduit rien, même en cochant l'emprunt", () => {
    const r = computeHomeOffice({ ...base, empruntEnCours: true, statutOccupant: "locataire" });
    expect(r.interetsEmpruntDeduits).toBe(0);
  });

  it("l'emprunt ne change jamais l'indemnité ni le coût pour la société", () => {
    const avec = computeHomeOffice({ ...base, empruntEnCours: true });
    const sans = computeHomeOffice({ ...base, empruntEnCours: false });
    expect(avec.indemniteAnnuelleBrute).toBeCloseTo(sans.indemniteAnnuelleBrute, 6);
    expect(avec.coutNetSociete).toBeCloseTo(sans.coutNetSociete, 6);
  });
});

describe("computeHomeOffice — déficit foncier (art. 156, I-3° CGI)", () => {
  // Configuration volontairement déficitaire : loyer désactivé, donc une indemnité faible en regard
  // des charges et de l'emprunt.
  const base: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 40, // quote-part de 50 %
    regimeFoncier: "reel",
    empruntEnCours: true,
    autresRevenusFonciersFoyer: 0,
  };

  it("sans déficit, tous les indicateurs restent à zéro", () => {
    const r = computeHomeOffice({ ...base, empruntEnCours: false, interetsEmpruntAnnuels: 0 });
    expect(r.deficitFoncierTotal).toBe(0);
    expect(r.deficitImputableRevenuGlobal).toBe(0);
    expect(r.deficitReportableFoncier).toBe(0);
    expect(r.economieIRDeficitFoncier).toBe(0);
  });

  it("le déficit total est l'excédent des charges déductibles sur l'indemnité", () => {
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 60000 });
    expect(r.deficitFoncierTotal).toBeCloseTo(r.chargesDeductiblesReel - r.indemniteAnnuelleBrute, 6);
    expect(r.baseImposableFonciere).toBe(0);
  });

  it("un déficit dû AUX SEULS INTÉRÊTS n'est jamais imputable sur le revenu global", () => {
    // Intérêts colossaux : ils absorbent l'indemnité à eux seuls, et le reste des charges aussi.
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 1000000 });
    const chargesHorsEmprunt = r.chargesDeductiblesReel - r.interetsEmpruntDeduits;
    // Tout ce qui dépasse vient des intérêts : l'imputation immédiate est bornée aux autres charges.
    expect(r.deficitImputableRevenuGlobal).toBeLessThanOrEqual(chargesHorsEmprunt + 1e-6);
    expect(r.deficitReportableFoncier).toBeGreaterThan(0);
  });

  it("l'imputation immédiate est plafonnée à 10 700 €/an", () => {
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 500000 });
    expect(r.deficitImputableRevenuGlobal).toBeLessThanOrEqual(PLAFOND_DEFICIT_FONCIER_REVENU_GLOBAL);
  });

  it("imputable + reportable = déficit total, sans perte", () => {
    for (const interets of [0, 5000, 50000, 500000]) {
      const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: interets });
      expect(r.deficitImputableRevenuGlobal + r.deficitReportableFoncier, String(interets)).toBeCloseTo(
        r.deficitFoncierTotal,
        6,
      );
    }
  });

  it("l'économie d'IR porte sur la seule fraction imputable, au taux marginal", () => {
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 60000 });
    expect(r.economieIRDeficitFoncier).toBeCloseTo(r.deficitImputableRevenuGlobal * r.tauxIRUtilise, 6);
  });

  it("le déficit ne procure aucune économie au micro-foncier", () => {
    // Bureau réduit pour rester sous le plafond micro tout en gardant un emprunt déficitaire.
    const sousPlafond = { ...base, surfaceBureauM2: 25, interetsEmpruntAnnuels: 60000 };
    const enMicro = computeHomeOffice({ ...sousPlafond, regimeFoncier: "micro" });
    expect(enMicro.eligibleMicroFoncier).toBe(true);
    expect(enMicro.deficitFoncierTotal).toBeGreaterThan(0);
    expect(enMicro.economieIRDeficitFoncier).toBe(0);
    // ...alors que le même dossier au réel en profite.
    expect(computeHomeOffice({ ...sousPlafond, regimeFoncier: "reel" }).economieIRDeficitFoncier).toBeGreaterThan(0);
  });

  it("le déficit réduit le coût fiscal du dirigeant, qui peut devenir négatif (gain net)", () => {
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 60000 });
    expect(r.irDu).toBe(0);
    expect(r.prelevementsSociaux).toBe(0);
    expect(r.coutFiscalGerant).toBeCloseTo(-r.economieIRDeficitFoncier, 6);
    expect(r.gainNetGerant).toBeGreaterThan(r.indemniteAnnuelleBrute);
  });

  it("l'ordre d'imputation est bien intérêts d'abord : au-delà, ils n'alimentent que le report", () => {
    // Dès que les intérêts absorbent toute l'indemnité, l'imputation immédiate est figée sur les
    // autres charges : les intérêts supplémentaires ne font grossir QUE la part reportable.
    const gros = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 200000 });
    const enorme = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 500000 });
    expect(gros.deficitImputableRevenuGlobal).toBeGreaterThan(0);
    expect(enorme.deficitImputableRevenuGlobal).toBeCloseTo(gros.deficitImputableRevenuGlobal, 6);
    expect(enorme.deficitReportableFoncier).toBeGreaterThan(gros.deficitReportableFoncier);
  });

  it("des intérêts modérés, absorbés par l'indemnité, ne créent aucun déficit", () => {
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 20000 });
    expect(r.deficitFoncierTotal).toBe(0);
    expect(r.baseImposableFonciere).toBeGreaterThan(0);
  });

  it("les identités comptables tiennent malgré le déficit", () => {
    const r = computeHomeOffice({ ...base, interetsEmpruntAnnuels: 60000 });
    expect(r.gainNetGerant).toBeCloseTo(r.indemniteAnnuelleBrute - r.coutFiscalGerant, 6);
    expect(r.coutNetGlobal).toBeCloseTo(r.coutFiscalGerant - r.economieImpotSociete, 6);
    expect(r.coutNetGlobal).toBeCloseTo(r.coutNetSociete - r.gainNetGerant, 6);
  });
});

describe("computeHomeOffice — formalisation bail professionnel", () => {
  it("les frais de mise en place n'affectent que le gain net de la 1ère année, pas le gain récurrent", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      formalisation: "bail_professionnel",
      fraisMiseEnPlaceBail: 500,
    };
    const r = computeHomeOffice(inputs);
    expect(r.gainNetGerantAnnee1).toBeCloseTo(r.gainNetGerant - 500, 6);
  });

  it("les frais de mise en place sont ignorés si la formalisation est une simple indemnité", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      formalisation: "indemnite",
      fraisMiseEnPlaceBail: 500,
    };
    const r = computeHomeOffice(inputs);
    expect(r.gainNetGerantAnnee1).toBeCloseTo(r.gainNetGerant, 6);
  });
});

describe("computeHomeOffice — régime IS et bénéfice prévisionnel", () => {
  it("une société déficitaire (régime IS) ne génère aucune économie d'impôt immédiate", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IS",
      beneficeAvantChargePrevisionnel: 0,
    };
    const r = computeHomeOffice(inputs);
    expect(r.economieImpotSociete).toBe(0);
  });

  it("coût net société = indemnité brute − économie d'impôt", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetSociete).toBeCloseTo(r.indemniteAnnuelleBrute - r.economieImpotSociete, 6);
  });
});

describe("computeHomeOffice — coût net global (société + dirigeant ensemble)", () => {
  it("coutNetGlobal = coût fiscal dirigeant − économie d'impôt société", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetGlobal).toBeCloseTo(r.coutFiscalGerant - r.economieImpotSociete, 6);
  });

  it("coutNetGlobal = coutNetSociete − gainNetGerant (les deux formulations coïncident)", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetGlobal).toBeCloseTo(r.coutNetSociete - r.gainNetGerant, 6);
  });

  it("indemnité nulle : coût net global nul", () => {
    let inputs = createDefaultHomeOfficeInputs();
    for (const c of inputs.chargeLines) {
      inputs = disableCharge(inputs, c.id);
    }
    const r = computeHomeOffice(inputs);
    expect(r.coutNetGlobal).toBe(0);
  });
});

describe("computeHomeOffice — comparaison bureau externe : bail classique vs coworking", () => {
  it("régime location : coût annuel = loyer mensuel × 12", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "location",
      loyerBureauExterneMensuel: 400,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(4800, 6);
  });

  it("régime coworking : coût annuel = tarif journalier × jours/mois × 12", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "coworking",
      coworkingTarifJournalier: 25,
      coworkingJoursParMois: 20,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(25 * 20 * 12, 6);
  });

  it("le champ loyer mensuel est ignoré en mode coworking", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "coworking",
      loyerBureauExterneMensuel: 999999,
      coworkingTarifJournalier: 25,
      coworkingJoursParMois: 20,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(25 * 20 * 12, 6);
  });
});

describe("computeHomeOffice — régime IR (société translucide)", () => {
  it("utilise le taux marginal manuel du foyer plutôt que le barème IS pour l'économie société", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IR",
      beneficeAvantChargePrevisionnel: 40000,
      personalTaxProfile: { ...createDefaultHomeOfficeInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    };
    const r = computeHomeOffice(inputs);
    expect(r.economieImpotSociete).toBeCloseTo(r.indemniteAnnuelleBrute * 0.3, 6);
  });

  it("en régime IR, le bénéfice prévisionnel de la société s'ajoute au revenu du foyer pour le calcul du TMI", () => {
    const base: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IR",
      personalTaxProfile: { ...createDefaultHomeOfficeInputs().personalTaxProfile, mode: "calcule" },
    };
    const faibleBenefice = computeHomeOffice({ ...base, beneficeAvantChargePrevisionnel: 5000 });
    const fortBenefice = computeHomeOffice({ ...base, beneficeAvantChargePrevisionnel: 200000 });
    expect(fortBenefice.tauxIRUtilise).toBeGreaterThan(faibleBenefice.tauxIRUtilise);
  });
});
