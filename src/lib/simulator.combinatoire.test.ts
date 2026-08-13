// Suite combinatoire : plutôt que de vérifier des cas isolés, on balaie le produit cartésien des
// principaux réglages et on assène sur CHAQUE combinaison un jeu d'invariants qui doivent tenir
// quelles que soient les options. C'est ce type de test croisé qui manquait : les bugs corrigés
// (double déduction de la participation, TVA accordée sans contrepartie, flux ponctuel hors
// comparatif) violaient tous un invariant simple, mais aucun test ne le formulait explicitement.

import { describe, expect, it } from "vitest";
import { type FinancingMode } from "./financing";
import {
  type ParticipationVersementMode,
  type SimulationInputs,
  ALL_FINANCING_MODES,
  PARTICIPATION_VERSEMENT_MODES,
  computeSimulation,
  createDefaultInputs,
} from "./simulator";

/** Axes balayés. Volontairement resserrés à ce qui interagit réellement dans le moteur. */
const AXES = {
  financingMode: ALL_FINANCING_MODES,
  modeVersement: PARTICIPATION_VERSEMENT_MODES,
  participation: [0, 60, 531],
  tva: [false, true],
  compensation: [false, true],
  leveeOption: [false, true],
  usagePrive: [0, 50, 100],
  electrique: [false, true],
};

interface Combinaison {
  financingMode: FinancingMode;
  modeVersement: ParticipationVersementMode;
  participation: number;
  tva: boolean;
  compensation: boolean;
  leveeOption: boolean;
  usagePrive: number;
  electrique: boolean;
}

function construire(c: Combinaison): SimulationInputs {
  const base = createDefaultInputs();
  return {
    ...base,
    financingMode: c.financingMode,
    personalFinancingMode: c.financingMode,
    modeVersementParticipation: c.modeVersement,
    monthlyParticipation: c.participation,
    tvaRecuperableVehicule: c.tva,
    compenserParticipationParAugmentationSalaire: c.compensation,
    privateUsePercent: c.usagePrive,
    isElectric: c.electrique,
    isEcoScoreEligible: c.electrique,
    co2EmissionsGkm: c.electrique ? 0 : 120,
    annualFuelPrivateCost: c.electrique ? 0 : 800,
    financing: { ...base.financing, loa: { ...base.financing.loa, leveeOption: c.leveeOption } },
  };
}

/** Produit cartésien complet des axes ci-dessus. */
function toutesLesCombinaisons(): Combinaison[] {
  const out: Combinaison[] = [];
  for (const financingMode of AXES.financingMode)
    for (const modeVersement of AXES.modeVersement)
      for (const participation of AXES.participation)
        for (const tva of AXES.tva)
          for (const compensation of AXES.compensation)
            for (const leveeOption of AXES.leveeOption)
              for (const usagePrive of AXES.usagePrive)
                for (const electrique of AXES.electrique)
                  out.push({
                    financingMode,
                    modeVersement,
                    participation,
                    tva,
                    compensation,
                    leveeOption,
                    usagePrive,
                    electrique,
                  });
  return out;
}

const COMBINAISONS = toutesLesCombinaisons();
const nom = (c: Combinaison) =>
  `${c.financingMode}/${c.modeVersement}/part=${c.participation}/tva=${c.tva}/comp=${c.compensation}/levee=${c.leveeOption}/privé=${c.usagePrive}%/élec=${c.electrique}`;

