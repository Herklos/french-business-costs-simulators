import { describe, expect, it } from "vitest";
import {
  type HomeOfficeInputs,
  chargeLinesDeReference,
  computeHomeOffice,
  createDefaultHomeOfficeInputs,
} from "./homeOffice";
import { montantReferenceCharge } from "./logementCharges";
import { prixM2Ville } from "./loyersVille";

function disableCharge(inputs: HomeOfficeInputs, id: string): HomeOfficeInputs {
  return { ...inputs, chargeLines: inputs.chargeLines.map((c) => (c.id === id ? { ...c, enabled: false } : c)) };
}

describe("computeHomeOffice — quote-part et charges", () => {
  it("la quote-part de surface est bornée à 100% même si le bureau dépasse le logement", () => {
    const inputs = { ...createDefaultHomeOfficeInputs(), surfaceTotaleM2: 50, surfaceBureauM2: 80 };
    const r = computeHomeOffice(inputs);
    expect(r.quotePartSurface).toBe(1);
  });

  it("surface totale nulle : quote-part nulle (division par zéro évitée)", () => {
    const inputs = { ...createDefaultHomeOfficeInputs(), surfaceTotaleM2: 0, surfaceBureauM2: 12 };
    const r = computeHomeOffice(inputs);
    expect(r.quotePartSurface).toBe(0);
    expect(r.indemniteAnnuelleBrute).toBe(0);
  });

  it("désactiver un poste de charge réduit l'indemnité annuelle brute", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const avecTout = computeHomeOffice(inputs);
    const sansElectricite = computeHomeOffice(disableCharge(inputs, "electricite"));
    expect(sansElectricite.indemniteAnnuelleBrute).toBeLessThan(avecTout.indemniteAnnuelleBrute);
  });

  it("désactiver toutes les charges donne une indemnité nulle", () => {
    let inputs = createDefaultHomeOfficeInputs();
    for (const c of inputs.chargeLines) {
      inputs = disableCharge(inputs, c.id);
    }
    const r = computeHomeOffice(inputs);
    expect(r.indemniteAnnuelleBrute).toBe(0);
    expect(r.totalChargesRetenuesAnnuel).toBe(0);
  });

  it("l'indemnité brute = charges retenues × quote-part de surface", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const r = computeHomeOffice(inputs);
    expect(r.indemniteAnnuelleBrute).toBeCloseTo(r.totalChargesRetenuesAnnuel * r.quotePartSurface, 6);
  });
});

