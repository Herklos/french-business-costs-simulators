import { describe, expect, it } from "vitest";
import {
  CATEGORIE_LABELS,
  type CategorieMateriel,
  DUREE_AMORTISSEMENT_PAR_CATEGORIE,
  MODES_ACQUISITION,
  MODE_ACQUISITION_LABELS,
  MODE_ACQUISITION_RESUMES,
  type MaterielInputs,
  type ModeAcquisitionMateriel,
  SEUIL_CHARGE_IMMEDIATE_HT,
  compareMontagesMateriel,
  computeMateriel,
  createDefaultMaterielInputs,
} from "./materiel";

function withPatch(patch: Partial<MaterielInputs>): MaterielInputs {
  return { ...createDefaultMaterielInputs(), ...patch };
}

describe("computeMateriel — seuil de charge immédiate (petit matériel, 500€ HT)", () => {
  it("un matériel ≤ 500€ HT est déduit immédiatement en charge (pas d'amortissement)", () => {
    const r = computeMateriel(withPatch({ prixHT: 450 }));
    expect(r.eligibleChargeImmediate).toBe(true);
    expect(r.chargeAnnee1).toBeCloseTo(450, 6);
    expect(r.annuiteAmortissement).toBe(0);
  });

  it("un matériel > 500€ HT est amorti sur la durée choisie", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3 }));
    expect(r.eligibleChargeImmediate).toBe(false);
    expect(r.chargeAnnee1).toBeCloseTo(600, 6);
    expect(r.annuiteAmortissement).toBeCloseTo(600, 6);
  });

  it("exactement au seuil (500€) : encore éligible à la charge immédiate", () => {
    const r = computeMateriel(withPatch({ prixHT: SEUIL_CHARGE_IMMEDIATE_HT }));
    expect(r.eligibleChargeImmediate).toBe(true);
  });
});

describe("computeMateriel — société vs personnel remboursé vs personnel non remboursé", () => {
  it("société et personnel remboursé ont exactement le même coût net société (même charge déductible)", () => {
    const base = withPatch({ prixHT: 1800 });
    const societe = computeMateriel({ ...base, modeAcquisition: "societe" });
    const rembourse = computeMateriel({ ...base, modeAcquisition: "personnel_rembourse" });
    expect(societe.coutNetSocieteTotalSurDuree).toBeCloseTo(rembourse.coutNetSocieteTotalSurDuree, 6);
    expect(societe.economieImpotAnnee1).toBeCloseTo(rembourse.economieImpotAnnee1, 6);
  });

  it("personnel non remboursé : aucune charge déductible, le dirigeant supporte le prix plein", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, modeAcquisition: "personnel_non_rembourse" }));
    expect(r.coutNetSocieteTotalSurDuree).toBe(0);
    expect(r.economieImpotAnnee1).toBe(0);
    expect(r.coutDirigeantNonRembourse).toBeCloseTo(1800, 6);
  });

  it("l'économie vs non remboursé est nulle pour le montage non remboursé lui-même", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, modeAcquisition: "personnel_non_rembourse" }));
    expect(r.economieVsNonRembourse).toBeCloseTo(0, 6);
  });

  it("l'économie vs non remboursé est positive pour société/remboursé (déduction effective)", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, modeAcquisition: "societe" }));
    expect(r.economieVsNonRembourse).toBeGreaterThan(0);
    expect(r.economieVsNonRembourse).toBeCloseTo(1800 - r.coutNetSocieteTotalSurDuree, 6);
  });
});