describe("balayage combinatoire — invariants du moteur", () => {
  it(`couvre ${COMBINAISONS.length} combinaisons`, () => {
    expect(COMBINAISONS.length).toBe(
      AXES.financingMode.length *
        AXES.modeVersement.length *
        AXES.participation.length *
        AXES.tva.length *
        AXES.compensation.length *
        AXES.leveeOption.length *
        AXES.usagePrive.length *
        AXES.electrique.length,
    );
  });

  it("ne produit jamais de valeur non finie", () => {
    for (const c of COMBINAISONS) {
      const r = computeSimulation(construire(c));
      for (const [cle, valeur] of Object.entries(r)) {
        if (typeof valeur === "number") {
          expect(Number.isFinite(valeur), `${cle} non fini sur ${nom(c)}`).toBe(true);
        }
      }
      for (const o of r.allOptions) {
        expect(Number.isFinite(o.globalCostAnnual), `coût global non fini sur ${nom(c)}`).toBe(true);
        for (const d of o.detail) {
          expect(Number.isFinite(d.value), `détail « ${d.label} » non fini sur ${nom(c)}`).toBe(true);
        }
      }
    }
  });

  it("respecte partSociete + partDirigeant = coût global sur chaque option", () => {
    for (const c of COMBINAISONS) {
      for (const o of computeSimulation(construire(c)).allOptions) {
        expect(o.partSociete + o.partDirigeant, `${o.label} sur ${nom(c)}`).toBeCloseTo(o.globalCostAnnual, 6);
      }
    }
  });

  it("produit toujours exactement 8 options, sans doublon", () => {
    for (const c of COMBINAISONS) {
      const options = computeSimulation(construire(c)).allOptions;
      expect(options).toHaveLength(8);
      expect(new Set(options.map((o) => `${o.owner}-${o.mode}`)).size, nom(c)).toBe(8);
    }
  });

  it("retient comme meilleure option celle dont le coût global est minimal", () => {
    for (const c of COMBINAISONS) {
      const r = computeSimulation(construire(c));
      expect(r.bestOption.globalCostAnnual, nom(c)).toBeCloseTo(
        Math.min(...r.allOptions.map((o) => o.globalCostAnnual)),
        6,
      );
    }
  });

  it("maintient l'AEN net et ses prélèvements positifs ou nuls", () => {
    for (const c of COMBINAISONS) {
      const r = computeSimulation(construire(c));
      expect(r.aenNet, nom(c)).toBeGreaterThanOrEqual(0);
      expect(r.cotisationsTNS, nom(c)).toBeGreaterThanOrEqual(0);
      expect(r.irEstimee, nom(c)).toBeGreaterThanOrEqual(0);
      expect(r.aenNet, nom(c)).toBeLessThanOrEqual(r.aenNetBeforeParticipation + 1e-9);
    }
  });
});

describe("balayage combinatoire — participation et modalités", () => {
  // C'EST L'INVARIANT QUI MANQUAIT. Un sacrifice unique ne peut être retranché qu'une fois de
  // l'assiette du dirigeant : soit sur l'AEN (versement prélevé sur des ressources nettes), soit sur
  // la rémunération elle-même (réduction du brut) — jamais sur les deux.
  it("n'impute la participation sur l'AEN que pour les modalités prélevées sur ressources nettes", () => {
    for (const c of COMBINAISONS.filter((x) => x.participation > 0)) {
      const r = computeSimulation(construire(c));
      if (c.modeVersement === "retenue_brute") {
        expect(r.participationReduitAen, nom(c)).toBe(false);
        expect(r.aenNet, `AEN amputé malgré une réduction de brut sur ${nom(c)}`).toBeCloseTo(
          r.aenNetBeforeParticipation,
          6,
        );
      } else {
        expect(r.participationReduitAen, nom(c)).toBe(true);
        expect(r.aenNet, nom(c)).toBeCloseTo(Math.max(0, r.aenNetBeforeParticipation - r.participationAnnual), 6);
      }
    }
  });

  it("ne facture jamais de coût de participation en l'absence de versement", () => {
    for (const c of COMBINAISONS.filter((x) => x.participation === 0)) {
      const r = computeSimulation(construire(c));
      expect(r.participationAnnual, nom(c)).toBe(0);
      expect(r.coutParticipationDirigeant, nom(c)).toBe(0);
      expect(r.impotSurParticipation, nom(c)).toBe(0);
      expect(r.participationNetteSociete, nom(c)).toBe(0);
      expect(r.augmentationBruteParticipation, nom(c)).toBe(0);
      expect(r.coutNetAugmentationParticipation, nom(c)).toBe(0);
      expect(r.economieModeVersementOptimal, nom(c)).toBe(0);
    }
  });

  it("rend la modalité de versement sans effet lorsqu'aucune participation n'est versée", () => {
    for (const c of COMBINAISONS.filter((x) => x.participation === 0 && x.modeVersement === "retenue_nette")) {
      const reference = computeSimulation(construire(c)).globalCostSociete;
      for (const m of PARTICIPATION_VERSEMENT_MODES) {
        const variante = computeSimulation(construire({ ...c, modeVersement: m })).globalCostSociete;
        expect(variante, `${m} sur ${nom(c)}`).toBeCloseTo(reference, 9);
      }
    }
  });

  it("désigne toujours la modalité qui minimise réellement la charge du dirigeant", () => {
    for (const c of COMBINAISONS.filter((x) => x.participation > 0 && !x.compensation)) {
      const r = computeSimulation(construire(c));
      const chargeDe = (m: ParticipationVersementMode) =>
        computeSimulation(construire({ ...c, modeVersement: m })).allOptions.find(
          (o) => o.owner === "societe" && o.mode === c.financingMode,
        )!.partDirigeant;
      const minimum = Math.min(...PARTICIPATION_VERSEMENT_MODES.map(chargeDe));
      expect(chargeDe(r.modeVersementOptimal), nom(c)).toBeCloseTo(minimum, 6);
    }
  });

  it("compense la participation en reportant la charge sur la société, sans jamais la supprimer", () => {
    for (const c of COMBINAISONS.filter(
      (x) => x.participation > 0 && x.modeVersement !== "retenue_brute" && !x.compensation,
    )) {
      const sans = computeSimulation(construire(c));
      const avec = computeSimulation(construire({ ...c, compensation: true }));
      expect(avec.coutParticipationDirigeant, nom(c)).toBeLessThanOrEqual(sans.coutParticipationDirigeant + 1e-9);
      expect(avec.coutNetAugmentationParticipation, nom(c)).toBeGreaterThan(0);
      const socSans = sans.allOptions.find((o) => o.owner === "societe" && o.mode === c.financingMode)!;
      const socAvec = avec.allOptions.find((o) => o.owner === "societe" && o.mode === c.financingMode)!;
      expect(socAvec.partSociete, nom(c)).toBeGreaterThan(socSans.partSociete);
      expect(socAvec.globalCostAnnual, `la compensation devrait renchérir le montage sur ${nom(c)}`).toBeGreaterThan(
        socSans.globalCostAnnual,
      );
    }
  });
});

