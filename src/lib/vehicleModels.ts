// Sélection indicative de modèles électriques et de leur éligibilité à l'éco-score renforcé
// (liste ADEME des véhicules électriques dont le score environnemental est ≥ 60 points,
// conditionnant l'abattement de 50% sur l'AEN — cf. règle "aen-abattement-vehicule-electrique-taux").
// Liste non exhaustive et non officielle : la liste ADEME à jour doit être vérifiée au cas par
// cas (elle évolue avec chaque nouvelle homologation/production), notamment pour les véhicules
// assemblés hors Union Européenne dont le score dépend fortement du site de production et de la
// filière batterie utilisés à un instant donné.

export interface VehicleModel {
  id: string;
  label: string;
  isElectric: boolean;
  ecoScoreEligible: boolean;
  notes: string;
}

export const VEHICLE_MODELS: VehicleModel[] = [
  {
    id: "tesla-model-y-berlin",
    label: "Tesla Model Y (assemblage Berlin, codes TVV éligibles)",
    isElectric: true,
    ecoScoreEligible: true,
    notes: "Versions assemblées à Berlin généralement éligibles ; vérifier le code TVV précis sur la carte grise.",
  },
  {
    id: "tesla-model-3",
    label: "Tesla Model 3",
    isElectric: true,
    ecoScoreEligible: false,
    notes: "Majoritairement non éligible (production hors UE pour une grande partie des versions commercialisées en France).",
  },
  {
    id: "renault-megane-e-tech",
    label: "Renault Megane E-Tech Electric",
    isElectric: true,
    ecoScoreEligible: true,
    notes: "Assemblée en France (Douai) — listée parmi les véhicules éligibles à l'éco-score ADEME.",
  },
  {
    id: "renault-scenic-e-tech",
    label: "Renault Scenic E-Tech Electric",
    isElectric: true,
    ecoScoreEligible: true,
    notes: "Assemblé en France (Douai) — listé parmi les véhicules éligibles à l'éco-score ADEME.",
  },
  {
    id: "autre",
    label: "Autre modèle / à vérifier manuellement",
    isElectric: true,
    ecoScoreEligible: false,
    notes: "Vérifier l'éligibilité sur la liste officielle ADEME au jour de la mise à disposition avant de cocher « Oui ».",
  },
];

export function getVehicleModel(id: string): VehicleModel | undefined {
  return VEHICLE_MODELS.find((m) => m.id === id);
}