describe("computeHomeOffice — loyer calculé depuis le prix au m² de la ville", () => {
  const base: HomeOfficeInputs = {
    ...createDefaultHomeOfficeInputs(),
    surfaceTotaleM2: 80,
    surfaceBureauM2: 12,
    loyerMarcheM2Mensuel: 16,
    loyerAutoDepuisPrixM2: true,
  };

  it("la ligne « loyer » porte la valeur locative du logement entier : prix au m² × surface totale × 12", () => {
    const r = computeHomeOffice(base);
    expect(r.loyerAnnuelLogementRetenu).toBeCloseTo(16 * 80 * 12, 6);
    expect(r.chargeLinesEffectives.find((c) => c.id === "loyer")?.montantAnnuel).toBeCloseTo(16 * 80 * 12, 6);
  });

  it("après quote-part, la part imputée au bureau vaut prix au m² × surface du BUREAU × 12", () => {
    const r = computeHomeOffice(base);
    expect(r.loyerAnnuelBureauRetenu).toBeCloseTo(16 * 12 * 12, 6);
  });

  it("la proratisation n'est pas appliquée deux fois au loyer", () => {
    const r = computeHomeOffice(base);
    // Le piège serait d'appliquer le prix au m² à la surface du bureau PUIS la quote-part :
    // on obtiendrait 16 × 12 × 12 × (12/80), soit huit fois moins.
    expect(r.loyerAnnuelBureauRetenu).not.toBeCloseTo(16 * 12 * 12 * (12 / 80), 6);
    expect(r.loyerAnnuelBureauRetenu / r.loyerAnnuelLogementRetenu).toBeCloseTo(r.quotePartSurface, 6);
  });

  it("le loyer imputé au bureau ne dépend pas de la surface totale du logement", () => {
    const petit = computeHomeOffice({ ...base, surfaceTotaleM2: 50 });
    const grand = computeHomeOffice({ ...base, surfaceTotaleM2: 150 });
    expect(petit.loyerAnnuelBureauRetenu).toBeCloseTo(grand.loyerAnnuelBureauRetenu, 6);
  });

  it("le loyer imputé au bureau est proportionnel à la surface du bureau", () => {
    const r1 = computeHomeOffice({ ...base, surfaceBureauM2: 10 });
    const r2 = computeHomeOffice({ ...base, surfaceBureauM2: 20 });
    expect(r2.loyerAnnuelBureauRetenu).toBeCloseTo(2 * r1.loyerAnnuelBureauRetenu, 6);
  });

  it("un prix au m² plus élevé augmente l'indemnité brute", () => {
    const parisien = computeHomeOffice({ ...base, loyerMarcheM2Mensuel: 32 });
    const lyonnais = computeHomeOffice({ ...base, loyerMarcheM2Mensuel: 16 });
    expect(parisien.indemniteAnnuelleBrute).toBeGreaterThan(lyonnais.indemniteAnnuelleBrute);
    expect(parisien.indemniteAnnuelleBrute - lyonnais.indemniteAnnuelleBrute).toBeCloseTo(16 * 12 * 12, 6);
  });

  it("en mode manuel, le montant saisi sur la ligne « loyer » est repris tel quel", () => {
    const manuel: HomeOfficeInputs = {
      ...base,
      loyerAutoDepuisPrixM2: false,
      chargeLines: base.chargeLines.map((c) => (c.id === "loyer" ? { ...c, montantAnnuel: 9000 } : c)),
    };
    const r = computeHomeOffice(manuel);
    expect(r.loyerAnnuelLogementRetenu).toBe(9000);
    expect(r.loyerAnnuelBureauRetenu).toBeCloseTo(9000 * r.quotePartSurface, 6);
  });

  it("en mode automatique, le montant saisi est ignoré mais conservé dans les entrées", () => {
    const inputs: HomeOfficeInputs = {
      ...base,
      chargeLines: base.chargeLines.map((c) => (c.id === "loyer" ? { ...c, montantAnnuel: 999999 } : c)),
    };
    const r = computeHomeOffice(inputs);
    expect(r.loyerAnnuelLogementRetenu).toBeCloseTo(16 * 80 * 12, 6);
    expect(inputs.chargeLines.find((c) => c.id === "loyer")?.montantAnnuel).toBe(999999);
  });

  it("désactiver la ligne « loyer » la sort de l'indemnité sans effacer sa valeur de marché", () => {
    const sansLoyer = computeHomeOffice({
      ...base,
      chargeLines: base.chargeLines.map((c) => (c.id === "loyer" ? { ...c, enabled: false } : c)),
    });
    const avecLoyer = computeHomeOffice(base);
    expect(sansLoyer.loyerAnnuelLogementRetenu).toBeCloseTo(avecLoyer.loyerAnnuelLogementRetenu, 6);
    expect(avecLoyer.indemniteAnnuelleBrute - sansLoyer.indemniteAnnuelleBrute).toBeCloseTo(
      avecLoyer.loyerAnnuelBureauRetenu,
      6,
    );
  });

  it("un prix au m² négatif ne produit pas de loyer négatif", () => {
    const r = computeHomeOffice({ ...base, loyerMarcheM2Mensuel: -20 });
    expect(r.loyerAnnuelLogementRetenu).toBe(0);
    expect(r.indemniteAnnuelleBrute).toBeGreaterThanOrEqual(0);
  });
});