describe("computeMateriel — cohérence de l'amortissement sur la durée", () => {
  it("le coût net total sur la durée = coût net année 1 × durée quand le bénéfice reste stable", () => {
    const r = computeMateriel(withPatch({ prixHT: 2400, dureeAmortissementAnnees: 4 }));
    expect(r.coutNetSocieteTotalSurDuree).toBeCloseTo(r.coutNetSocieteAnnee1 * 4, 6);
  });

  it("régime IR (translucide) : l'économie utilise le taux marginal du foyer plutôt que l'IS", () => {
    const r = computeMateriel(
      withPatch({
        prixHT: 1800,
        impositionSociete: "IR",
        personalTaxProfile: { ...createDefaultMaterielInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
      }),
    );
    expect(r.economieImpotAnnee1).toBeCloseTo(r.chargeAnnee1 * 0.3, 6);
  });
});

describe("computeMateriel — cas limites", () => {
  it("prix nul : aucun coût, aucune charge", () => {
    const r = computeMateriel(withPatch({ prixHT: 0 }));
    expect(r.chargeAnnee1).toBe(0);
    expect(r.coutNetSocieteTotalSurDuree).toBe(0);
    expect(r.eligibleChargeImmediate).toBe(false);
  });

  it("createDefaultMaterielInputs retourne un identifiant unique à chaque appel", () => {
    expect(createDefaultMaterielInputs().id).not.toBe(createDefaultMaterielInputs().id);
  });
});

describe("computeMateriel — LOA / leasing", () => {
  it("la charge annuelle = loyer mensuel × 12, jamais de charge immédiate en LOA", () => {
    const r = computeMateriel(withPatch({ modeAcquisition: "loa", loaLoyerMensuel: 60, loaDureeMois: 36 }));
    expect(r.eligibleChargeImmediate).toBe(false);
    expect(r.chargeAnnee1).toBeCloseTo(720, 6);
  });

  it("le coût net société sur la durée = coût net annuel × durée LOA en années", () => {
    const r = computeMateriel(withPatch({ modeAcquisition: "loa", loaLoyerMensuel: 60, loaDureeMois: 36 }));
    expect(r.coutNetSocieteTotalSurDuree).toBeCloseTo(r.coutNetSocieteAnnee1 * 3, 6);
  });

  it("un loyer LOA négatif saisi par erreur est ramené à zéro", () => {
    const r = computeMateriel(withPatch({ modeAcquisition: "loa", loaLoyerMensuel: -10 }));
    expect(r.chargeAnnee1).toBe(0);
  });
});

describe("computeMateriel — plan de renouvellement périodique", () => {
  it("un seul cycle si l'horizon = la durée du cycle", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, horizonRenouvellementAnnees: 3 }));
    expect(r.nombreCycles).toBe(1);
    expect(r.coutTotalSurHorizon).toBeCloseTo(r.coutNetSocieteTotalSurDuree, 6);
  });

  it("plusieurs cycles sur un horizon plus long, sans inflation : coût proportionnel", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, horizonRenouvellementAnnees: 9, tauxInflationMateriel: 0 }));
    expect(r.nombreCycles).toBe(3);
    expect(r.coutTotalSurHorizon).toBeCloseTo(r.coutNetSocieteTotalSurDuree * 3, 6);
  });

  it("avec inflation, le coût total dépasse le simple produit linéaire", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, horizonRenouvellementAnnees: 9, tauxInflationMateriel: 0.05 }));
    expect(r.coutTotalSurHorizon).toBeGreaterThan(r.coutNetSocieteTotalSurDuree * 3);
  });
});

describe("computeMateriel — catégorie outillage / matériel d'atelier", () => {
  it("la durée d'amortissement par défaut de l'outillage est de 7 ans", () => {
    expect(DUREE_AMORTISSEMENT_PAR_CATEGORIE.outillage).toBe(7);
  });

  it("chaque catégorie a un libellé, y compris outillage", () => {
    const categories: CategorieMateriel[] = ["informatique", "mobilier", "outillage", "autre"];
    for (const c of categories) {
      expect(CATEGORIE_LABELS[c]).toBeTruthy();
    }
  });

  it("un outillage amorti sur sa durée par défaut se calcule comme les autres catégories", () => {
    const r = computeMateriel(
      withPatch({ categorie: "outillage", prixHT: 3500, dureeAmortissementAnnees: DUREE_AMORTISSEMENT_PAR_CATEGORIE.outillage }),
    );
    expect(r.eligibleChargeImmediate).toBe(false);
    expect(r.annuiteAmortissement).toBeCloseTo(3500 / 7, 6);
  });
});

