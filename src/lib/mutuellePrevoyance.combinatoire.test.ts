// Balayage combinatoire du simulateur mutuelle & prévoyance.
//
// Les tests unitaires vérifient des situations choisies ; celui-ci vérifie que rien ne casse sur
// AUCUNE combinaison d'entrées. Le moteur croise deux statuts aux règles entièrement distinctes,
// deux plafonds, un caractère obligatoire ou facultatif et deux taux de prise en charge : c'est le
// genre de branchement où une combinaison oubliée passe inaperçue pendant longtemps.
//
// Chaque combinaison est confrontée aux invariants ci-dessous — des propriétés qui doivent tenir
// quelles que soient les entrées, par opposition à des valeurs attendues cas par cas.

import { describe, expect, it, vi } from "vitest";
import {
  type MutuellePrevoyanceInputs,
  EXONERATION_COLLECTIVE_PLAFOND_MAX_TAUX_PASS,
  MADELIN_PLAFOND_MAX_MULTIPLE_PASS,
  MADELIN_PLAFOND_MAX_TAUX_PASS,
  TAUX_CSG_CRDS_PART_PATRONALE,
  TAUX_FORFAIT_SOCIAL_PREVOYANCE,
  computeMutuellePrevoyance,
  createDefaultMutuellePrevoyanceInputs,
} from "./mutuellePrevoyance";
import { PASS_2026 } from "./pass";

vi.setConfig({ testTimeout: 60_000 });

const AXES = {
  companyType: ["EURL", "SASU"],
  priseEnChargeParLaSociete: [true, false],
  couvertureConjoint: [true, false],
  nombreEnfantsCouverts: [0, 3],
  extensionFamilleObligatoire: [true, false],
  partPatronalePourcent: [50, 100],
  partPatronaleFamillePourcent: [0, 50, 100],
  effectifAuMoins11Salaries: [true, false],
  impositionSociete: ["IS", "IR"] as const,
  cotisationAnnuelle: [0, 1200, 20000],
  salaireBrutAnnuelReference: [20000, 300000],
} satisfies Record<string, readonly unknown[]>;

/** Produit cartésien de tous les axes, sous forme de patches applicables aux entrées par défaut. */
function combinaisons(): Partial<MutuellePrevoyanceInputs>[] {
  let acc: Record<string, unknown>[] = [{}];
  for (const [cle, valeurs] of Object.entries(AXES)) {
    acc = acc.flatMap((base) => valeurs.map((v) => ({ ...base, [cle]: v })));
  }
  return acc as Partial<MutuellePrevoyanceInputs>[];
}

const COMBINAISONS = combinaisons();