describe("createDefaultHomeOfficeInputs — placeholders alignés sur les références", () => {
  it("le prix au m² par défaut correspond à la ville par défaut", () => {
    const inputs = createDefaultHomeOfficeInputs();
    expect(inputs.loyerMarcheM2Mensuel).toBe(prixM2Ville(inputs.ville));
  });

  it("chaque poste de charge est pré-rempli à sa valeur de référence", () => {
    const inputs = createDefaultHomeOfficeInputs();
    for (const ligne of inputs.chargeLines) {
      const reference = montantReferenceCharge(ligne.id, inputs.surfaceTotaleM2, inputs.statutOccupant);
      if (reference === undefined) continue; // le loyer, calculé depuis le prix au m²
      expect(ligne.montantAnnuel).toBe(reference);
    }
  });
});

describe("chargeLinesDeReference", () => {
  it("réaligne les montants sur les références sans toucher aux cases cochées", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const modifiees = inputs.chargeLines.map((c) => ({ ...c, montantAnnuel: 1, enabled: c.id === "eau" }));
    const realignees = chargeLinesDeReference(inputs.surfaceTotaleM2, inputs.statutOccupant, modifiees);
    for (const ligne of realignees) {
      expect(ligne.enabled).toBe(ligne.id === "eau");
      const reference = montantReferenceCharge(ligne.id, inputs.surfaceTotaleM2, inputs.statutOccupant);
      expect(ligne.montantAnnuel).toBe(reference ?? 1);
    }
  });

  it("passer de propriétaire à locataire annule la taxe foncière", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const locataire = chargeLinesDeReference(inputs.surfaceTotaleM2, "locataire", inputs.chargeLines);
    expect(locataire.find((c) => c.id === "taxeFonciere")?.montantAnnuel).toBe(0);
  });

  it("une surface plus grande augmente les postes proportionnels à la surface", () => {
    const inputs = createDefaultHomeOfficeInputs();
    const petit = chargeLinesDeReference(40, "proprietaire", inputs.chargeLines);
    const grand = chargeLinesDeReference(120, "proprietaire", inputs.chargeLines);
    const chauffagePetit = petit.find((c) => c.id === "chauffage")?.montantAnnuel ?? 0;
    const chauffageGrand = grand.find((c) => c.id === "chauffage")?.montantAnnuel ?? 0;
    expect(chauffageGrand).toBeCloseTo(3 * chauffagePetit, 0);
    // ...mais laisse inchangés les postes forfaitaires.
    expect(petit.find((c) => c.id === "eau")?.montantAnnuel).toBe(grand.find((c) => c.id === "eau")?.montantAnnuel);
  });
});

describe("computeHomeOffice — régime micro-foncier / réel", () => {
  it("bascule automatiquement en régime réel si le plafond micro-foncier (15 000€) est dépassé", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      regimeFoncier: "micro",
      autresRevenusFonciersFoyer: 20000, // dépasse déjà le plafond à lui seul
    };
    const r = computeHomeOffice(inputs);
    expect(r.eligibleMicroFoncier).toBe(false);
  });

  it("le régime micro-foncier applique un abattement de 30% sur l'indemnité brute", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      regimeFoncier: "micro",
      autresRevenusFonciersFoyer: 0,
    };
    const r = computeHomeOffice(inputs);
    expect(r.abattementApplique).toBeCloseTo(r.indemniteAnnuelleBrute * 0.3, 6);
    expect(r.baseImposableFonciere).toBeCloseTo(r.indemniteAnnuelleBrute * 0.7, 6);
  });
});

describe("computeHomeOffice — formalisation bail professionnel", () => {
  it("les frais de mise en place n'affectent que le gain net de la 1ère année, pas le gain récurrent", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      formalisation: "bail_professionnel",
      fraisMiseEnPlaceBail: 500,
    };
    const r = computeHomeOffice(inputs);
    expect(r.gainNetGerantAnnee1).toBeCloseTo(r.gainNetGerant - 500, 6);
  });

  it("les frais de mise en place sont ignorés si la formalisation est une simple indemnité", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      formalisation: "indemnite",
      fraisMiseEnPlaceBail: 500,
    };
    const r = computeHomeOffice(inputs);
    expect(r.gainNetGerantAnnee1).toBeCloseTo(r.gainNetGerant, 6);
  });
});