describe("balayage combinatoire — TVA", () => {
  it("n'ouvre aucun droit à déduction sans contrepartie versée", () => {
    for (const c of COMBINAISONS.filter((x) => x.participation === 0)) {
      const r = computeSimulation(construire(c));
      expect(r.tvaEffectivementDeductible, nom(c)).toBe(false);
      expect(r.tvaDeductible, nom(c)).toBe(0);
      expect(r.tvaCollecteeSurParticipation, nom(c)).toBe(0);
      expect(r.gainTvaNet, nom(c)).toBe(0);
    }
  });

  it("laisse le coût strictement inchangé lorsque l'option est cochée sans contrepartie", () => {
    for (const c of COMBINAISONS.filter((x) => x.participation === 0 && !x.tva)) {
      const sans = computeSimulation(construire(c));
      const avec = computeSimulation(construire({ ...c, tva: true }));
      expect(avec.globalCostSociete, nom(c)).toBeCloseTo(sans.globalCostSociete, 9);
    }
  });

  it("n'affecte jamais les options « achat personnel »", () => {
    for (const c of COMBINAISONS.filter((x) => !x.tva)) {
      const sans = computeSimulation(construire(c)).allOptions.filter((o) => o.owner === "personnel");
      const avec = computeSimulation(construire({ ...c, tva: true })).allOptions.filter(
        (o) => o.owner === "personnel",
      );
      for (let i = 0; i < sans.length; i++) {
        expect(avec[i].globalCostAnnual, `${avec[i].label} sur ${nom(c)}`).toBeCloseTo(sans[i].globalCostAnnual, 6);
      }
    }
  });

  it("décompose la TVA récupérée sans jamais perdre ni dupliquer un euro", () => {
    for (const c of COMBINAISONS.filter((x) => x.tva && x.participation > 0)) {
      const r = computeSimulation(construire(c));
      expect(r.tvaDeductibleRecurrente + r.tvaOptionAchatAnnualisee, nom(c)).toBeCloseTo(r.tvaDeductible, 6);
      expect(r.gainTvaNet, nom(c)).toBeCloseTo(r.tvaDeductible - r.tvaCollecteeSurParticipation, 6);
      expect(r.tvaDeductibleRecurrente, nom(c)).toBeGreaterThanOrEqual(0);
      expect(r.tvaOptionAchatAnnualisee, nom(c)).toBeGreaterThanOrEqual(0);
    }
  });

  it("ne récupère de TVA sur la levée d'option que pour une LOA effectivement levée", () => {
    for (const c of COMBINAISONS.filter((x) => x.tva && x.participation > 0)) {
      const r = computeSimulation(construire(c));
      if (c.financingMode === "loa" && c.leveeOption) {
        expect(r.tvaOptionAchatAnnualisee, nom(c)).toBeGreaterThan(0);
      } else {
        expect(r.tvaOptionAchatAnnualisee, nom(c)).toBe(0);
      }
    }
  });
});

