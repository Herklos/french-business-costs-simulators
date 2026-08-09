import { describe, expect, it } from "vitest";
import {
  computeComptant,
  computeCredit,
  computeLld,
  computeLoa,
  computeMensualiteCredit,
  createDefaultFinancingInputs,
  getTauxUsureApplicable,
} from "./financing";

describe("computeMensualiteCredit", () => {
  it("répartit également le capital quand le taux est nul", () => {
    expect(computeMensualiteCredit(12000, 0, 12)).toBeCloseTo(1000, 6);
  });

  it("retourne 0 si la durée est nulle ou négative", () => {
    expect(computeMensualiteCredit(10000, 0.05, 0)).toBe(0);
    expect(computeMensualiteCredit(10000, 0.05, -12)).toBe(0);
  });

  it("calcule une mensualité positive et cohérente avec un taux réel", () => {
    const mensualite = computeMensualiteCredit(40500, 0.04, 60);
    // Total remboursé doit être supérieur au capital emprunté (le crédit a un coût).
    expect(mensualite * 60).toBeGreaterThan(40500);
    expect(mensualite).toBeGreaterThan(40500 / 60);
  });
});

describe("computeComptant", () => {
  it("coûte le prix TTC plus le coût d'opportunité du capital immobilisé", () => {
    const r = computeComptant({ prixTTC: 45000, dureeDetentionMois: 60, tauxOpportunite: 0.03 });
    expect(r.coutTotal).toBeCloseTo(45000 + 45000 * 0.03 * 5, 6);
    expect(r.devientProprietaire).toBe(true);
    // Pas d'option d'achat en comptant : loyerAnnuelMoyen === coût annualisé.
    expect(r.loyerAnnuelMoyen).toBeCloseTo(r.coutMensuelEquivalent * 12, 6);
  });
});

describe("computeCredit", () => {
  it("le coût total inclut l'apport et est supérieur au prix TTC (coût du crédit)", () => {
    const r = computeCredit({ prixTTC: 45000, apport: 4500, tauxAnnuel: 0.04, dureeMois: 60 });
    expect(r.coutTotal).toBeGreaterThan(45000);
    expect(r.devientProprietaire).toBe(true);
    expect(r.loyerAnnuelMoyen).toBeCloseTo(r.coutMensuelEquivalent * 12, 6);
  });

  it("un apport égal au prix TTC ne génère aucune mensualité", () => {
    const r = computeCredit({ prixTTC: 45000, apport: 45000, tauxAnnuel: 0.04, dureeMois: 60 });
    expect(r.coutTotal).toBeCloseTo(45000, 6);
  });
});

describe("computeLoa — régression : l'option d'achat ne doit pas gonfler le loyer annuel moyen", () => {
  const base = {
    prixTTC: 45000,
    premierLoyerMajore: 9000,
    loyerMensuel: 810,
    dureeMois: 48,
    valeurOptionAchat: 15750,
  };

  it("sans levée d'option : coût total et loyer annuel moyen sont identiques", () => {
    const r = computeLoa({ ...base, leveeOption: false });
    expect(r.coutTotal).toBeCloseTo(9000 + 810 * 48, 6);
    expect(r.loyerAnnuelMoyen).toBeCloseTo(r.coutMensuelEquivalent * 12, 6);
    expect(r.devientProprietaire).toBe(false);
  });

  it("avec levée d'option : le coût total (cash) intègre l'option, mais PAS le loyer annuel moyen (base AEN)", () => {
    const avecOption = computeLoa({ ...base, leveeOption: true });
    const sansOption = computeLoa({ ...base, leveeOption: false });

    // Le coût total réellement décaissé augmente bien de la valeur de l'option.
    expect(avecOption.coutTotal).toBeCloseTo(sansOption.coutTotal + base.valeurOptionAchat, 6);

    // Le loyer annuel moyen (utilisé pour la base légale de l'AEN, méthode réelle véhicule loué à
    // 30% — BOI-RSA-BASE-30-50-30) ne doit PAS inclure l'option d'achat : c'est un achat de
    // capital, pas un loyer. Il doit donc rester identique, que l'option soit levée ou non.
    expect(avecOption.loyerAnnuelMoyen).toBeCloseTo(sansOption.loyerAnnuelMoyen, 6);
    expect(avecOption.loyerAnnuelMoyen).toBeCloseTo((base.premierLoyerMajore + base.loyerMensuel * base.dureeMois) / 4, 6);

    // En revanche coutMensuelEquivalent (coût cash réel) doit bien être plus élevé avec l'option.
    expect(avecOption.coutMensuelEquivalent).toBeGreaterThan(sansOption.coutMensuelEquivalent);
    expect(avecOption.devientProprietaire).toBe(true);
  });
});