describe("computeHomeOffice — régime IS et bénéfice prévisionnel", () => {
  it("une société déficitaire (régime IS) ne génère aucune économie d'impôt immédiate", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IS",
      beneficeAvantChargePrevisionnel: 0,
    };
    const r = computeHomeOffice(inputs);
    expect(r.economieImpotSociete).toBe(0);
  });

  it("coût net société = indemnité brute − économie d'impôt", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetSociete).toBeCloseTo(r.indemniteAnnuelleBrute - r.economieImpotSociete, 6);
  });
});

describe("computeHomeOffice — coût net global (société + dirigeant ensemble)", () => {
  it("coutNetGlobal = coût fiscal dirigeant − économie d'impôt société", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetGlobal).toBeCloseTo(r.coutFiscalGerant - r.economieImpotSociete, 6);
  });

  it("coutNetGlobal = coutNetSociete − gainNetGerant (les deux formulations coïncident)", () => {
    const r = computeHomeOffice(createDefaultHomeOfficeInputs());
    expect(r.coutNetGlobal).toBeCloseTo(r.coutNetSociete - r.gainNetGerant, 6);
  });

  it("indemnité nulle : coût net global nul", () => {
    let inputs = createDefaultHomeOfficeInputs();
    for (const c of inputs.chargeLines) {
      inputs = disableCharge(inputs, c.id);
    }
    const r = computeHomeOffice(inputs);
    expect(r.coutNetGlobal).toBe(0);
  });
});

describe("computeHomeOffice — comparaison bureau externe : bail classique vs coworking", () => {
  it("régime location : coût annuel = loyer mensuel × 12", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "location",
      loyerBureauExterneMensuel: 400,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(4800, 6);
  });

  it("régime coworking : coût annuel = tarif journalier × jours/mois × 12", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "coworking",
      coworkingTarifJournalier: 25,
      coworkingJoursParMois: 20,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(25 * 20 * 12, 6);
  });

  it("le champ loyer mensuel est ignoré en mode coworking", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      typeComparaisonExterne: "coworking",
      loyerBureauExterneMensuel: 999999,
      coworkingTarifJournalier: 25,
      coworkingJoursParMois: 20,
    };
    expect(computeHomeOffice(inputs).coutBureauExterneAnnuel).toBeCloseTo(25 * 20 * 12, 6);
  });
});

describe("computeHomeOffice — régime IR (société translucide)", () => {
  it("utilise le taux marginal manuel du foyer plutôt que le barème IS pour l'économie société", () => {
    const inputs: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IR",
      beneficeAvantChargePrevisionnel: 40000,
      personalTaxProfile: { ...createDefaultHomeOfficeInputs().personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    };
    const r = computeHomeOffice(inputs);
    expect(r.economieImpotSociete).toBeCloseTo(r.indemniteAnnuelleBrute * 0.3, 6);
  });

  it("en régime IR, le bénéfice prévisionnel de la société s'ajoute au revenu du foyer pour le calcul du TMI", () => {
    const base: HomeOfficeInputs = {
      ...createDefaultHomeOfficeInputs(),
      impositionSociete: "IR",
      personalTaxProfile: { ...createDefaultHomeOfficeInputs().personalTaxProfile, mode: "calcule" },
    };
    const faibleBenefice = computeHomeOffice({ ...base, beneficeAvantChargePrevisionnel: 5000 });
    const fortBenefice = computeHomeOffice({ ...base, beneficeAvantChargePrevisionnel: 200000 });
    expect(fortBenefice.tauxIRUtilise).toBeGreaterThan(faibleBenefice.tauxIRUtilise);
  });
});