describe("computeMateriel — usage mixte pro/privé (avantage en nature)", () => {
  it("aucun AEN si l'usage est 100% professionnel", () => {
    const r = computeMateriel(withPatch({ usagePrivePercent: 0 }));
    expect(r.aenAnnuelle).toBe(0);
    expect(r.coutDirigeantAEN).toBe(0);
  });

  it("AEN proportionnel à l'usage privé", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, usagePrivePercent: 50 }));
    expect(r.aenAnnuelle).toBeCloseTo(r.chargeAnnee1 * 0.5, 6);
  });

  it("le coût dirigeant AEN = cotisations sociales + IR sur l'AEN", () => {
    const r = computeMateriel(withPatch({ usagePrivePercent: 50, tauxChargesSocialesAEN: 0.43 }));
    expect(r.coutDirigeantAEN).toBeCloseTo(r.cotisationsSocialesAEN + r.irSurAEN, 6);
  });

  it("aucun AEN pour un achat personnel non remboursé (le dirigeant utilise déjà son propre bien)", () => {
    const r = computeMateriel(withPatch({ modeAcquisition: "personnel_non_rembourse", usagePrivePercent: 50 }));
    expect(r.aenAnnuelle).toBe(0);
  });
});

describe("computeMateriel — coût net global année 1 (société + dirigeant ensemble)", () => {
  it("achat société sans AEN : coutNetGlobalAnnee1 = coutNetSocieteAnnee1 (rien à la charge du dirigeant)", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, modeAcquisition: "societe", usagePrivePercent: 0 }));
    expect(r.coutNetGlobalAnnee1).toBeCloseTo(r.coutNetSocieteAnnee1, 6);
  });

  it("achat personnel non remboursé : coutNetGlobalAnnee1 = prix plein (aucune charge société)", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, modeAcquisition: "personnel_non_rembourse" }));
    expect(r.coutNetGlobalAnnee1).toBeCloseTo(1800, 6);
  });

  it("usage mixte : coutNetGlobalAnnee1 = coutNetSocieteAnnee1 + coutDirigeantAEN", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, usagePrivePercent: 50 }));
    expect(r.coutNetGlobalAnnee1).toBeCloseTo(r.coutNetSocieteAnnee1 + r.coutDirigeantAEN, 6);
  });
});

describe("computeMateriel — coût net global sur un cycle et sur l'horizon", () => {
  it("achat société sans usage privé : le coût global d'un cycle est celui de la société", () => {
    const r = computeMateriel(withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, modeAcquisition: "societe" }));
    expect(r.coutNetGlobalSurDuree).toBeCloseTo(r.coutNetSocieteTotalSurDuree, 6);
  });

  it("achat non remboursé : le coût global d'un cycle est le prix plein, une seule fois", () => {
    const r = computeMateriel(
      withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, modeAcquisition: "personnel_non_rembourse" }),
    );
    expect(r.coutNetGlobalSurDuree).toBeCloseTo(1800, 6);
  });

  it("l'AEN se répète chaque année du cycle, contrairement au décaissement d'achat", () => {
    const r = computeMateriel(
      withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, usagePrivePercent: 40, horizonRenouvellementAnnees: 3 }),
    );
    expect(r.coutNetGlobalSurDuree).toBeCloseTo(r.coutNetSocieteTotalSurDuree + r.coutDirigeantAEN * 3, 6);
  });

  it("sans inflation, l'horizon multiplie simplement le cycle", () => {
    const r = computeMateriel(
      withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3, horizonRenouvellementAnnees: 9, tauxInflationMateriel: 0 }),
    );
    expect(r.nombreCycles).toBe(3);
    expect(r.coutNetGlobalSurHorizon).toBeCloseTo(r.coutNetGlobalSurDuree * 3, 6);
  });

  it("avec inflation, chaque cycle successif coûte plus cher que le précédent", () => {
    const r = computeMateriel(
      withPatch({
        prixHT: 1000,
        dureeAmortissementAnnees: 2,
        horizonRenouvellementAnnees: 4,
        tauxInflationMateriel: 0.1,
      }),
    );
    // Deux cycles : le second majoré de 10 %.
    expect(r.coutNetGlobalSurHorizon).toBeCloseTo(r.coutNetGlobalSurDuree * (1 + 1.1), 6);
  });

  it("le coût global sur l'horizon suit le coût société quand le dirigeant ne paie rien", () => {
    const r = computeMateriel(
      withPatch({ prixHT: 1800, modeAcquisition: "societe", usagePrivePercent: 0, horizonRenouvellementAnnees: 9 }),
    );
    expect(r.coutNetGlobalSurHorizon).toBeCloseTo(r.coutTotalSurHorizon, 6);
  });
});

