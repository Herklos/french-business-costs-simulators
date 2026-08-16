import { describe, expect, it } from "vitest";
import { type HomeOfficeInputs, createDefaultHomeOfficeInputs, computeHomeOffice } from "./homeOffice";
import { buildUrssafJustification } from "./homeOfficeJustification";

function inputs(patch: Partial<HomeOfficeInputs> = {}): HomeOfficeInputs {
  const defauts = createDefaultHomeOfficeInputs();
  return {
    ...defauts,
    personalTaxProfile: { ...defauts.personalTaxProfile, mode: "manuel", tauxManuel: 0.3 },
    ...patch,
  };
}

describe("buildUrssafJustification — structure du document", () => {
  it("comporte les huit sections attendues, dans l'ordre d'un raisonnement de contrôle", () => {
    const doc = buildUrssafJustification(inputs());
    const sections = doc.split("\n").filter((l) => /^— .+ —$/.test(l.trim()));
    expect(sections).toEqual([
      "— 1. Parties, bien et période —",
      "— 2. Fondement juridique —",
      "— 3. Détermination de la quote-part professionnelle —",
      "— 4. Valeur locative retenue —",
      "— 5. Ventilation poste par poste : valeur locative et charges —",
      "— 6. Montant dû et traitement déclaratif —",
      "— 7. Justificatifs tenus à disposition —",
      "— 8. Attestation —",
    ]);
  });

  it("cite nommément chaque fondement juridique invoqué par le calcul", () => {
    const doc = buildUrssafJustification(inputs());
    for (const reference of [
      "L631-7-3",
      "39-1-1°",
      "BOI-RSA-BASE-30-50-30-30",
      "BOI-BNC-BASE-40-60-30",
      "31, I-1°",
      "BOI-RFPI-BASE-20-50",
    ]) {
      expect(doc, reference).toContain(reference);
    }
  });

  it("rappelle explicitement que la TEOM n'est pas déductible du revenu foncier", () => {
    expect(buildUrssafJustification(inputs())).toContain("ordures ménagères");
  });

  it("se termine par une attestation et un espace de signature des deux parties", () => {
    const doc = buildUrssafJustification(inputs({ nomDirigeant: "A. Dupont", denominationSociete: "ACME SAS" }));
    expect(doc).toContain("atteste que les surfaces et les montants");
    expect(doc).toContain("Le bénéficiaire — A. Dupont");
    expect(doc).toContain("Pour la société — ACME SAS");
  });

  it("porte la mention d'usage : ce n'est ni un avis juridique ni une attestation comptable", () => {
    expect(buildUrssafJustification(inputs())).toContain("ne constitue ni un avis juridique");
  });
});

describe("buildUrssafJustification — mentions nominatives", () => {
  it("reprend les identités saisies", () => {
    const doc = buildUrssafJustification(
      inputs({
        nomDirigeant: "Camille Martin",
        denominationSociete: "Studio Bleu SASU",
        adresseLogement: "12 rue des Lilas, 75011 Paris",
        dateEffet: "2026-01-15",
      }),
    );
    expect(doc).toContain("Camille Martin");
    expect(doc).toContain("Studio Bleu SASU");
    expect(doc).toContain("12 rue des Lilas, 75011 Paris");
    expect(doc).toContain("15/01/2026");
  });

  it("laisse des pointillés à compléter plutôt qu'un vide, quand rien n'est saisi", () => {
    const doc = buildUrssafJustification(inputs());
    expect(doc).toContain("……………");
    // Aucune ligne ne doit se terminer par « : » suivi de rien.
    for (const ligne of doc.split("\n")) {
      expect(ligne.trimEnd(), ligne).not.toMatch(/:\s*$/);
    }
  });

  it("une date invalide est reprise telle quelle plutôt que d'afficher « Invalid Date »", () => {
    expect(buildUrssafJustification(inputs({ dateEffet: "pas-une-date" }))).toContain("pas-une-date");
    expect(buildUrssafJustification(inputs({ dateEffet: "pas-une-date" }))).not.toContain("Invalid Date");
  });
});

