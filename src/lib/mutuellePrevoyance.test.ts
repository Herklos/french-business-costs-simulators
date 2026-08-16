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

/** Régime IR translucide au taux marginal de 30 % : chaque économie d'impôt vaut exactement 30 %
 *  de la charge, ce qui rend les montants vérifiables à la main sans dérouler le barème de l'IS. */
function casEcole(companyType: string, patch: Partial<MutuellePrevoyanceInputs> = {}): MutuellePrevoyanceInputs {
  const defauts = createDefaultMutuellePrevoyanceInputs();
  return {
    ...defauts,
    companyType,
    impositionSociete: "IR",
    personalTaxProfile: { ...defauts.personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    cotisationAnnuelle: 1200,
    couvertureConjoint: true,
    surcoutConjointAnnuel: 800,
    nombreEnfantsCouverts: 2,
    surcoutParEnfantAnnuel: 300,
    salaireBrutAnnuelReference: 45000,
    beneficeAvantChargePrevisionnel: 40000,
    ...patch,
  };
}

describe("computeMutuellePrevoyance — périmètre couvert (dirigeant, conjoint, enfants)", () => {
  it("le dirigeant seul compte pour une personne et pour sa seule cotisation", () => {
    const r = computeMutuellePrevoyance(withCompany("SASU", { cotisationAnnuelle: 1200 }));
    expect(r.nombrePersonnesCouvertes).toBe(1);
    expect(r.cotisationFamille).toBe(0);
    expect(r.cotisationTotale).toBeCloseTo(1200, 6);
  });

  it("le conjoint ajoute son surcoût et une personne", () => {
    const r = computeMutuellePrevoyance(
      withCompany("SASU", { cotisationAnnuelle: 1200, couvertureConjoint: true, surcoutConjointAnnuel: 800 }),
    );
    expect(r.nombrePersonnesCouvertes).toBe(2);
    expect(r.cotisationFamille).toBeCloseTo(800, 6);
    expect(r.cotisationTotale).toBeCloseTo(2000, 6);
  });

  it("les enfants sont facturés par tête", () => {
    const r = computeMutuellePrevoyance(
      withCompany("SASU", { cotisationAnnuelle: 1200, nombreEnfantsCouverts: 3, surcoutParEnfantAnnuel: 300 }),
    );
    expect(r.nombrePersonnesCouvertes).toBe(4);
    expect(r.cotisationFamille).toBeCloseTo(900, 6);
  });

  it("conjoint et enfants s'additionnent", () => {
    const r = computeMutuellePrevoyance(casEcole("SASU"));
    expect(r.nombrePersonnesCouvertes).toBe(4);
    expect(r.cotisationFamille).toBeCloseTo(1400, 6);
    expect(r.cotisationTotale).toBeCloseTo(2600, 6);
  });

  it("le surcoût conjoint est ignoré tant que le conjoint n'est pas couvert", () => {
    const r = computeMutuellePrevoyance(
      withCompany("SASU", { couvertureConjoint: false, surcoutConjointAnnuel: 5000 }),
    );
    expect(r.cotisationFamille).toBe(0);
  });

  it("un nombre d'enfants négatif ou fractionnaire est ramené à un entier positif", () => {
    expect(computeMutuellePrevoyance(withCompany("SASU", { nombreEnfantsCouverts: -3 })).cotisationFamille).toBe(0);
    const r = computeMutuellePrevoyance(
      withCompany("SASU", { nombreEnfantsCouverts: 2.7, surcoutParEnfantAnnuel: 100 }),
    );
    expect(r.cotisationFamille).toBeCloseTo(200, 6);
    expect(r.nombrePersonnesCouvertes).toBe(3);
  });

  it("des surcoûts négatifs saisis par erreur sont ramenés à zéro", () => {
    const r = computeMutuellePrevoyance(
      withCompany("SASU", {
        cotisationAnnuelle: -500,
        couvertureConjoint: true,
        surcoutConjointAnnuel: -800,
        nombreEnfantsCouverts: 2,
        surcoutParEnfantAnnuel: -100,
      }),
    );
    expect(r.cotisationTotale).toBe(0);
  });
});

describe("computeMutuellePrevoyance — TNS : ayants droit dans un plafond unique", () => {
  it("les cotisations de la famille sont déductibles au même titre que celles du dirigeant", () => {
    const r = computeMutuellePrevoyance(casEcole("EURL"));
    // Plafond : 7 % × 48 060 + 3,75 % × 40 000 = 3 364,20 + 1 500 = 4 864,20 €, au-dessus des 2 600 €.
    expect(r.plafondMadelin).toBeCloseTo(4864.2, 2);
    expect(r.cotisationDeductibleTNS).toBeCloseTo(2600, 6);
    expect(r.cotisationNonDeductibleTNS).toBeCloseTo(0, 6);
  });

  it("le plafond n'est pas relevé par personne couverte : il se sature plus vite", () => {
    const seul = computeMutuellePrevoyance(casEcole("EURL", { couvertureConjoint: false, nombreEnfantsCouverts: 0 }));
    const famille = computeMutuellePrevoyance(casEcole("EURL"));
    expect(famille.plafondMadelin).toBeCloseTo(seul.plafondMadelin, 6);
    expect(famille.cotisationTotale).toBeGreaterThan(seul.cotisationTotale);
  });

  it("une couverture familiale coûteuse déborde le plafond, et le débordement n'est plus déductible", () => {
    const r = computeMutuellePrevoyance(
      casEcole("EURL", { cotisationAnnuelle: 4000, surcoutConjointAnnuel: 1500, nombreEnfantsCouverts: 0 }),
    );
    expect(r.cotisationTotale).toBeCloseTo(5500, 6);
    expect(r.cotisationDeductibleTNS).toBeCloseTo(4864.2, 2);
    expect(r.cotisationNonDeductibleTNS).toBeCloseTo(635.8, 2);
  });

  it("le même contrat sans la famille tiendrait dans le plafond : c'est bien l'extension qui le fait déborder", () => {
    const seul = computeMutuellePrevoyance(
      casEcole("EURL", { cotisationAnnuelle: 4000, couvertureConjoint: false, nombreEnfantsCouverts: 0 }),
    );
    expect(seul.cotisationNonDeductibleTNS).toBeCloseTo(0, 6);
  });

  it("cas d'école : société payeuse, IR à 30 % — 2 600 € de cotisation coûtent 1 820 € nets", () => {
    const r = computeMutuellePrevoyance(casEcole("EURL", { priseEnChargeParLaSociete: true }));
    expect(r.economieImpotSociete).toBeCloseTo(780, 6); // 2 600 × 30 %
    expect(r.coutNetSociete).toBeCloseTo(1820, 6);
    expect(r.coutNetDirigeant).toBe(0);
    expect(r.coutNetGlobal).toBeCloseTo(1820, 6);
    expect(r.economieVsContratIndividuel).toBeCloseTo(780, 6);
  });

  it("aucune part patronale/salariale n'est calculée pour un TNS", () => {
    const r = computeMutuellePrevoyance(casEcole("EURL", { partPatronaleFamillePourcent: 100 }));
    expect(r.partPatronale).toBe(0);
    expect(r.partPatronaleFamille).toBe(0);
    expect(r.csgCrdsSurPartPatronale).toBe(0);
    expect(r.forfaitSocial).toBe(0);
  });
});

describe("computeMutuellePrevoyance — assimilé salarié : deux taux de prise en charge distincts", () => {
  it("le taux famille s'applique au seul surcoût famille, le taux dirigeant à sa seule cotisation", () => {
    const r = computeMutuellePrevoyance(
      casEcole("SASU", { partPatronalePourcent: 50, partPatronaleFamillePourcent: 100 }),
    );
    expect(r.partPatronaleDirigeant).toBeCloseTo(600, 6); // 1 200 × 50 %
    expect(r.partPatronaleFamille).toBeCloseTo(1400, 6); // 1 400 × 100 %
    expect(r.partPatronale).toBeCloseTo(2000, 6);
    expect(r.partSalariale).toBeCloseTo(600, 6);
  });

  it("100 % sur la famille est admis, comme 0 % : aucun minimum, aucun plafond", () => {
    for (const taux of [0, 25, 50, 100]) {
      const r = computeMutuellePrevoyance(casEcole("SASU", { partPatronaleFamillePourcent: taux }));
      expect(r.partPatronaleFamille, `${taux}%`).toBeCloseTo(1400 * (taux / 100), 6);
    }
  });

  it("un taux hors bornes est ramené dans [0, 100]", () => {
    expect(
      computeMutuellePrevoyance(casEcole("SASU", { partPatronaleFamillePourcent: 250 })).partPatronaleFamille,
    ).toBeCloseTo(1400, 6);
    expect(
      computeMutuellePrevoyance(casEcole("SASU", { partPatronaleFamillePourcent: -40 })).partPatronaleFamille,
    ).toBe(0);
  });

  it("part patronale + part salariale = cotisation totale, quels que soient les deux taux", () => {
    for (const dirigeant of [50, 75, 100]) {
      for (const famille of [0, 40, 100]) {
        const r = computeMutuellePrevoyance(
          casEcole("SASU", { partPatronalePourcent: dirigeant, partPatronaleFamillePourcent: famille }),
        );
        expect(r.partPatronale + r.partSalariale, `${dirigeant}/${famille}`).toBeCloseTo(r.cotisationTotale, 6);
      }
    }
  });
});

describe("computeMutuellePrevoyance — extension famille obligatoire ou facultative", () => {
  it("facultative : la part patronale famille est assujettie en totalité, sans consommer le plafond", () => {
    const r = computeMutuellePrevoyance(
      casEcole("SASU", { extensionFamilleObligatoire: false, partPatronaleFamillePourcent: 100 }),
    );
    expect(r.partFamilleAssujettie).toBeCloseTo(1400, 6);
    expect(r.excedentPlafond).toBeCloseTo(0, 6);
    expect(r.montantExcedentaire).toBeCloseTo(1400, 6);
    // Seule la part patronale du dirigeant a été confrontée au plafond.
    expect(r.montantExonere).toBeCloseTo(600, 6);
  });

  it("obligatoire : la part patronale famille rejoint l'exonération, dans le plafond commun", () => {
    const r = computeMutuellePrevoyance(
      casEcole("SASU", { extensionFamilleObligatoire: true, partPatronaleFamillePourcent: 100 }),
    );
    expect(r.partFamilleAssujettie).toBe(0);
    expect(r.montantExcedentaire).toBeCloseTo(0, 6);
    expect(r.montantExonere).toBeCloseTo(2000, 6);
  });

  it("obligatoire, mais au-delà du plafond : le dépassement seul est réintégré", () => {
    // Part patronale éligible = 6 000 + 4 000 = 10 000 €, plafond = 3 558,60 €.
    const r = computeMutuellePrevoyance(
      casEcole("SASU", {
        extensionFamilleObligatoire: true,
        cotisationAnnuelle: 6000,
        partPatronalePourcent: 100,
        surcoutConjointAnnuel: 4000,
        nombreEnfantsCouverts: 0,
        partPatronaleFamillePourcent: 100,
      }),
    );
    expect(r.plafondExonerationSociale).toBeCloseTo(3558.6, 2);
    expect(r.montantExonere).toBeCloseTo(3558.6, 2);
    expect(r.excedentPlafond).toBeCloseTo(6441.4, 2);
    expect(r.partFamilleAssujettie).toBe(0);
    expect(r.montantExcedentaire).toBeCloseTo(6441.4, 2);
  });

  it("le montant réintégré est toujours la somme de ses deux composantes", () => {
    for (const obligatoire of [true, false]) {
      for (const cotisation of [500, 3000, 20000]) {
        const r = computeMutuellePrevoyance(
          casEcole("SASU", { extensionFamilleObligatoire: obligatoire, cotisationAnnuelle: cotisation }),
        );
        expect(r.montantExcedentaire, `${obligatoire}/${cotisation}`).toBeCloseTo(
          r.excedentPlafond + r.partFamilleAssujettie,
          6,
        );
      }
    }
  });

  it("rendre l'affiliation obligatoire ne peut jamais coûter plus cher", () => {
    for (const taux of [0, 50, 100]) {
      const facultative = computeMutuellePrevoyance(
        casEcole("SASU", { extensionFamilleObligatoire: false, partPatronaleFamillePourcent: taux }),
      );
      const obligatoire = computeMutuellePrevoyance(
        casEcole("SASU", { extensionFamilleObligatoire: true, partPatronaleFamillePourcent: taux }),
      );
      expect(obligatoire.coutNetGlobal, `${taux}%`).toBeLessThanOrEqual(facultative.coutNetGlobal + 1e-9);
    }
  });

  it("sans famille couverte, le caractère obligatoire ou facultatif ne change rien", () => {
    const base = { couvertureConjoint: false, nombreEnfantsCouverts: 0 };
    const a = computeMutuellePrevoyance(casEcole("SASU", { ...base, extensionFamilleObligatoire: false }));
    const b = computeMutuellePrevoyance(casEcole("SASU", { ...base, extensionFamilleObligatoire: true }));
    expect(a.coutNetGlobal).toBeCloseTo(b.coutNetGlobal, 6);
  });
});

describe("computeMutuellePrevoyance — le plafond s'apprécie sur la part patronale, pas sur la cotisation", () => {
  it("une cotisation supérieure au plafond ne crée aucun excédent si la part patronale y reste", () => {
    // Cotisation 6 000 € > plafond 3 558,60 €, mais part patronale 50 % = 3 000 € < plafond.
    const r = computeMutuellePrevoyance(
      casEcole("SASU", {
        cotisationAnnuelle: 6000,
        couvertureConjoint: false,
        nombreEnfantsCouverts: 0,
        partPatronalePourcent: 50,
      }),
    );
    expect(r.cotisationTotale).toBeCloseTo(6000, 6);
    expect(r.plafondExonerationSociale).toBeCloseTo(3558.6, 2);
    expect(r.partPatronale).toBeCloseTo(3000, 6);
    expect(r.montantExcedentaire).toBeCloseTo(0, 6);
  });

  it("la même cotisation intégralement patronale, elle, déborde", () => {
    const r = computeMutuellePrevoyance(
      casEcole("SASU", {
        cotisationAnnuelle: 6000,
        couvertureConjoint: false,
        nombreEnfantsCouverts: 0,
        partPatronalePourcent: 100,
      }),
    );
    expect(r.excedentPlafond).toBeCloseTo(6000 - 3558.6, 2);
  });

  it("exonéré + dépassement = part patronale soumise au plafond", () => {
    for (const cotisation of [500, 3000, 12000]) {
      for (const taux of [50, 100]) {
        const r = computeMutuellePrevoyance(
          casEcole("SASU", { cotisationAnnuelle: cotisation, partPatronalePourcent: taux, extensionFamilleObligatoire: true }),
        );
        expect(r.montantExonere + r.excedentPlafond, `${cotisation}/${taux}`).toBeCloseTo(r.partPatronale, 6);
      }
    }
  });

  it("le plafond absolu de 12 % du PASS s'applique aux très hauts salaires", () => {
    const r = computeMutuellePrevoyance(casEcole("SASU", { salaireBrutAnnuelReference: 500000 }));
    expect(r.plafondExonerationSociale).toBeCloseTo(0.12 * PASS_2026, 6);
  });
});

describe("computeMutuellePrevoyance — ce que la fraction exonérée coûte quand même", () => {
  it("la CSG/CRDS frappe la part patronale exonérée à 9,7 %, sans abattement", () => {
    const r = computeMutuellePrevoyance(
      casEcole("SASU", { extensionFamilleObligatoire: true, partPatronaleFamillePourcent: 100 }),
    );
    expect(r.montantExonere).toBeCloseTo(2000, 6);
    expect(r.csgCrdsSurPartPatronale).toBeCloseTo(194, 6); // 2 000 × 9,7 %
  });

  it("le forfait social est nul en dessous de 11 salariés, et de 8 % au-delà", () => {
    const petite = computeMutuellePrevoyance(casEcole("SASU", { effectifAuMoins11Salaries: false }));
    expect(petite.forfaitSocial).toBe(0);
    const grande = computeMutuellePrevoyance(casEcole("SASU", { effectifAuMoins11Salaries: true }));
    expect(grande.forfaitSocial).toBeCloseTo(grande.montantExonere * 0.08, 6);
    expect(grande.coutNetSociete).toBeGreaterThan(petite.coutNetSociete);
  });

  it("la fraction réintégrée supporte des charges des deux côtés, plus l'impôt sur le revenu", () => {
    const r = computeMutuellePrevoyance(
      casEcole("SASU", { extensionFamilleObligatoire: false, partPatronaleFamillePourcent: 100 }),
    );
    expect(r.montantExcedentaire).toBeCloseTo(1400, 6);
    expect(r.chargesPatronalesReintegration).toBeCloseTo(588, 6); // 1 400 × 42 %
    expect(r.chargesSalarialesReintegration).toBeCloseTo(308, 6); // 1 400 × 22 %
    expect(r.irSurExcedent).toBeCloseTo(420, 6); // 1 400 × 30 %
  });

  it("les charges patronales de réintégration sont déductibles du résultat société", () => {
    const r = computeMutuellePrevoyance(
      casEcole("SASU", { extensionFamilleObligatoire: false, partPatronaleFamillePourcent: 100 }),
    );
    // Base déductible = part patronale 2 000 + charges patronales 588 = 2 588 €, économie 30 %.
    expect(r.economieImpotSociete).toBeCloseTo(776.4, 6);
    expect(r.coutNetSociete).toBeCloseTo(1811.6, 6);
  });
});

describe("computeMutuellePrevoyance — cas d'école : ce que l'acte fondateur change vraiment", () => {
  const facultative = () =>
    computeMutuellePrevoyance(
      casEcole("SASU", { extensionFamilleObligatoire: false, partPatronaleFamillePourcent: 100 }),
    );
  const obligatoire = () =>
    computeMutuellePrevoyance(
      casEcole("SASU", { extensionFamilleObligatoire: true, partPatronaleFamillePourcent: 100 }),
    );

  it("extension facultative financée à 100 % : 3 197,80 € pour 2 600 € de cotisation", () => {
    const r = facultative();
    expect(r.coutNetSociete).toBeCloseTo(1811.6, 6);
    expect(r.coutNetDirigeant).toBeCloseTo(1386.2, 6); // 600 + 58,20 + 308 + 420
    expect(r.coutNetGlobal).toBeCloseTo(3197.8, 6);
  });

  it("financer une extension facultative coûte plus cher qu'un contrat individuel", () => {
    const r = facultative();
    expect(r.coutContratIndividuelEquivalent).toBeCloseTo(2600, 6);
    expect(r.economieVsContratIndividuel).toBeCloseTo(-597.8, 6);
    expect(r.tauxEconomieGlobal).toBeLessThan(0);
  });

  it("la même extension rendue obligatoire : 2 194 €, et l'économie redevient positive", () => {
    const r = obligatoire();
    expect(r.coutNetSociete).toBeCloseTo(1400, 6); // 2 000 − 30 %
    expect(r.coutNetDirigeant).toBeCloseTo(794, 6); // 600 + 194
    expect(r.coutNetGlobal).toBeCloseTo(2194, 6);
    expect(r.economieVsContratIndividuel).toBeCloseTo(406, 6);
  });

  it("l'écart entre les deux rédactions de l'acte fondateur vaut 1 003,80 € par an", () => {
    expect(facultative().coutNetGlobal - obligatoire().coutNetGlobal).toBeCloseTo(1003.8, 6);
  });
});

describe("computeMutuellePrevoyance — économie vs contrat individuel", () => {
  it("la référence est le prix plein de la même couverture, famille comprise", () => {
    const r = computeMutuellePrevoyance(casEcole("EURL"));
    expect(r.coutContratIndividuelEquivalent).toBeCloseTo(r.cotisationTotale, 6);
  });

  it("elle est cohérente avec le coût net global", () => {
    for (const type of ["EURL", "SASU"]) {
      const r = computeMutuellePrevoyance(casEcole(type));
      expect(r.economieVsContratIndividuel, type).toBeCloseTo(r.cotisationTotale - r.coutNetGlobal, 6);
    }
  });

  it("un TNS déduit toujours quelque chose, donc gagne toujours au passage par le cadre professionnel", () => {
    const r = computeMutuellePrevoyance(casEcole("EURL"));
    expect(r.economieVsContratIndividuel).toBeGreaterThan(0);
  });

  it("cotisation nulle : aucune économie, aucun coût, aucun taux aberrant", () => {
    const r = computeMutuellePrevoyance(
      casEcole("SASU", { cotisationAnnuelle: 0, couvertureConjoint: false, nombreEnfantsCouverts: 0 }),
    );
    expect(r.cotisationTotale).toBe(0);
    expect(r.coutNetGlobal).toBe(0);
    expect(r.economieVsContratIndividuel).toBe(0);
    expect(r.tauxEconomieGlobal).toBe(0);
  });
});
