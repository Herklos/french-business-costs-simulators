import { describe, expect, it } from "vitest";
import {
  applyAbattement10,
  applyDecote,
  computeEffectiveMarginalRate,
  computeIR,
  computeParts,
  createDefaultPersonalTaxProfile,
  resolvePersonalTaxProfile,
} from "./frenchIncomeTax";

describe("computeParts", () => {
  it("1 part pour une personne seule sans enfant, 2 parts pour un couple", () => {
    expect(computeParts("seul", 0)).toBe(1);
    expect(computeParts("couple", 0)).toBe(2);
  });

  it("+0,5 part par enfant pour les deux premiers", () => {
    expect(computeParts("seul", 1)).toBe(1.5);
    expect(computeParts("seul", 2)).toBe(2);
  });

  it("+1 part entière à partir du 3e enfant", () => {
    expect(computeParts("seul", 3)).toBe(3);
    expect(computeParts("couple", 3)).toBe(4);
    expect(computeParts("seul", 4)).toBe(4);
  });

  it("ignore les valeurs négatives d'enfants", () => {
    expect(computeParts("seul", -2)).toBe(1);
  });
});

describe("applyAbattement10", () => {
  it("applique 10% dans la fourchette min/max", () => {
    expect(applyAbattement10(30000)).toBeCloseTo(27000, 6);
  });

  it("applique le plancher minimum sur un petit salaire", () => {
    // 10% de 2000€ = 200€ < plancher 495€ → abattement plafonné au plancher.
    expect(applyAbattement10(2000)).toBeCloseTo(2000 - 495, 6);
  });

  it("applique le plafond maximum sur un gros salaire", () => {
    // 10% de 200 000€ = 20 000€ > plafond 14 171€ → abattement plafonné.
    expect(applyAbattement10(200000)).toBeCloseTo(200000 - 14171, 6);
  });

  it("retourne 0 pour un salaire nul ou négatif", () => {
    expect(applyAbattement10(0)).toBe(0);
    expect(applyAbattement10(-100)).toBe(0);
  });
});

describe("computeIR", () => {
  it("aucun impôt sous le seuil de la première tranche", () => {
    const r = computeIR(10000, 1);
    expect(r.impotTotal).toBe(0);
    expect(r.tmi).toBe(0);
  });

  it("calcule correctement un cas à cheval sur deux tranches", () => {
    // 1 part, revenu imposable 27 000€ (comme le profil par défaut du simulateur).
    const r = computeIR(27000, 1);
    expect(r.tmi).toBeCloseTo(0.11, 6);
    const attendu = (27000 - 11497) * 0.11;
    expect(r.impotTotal).toBeCloseTo(attendu, 6);
  });

  it("le quotient familial réduit l'impôt total à revenu égal", () => {
    const seul = computeIR(60000, 1);
    const famille = computeIR(60000, 3);
    expect(famille.impotTotal).toBeLessThan(seul.impotTotal);
  });

  it("un revenu très élevé atteint la tranche à 45%", () => {
    const r = computeIR(500000, 1);
    expect(r.tmi).toBeCloseTo(0.45, 6);
  });
});

describe("applyDecote", () => {
  it("aucune décote au-delà du seuil", () => {
    expect(applyDecote(2000, "seul")).toBe(2000);
    expect(applyDecote(3500, "couple")).toBe(3500);
  });

  it("réduit l'impôt d'un foyer modeste, sans jamais aller sous 0", () => {
    const impotBrut = 800; // < seuil 1982€ pour une personne seule
    const resultat = applyDecote(impotBrut, "seul");
    expect(resultat).toBeLessThan(impotBrut);
    expect(resultat).toBeGreaterThanOrEqual(0);
  });

  it("peut annuler totalement l'impôt pour un foyer très modeste", () => {
    expect(applyDecote(100, "seul")).toBe(0);
  });
});

describe("computeEffectiveMarginalRate", () => {
  it("majore le taux de la tranche de ×1,4525 dans la zone de décote", () => {
    const taux = computeEffectiveMarginalRate(1000, 0.11, "seul");
    expect(taux).toBeCloseTo(0.11 * 1.4525, 6);
  });

  it("ne majore pas le taux hors de la zone de décote", () => {
    const taux = computeEffectiveMarginalRate(5000, 0.3, "seul");
    expect(taux).toBeCloseTo(0.3, 6);
  });
});

describe("resolvePersonalTaxProfile", () => {
  it("mode manuel : retourne directement le taux saisi, sans passer par le barème", () => {
    const profile = { ...createDefaultPersonalTaxProfile(), mode: "manuel" as const, tauxManuel: 0.41 };
    const r = resolvePersonalTaxProfile(profile);
    expect(r.tauxUtilise).toBeCloseTo(0.41, 6);
  });

  it("mode calculé : intègre le salaire du conjoint uniquement si couple", () => {
    const profile = {
      ...createDefaultPersonalTaxProfile(),
      salaireNetImposableAnnuel: 30000,
      conjointSalaireNetImposableAnnuel: 30000,
    };
    const seul = resolvePersonalTaxProfile({ ...profile, situationFamiliale: "seul" });
    const couple = resolvePersonalTaxProfile({ ...profile, situationFamiliale: "couple" });
    // Le revenu du foyer "couple" doit inclure le salaire du conjoint, "seul" non.
    expect(couple.revenuImposable).toBeGreaterThan(seul.revenuImposable);
    expect(seul.revenuImposable).toBeCloseTo(applyAbattement10(30000), 6);
  });

  it("un foyer sans aucun revenu a un taux utilisé nul", () => {
    const profile = {
      ...createDefaultPersonalTaxProfile(),
      salaireNetImposableAnnuel: 0,
      autresRevenusImposablesFoyer: 0,
    };
    const r = resolvePersonalTaxProfile(profile);
    expect(r.tauxUtilise).toBe(0);
  });
});
