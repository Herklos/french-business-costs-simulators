import { describe, expect, it } from "vitest";
import { type RetraiteInputs, computeRetraite, createDefaultRetraiteInputs } from "./retraite";
import { PASS_2026 } from "./pass";

function withCompany(companyType: string, patch: Partial<RetraiteInputs> = {}): RetraiteInputs {
  return { ...createDefaultRetraiteInputs(), companyType, ...patch };
}

describe("computeRetraite — statut du dirigeant", () => {
  it("EURL : statut TNS, économie côté société", () => {
    const r = computeRetraite(withCompany("EURL"));
    expect(r.dirigeantStatus).toBe("TNS");
    expect(r.economieImpotSociete).toBeGreaterThan(0);
    expect(r.economieImpotDirigeant).toBe(0);
  });

  it("SASU : statut assimilé salarié, économie côté dirigeant", () => {
    const r = computeRetraite(withCompany("SASU"));
    expect(r.dirigeantStatus).toBe("ASSIMILE_SALARIE");
    expect(r.economieImpotDirigeant).toBeGreaterThan(0);
    expect(r.economieImpotSociete).toBe(0);
  });
});

describe("computeRetraite — plafond TNS (Madelin retraite)", () => {
  it("versement sous le plafond : intégralement déductible", () => {
    const r = computeRetraite(withCompany("EURL", { versementAnnuel: 2000, beneficeAvantChargePrevisionnel: 40000 }));
    expect(r.versementDeductible).toBeCloseTo(2000, 6);
    expect(r.versementNonDeductible).toBeCloseTo(0, 6);
  });

  it("le plancher (10% du PASS) s'applique même à bénéfice nul", () => {
    const r = computeRetraite(withCompany("EURL", { beneficeAvantChargePrevisionnel: 0 }));
    expect(r.plafondDeduction).toBeCloseTo(0.1 * PASS_2026, 6);
  });

  it("la tranche complémentaire de 15% s'applique au-delà d'1×PASS de bénéfice", () => {
    const r = computeRetraite(withCompany("EURL", { beneficeAvantChargePrevisionnel: 2 * PASS_2026 }));
    const attendu = 0.1 * (2 * PASS_2026) + 0.15 * PASS_2026;
    expect(r.plafondDeduction).toBeCloseTo(attendu, 6);
  });

  it("le bénéfice est plafonné à 8×PASS pour le calcul du plafond", () => {
    const r1 = computeRetraite(withCompany("EURL", { beneficeAvantChargePrevisionnel: 8 * PASS_2026 }));
    const r2 = computeRetraite(withCompany("EURL", { beneficeAvantChargePrevisionnel: 20 * PASS_2026 }));
    expect(r2.plafondDeduction).toBeCloseTo(r1.plafondDeduction, 6);
  });
});

describe("computeRetraite — plafond assimilé salarié (PER individuel classique)", () => {
  it("plafond = 10% du revenu net N-1", () => {
    const r = computeRetraite(withCompany("SASU", { revenuNetImposableN1: 50000 }));
    expect(r.plafondDeduction).toBeCloseTo(5000, 6);
  });

  it("le plancher (10% du PASS) s'applique si le revenu est faible", () => {
    const r = computeRetraite(withCompany("SASU", { revenuNetImposableN1: 1000 }));
    expect(r.plafondDeduction).toBeCloseTo(0.1 * PASS_2026, 6);
  });

  it("le revenu est plafonné à 8×PASS pour le calcul du plafond", () => {
    const r = computeRetraite(withCompany("SASU", { revenuNetImposableN1: 100 * PASS_2026 }));
    expect(r.plafondDeduction).toBeCloseTo(0.1 * 8 * PASS_2026, 6);
  });
});

describe("computeRetraite — cohérence générale", () => {
  it("versement au-delà du plafond : le surplus n'est pas déductible", () => {
    const r = computeRetraite(withCompany("SASU", { versementAnnuel: 100000, revenuNetImposableN1: 40000 }));
    expect(r.versementNonDeductible).toBeGreaterThan(0);
    expect(r.versementDeductible).toBeCloseTo(r.plafondDeduction, 6);
  });

  it("coutNetGlobal = versementAnnuel − économie d'impôt (société + dirigeant)", () => {
    const r = computeRetraite(withCompany("EURL", { versementAnnuel: 3000 }));
    expect(r.coutNetGlobal).toBeCloseTo(3000 - r.economieImpotSociete - r.economieImpotDirigeant, 6);
  });

  it("versement nul : tous les résultats à zéro", () => {
    const r = computeRetraite(withCompany("EURL", { versementAnnuel: 0 }));
    expect(r.coutNetGlobal).toBe(0);
    expect(r.tauxEconomieGlobal).toBe(0);
  });

  it("createDefaultRetraiteInputs retourne un identifiant unique à chaque appel", () => {
    expect(createDefaultRetraiteInputs().id).not.toBe(createDefaultRetraiteInputs().id);
  });
});

describe("computeRetraite — détail du calcul (breakdown société vs dirigeant)", () => {
  it("TNS : le détail additionne bien versement − économie société = coût net société, coût dirigeant nul", () => {
    const r = computeRetraite(withCompany("EURL", { versementAnnuel: 4000 }));
    const find = (label: string) => r.detail.find((d) => d.label === label);
    expect(find("Versement annuel (pris en charge par la société)")?.value).toBeCloseTo(4000, 6);
    expect(find("= Coût net société")?.value).toBeCloseTo(r.coutNetGlobal, 6);
    expect(find("Coût net dirigeant (aucun décaissement personnel)")?.value).toBe(0);
    expect(find("= Coût net global")?.value).toBeCloseTo(r.coutNetGlobal, 6);
  });

  it("assimilé salarié : le détail additionne bien versement − économie IR = coût net dirigeant, coût société nul", () => {
    const r = computeRetraite(withCompany("SASU", { versementAnnuel: 4000 }));
    const find = (label: string) => r.detail.find((d) => d.label === label);
    expect(find("Versement annuel (financé personnellement par le dirigeant)")?.value).toBeCloseTo(4000, 6);
    expect(find("= Coût net dirigeant")?.value).toBeCloseTo(r.coutNetGlobal, 6);
    expect(find("Coût net société (aucune charge société)")?.value).toBe(0);
    expect(find("= Coût net global")?.value).toBeCloseTo(r.coutNetGlobal, 6);
  });

  it("le détail n'inclut la ligne 'non déductible' que si le versement dépasse le plafond", () => {
    const sousPlafond = computeRetraite(withCompany("EURL", { versementAnnuel: 500, beneficeAvantChargePrevisionnel: 40000 }));
    const auDessusPlafond = computeRetraite(withCompany("EURL", { versementAnnuel: 100000, beneficeAvantChargePrevisionnel: 40000 }));
    expect(sousPlafond.detail.some((d) => d.label.includes("NON déductible"))).toBe(false);
    expect(auDessusPlafond.detail.some((d) => d.label.includes("NON déductible"))).toBe(true);
  });
});
