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

  it("les autres modèles n'ont pas d'offre LOA constructeur codée en dur", () => {
    for (const m of VEHICLE_MODELS) {
      if (m.id !== "tesla-model-y-berlin") {
        expect(m.defaultLoaOffer).toBeUndefined();
      }
    }
  });
});
