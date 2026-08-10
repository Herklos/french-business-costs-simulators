import { describe, expect, it } from "vitest";
import {
  type RemunerationInputs,
  PFU_TAUX_GLOBAL,
  SEUIL_DIVIDENDES_TNS_RATIO,
  computeRemuneration,
  createDefaultRemunerationInputs,
} from "./remuneration";

function withCompany(companyType: string, patch: Partial<RemunerationInputs> = {}): RemunerationInputs {
  return { ...createDefaultRemunerationInputs(), companyType, ...patch };
}

describe("computeRemuneration — cohérence générale", () => {
  it("le coût total entreprise est identique quel que soit le scénario (comparaison à budget égal)", () => {
    const r = computeRemuneration(createDefaultRemunerationInputs());
    for (const s of r.scenarios) {
      expect(s.coutTotalEntreprise).toBeCloseTo(createDefaultRemunerationInputs().budgetAnnuelDisponible, 6);
    }
  });

  it("100% salaire : aucun bénéfice soumis à l'IS, aucun dividende", () => {
    const r = computeRemuneration(createDefaultRemunerationInputs());
    expect(r.scenarioSalaire.beneficeSoumisIS).toBeCloseTo(0, 6);
    expect(r.scenarioSalaire.dividendeBrutDistribuable).toBeCloseTo(0, 6);
    expect(r.scenarioSalaire.salaireBrutAnnuel).toBeGreaterThan(0);
  });

  it("100% dividendes : aucun salaire, tout le budget passe par l'IS avant distribution", () => {
    const r = computeRemuneration(createDefaultRemunerationInputs());
    expect(r.scenarioDividendes.salaireBrutAnnuel).toBeCloseTo(0, 6);
    expect(r.scenarioDividendes.coutSalaireEntreprise).toBeCloseTo(0, 6);
    expect(r.scenarioDividendes.beneficeSoumisIS).toBeCloseTo(createDefaultRemunerationInputs().budgetAnnuelDisponible, 6);
    expect(r.scenarioDividendes.isDue).toBeGreaterThan(0);
    expect(r.scenarioDividendes.dividendeBrutDistribuable).toBeCloseTo(
      r.scenarioDividendes.beneficeSoumisIS - r.scenarioDividendes.isDue,
      6,
    );
  });

  it("mixte : le net total est bien salaire net + dividende net", () => {
    const r = computeRemuneration(createDefaultRemunerationInputs());
    expect(r.scenarioMixte.netTotalAnnuel).toBeCloseTo(
      r.scenarioMixte.salaireNetApresImpotAnnuel + r.scenarioMixte.dividendeNetAnnuel,
      6,
    );
    expect(r.scenarioMixte.netTotalMensuel).toBeCloseTo(r.scenarioMixte.netTotalAnnuel / 12, 6);
  });

  it("le meilleur scénario a bien le net total annuel le plus élevé des 3", () => {
    const r = computeRemuneration(createDefaultRemunerationInputs());
    const maxNet = Math.max(...r.scenarios.map((s) => s.netTotalAnnuel));
    expect(r.meilleurScenario.netTotalAnnuel).toBeCloseTo(maxNet, 6);
  });
});

describe("computeRemuneration — coût pour 1€ net perçu", () => {
  it("coutPour1EuroNet = coût total entreprise / net total annuel", () => {
    const r = computeRemuneration(createDefaultRemunerationInputs());
    for (const s of r.scenarios) {
      expect(s.coutPour1EuroNet).toBeCloseTo(s.coutTotalEntreprise / s.netTotalAnnuel, 6);
    }
  });

  it("le meilleur scénario (net le plus élevé) a aussi le coût pour 1€ net le plus bas — à budget égal, les deux classements coïncident", () => {
    const r = computeRemuneration(createDefaultRemunerationInputs());
    const minCout = Math.min(...r.scenarios.map((s) => s.coutPour1EuroNet));
    expect(r.meilleurScenario.coutPour1EuroNet).toBeCloseTo(minCout, 6);
  });

  it("coutPour1EuroNet vaut Infinity si le net du scénario est nul", () => {
    // Budget nul : aucun net dans aucun scénario.
    const r = computeRemuneration(withCompany("EURL", { budgetAnnuelDisponible: 0 }));
    for (const s of r.scenarios) {
      expect(s.coutPour1EuroNet).toBe(Infinity);
    }
  });
});

describe("computeRemuneration — statut du dirigeant selon la forme juridique", () => {
  it("EURL : statut TNS, cotisations calculées sur le net", () => {
    const r = computeRemuneration(withCompany("EURL"));
    expect(r.dirigeantStatus).toBe("TNS");
    expect(r.scenarioSalaire.cotisationsTNS).toBeGreaterThan(0);
    expect(r.scenarioSalaire.cotisationsPatronales).toBeCloseTo(0, 6);
    expect(r.scenarioSalaire.cotisationsSalariales).toBeCloseTo(0, 6);
  });

  it("SASU : statut assimilé salarié, charges patronales + salariales sur le brut", () => {
    const r = computeRemuneration(withCompany("SASU"));
    expect(r.dirigeantStatus).toBe("ASSIMILE_SALARIE");
    expect(r.scenarioSalaire.cotisationsPatronales).toBeGreaterThan(0);
    expect(r.scenarioSalaire.cotisationsSalariales).toBeGreaterThan(0);
    expect(r.scenarioSalaire.cotisationsTNS).toBeCloseTo(0, 6);
  });

  it("SARL gérant majoritaire = TNS, gérant minoritaire = assimilé salarié", () => {
    const majoritaire = computeRemuneration(withCompany("SARL", { gerantMajoritaire: true }));
    const minoritaire = computeRemuneration(withCompany("SARL", { gerantMajoritaire: false }));
    expect(majoritaire.dirigeantStatus).toBe("TNS");
    expect(minoritaire.dirigeantStatus).toBe("ASSIMILE_SALARIE");
  });
});

