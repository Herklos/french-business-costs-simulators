import { describe, expect, it } from "vitest";
import { TAX_RULES, getRule, getRuleStatus, getRulesByCategory } from "./taxRules";

describe("TAX_RULES — intégrité du registre", () => {
  it("chaque règle a un identifiant unique", () => {
    const ids = TAX_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chaque règle a une référence légale et une source renseignées", () => {
    for (const rule of TAX_RULES) {
      expect(rule.legalReference.length).toBeGreaterThan(0);
      expect(rule.sourceLabel.length).toBeGreaterThan(0);
    }
  });

  it("validUntil, quand renseigné, est postérieur à validFrom", () => {
    for (const rule of TAX_RULES) {
      if (rule.validUntil) {
        expect(new Date(rule.validUntil).getTime()).toBeGreaterThan(new Date(rule.validFrom).getTime());
      }
    }
  });
});

describe("getRule / getRulesByCategory", () => {
  it("retrouve une règle connue par son identifiant", () => {
    expect(getRule("aen-methode-reelle-obligatoire-tns")?.category).toBe("aen_vehicule");
  });

  it("retourne undefined pour un identifiant inconnu", () => {
    expect(getRule("regle-inexistante")).toBeUndefined();
  });

  it("filtre correctement par catégorie", () => {
    const regles = getRulesByCategory("aen_vehicule");
    expect(regles.length).toBeGreaterThan(0);
    expect(regles.every((r) => r.category === "aen_vehicule")).toBe(true);
  });
});

describe("getRuleStatus", () => {
  const regleSansEcheance = { validUntil: null } as Parameters<typeof getRuleStatus>[0];
  const regleAvecEcheance = { validUntil: "2026-12-31" } as Parameters<typeof getRuleStatus>[0];

  it("toujours active si aucune date de fin", () => {
    expect(getRuleStatus(regleSansEcheance, new Date("2030-01-01"))).toBe("active");
  });

  it("active si l'échéance est à plus de 90 jours", () => {
    expect(getRuleStatus(regleAvecEcheance, new Date("2026-06-01"))).toBe("active");
  });

  it("bientôt expirée dans les 90 jours précédant l'échéance", () => {
    expect(getRuleStatus(regleAvecEcheance, new Date("2026-11-15"))).toBe("expiring_soon");
  });

  it("expirée après la date de fin", () => {
    expect(getRuleStatus(regleAvecEcheance, new Date("2027-02-01"))).toBe("expired");
  });

  it("le jour même de l'échéance n'est pas encore expiré", () => {
    expect(getRuleStatus(regleAvecEcheance, new Date("2026-12-31"))).toBe("expiring_soon");
  });
});

describe("intégrité du registre des règles", () => {
  it("n'expose aucune règle en double", () => {
    const ids = TAX_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renseigne systématiquement référence légale, source et période de validité", () => {
    for (const rule of TAX_RULES) {
      expect(rule.legalReference.trim().length, rule.id).toBeGreaterThan(0);
      expect(rule.sourceLabel.trim().length, rule.id).toBeGreaterThan(0);
      expect(rule.label.trim().length, rule.id).toBeGreaterThan(0);
      expect(rule.value.trim().length, rule.id).toBeGreaterThan(0);
      expect(rule.validFrom, rule.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (rule.validUntil !== null) expect(rule.validUntil, rule.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("n'ouvre jamais une période de validité qui se referme avant de commencer", () => {
    for (const rule of TAX_RULES) {
      if (rule.validUntil) expect(rule.validUntil >= rule.validFrom, rule.id).toBe(true);
    }
  });

  it("ne pointe que vers des URL de source exploitables", () => {
    for (const rule of TAX_RULES) {
      if (rule.sourceUrl) expect(rule.sourceUrl, rule.id).toMatch(/^https:\/\//);
    }
  });

  it("renvoie toujours vers des règles existantes lorsqu'une note en cite une autre", () => {
    // Les notes se citent mutuellement (« cf. règle "xxx" ») : un renvoi orphelin laisserait le
    // lecteur sans la précision annoncée.
    const ids = new Set(TAX_RULES.map((r) => r.id));
    for (const rule of TAX_RULES) {
      for (const cite of rule.notes?.match(/« ([a-z0-9-]{8,}) »/g) ?? []) {
        const id = cite.replace(/[«»\s]/g, "");
        if (id.includes("-")) expect(ids.has(id), `${rule.id} cite « ${id} », introuvable`).toBe(true);
      }
    }
  });
});