describe("buildUrssafJustification — chiffres repris du calcul", () => {
  it("le total du tableau des charges est bien l'indemnité brute", () => {
    const sim = inputs();
    const r = computeHomeOffice(sim);
    const doc = buildUrssafJustification(sim);
    const ligneTotal = doc.split("\n").find((l) => l.includes("TOTAL"));
    expect(ligneTotal).toBeDefined();
    // Le montant est formaté avec des espaces insécables : on compare sur les chiffres seuls.
    const chiffres = (s: string) => s.replace(/\D/g, "");
    expect(chiffres(ligneTotal ?? "")).toContain(chiffres(String(Math.round(r.indemniteAnnuelleBrute))));
  });

  it("n'énumère que les postes réellement retenus", () => {
    const sim = inputs({
      chargeLines: createDefaultHomeOfficeInputs().chargeLines.map((c) => ({
        ...c,
        enabled: c.id === "electricite",
      })),
    });
    const doc = buildUrssafJustification(sim);
    expect(doc).toContain("Électricité");
    expect(doc).not.toContain("Taxe foncière ");
  });

  it("détaille les annexes d'usage mixte quand elles sont renseignées, et les tait sinon", () => {
    const sansAnnexes = buildUrssafJustification(inputs());
    expect(sansAnnexes).not.toContain("usage mixte)");

    const sim = inputs();
    const avecAnnexes = buildUrssafJustification({
      ...sim,
      surfacesAnnexes: sim.surfacesAnnexes.map((a, i) =>
        i === 0 ? { ...a, surfaceM2: 6, coefficientPro: 0.5, enabled: true } : a,
      ),
    });
    expect(avecAnnexes).toContain("usage mixte)");
    expect(avecAnnexes).toContain("3 m²"); // 6 m² × 50 %
  });

  it("justifie la valeur locative par sa source, calculée ou réelle", () => {
    expect(buildUrssafJustification(inputs({ loyerAutoDepuisPrixM2: true }))).toContain("carte des loyers");
    expect(buildUrssafJustification(inputs({ loyerAutoDepuisPrixM2: false }))).toContain("quittances de loyer");
  });

  it("mentionne le déficit foncier et son plafond dès qu'il en existe un", () => {
    const sim = inputs({
      regimeFoncier: "reel",
      empruntEnCours: true,
      interetsEmpruntAnnuels: 200000,
      surfaceBureauM2: 20,
      surfaceTotaleM2: 80,
    });
    expect(computeHomeOffice(sim).deficitFoncierTotal).toBeGreaterThan(0);
    const doc = buildUrssafJustification(sim);
    expect(doc).toContain("Déficit foncier constaté");
    expect(doc).toContain("156, I-3°");
  });

  it("ne parle pas de déficit quand il n'y en a pas", () => {
    expect(buildUrssafJustification(inputs())).not.toContain("Déficit foncier constaté");
  });

  it("adapte la liste des pièces au montage retenu", () => {
    const bail = buildUrssafJustification(inputs({ formalisation: "bail_professionnel" }));
    expect(bail).toContain("Bail professionnel signé");
    const convention = buildUrssafJustification(inputs({ formalisation: "indemnite" }));
    expect(convention).toContain("Convention de mise à disposition signée");

    expect(buildUrssafJustification(inputs({ empruntEnCours: true }))).toContain("Tableau d'amortissement");
    expect(buildUrssafJustification(inputs({ empruntEnCours: false }))).not.toContain("Tableau d'amortissement");
  });

  it("signale le dépassement du repère de surface plutôt que de le passer sous silence", () => {
    const doc = buildUrssafJustification(inputs({ surfaceTotaleM2: 80, surfaceBureauM2: 40 }));
    expect(doc).toContain("dépasse le repère interne");
    // ... en le présentant pour ce qu'il est : un seuil de vigilance que les parties se donnent, et
    // non une norme légale sous laquelle la situation serait réputée sûre.
    expect(doc).toContain("n'est pas une norme légale");
  });

  it("ne présente jamais le repère de surface comme un seuil légal protecteur", () => {
    // Sous le repère, le document ne doit rien en dire : l'argument est la méthode de mesure, pas le
    // franchissement d'un pourcentage. Laisser entendre qu'« en dessous de 30 % on est couvert »
    // donnerait au lecteur une sécurité que l'art. L631-7-3 CCH ne confère pas.
    const doc = buildUrssafJustification(inputs({ surfaceTotaleM2: 100, surfaceBureauM2: 15 }));
    expect(doc).not.toContain("demeure sous le seuil");
    expect(doc).not.toContain("repère interne");
    expect(doc).toContain("relevé des surfaces effectivement affectées");
  });

  it("ventile explicitement la somme due entre jouissance des locaux et remboursement de charges", () => {
    const sim = inputs();
    const r = computeHomeOffice(sim);
    const doc = buildUrssafJustification(sim);
    expect(doc).toContain("Contrepartie de la mise à disposition");
    expect(doc).toContain("Remboursement de charges professionnelles");
    expect(doc).toContain("n'est pas un loyer forfaitaire");
    // Les deux composantes doivent se recomposer exactement en l'indemnité totale.
    const chiffres = (s: string) => s.replace(/\D/g, "");
    const totalDu = doc.split("\n").find((l) => l.includes("TOTAL DÛ"));
    expect(chiffres(totalDu ?? "")).toContain(chiffres(String(Math.round(r.indemniteAnnuelleBrute))));
  });

  it("la part « jouissance » est la quote-part professionnelle de la valeur locative", () => {
    const sim = inputs();
    const r = computeHomeOffice(sim);
    const doc = buildUrssafJustification(sim);
    const chiffres = (s: string) => s.replace(/\D/g, "");
    const ligne = doc.split("\n").find((l) => l.includes("Contrepartie de la mise à disposition") && l.includes("/an"));
    expect(ligne).toBeDefined();
    expect(chiffres(ligne ?? "")).toContain(chiffres(String(Math.round(r.loyerAnnuelBureauRetenu))));
  });
});

