import { describe, expect, it } from "vitest";
import {
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