function entrees(patch: Partial<MutuellePrevoyanceInputs>): MutuellePrevoyanceInputs {
  const defauts = createDefaultMutuellePrevoyanceInputs();
  return {
    ...defauts,
    // Taux marginal fixé : les invariants portent sur la structure du calcul, pas sur le barème.
    personalTaxProfile: { ...defauts.personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    surcoutConjointAnnuel: 800,
    surcoutParEnfantAnnuel: 300,
    beneficeAvantChargePrevisionnel: 60000,
    ...patch,
  };
}

describe("computeMutuellePrevoyance — invariants sur toutes les combinaisons d'entrées", () => {
  it(`couvre ${COMBINAISONS.length} combinaisons`, () => {
    expect(COMBINAISONS.length).toBe(
      Object.values(AXES).reduce((produit, valeurs) => produit * valeurs.length, 1),
    );
    expect(COMBINAISONS.length).toBeGreaterThan(1000);
  });

  it("aucune combinaison ne produit de valeur non finie", () => {
    for (const patch of COMBINAISONS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      for (const [cle, valeur] of Object.entries(r)) {
        if (typeof valeur !== "number") continue;
        expect(Number.isFinite(valeur), `${cle} = ${valeur} pour ${JSON.stringify(patch)}`).toBe(true);
      }
    }
  });

  it("aucun montant n'est négatif — un coût ou une assiette ne peut pas l'être", () => {
    // Seule exception admise : l'économie vs contrat individuel, qui est un écart et peut être
    // négative lorsque le passage par la société coûte plus cher qu'un contrat souscrit en direct.
    for (const patch of COMBINAISONS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      for (const [cle, valeur] of Object.entries(r)) {
        if (typeof valeur !== "number") continue;
        if (cle === "economieVsContratIndividuel" || cle === "tauxEconomieGlobal") continue;
        expect(valeur, `${cle} = ${valeur} pour ${JSON.stringify(patch)}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("la cotisation totale est toujours la somme du dirigeant et de la famille", () => {
    for (const patch of COMBINAISONS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.cotisationTotale, JSON.stringify(patch)).toBeCloseTo(
        r.cotisationDirigeantSeul + r.cotisationFamille,
        6,
      );
      expect(r.nombrePersonnesCouvertes).toBeGreaterThanOrEqual(1);
    }
  });

  it("le coût net global est toujours la somme des deux poches", () => {
    for (const patch of COMBINAISONS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.coutNetGlobal, JSON.stringify(patch)).toBeCloseTo(r.coutNetSociete + r.coutNetDirigeant, 6);
    }
  });

  it("l'économie vs contrat individuel est toujours l'écart avec la cotisation totale", () => {
    for (const patch of COMBINAISONS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.coutContratIndividuelEquivalent).toBeCloseTo(r.cotisationTotale, 6);
      expect(r.economieVsContratIndividuel, JSON.stringify(patch)).toBeCloseTo(
        r.cotisationTotale - r.coutNetGlobal,
        6,
      );
    }
  });

  it("le taux d'économie global est cohérent avec le coût net, et nul si la cotisation l'est", () => {
    for (const patch of COMBINAISONS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      if (r.cotisationTotale === 0) {
        expect(r.tauxEconomieGlobal, JSON.stringify(patch)).toBe(0);
        expect(r.coutNetGlobal).toBe(0);
      } else {
        expect(r.tauxEconomieGlobal, JSON.stringify(patch)).toBeCloseTo(1 - r.coutNetGlobal / r.cotisationTotale, 6);
      }
    }
  });

  it("le statut du dirigeant est celui de sa forme juridique, et les deux blocs de résultats s'excluent", () => {
    for (const patch of COMBINAISONS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      const cle = JSON.stringify(patch);
      if (patch.companyType === "EURL") {
        expect(r.dirigeantStatus, cle).toBe("TNS");
        // Aucune notion de part patronale, de plafond collectif ni de charges associées.
        expect(r.partPatronale).toBe(0);
        expect(r.plafondExonerationSociale).toBe(0);
        expect(r.csgCrdsSurPartPatronale).toBe(0);
        expect(r.forfaitSocial).toBe(0);
        expect(r.montantExcedentaire).toBe(0);
      } else {
        expect(r.dirigeantStatus, cle).toBe("ASSIMILE_SALARIE");
        expect(r.plafondMadelin).toBe(0);
        expect(r.cotisationDeductibleTNS).toBe(0);
        expect(r.cotisationNonDeductibleTNS).toBe(0);
      }
    }
  });
});

describe("invariants — TNS (Madelin)", () => {
  const casTNS = COMBINAISONS.filter((p) => p.companyType === "EURL");

  it("déductible + non déductible = cotisation totale, ayants droit compris", () => {
    for (const patch of casTNS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.cotisationDeductibleTNS + r.cotisationNonDeductibleTNS, JSON.stringify(patch)).toBeCloseTo(
        r.cotisationTotale,
        6,
      );
    }
  });

  it("la déduction ne dépasse jamais le plafond, lui-même borné par le plafond absolu", () => {
    const plafondAbsolu = MADELIN_PLAFOND_MAX_TAUX_PASS * MADELIN_PLAFOND_MAX_MULTIPLE_PASS * PASS_2026;
    for (const patch of casTNS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.cotisationDeductibleTNS).toBeLessThanOrEqual(r.plafondMadelin + 1e-9);
      expect(r.plafondMadelin).toBeLessThanOrEqual(plafondAbsolu + 1e-9);
    }
  });

  it("le plafond ne dépend jamais du périmètre couvert : c'est une enveloppe unique", () => {
    for (const patch of casTNS) {
      const avec = computeMutuellePrevoyance(entrees(patch));
      const sans = computeMutuellePrevoyance(
        entrees({ ...patch, couvertureConjoint: false, nombreEnfantsCouverts: 0 }),
      );
      expect(avec.plafondMadelin, JSON.stringify(patch)).toBeCloseTo(sans.plafondMadelin, 6);
    }
  });

  it("un seul payeur supporte le coût : jamais les deux à la fois", () => {
    for (const patch of casTNS) {
      const r = computeMutuellePrevoyance(entrees(patch));
      const cle = JSON.stringify(patch);
      if (patch.priseEnChargeParLaSociete) {
        expect(r.coutNetDirigeant, cle).toBe(0);
        expect(r.economieImpotDirigeant, cle).toBe(0);
      } else {
        expect(r.coutNetSociete, cle).toBe(0);
        expect(r.economieImpotSociete, cle).toBe(0);
      }
    }
  });

  it("couvrir la famille ne réduit jamais la cotisation ni le coût net", () => {
    for (const patch of casTNS) {
      const avec = computeMutuellePrevoyance(entrees({ ...patch, couvertureConjoint: true, nombreEnfantsCouverts: 3 }));
      const sans = computeMutuellePrevoyance(
        entrees({ ...patch, couvertureConjoint: false, nombreEnfantsCouverts: 0 }),
      );
      expect(avec.cotisationTotale, JSON.stringify(patch)).toBeGreaterThanOrEqual(sans.cotisationTotale);
      expect(avec.coutNetGlobal).toBeGreaterThanOrEqual(sans.coutNetGlobal - 1e-9);
    }
  });
});

describe("invariants — assimilé salarié (régime collectif)", () => {
  const casSalarie = COMBINAISONS.filter((p) => p.companyType === "SASU");

  it("part patronale + part salariale = cotisation totale", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.partPatronale + r.partSalariale, JSON.stringify(patch)).toBeCloseTo(r.cotisationTotale, 6);
      expect(r.partPatronale).toBeCloseTo(r.partPatronaleDirigeant + r.partPatronaleFamille, 6);
    }
  });

  it("le plafond ne dépasse jamais 12 % du PASS", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.plafondExonerationSociale).toBeLessThanOrEqual(
        EXONERATION_COLLECTIVE_PLAFOND_MAX_TAUX_PASS * PASS_2026 + 1e-9,
      );
    }
  });

  it("le montant réintégré est la somme du dépassement de plafond et de la famille assujettie", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.montantExcedentaire, JSON.stringify(patch)).toBeCloseTo(
        r.excedentPlafond + r.partFamilleAssujettie,
        6,
      );
    }
  });

  it("exonéré + dépassement = part patronale éligible, et l'exonéré ne dépasse jamais le plafond", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      const eligible = patch.extensionFamilleObligatoire ? r.partPatronale : r.partPatronaleDirigeant;
      expect(r.montantExonere + r.excedentPlafond, JSON.stringify(patch)).toBeCloseTo(eligible, 6);
      expect(r.montantExonere).toBeLessThanOrEqual(r.plafondExonerationSociale + 1e-9);
    }
  });

  it("une extension obligatoire n'assujettit jamais la famille ; une extension facultative l'assujettit toujours", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      const cle = JSON.stringify(patch);
      if (patch.extensionFamilleObligatoire) {
        expect(r.partFamilleAssujettie, cle).toBe(0);
      } else {
        expect(r.partFamilleAssujettie, cle).toBeCloseTo(r.partPatronaleFamille, 6);
      }
    }
  });

  it("la CSG/CRDS suit exactement la part patronale exonérée", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.csgCrdsSurPartPatronale, JSON.stringify(patch)).toBeCloseTo(
        r.montantExonere * TAUX_CSG_CRDS_PART_PATRONALE,
        6,
      );
    }
  });

  it("le forfait social n'existe qu'au-delà du seuil d'effectif", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      const attendu = patch.effectifAuMoins11Salaries ? r.montantExonere * TAUX_FORFAIT_SOCIAL_PREVOYANCE : 0;
      expect(r.forfaitSocial, JSON.stringify(patch)).toBeCloseTo(attendu, 6);
    }
  });

  it("franchir le seuil d'effectif ne peut qu'alourdir le coût société", () => {
    for (const patch of casSalarie) {
      const petite = computeMutuellePrevoyance(entrees({ ...patch, effectifAuMoins11Salaries: false }));
      const grande = computeMutuellePrevoyance(entrees({ ...patch, effectifAuMoins11Salaries: true }));
      expect(grande.coutNetSociete, JSON.stringify(patch)).toBeGreaterThanOrEqual(petite.coutNetSociete - 1e-9);
    }
  });

  it("rendre l'affiliation des ayants droit obligatoire ne peut jamais coûter plus cher", () => {
    for (const patch of casSalarie) {
      const facultative = computeMutuellePrevoyance(entrees({ ...patch, extensionFamilleObligatoire: false }));
      const obligatoire = computeMutuellePrevoyance(entrees({ ...patch, extensionFamilleObligatoire: true }));
      expect(obligatoire.coutNetGlobal, JSON.stringify(patch)).toBeLessThanOrEqual(facultative.coutNetGlobal + 1e-9);
    }
  });

  it("sans ayant droit couvert, le caractère obligatoire n'a aucun effet", () => {
    for (const patch of casSalarie) {
      const base = { ...patch, couvertureConjoint: false, nombreEnfantsCouverts: 0 };
      const a = computeMutuellePrevoyance(entrees({ ...base, extensionFamilleObligatoire: false }));
      const b = computeMutuellePrevoyance(entrees({ ...base, extensionFamilleObligatoire: true }));
      expect(a.coutNetGlobal, JSON.stringify(patch)).toBeCloseTo(b.coutNetGlobal, 6);
    }
  });

  it("la charge déduite par la société couvre la part patronale et les charges qu'elle déclenche", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      const chargeDeductible = r.partPatronale + r.forfaitSocial + r.chargesPatronalesReintegration;
      // Le coût net société est cette charge diminuée de l'économie d'impôt qu'elle procure.
      expect(r.coutNetSociete, JSON.stringify(patch)).toBeCloseTo(chargeDeductible - r.economieImpotSociete, 6);
      expect(r.economieImpotSociete).toBeLessThanOrEqual(chargeDeductible + 1e-9);
    }
  });

  it("le coût dirigeant réunit sa part, la CSG/CRDS et le prix de la réintégration", () => {
    for (const patch of casSalarie) {
      const r = computeMutuellePrevoyance(entrees(patch));
      expect(r.coutNetDirigeant, JSON.stringify(patch)).toBeCloseTo(
        r.partSalariale + r.csgCrdsSurPartPatronale + r.chargesSalarialesReintegration + r.irSurExcedent,
        6,
      );
    }
  });

  it("augmenter la prise en charge patronale déplace le coût sans le faire disparaître", () => {
    for (const patch of casSalarie) {
      const bas = computeMutuellePrevoyance(entrees({ ...patch, partPatronaleFamillePourcent: 0 }));
      const haut = computeMutuellePrevoyance(entrees({ ...patch, partPatronaleFamillePourcent: 100 }));
      const cle = JSON.stringify(patch);
      expect(haut.partSalariale, cle).toBeLessThanOrEqual(bas.partSalariale + 1e-9);
      expect(haut.partPatronale, cle).toBeGreaterThanOrEqual(bas.partPatronale - 1e-9);
    }
  });
});