describe("compareMontagesMateriel — comparatif de tous les montages", () => {
  it("chiffre les quatre montages, sans doublon ni oubli", () => {
    const { montages } = compareMontagesMateriel(withPatch({}));
    expect(montages).toHaveLength(4);
    expect(new Set(montages.map((m) => m.mode))).toEqual(new Set(MODES_ACQUISITION));
  });

  it("les classe du moins cher au plus cher", () => {
    const { montages } = compareMontagesMateriel(withPatch({ prixHT: 2400, loaLoyerMensuel: 90 }));
    const couts = montages.map((m) => m.coutHorizon);
    expect([...couts].sort((a, b) => a - b)).toEqual(couts);
  });

  it("le premier du classement est le meilleur, et son écart est nul", () => {
    const { montages, meilleur } = compareMontagesMateriel(withPatch({ prixHT: 2400 }));
    expect(meilleur).toBe(montages[0]);
    expect(meilleur.ecartVsMeilleur).toBe(0);
    expect(meilleur.meilleur).toBe(true);
  });

  it("l'écart affiché est bien la différence avec le montage le moins cher", () => {
    const { montages } = compareMontagesMateriel(withPatch({ prixHT: 2400, loaLoyerMensuel: 200 }));
    for (const m of montages) {
      expect(m.ecartVsMeilleur).toBeCloseTo(m.coutHorizon - montages[0].coutHorizon, 6);
      expect(m.ecartVsMeilleur).toBeGreaterThanOrEqual(0);
    }
  });

  it("achat société et achat personnel remboursé sont à égalité, et partagent le trophée s'ils gagnent", () => {
    const { montages } = compareMontagesMateriel(withPatch({ prixHT: 2400, loaLoyerMensuel: 500 }));
    const societe = montages.find((m) => m.mode === "societe");
    const rembourse = montages.find((m) => m.mode === "personnel_rembourse");
    expect(societe?.coutHorizon).toBe(rembourse?.coutHorizon);
    expect(societe?.meilleur).toBe(true);
    expect(rembourse?.meilleur).toBe(true);
    expect(montages.filter((m) => m.meilleur)).toHaveLength(2);
  });

  it("l'achat non remboursé n'est jamais le montage le moins cher quand la société peut déduire", () => {
    // Prix élevé, LOA volontairement ruineuse : même dans ce cas le montage sans aucune déduction
    // ne peut pas gagner, puisque les montages déductibles coûtent au plus le prix plein.
    const { meilleur } = compareMontagesMateriel(withPatch({ prixHT: 5000, loaLoyerMensuel: 900 }));
    expect(meilleur.mode).not.toBe("personnel_non_rembourse");
  });

  it("une LOA bon marché l'emporte sur l'achat", () => {
    const { meilleur } = compareMontagesMateriel(
      withPatch({ prixHT: 5000, dureeAmortissementAnnees: 3, loaLoyerMensuel: 30, loaDureeMois: 36, horizonRenouvellementAnnees: 3 }),
    );
    expect(meilleur.mode).toBe("loa");
  });

  it("une LOA hors de prix perd contre l'achat", () => {
    const { meilleur } = compareMontagesMateriel(
      withPatch({ prixHT: 1200, dureeAmortissementAnnees: 3, loaLoyerMensuel: 400, loaDureeMois: 36, horizonRenouvellementAnnees: 3 }),
    );
    expect(meilleur.mode).toBe("societe");
  });

  it("le classement ne dépend pas du montage sélectionné dans les entrées", () => {
    const base = withPatch({ prixHT: 2400, loaLoyerMensuel: 90 });
    const reference = compareMontagesMateriel(base).montages.map((m) => [m.mode, m.coutHorizon] as const);
    for (const mode of MODES_ACQUISITION) {
      const autre = compareMontagesMateriel({ ...base, modeAcquisition: mode }).montages.map(
        (m) => [m.mode, m.coutHorizon] as const,
      );
      expect(autre, `sélection ${mode}`).toEqual(reference);
    }
  });

  it("chaque montage porte le coût que computeMateriel calcule pour lui", () => {
    const base = withPatch({ prixHT: 2400, usagePrivePercent: 25, horizonRenouvellementAnnees: 6 });
    for (const m of compareMontagesMateriel(base).montages) {
      const direct = computeMateriel({ ...base, modeAcquisition: m.mode });
      expect(m.coutHorizon, m.mode).toBeCloseTo(direct.coutNetGlobalSurHorizon, 6);
      expect(m.results.chargeAnnee1, m.mode).toBeCloseTo(direct.chargeAnnee1, 6);
    }
  });

  it("chaque montage a un libellé et un résumé non vides", () => {
    for (const m of compareMontagesMateriel(withPatch({})).montages) {
      expect(m.label).toBe(MODE_ACQUISITION_LABELS[m.mode]);
      expect(m.resume).toBe(MODE_ACQUISITION_RESUMES[m.mode]);
      expect(m.resume.length).toBeGreaterThan(20);
    }
  });

  it("aucun coût aberrant sur des saisies extrêmes ou incohérentes", () => {
    const cas: Partial<MaterielInputs>[] = [
      { prixHT: 0, loaLoyerMensuel: 0 },
      { prixHT: -500 },
      { dureeAmortissementAnnees: 0 },
      { loaDureeMois: 0 },
      { horizonRenouvellementAnnees: 0 },
      { usagePrivePercent: 150 },
      { usagePrivePercent: -20 },
      { prixHT: 10_000_000, horizonRenouvellementAnnees: 50, tauxInflationMateriel: 0.2 },
    ];
    for (const patch of cas) {
      const { montages } = compareMontagesMateriel(withPatch(patch));
      for (const m of montages) {
        expect(Number.isFinite(m.coutHorizon), `${JSON.stringify(patch)} / ${m.mode}`).toBe(true);
        expect(Number.isNaN(m.coutHorizon)).toBe(false);
      }
    }
  });

  it("un usage privé à 100 % est traité comme 100 %, pas au-delà", () => {
    const cent = computeMateriel(withPatch({ usagePrivePercent: 100 }));
    const audela = computeMateriel(withPatch({ usagePrivePercent: 250 }));
    expect(audela.aenAnnuelle).toBeCloseTo(cent.aenAnnuelle, 6);
  });

  it("un horizon plus long ne peut pas faire baisser le coût global d'un montage", () => {
    const base = withPatch({ prixHT: 1800, dureeAmortissementAnnees: 3 });
    let precedent = -Infinity;
    for (const horizon of [3, 6, 9, 12]) {
      const r = computeMateriel({ ...base, horizonRenouvellementAnnees: horizon });
      expect(r.coutNetGlobalSurHorizon).toBeGreaterThanOrEqual(precedent);
      precedent = r.coutNetGlobalSurHorizon;
    }
  });
});

