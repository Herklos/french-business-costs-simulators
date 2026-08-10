import { describe, expect, it } from "vitest";
import {
  type MutuellePrevoyanceInputs,
  computeMutuellePrevoyance,
  createDefaultMutuellePrevoyanceInputs,
} from "./mutuellePrevoyance";
import { PASS_2026 } from "./pass";

function withCompany(companyType: string, patch: Partial<MutuellePrevoyanceInputs> = {}): MutuellePrevoyanceInputs {
  return { ...createDefaultMutuellePrevoyanceInputs(), companyType, ...patch };
}

describe("computeMutuellePrevoyance — statut du dirigeant", () => {
  it("EURL : statut TNS, plafond Madelin calculé", () => {
    const r = computeMutuellePrevoyance(withCompany("EURL"));
    expect(r.dirigeantStatus).toBe("TNS");
    expect(r.plafondMadelin).toBeGreaterThan(0);
    expect(r.partPatronale).toBe(0);
  });

  it("SASU : statut assimilé salarié, part patronale/salariale calculées", () => {
    const r = computeMutuellePrevoyance(withCompany("SASU"));
    expect(r.dirigeantStatus).toBe("ASSIMILE_SALARIE");
    expect(r.plafondMadelin).toBe(0);
    expect(r.partPatronale).toBeGreaterThan(0);
  });
});

describe("computeMutuellePrevoyance — TNS (Madelin)", () => {
  it("cotisation sous le plafond : intégralement déductible", () => {
    const r = computeMutuellePrevoyance(withCompany("EURL", { cotisationAnnuelle: 500, beneficeAvantChargePrevisionnel: 40000 }));
    expect(r.cotisationDeductibleTNS).toBeCloseTo(500, 6);
    expect(r.cotisationNonDeductibleTNS).toBeCloseTo(0, 6);
  });

  it("cotisation très élevée : plafonnée par le plafond absolu (3% de 8×PASS)", () => {
    const r = computeMutuellePrevoyance(withCompany("EURL", { cotisationAnnuelle: 1_000_000, beneficeAvantChargePrevisionnel: 1_000_000 }));
    expect(r.cotisationDeductibleTNS).toBeCloseTo(0.03 * 8 * PASS_2026, 6);
    expect(r.cotisationNonDeductibleTNS).toBeGreaterThan(0);
  });

  it("prise en charge par la société : économie côté société, coût dirigeant nul", () => {
    const r = computeMutuellePrevoyance(withCompany("EURL", { priseEnChargeParLaSociete: true, cotisationAnnuelle: 1500 }));
    expect(r.economieImpotSociete).toBeGreaterThan(0);
    expect(r.economieImpotDirigeant).toBe(0);
    expect(r.coutNetDirigeant).toBe(0);
    expect(r.coutNetSociete).toBeGreaterThan(0);
  });

  it("prise en charge personnelle : économie côté dirigeant (IR), coût société nul", () => {
    const r = computeMutuellePrevoyance(withCompany("EURL", { priseEnChargeParLaSociete: false, cotisationAnnuelle: 1500 }));
    expect(r.economieImpotDirigeant).toBeGreaterThan(0);
    expect(r.economieImpotSociete).toBe(0);
    expect(r.coutNetSociete).toBe(0);
    expect(r.coutNetDirigeant).toBeGreaterThan(0);
  });

  it("le coût net global est identique que la société ou le dirigeant paie, à taux d'imposition équivalent", () => {
    // Avec un régime IR translucide, l'économie IS et l'économie IR utilisent le même taux
    // (tauxIRUtilise), donc le coût net global ne doit pas dépendre du payeur.
    const base = withCompany("EURL", { impositionSociete: "IR", cotisationAnnuelle: 1000 });
    const parSociete = computeMutuellePrevoyance({ ...base, priseEnChargeParLaSociete: true });
    const parDirigeant = computeMutuellePrevoyance({ ...base, priseEnChargeParLaSociete: false });
    expect(parSociete.coutNetGlobal).toBeCloseTo(parDirigeant.coutNetGlobal, 6);
  });
});

describe("computeMutuellePrevoyance — assimilé salarié (mutuelle collective)", () => {
  it("la part salariale est bien cotisationAnnuelle - partPatronale", () => {
    const r = computeMutuellePrevoyance(withCompany("SASU", { cotisationAnnuelle: 1500, partPatronalePourcent: 60 }));
    expect(r.partPatronale).toBeCloseTo(900, 6);
    expect(r.partSalariale).toBeCloseTo(600, 6);
  });

  it("sous le plafond d'exonération : aucun excédent, aucun IR supplémentaire", () => {
    const r = computeMutuellePrevoyance(withCompany("SASU", { cotisationAnnuelle: 800, salaireBrutAnnuelReference: 45000 }));
    expect(r.montantExcedentaire).toBeCloseTo(0, 6);
  });

  it("au-delà du plafond d'exonération : excédent réintégré et imposé à l'IR", () => {
    const r = computeMutuellePrevoyance(withCompany("SASU", { cotisationAnnuelle: 10000, salaireBrutAnnuelReference: 45000 }));
    expect(r.montantExcedentaire).toBeGreaterThan(0);
    expect(r.montantExonere).toBeCloseTo(r.plafondExonerationSociale, 6);
  });

  it("la part patronale reste déductible du résultat société même au-delà du plafond d'exonération", () => {
    const r = computeMutuellePrevoyance(withCompany("SASU", { cotisationAnnuelle: 10000, partPatronalePourcent: 100 }));
    expect(r.economieImpotSociete).toBeGreaterThan(0);
    expect(r.economieImpotSociete).toBeLessThan(r.partPatronale);
  });
});

describe("computeMutuellePrevoyance — cas limites", () => {
  it("cotisation nulle (TNS) : tous les résultats à zéro", () => {
    const r = computeMutuellePrevoyance(withCompany("EURL", { cotisationAnnuelle: 0 }));
    expect(r.coutNetGlobal).toBe(0);
    expect(r.tauxEconomieGlobal).toBe(0);
  });

  it("cotisation nulle (assimilé salarié) : tous les résultats à zéro", () => {
    const r = computeMutuellePrevoyance(withCompany("SASU", { cotisationAnnuelle: 0 }));
    expect(r.coutNetGlobal).toBe(0);
    expect(r.tauxEconomieGlobal).toBe(0);
  });

  it("createDefaultMutuellePrevoyanceInputs retourne un identifiant unique à chaque appel", () => {
    expect(createDefaultMutuellePrevoyanceInputs().id).not.toBe(createDefaultMutuellePrevoyanceInputs().id);
  });
});

describe("computeMutuellePrevoyance — régime IR (société translucide, assimilé salarié)", () => {
  it("la part patronale utilise le taux marginal manuel du foyer plutôt que le barème IS", () => {
    const inputs = withCompany("SASU", {
      impositionSociete: "IR",
      cotisationAnnuelle: 1500,
      personalTaxProfile: { ...createDefaultMutuellePrevoyanceInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    });
    const r = computeMutuellePrevoyance(inputs);
    expect(r.economieImpotSociete).toBeCloseTo(r.partPatronale * 0.3, 6);
  });
});
