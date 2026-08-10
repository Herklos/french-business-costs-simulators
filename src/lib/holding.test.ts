import { describe, expect, it } from "vitest";
import {
  DUREE_DETENTION_MINIMALE_INTEGRATION_FISCALE_ANNEES,
  DUREE_DETENTION_MINIMALE_MERE_FILLE_ANNEES,
  type HoldingInputs,
  PFU_TAUX_DIVIDENDES,
  QUOTE_PART_FRAIS_ET_CHARGES_INTEGRATION_FISCALE,
  QUOTE_PART_FRAIS_ET_CHARGES_MERE_FILLE,
  SEUIL_DETENTION_INTEGRATION_FISCALE_POURCENT,
  SEUIL_DETENTION_MERE_FILLE_POURCENT,
  computeHolding,
  createDefaultHoldingInputs,
} from "./holding";

function withPatch(patch: Partial<HoldingInputs>): HoldingInputs {
  return { ...createDefaultHoldingInputs(), ...patch };
}

describe("computeHolding — éligibilité au régime mère-fille", () => {
  it("éligible par défaut (détention 100%, 3 ans)", () => {
    const r = computeHolding(createDefaultHoldingInputs());
    expect(r.eligibleRegimeMereFille).toBe(true);
  });

  it("non éligible si la détention est sous le seuil de 5%", () => {
    const r = computeHolding(withPatch({ tauxDetentionFilialePourcent: 3 }));
    expect(r.eligibleRegimeMereFille).toBe(false);
  });

  it("non éligible si la durée de détention est sous 2 ans", () => {
    const r = computeHolding(withPatch({ dureeDetentionFilialeAnnees: 1 }));
    expect(r.eligibleRegimeMereFille).toBe(false);
  });

  it("éligible pile aux seuils (5%, 2 ans)", () => {
    const r = computeHolding(
      withPatch({
        tauxDetentionFilialePourcent: SEUIL_DETENTION_MERE_FILLE_POURCENT,
        dureeDetentionFilialeAnnees: DUREE_DETENTION_MINIMALE_MERE_FILLE_ANNEES,
      }),
    );
    expect(r.eligibleRegimeMereFille).toBe(true);
  });
});

describe("computeHolding — coût IS de la remontée de dividendes", () => {
  it("éligible mère-fille (sans intégration fiscale) : seule la quote-part de frais et charges (5%) est imposée à l'IS", () => {
    const r = computeHolding(
      withPatch({
        dividendeAnnuelFiliale: 100000,
        tauxDetentionFilialePourcent: 50, // sous le seuil de 95% de l'intégration fiscale, mais au-dessus du seuil de 5% du mère-fille
        corporateTaxRateHolding: 0.25,
        eligibleTauxReduitPMEHolding: false,
      }),
    );
    expect(r.baseImposableIS).toBeCloseTo(100000 * QUOTE_PART_FRAIS_ET_CHARGES_MERE_FILLE, 6);
    expect(r.coutISAnnee1).toBeCloseTo(5000 * 0.25, 6);
  });

  it("non éligible : le dividende brut entier est imposé à l'IS (aucune exonération)", () => {
    const r = computeHolding(
      withPatch({ dividendeAnnuelFiliale: 100000, tauxDetentionFilialePourcent: 3, corporateTaxRateHolding: 0.25, eligibleTauxReduitPMEHolding: false }),
    );
    expect(r.baseImposableIS).toBeCloseTo(100000, 6);
    expect(r.coutISAnnee1).toBeGreaterThan(computeHolding(withPatch({ dividendeAnnuelFiliale: 100000 })).coutISAnnee1);
  });

  it("le net capitalisé année 1 = dividende − coût IS", () => {
    const r = computeHolding(withPatch({ dividendeAnnuelFiliale: 50000 }));
    expect(r.netCapitaliseHoldingAnnee1).toBeCloseTo(50000 - r.coutISAnnee1, 6);
  });

  it("la distribution directe année 1 = dividende × (1 − PFU)", () => {
    const r = computeHolding(withPatch({ dividendeAnnuelFiliale: 50000 }));
    expect(r.netDistributionDirecteAnnee1).toBeCloseTo(50000 * (1 - PFU_TAUX_DIVIDENDES), 6);
  });

  it("le coût de remontée avec holding (éligible) est très inférieur au PFU direct", () => {
    const r = computeHolding(withPatch({ dividendeAnnuelFiliale: 50000 }));
    expect(r.netCapitaliseHoldingAnnee1).toBeGreaterThan(r.netDistributionDirecteAnnee1);
  });
});

