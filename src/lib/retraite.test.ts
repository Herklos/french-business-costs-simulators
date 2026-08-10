import { describe, expect, it } from "vitest";
import {
  PFU_TAUX_GAINS,
  type RetraiteInputs,
  computeRetraite,
  createDefaultRetraiteInputs,
  tauxConversionRenteViagere,
} from "./retraite";
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

  it("versement nul (TNS) : tous les résultats à zéro", () => {
    const r = computeRetraite(withCompany("EURL", { versementAnnuel: 0 }));
    expect(r.coutNetGlobal).toBe(0);
    expect(r.tauxEconomieGlobal).toBe(0);
  });

  it("versement nul (assimilé salarié) : tous les résultats à zéro", () => {
    const r = computeRetraite(withCompany("SASU", { versementAnnuel: 0 }));
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

describe("computeRetraite — régime IR (société translucide, TNS)", () => {
  it("utilise le taux marginal manuel du foyer plutôt que le barème IS", () => {
    const inputs = withCompany("EURL", {
      impositionSociete: "IR",
      versementAnnuel: 3000,
      personalTaxProfile: { ...createDefaultRetraiteInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    });
    const r = computeRetraite(inputs);
    expect(r.economieImpotSociete).toBeCloseTo(r.versementDeductible * 0.3, 6);
  });

  it("le taux réduit PME et le bénéfice prévisionnel sont sans effet en régime IR", () => {
    const base = withCompany("EURL", {
      impositionSociete: "IR",
      versementAnnuel: 3000,
      personalTaxProfile: { ...createDefaultRetraiteInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    });
    const avecReduit = computeRetraite({ ...base, eligibleTauxReduitPME: true });
    const sansReduit = computeRetraite({ ...base, eligibleTauxReduitPME: false });
    expect(avecReduit.economieImpotSociete).toBeCloseTo(sansReduit.economieImpotSociete, 6);
  });
});

describe("computeRetraite — report des plafonds non utilisés des 3 années précédentes", () => {
  it("sans report, le plafond avec report égale le plafond de base", () => {
    const r = computeRetraite(withCompany("EURL", { plafondNonUtiliseAnneesPrecedentes: 0 }));
    expect(r.plafondDeductionAvecReport).toBeCloseTo(r.plafondDeduction, 6);
    expect(r.versementDeductibleAvecReport).toBeCloseTo(r.versementDeductible, 6);
    expect(r.economieSupplementaireGraceAuReport).toBeCloseTo(0, 6);
  });

  it("le report augmente le plafond déductible d'autant (TNS)", () => {
    const r = computeRetraite(
      withCompany("EURL", { versementAnnuel: 100000, beneficeAvantChargePrevisionnel: 40000, plafondNonUtiliseAnneesPrecedentes: 5000 }),
    );
    expect(r.plafondDeductionAvecReport).toBeCloseTo(r.plafondDeduction + 5000, 6);
    expect(r.versementDeductibleAvecReport).toBeGreaterThan(r.versementDeductible);
    expect(r.economieSupplementaireGraceAuReport).toBeGreaterThan(0);
  });

  it("le report augmente le plafond déductible d'autant (assimilé salarié)", () => {
    const r = computeRetraite(
      withCompany("SASU", { versementAnnuel: 100000, revenuNetImposableN1: 40000, plafondNonUtiliseAnneesPrecedentes: 3000 }),
    );
    expect(r.plafondDeductionAvecReport).toBeCloseTo(r.plafondDeduction + 3000, 6);
    expect(r.economieSupplementaireGraceAuReport).toBeGreaterThan(0);
  });

  it("le report est sans effet si le versement était déjà sous le plafond de base", () => {
    const r = computeRetraite(withCompany("EURL", { versementAnnuel: 500, plafondNonUtiliseAnneesPrecedentes: 10000 }));
    expect(r.versementDeductibleAvecReport).toBeCloseTo(r.versementDeductible, 6);
    expect(r.economieSupplementaireGraceAuReport).toBeCloseTo(0, 6);
  });
});

describe("computeRetraite — projection du capital", () => {
  it("aucune projection si l'âge de départ est déjà atteint", () => {
    const r = computeRetraite(withCompany("EURL", { ageActuel: 64, ageDepartRetraite: 64 }));
    expect(r.dureeProjectionAnnees).toBe(0);
    expect(r.projectionCapital).toHaveLength(0);
    expect(r.capitalBrutFinalProjete).toBe(0);
  });

  it("sans rendement, le capital final = somme des versements", () => {
    const r = computeRetraite(
      withCompany("EURL", { versementAnnuel: 2000, ageActuel: 50, ageDepartRetraite: 55, tauxRendementAnnuelProjection: 0 }),
    );
    expect(r.dureeProjectionAnnees).toBe(5);
    expect(r.versementsCumulesFinal).toBeCloseTo(10000, 6);
    expect(r.capitalBrutFinalProjete).toBeCloseTo(10000, 6);
    expect(r.plusValueLatenteFinale).toBeCloseTo(0, 6);
  });

  it("avec rendement positif, le capital final dépasse les versements cumulés", () => {
    const r = computeRetraite(
      withCompany("EURL", { versementAnnuel: 2000, ageActuel: 50, ageDepartRetraite: 60, tauxRendementAnnuelProjection: 0.03 }),
    );
    expect(r.capitalBrutFinalProjete).toBeGreaterThan(r.versementsCumulesFinal);
    expect(r.plusValueLatenteFinale).toBeCloseTo(r.capitalBrutFinalProjete - r.versementsCumulesFinal, 6);
  });

  it("la série projectionCapital est croissante en âge et en versements cumulés", () => {
    const r = computeRetraite(
      withCompany("EURL", { versementAnnuel: 1000, ageActuel: 40, ageDepartRetraite: 45, tauxRendementAnnuelProjection: 0.02 }),
    );
    expect(r.projectionCapital).toHaveLength(5);
    expect(r.projectionCapital[0].age).toBe(41);
    expect(r.projectionCapital.at(-1)?.age).toBe(45);
    for (let i = 1; i < r.projectionCapital.length; i++) {
      expect(r.projectionCapital[i].versementsCumules).toBeGreaterThan(r.projectionCapital[i - 1].versementsCumules);
      expect(r.projectionCapital[i].capitalBrut).toBeGreaterThan(r.projectionCapital[i - 1].capitalBrut);
    }
  });
});

describe("computeRetraite — comparaison PER vs assurance-vie", () => {
  it("sans plus-value, PER et assurance-vie ont le même capital net (rien à taxer)", () => {
    const r = computeRetraite(
      withCompany("EURL", { versementAnnuel: 2000, ageActuel: 50, ageDepartRetraite: 55, tauxRendementAnnuelProjection: 0 }),
    );
    expect(r.comparaisonAssuranceVie.perCapitalNetApresImpot).toBeLessThan(r.comparaisonAssuranceVie.assuranceVieCapitalNetApresImpot + 0.01);
    expect(r.comparaisonAssuranceVie.assuranceVieCapitalNetApresImpot).toBeCloseTo(r.capitalBrutFinalProjete, 6);
  });

  it("le PER re-taxe le capital versé au TMI, l'assurance-vie ne re-taxe que la plus-value au PFU", () => {
    const r = computeRetraite(
      withCompany("SASU", {
        versementAnnuel: 5000,
        ageActuel: 40,
        ageDepartRetraite: 60,
        tauxRendementAnnuelProjection: 0.04,
        personalTaxProfile: { ...createDefaultRetraiteInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.41 },
      }),
    );
    const attenduPER =
      r.capitalBrutFinalProjete - r.versementsCumulesFinal * 0.41 - r.plusValueLatenteFinale * PFU_TAUX_GAINS;
    const attenduAV = r.capitalBrutFinalProjete - r.plusValueLatenteFinale * PFU_TAUX_GAINS;
    expect(r.comparaisonAssuranceVie.perCapitalNetApresImpot).toBeCloseTo(attenduPER, 6);
    expect(r.comparaisonAssuranceVie.assuranceVieCapitalNetApresImpot).toBeCloseTo(attenduAV, 6);
    expect(r.comparaisonAssuranceVie.ecartEnFaveurPER).toBeCloseTo(attenduPER - attenduAV, 6);
  });
});

describe("tauxConversionRenteViagere — table indicative par âge", () => {
  it("retourne le taux le plus bas en-deçà du premier palier", () => {
    expect(tauxConversionRenteViagere(50)).toBeCloseTo(0.035, 6);
  });

  it("retourne le taux du palier exact et croît avec l'âge", () => {
    expect(tauxConversionRenteViagere(65)).toBeCloseTo(0.043, 6);
    expect(tauxConversionRenteViagere(75)).toBeCloseTo(0.062, 6);
    expect(tauxConversionRenteViagere(90)).toBeCloseTo(0.062, 6);
    expect(tauxConversionRenteViagere(70)).toBeGreaterThan(tauxConversionRenteViagere(65));
  });
});

describe("computeRetraite — estimation de rente viagère", () => {
  it("la rente annuelle = capital final × taux de conversion à l'âge de départ", () => {
    const r = computeRetraite(
      withCompany("EURL", { versementAnnuel: 3000, ageActuel: 50, ageDepartRetraite: 65, tauxRendementAnnuelProjection: 0.02 }),
    );
    expect(r.renteViagereTauxConversion).toBeCloseTo(0.043, 6);
    expect(r.renteViagereAnnuelleEstimee).toBeCloseTo(r.capitalBrutFinalProjete * 0.043, 6);
    expect(r.renteViagereMensuelleEstimee).toBeCloseTo(r.renteViagereAnnuelleEstimee / 12, 6);
  });

  it("capital final nul (versement nul) : rente nulle", () => {
    const r = computeRetraite(withCompany("EURL", { versementAnnuel: 0 }));
    expect(r.renteViagereAnnuelleEstimee).toBe(0);
    expect(r.renteViagereMensuelleEstimee).toBe(0);
  });
});