describe("computeLld", () => {
  it("n'a jamais d'option d'achat : loyerAnnuelMoyen === coût annualisé", () => {
    const r = computeLld({
      premierLoyer: 0,
      loyerMensuel: 990,
      dureeMois: 48,
      kmInclusAnnuel: 15000,
      kmReelAnnuel: 15000,
      coutKmSupplementaire: 0.08,
    });
    expect(r.loyerAnnuelMoyen).toBeCloseTo(r.coutMensuelEquivalent * 12, 6);
    expect(r.devientProprietaire).toBe(false);
  });

  it("facture le dépassement kilométrique au-delà du forfait inclus", () => {
    const sansDepassement = computeLld({
      premierLoyer: 0,
      loyerMensuel: 990,
      dureeMois: 12,
      kmInclusAnnuel: 15000,
      kmReelAnnuel: 15000,
      coutKmSupplementaire: 0.08,
    });
    const avecDepassement = computeLld({
      premierLoyer: 0,
      loyerMensuel: 990,
      dureeMois: 12,
      kmInclusAnnuel: 15000,
      kmReelAnnuel: 20000,
      coutKmSupplementaire: 0.08,
    });
    expect(avecDepassement.coutTotal).toBeCloseTo(sansDepassement.coutTotal + 5000 * 0.08, 6);
  });

  it("ne facture rien si le kilométrage réel est inférieur au forfait inclus", () => {
    const r = computeLld({
      premierLoyer: 0,
      loyerMensuel: 990,
      dureeMois: 12,
      kmInclusAnnuel: 15000,
      kmReelAnnuel: 10000,
      coutKmSupplementaire: 0.08,
    });
    expect(r.detail.kmDepassement).toBe(0);
    expect(r.detail.coutDepassement).toBe(0);
  });
});

describe("createDefaultFinancingInputs", () => {
  it("initialise les 4 modes avec le prix TTC fourni et l'option LOA levée par défaut", () => {
    const inputs = createDefaultFinancingInputs(45000);
    expect(inputs.comptant.prixTTC).toBe(45000);
    expect(inputs.credit.prixTTC).toBe(45000);
    expect(inputs.loa.prixTTC).toBe(45000);
    expect(inputs.loa.leveeOption).toBe(true);
  });

  it("reprend l'offre LOA réelle Tesla Model Y au prix de référence (45 000€)", () => {
    const inputs = createDefaultFinancingInputs(45000);
    expect(inputs.loa.loyerMensuel).toBe(308);
    expect(inputs.loa.dureeMois).toBe(36);
    expect(inputs.loa.premierLoyerMajore).toBe(9320);
    expect(inputs.loa.valeurOptionAchat).toBe(25804);
  });

  it("revient à une estimation générique (% du prix) pour un autre prix de véhicule", () => {
    const inputs = createDefaultFinancingInputs(60000);
    expect(inputs.loa.loyerMensuel).not.toBe(308);
    expect(inputs.loa.dureeMois).toBe(48);
    expect(inputs.loa.premierLoyerMajore).toBeCloseTo(60000 * 0.2, 6);
  });
});

describe("getTauxUsureApplicable", () => {
  it("applique la tranche correspondant au montant emprunté", () => {
    expect(getTauxUsureApplicable(2000)).toBeCloseTo(0.2356, 6);
    expect(getTauxUsureApplicable(3000)).toBeCloseTo(0.2356, 6);
    expect(getTauxUsureApplicable(3001)).toBeCloseTo(0.1587, 6);
    expect(getTauxUsureApplicable(6000)).toBeCloseTo(0.1587, 6);
    expect(getTauxUsureApplicable(6001)).toBeCloseTo(0.0856, 6);
    expect(getTauxUsureApplicable(100000)).toBeCloseTo(0.0856, 6);
  });
});
