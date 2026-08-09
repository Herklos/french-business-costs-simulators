import { describe, expect, it } from "vitest";
import { VEHICLE_MODELS, getVehicleModel } from "./vehicleModels";

describe("vehicleModels", () => {
  it("inclut la Renault Megane E-Tech et la Scenic E-Tech comme éligibles à l'éco-score", () => {
    const megane = getVehicleModel("renault-megane-e-tech");
    const scenic = getVehicleModel("renault-scenic-e-tech");
    expect(megane?.ecoScoreEligible).toBe(true);
    expect(scenic?.ecoScoreEligible).toBe(true);
    expect(megane?.isElectric).toBe(true);
    expect(scenic?.isElectric).toBe(true);
  });

  it("la Tesla Model Y (Berlin) est éligible, la Model 3 ne l'est pas", () => {
    expect(getVehicleModel("tesla-model-y-berlin")?.ecoScoreEligible).toBe(true);
    expect(getVehicleModel("tesla-model-3")?.ecoScoreEligible).toBe(false);
  });

  it("retourne undefined pour un identifiant inconnu", () => {
    expect(getVehicleModel("modele-inexistant")).toBeUndefined();
  });

  it("chaque modèle a un identifiant unique", () => {
    const ids = VEHICLE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("le Tesla Model Y porte l'offre LOA constructeur réelle (308€/mois, 36 mois)", () => {
    const modelY = getVehicleModel("tesla-model-y-berlin");
    expect(modelY?.defaultPrice).toBe(45000);
    expect(modelY?.defaultLoaOffer).toEqual({
      premierLoyerMajore: 9320,
      loyerMensuel: 308,
      dureeMois: 36,
      valeurOptionAchat: 25804,
      tauxAnnuelIndicatif: 0.0099,
    });
  });

  it("le Tesla Model 3 porte l'offre LOA constructeur constatée (279€/mois, 36 mois)", () => {
    const model3 = getVehicleModel("tesla-model-3");
    expect(model3?.defaultPrice).toBe(42990);
    expect(model3?.defaultLoaOffer).toEqual({
      premierLoyerMajore: 8250,
      loyerMensuel: 279,
      dureeMois: 36,
      valeurOptionAchat: 16745,
    });
  });

  it("Megane E-Tech et Scenic E-Tech ont un prix de référence mais pas d'offre LOA constructeur codée en dur (donnée non trouvée de façon fiable)", () => {
    const megane = getVehicleModel("renault-megane-e-tech");
    const scenic = getVehicleModel("renault-scenic-e-tech");
    expect(megane?.defaultPrice).toBe(37500);
    expect(megane?.defaultLoaOffer).toBeUndefined();
    expect(scenic?.defaultPrice).toBe(40490);
    expect(scenic?.defaultLoaOffer).toBeUndefined();
  });

  it("le Tesla Model Y porte aussi une offre LLD réelle « tout compris » (592€/mois, 48 mois)", () => {
    const modelY = getVehicleModel("tesla-model-y-berlin");
    expect(modelY?.defaultLldOffer).toEqual({
      premierLoyer: 0,
      loyerMensuel: 592,
      dureeMois: 48,
      kmInclusAnnuel: 15000,
      toutComprisEntretienAssurance: true,
    });
  });

  it("les autres modèles n'ont pas d'offre LLD constructeur codée en dur", () => {
    for (const m of VEHICLE_MODELS) {
      if (m.id !== "tesla-model-y-berlin") {
        expect(m.defaultLldOffer).toBeUndefined();
      }
    }
  });

  it("le modèle « autre » n'a ni prix ni offre LOA/LLD de référence", () => {
    const autre = getVehicleModel("autre");
    expect(autre?.defaultPrice).toBeUndefined();
    expect(autre?.defaultLoaOffer).toBeUndefined();
    expect(autre?.defaultLldOffer).toBeUndefined();
  });
});