describe("computeRemuneration — seuil des 10% sur les dividendes TNS (art. L131-6 CSS)", () => {
  it("SASU : aucun seuil, aucune cotisation sociale sur les dividendes quel que soit leur montant", () => {
    const r = computeRemuneration(withCompany("SASU", { budgetAnnuelDisponible: 200000, capitalSocial: 1 }));
    expect(r.seuilDividendesTNS).toBe(Infinity);
    expect(r.scenarioDividendes.cotisationsTNSSurDividendeExcedentaire).toBeCloseTo(0, 6);
    expect(r.scenarioDividendes.dividendeAuDessusSeuilTNS).toBeCloseTo(0, 6);
  });

  it("EURL, capital social faible : la quasi-totalité des dividendes dépasse le seuil de 10% et supporte des cotisations TNS", () => {
    const r = computeRemuneration(withCompany("EURL", { budgetAnnuelDisponible: 200000, capitalSocial: 1000, primesEmissionEtCCA: 0 }));
    expect(r.seuilDividendesTNS).toBeCloseTo(SEUIL_DIVIDENDES_TNS_RATIO * 1000, 6);
    expect(r.scenarioDividendes.dividendeAuDessusSeuilTNS).toBeGreaterThan(0);
    expect(r.scenarioDividendes.cotisationsTNSSurDividendeExcedentaire).toBeGreaterThan(0);
  });

  it("EURL, capital social élevé : les dividendes restent sous le seuil, pas de cotisations TNS", () => {
    const r = computeRemuneration(withCompany("EURL", { budgetAnnuelDisponible: 20000, capitalSocial: 1_000_000 }));
    expect(r.scenarioDividendes.dividendeAuDessusSeuilTNS).toBeCloseTo(0, 6);
    expect(r.scenarioDividendes.cotisationsTNSSurDividendeExcedentaire).toBeCloseTo(0, 6);
  });

  it("l'excédent au-delà du seuil ne subit pas les prélèvements sociaux de 17,2% (remplacés par les cotisations TNS)", () => {
    const r = computeRemuneration(withCompany("EURL", { budgetAnnuelDisponible: 200000, capitalSocial: 1000 }));
    const s = r.scenarioDividendes;
    expect(s.prelevementsSociauxSurDividendes).toBeCloseTo(s.dividendeSousSeuilTNS * 0.172, 6);
  });
});

describe("computeRemuneration — PFU sur les dividendes", () => {
  it("sans option barème, l'IR + PS sur la fraction sous le seuil correspond au taux global du PFU (30%)", () => {
    const r = computeRemuneration(withCompany("SASU", { budgetAnnuelDisponible: 60000, optionBaremeProgressifDividendes: false }));
    const s = r.scenarioDividendes;
    const irEtPsSurDividendes = s.irSurDividendes + s.prelevementsSociauxSurDividendes;
    expect(irEtPsSurDividendes).toBeCloseTo(s.dividendeBrutDistribuable * PFU_TAUX_GLOBAL, 6);
  });
});

describe("computeRemuneration — export/texte", () => {
  it("createDefaultRemunerationInputs retourne des valeurs cohérentes et un identifiant unique", () => {
    const a = createDefaultRemunerationInputs();
    const b = createDefaultRemunerationInputs();
    expect(a.id).not.toBe(b.id);
    expect(a.companyType).toBe("EURL");
    expect(a.modeRemuneration).toBe("mixte");
  });
});

describe("computeRemuneration — régime IR (société translucide)", () => {
  it("aucun IS n'est dû sur le bénéfice affecté aux dividendes", () => {
    const r = computeRemuneration(withCompany("EURL", { impositionSociete: "IR", budgetAnnuelDisponible: 60000 }));
    expect(r.scenarioDividendes.isDue).toBe(0);
    expect(r.scenarioDividendes.dividendeBrutDistribuable).toBeCloseTo(r.scenarioDividendes.beneficeSoumisIS, 6);
  });

  it("un budget plus élevé pousse le TMI du foyer plus haut (bénéfice intégré au revenu imposable) — prélèvement marginal croissant", () => {
    const petit = computeRemuneration(withCompany("EURL", { impositionSociete: "IR", budgetAnnuelDisponible: 10000 }));
    const grand = computeRemuneration(withCompany("EURL", { impositionSociete: "IR", budgetAnnuelDisponible: 200000 }));
    expect(grand.scenarioDividendes.tauxPrelevementGlobal).toBeGreaterThan(petit.scenarioDividendes.tauxPrelevementGlobal);
  });
});