describe("compareMontagesMateriel — cas d'école calculables à la main", () => {
  // Régime IR translucide au taux marginal de 30 % : l'économie d'impôt vaut exactement 30 % de la
  // charge, ce qui rend chaque montant vérifiable sans dérouler le barème de l'IS.
  function casEcole(patch: Partial<MaterielInputs> = {}): MaterielInputs {
    const defauts = createDefaultMaterielInputs();
    return {
      ...defauts,
      impositionSociete: "IR",
      personalTaxProfile: { ...defauts.personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
      prixHT: 3000,
      dureeAmortissementAnnees: 3,
      horizonRenouvellementAnnees: 3,
      tauxInflationMateriel: 0,
      usagePrivePercent: 0,
      loaLoyerMensuel: 100,
      loaDureeMois: 36,
      ...patch,
    };
  }

  it("achat société : 3 000 € amortis sur 3 ans coûtent 2 100 € nets", () => {
    // Annuité 1 000 €, économie 300 €, coût net 700 €/an, sur 3 ans → 2 100 €.
    const r = computeMateriel(casEcole({ modeAcquisition: "societe" }));
    expect(r.annuiteAmortissement).toBeCloseTo(1000, 6);
    expect(r.economieImpotAnnee1).toBeCloseTo(300, 6);
    expect(r.coutNetSocieteAnnee1).toBeCloseTo(700, 6);
    expect(r.coutNetGlobalSurHorizon).toBeCloseTo(2100, 6);
  });

  it("achat non remboursé : 3 000 € coûtent 3 000 €, soit 900 € de plus", () => {
    const r = computeMateriel(casEcole({ modeAcquisition: "personnel_non_rembourse" }));
    expect(r.coutNetGlobalSurHorizon).toBeCloseTo(3000, 6);
  });

  it("LOA à 100 €/mois sur 36 mois : 3 600 € de loyers, 2 520 € nets", () => {
    // 1 200 €/an de loyers, économie 360 €, coût net 840 €/an, sur 3 ans → 2 520 €.
    const r = computeMateriel(casEcole({ modeAcquisition: "loa" }));
    expect(r.chargeAnnee1).toBeCloseTo(1200, 6);
    expect(r.coutNetGlobalSurHorizon).toBeCloseTo(2520, 6);
  });

  it("le classement complet de ce cas d'école est celui attendu, aux écarts près", () => {
    const { montages } = compareMontagesMateriel(casEcole());
    expect(montages.map((m) => m.mode)).toEqual(["societe", "personnel_rembourse", "loa", "personnel_non_rembourse"]);
    expect(montages.map((m) => Math.round(m.coutHorizon))).toEqual([2100, 2100, 2520, 3000]);
    expect(montages.map((m) => Math.round(m.ecartVsMeilleur))).toEqual([0, 0, 420, 900]);
  });

  it("usage privé de 50 % : l'AEN ajoute son coût au montage société et peut renverser le classement", () => {
    // AEN = 1 000 € × 50 % = 500 €/an ; coût dirigeant = 500 × (43 % + 30 %) = 365 €/an, soit
    // 1 095 € sur trois ans, qui s'ajoutent aux 2 100 € du montage société → 3 195 €.
    const r = computeMateriel(casEcole({ modeAcquisition: "societe", usagePrivePercent: 50 }));
    expect(r.aenAnnuelle).toBeCloseTo(500, 6);
    expect(r.coutDirigeantAEN).toBeCloseTo(365, 6);
    expect(r.coutNetGlobalSurHorizon).toBeCloseTo(3195, 6);

    const { meilleur } = compareMontagesMateriel(casEcole({ usagePrivePercent: 50 }));
    expect(meilleur.mode).toBe("personnel_non_rembourse");
  });
});

describe("MODES_ACQUISITION — registre des montages", () => {
  it("chaque mode du type a un libellé et un résumé", () => {
    const modes: ModeAcquisitionMateriel[] = ["societe", "personnel_rembourse", "personnel_non_rembourse", "loa"];
    expect(MODES_ACQUISITION).toEqual(modes);
    for (const mode of modes) {
      expect(MODE_ACQUISITION_LABELS[mode]).toBeTruthy();
      expect(MODE_ACQUISITION_RESUMES[mode]).toBeTruthy();
    }
  });
});