describe("balayage combinatoire — exhaustivité et cohérence du détail affiché", () => {
  it("ne laisse jamais un flux hors du coût annuel comparé", () => {
    for (const c of COMBINAISONS) {
      for (const o of computeSimulation(construire(c)).allOptions) {
        for (const ligne of o.detail) {
          expect(ligne.label.toLowerCase(), `${o.label} sur ${nom(c)}`).not.toContain("hors coût annuel");
        }
      }
    }
  });

  it("reconstitue le décaissement société à partir de ses propres lignes de détail", () => {
    for (const c of COMBINAISONS) {
      const r = computeSimulation(construire(c));
      const o = r.allOptions.find((x) => x.owner === "societe" && x.mode === c.financingMode)!;
      const somme = (fragment: string) =>
        o.detail.filter((d) => d.label.includes(fragment)).reduce((acc, d) => acc + d.value, 0);
      const attendu =
        somme("Financement du véhicule") +
        somme("option d'achat LOA, lissée") +
        somme("Assurance annuelle") +
        somme("Entretien annuel") +
        somme("Taxes annuelles CO2") -
        somme("Valeur résiduelle annualisée") -
        somme("TVA déductible récupérée");
      expect(attendu, nom(c)).toBeCloseTo(somme("= Décaissement réel société"), 6);
    }
  });

  it("affiche des libellés de détail uniques au sein d'une même option", () => {
    for (const c of COMBINAISONS) {
      for (const o of computeSimulation(construire(c)).allOptions) {
        const libelles = o.detail.map((d) => d.label);
        expect(new Set(libelles).size, `libellé dupliqué dans ${o.label} sur ${nom(c)}`).toBe(libelles.length);
      }
    }
  });
});

describe("balayage combinatoire — monotonies attendues", () => {
  it("ne fait jamais croître l'AEN quand la participation augmente", () => {
    for (const c of COMBINAISONS.filter((x) => x.participation === 0)) {
      let precedent = Number.POSITIVE_INFINITY;
      for (const participation of [0, 50, 100, 200, 400, 800]) {
        const r = computeSimulation(construire({ ...c, participation }));
        expect(r.aenNet, `AEN croissant à ${participation} €/mois sur ${nom(c)}`).toBeLessThanOrEqual(precedent + 1e-9);
        precedent = r.aenNet;
      }
    }
  });

  it("ne fait jamais décroître le coût société quand l'usage privé augmente, à réglages égaux", () => {
    // Plus l'usage privé est élevé, moins la charge est déductible : le coût net société ne peut pas
    // diminuer. Vérifié hors participation, qui interfère avec l'assiette de l'AEN.
    for (const c of COMBINAISONS.filter((x) => x.participation === 0 && x.usagePrive === 0)) {
      let precedent = Number.NEGATIVE_INFINITY;
      for (const usagePrive of [0, 25, 50, 75, 100]) {
        const r = computeSimulation(construire({ ...c, usagePrive }));
        expect(r.coutNetSociete, `coût décroissant à ${usagePrive}% sur ${nom(c)}`).toBeGreaterThanOrEqual(
          precedent - 1e-6,
        );
        precedent = r.coutNetSociete;
      }
    }
  });

  it("exonère systématiquement les véhicules électriques des taxes CO2 et polluants", () => {
    for (const c of COMBINAISONS.filter((x) => x.electrique)) {
      expect(computeSimulation(construire(c)).annualVehicleTax, nom(c)).toBe(0);
    }
  });
});
