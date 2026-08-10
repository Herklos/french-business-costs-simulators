import { describe, expect, it } from "vitest";
import {
  CATEGORIE_LABELS,
  type CategorieMateriel,
  DUREE_AMORTISSEMENT_PAR_CATEGORIE,
  type MaterielInputs,
  SEUIL_CHARGE_IMMEDIATE_HT,
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