describe("buildUrssafJustification — robustesse", () => {
  const cas: [string, Partial<HomeOfficeInputs>][] = [
    ["surfaces nulles", { surfaceTotaleM2: 0, surfaceBureauM2: 0 }],
    ["bureau plus grand que le logement", { surfaceTotaleM2: 20, surfaceBureauM2: 90 }],
    ["aucune charge activée", {}],
    ["emprunt colossal", { empruntEnCours: true, interetsEmpruntAnnuels: 5_000_000, regimeFoncier: "reel" }],
    ["libellés très longs", { nomDirigeant: "X".repeat(200), adresseLogement: "Y".repeat(300) }],
  ];

  it.each(cas)("%s : produit un document non vide et sans valeur illisible", (_libelle, patch) => {
    const doc = buildUrssafJustification(inputs(patch));
    expect(doc.length).toBeGreaterThan(500);
    expect(doc).not.toContain("NaN");
    expect(doc).not.toContain("undefined");
    expect(doc).not.toContain("Infinity");
    expect(doc).not.toContain("[object Object]");
  });

  it("les lignes de tableau sont marquées d'une tabulation et alignées à largeur constante", () => {
    const doc = buildUrssafJustification(inputs());
    const lignes = doc.split("\n").filter((l) => l.startsWith("\t") && !l.includes("---"));
    expect(lignes.length).toBeGreaterThan(3);
    const largeurs = new Set(lignes.map((l) => l.length));
    // Toutes les lignes de tableau partagent la même largeur : c'est ce qui aligne les colonnes.
    expect(largeurs.size, [...largeurs].join(", ")).toBe(1);
  });

  it("un libellé trop long est tronqué pour ne pas casser l'alignement", () => {
    const sim = inputs();
    const doc = buildUrssafJustification({
      ...sim,
      surfacesAnnexes: sim.surfacesAnnexes.map((a, i) =>
        i === 0 ? { ...a, label: "Z".repeat(120), surfaceM2: 4, enabled: true } : a,
      ),
    });
    const lignes = doc.split("\n").filter((l) => l.startsWith("\t") && !l.includes("---"));
    expect(new Set(lignes.map((l) => l.length)).size).toBe(1);
    expect(doc).toContain("…");
  });
});

describe("buildUrssafJustification — cohérence avec les autres déclarations", () => {
  it("tire les conséquences de la surface professionnelle en matière de CFE", () => {
    // Revendiquer une surface exclusivement professionnelle pour justifier l'indemnité sans en
    // tenir compte pour la CFE serait une incohérence entre deux déclarations qui se lisent
    // ensemble — exactement ce qu'un vérificateur relève.
    const doc = buildUrssafJustification(inputs());
    expect(doc).toContain("cotisation foncière des entreprises");
    expect(doc).toContain("1647 D");
    expect(doc).toContain("les deux déclarations sont cohérentes entre elles");
  });

  it("précise que le plafond du micro-foncier s'apprécie sur le foyer, tous biens confondus", () => {
    const sousLePlafond = buildUrssafJustification(inputs());
    expect(sousLePlafond).toContain("tous biens confondus");
    const auDessus = buildUrssafJustification(inputs({ autresRevenusFonciersFoyer: 40000 }));
    expect(auDessus).toContain("revenus fonciers bruts du foyer étant dépassé");
  });
});