describe("computeHolding — éligibilité à l'intégration fiscale (QPFC réduite à 1%)", () => {
  it("éligible par défaut (détention 100%, 3 ans)", () => {
    const r = computeHolding(createDefaultHoldingInputs());
    expect(r.eligibleIntegrationFiscale).toBe(true);
  });

  it("non éligible si la détention est sous le seuil de 95% (mais reste éligible mère-fille)", () => {
    const r = computeHolding(withPatch({ tauxDetentionFilialePourcent: 50 }));
    expect(r.eligibleIntegrationFiscale).toBe(false);
    expect(r.eligibleRegimeMereFille).toBe(true);
  });

  it("non éligible si la durée de détention est sous 2 ans", () => {
    const r = computeHolding(withPatch({ dureeDetentionFilialeAnnees: 1 }));
    expect(r.eligibleIntegrationFiscale).toBe(false);
  });

  it("éligible pile aux seuils (95%, 2 ans)", () => {
    const r = computeHolding(
      withPatch({
        tauxDetentionFilialePourcent: SEUIL_DETENTION_INTEGRATION_FISCALE_POURCENT,
        dureeDetentionFilialeAnnees: DUREE_DETENTION_MINIMALE_INTEGRATION_FISCALE_ANNEES,
      }),
    );
    expect(r.eligibleIntegrationFiscale).toBe(true);
  });

  it("la QPFC appliquée est de 1% (et non 5%) quand l'intégration fiscale s'applique", () => {
    const r = computeHolding(
      withPatch({ dividendeAnnuelFiliale: 100000, tauxDetentionFilialePourcent: 100, dureeDetentionFilialeAnnees: 5 }),
    );
    expect(r.baseImposableIS).toBeCloseTo(100000 * QUOTE_PART_FRAIS_ET_CHARGES_INTEGRATION_FISCALE, 6);
  });

  it("la QPFC réduite (1%) génère un coût IS strictement inférieur à la QPFC mère-fille (5%), à dividende égal", () => {
    const avecIntegration = computeHolding(
      withPatch({ dividendeAnnuelFiliale: 100000, tauxDetentionFilialePourcent: 100, dureeDetentionFilialeAnnees: 5 }),
    );
    const sansIntegration = computeHolding(
      withPatch({ dividendeAnnuelFiliale: 100000, tauxDetentionFilialePourcent: 50, dureeDetentionFilialeAnnees: 5 }),
    );
    expect(avecIntegration.eligibleIntegrationFiscale).toBe(true);
    expect(sansIntegration.eligibleIntegrationFiscale).toBe(false);
    expect(avecIntegration.coutISAnnee1).toBeLessThan(sansIntegration.coutISAnnee1);
  });
});

describe("computeHolding — projection sur la durée choisie", () => {
  it("aucune projection si la durée est nulle", () => {
    const r = computeHolding(withPatch({ dureeProjectionAnnees: 0 }));
    expect(r.projection).toHaveLength(0);
    expect(r.capitalHoldingFinalBrut).toBe(0);
    expect(r.capitalDirectPersonnelFinal).toBe(0);
  });

  it("le capital croît chaque année dans les deux scénarios", () => {
    const r = computeHolding(withPatch({ dureeProjectionAnnees: 5, dividendeAnnuelFiliale: 20000, tauxRendementReinvestissement: 0.03 }));
    expect(r.projection).toHaveLength(5);
    for (let i = 1; i < r.projection.length; i++) {
      expect(r.projection[i].capitalHolding).toBeGreaterThan(r.projection[i - 1].capitalHolding);
      expect(r.projection[i].capitalDirectPersonnel).toBeGreaterThan(r.projection[i - 1].capitalDirectPersonnel);
    }
  });

  it("sans rendement, le capital holding final = somme des nets capitalisés annuels", () => {
    const r = computeHolding(withPatch({ dureeProjectionAnnees: 4, dividendeAnnuelFiliale: 10000, tauxRendementReinvestissement: 0 }));
    expect(r.capitalHoldingFinalBrut).toBeCloseTo(r.netCapitaliseHoldingAnnee1 * 4, 6);
  });

  it("dividende nul : aucun capital accumulé", () => {
    const r = computeHolding(withPatch({ dividendeAnnuelFiliale: 0, dureeProjectionAnnees: 5 }));
    expect(r.capitalHoldingFinalBrut).toBe(0);
    expect(r.capitalDirectPersonnelFinal).toBe(0);
  });
});

describe("computeHolding — sortie finale & comparaison globale", () => {
  it("le coût de sortie finale = capital brut holding × PFU", () => {
    const r = computeHolding(withPatch({ dureeProjectionAnnees: 8, dividendeAnnuelFiliale: 30000, tauxRendementReinvestissement: 0.03 }));
    expect(r.coutSortieFinaleHolding).toBeCloseTo(r.capitalHoldingFinalBrut * PFU_TAUX_DIVIDENDES, 6);
    expect(r.capitalHoldingFinalNetApresSortie).toBeCloseTo(r.capitalHoldingFinalBrut - r.coutSortieFinaleHolding, 6);
  });

  it("sur une longue durée, la capitalisation dans la holding l'emporte sur la distribution directe même après la sortie finale au PFU", () => {
    const r = computeHolding(withPatch({ dureeProjectionAnnees: 20, dividendeAnnuelFiliale: 50000, tauxRendementReinvestissement: 0.04 }));
    expect(r.capitalHoldingFinalNetApresSortie).toBeGreaterThan(r.capitalDirectPersonnelFinal);
    expect(r.ecartEnFaveurHolding).toBeCloseTo(r.capitalHoldingFinalNetApresSortie - r.capitalDirectPersonnelFinal, 6);
  });

  it("createDefaultHoldingInputs retourne un identifiant unique à chaque appel", () => {
    expect(createDefaultHoldingInputs().id).not.toBe(createDefaultHoldingInputs().id);
  });
});
