import { describe, expect, it } from "vitest";
import { getCompanyType, getCompanyTypes, resolveDirigeantStatus } from "./companyTypes";

describe("getCompanyTypes / getCompanyType", () => {
  it("retourne les 4 formes juridiques françaises", () => {
    const types = getCompanyTypes("FR");
    expect(types.map((t) => t.code)).toEqual(["EURL", "SARL", "SASU", "SAS"]);
  });

  it("retourne un tableau vide pour un pays non renseigné", () => {
    expect(getCompanyTypes("XX")).toEqual([]);
  });

  it("retrouve une forme juridique par son code", () => {
    expect(getCompanyType("FR", "SASU")?.label).toContain("SASU");
    expect(getCompanyType("FR", "INCONNU")).toBeUndefined();
  });
});

describe("resolveDirigeantStatus", () => {
  it("EURL : toujours TNS (pas d'option majoritaire/minoritaire)", () => {
    const eurl = getCompanyType("FR", "EURL");
    expect(resolveDirigeantStatus(eurl, true)).toBe("TNS");
    expect(resolveDirigeantStatus(eurl, false)).toBe("TNS");
  });

  it("SASU/SAS : toujours assimilé salarié", () => {
    const sasu = getCompanyType("FR", "SASU");
    const sas = getCompanyType("FR", "SAS");
    expect(resolveDirigeantStatus(sasu, true)).toBe("ASSIMILE_SALARIE");
    expect(resolveDirigeantStatus(sas, false)).toBe("ASSIMILE_SALARIE");
  });

  it("SARL : dépend de la majorité détenue par le gérant", () => {
    const sarl = getCompanyType("FR", "SARL");
    expect(resolveDirigeantStatus(sarl, true)).toBe("TNS");
    expect(resolveDirigeantStatus(sarl, false)).toBe("ASSIMILE_SALARIE");
  });

  it("forme juridique inconnue : repli sur TNS par sécurité", () => {
    expect(resolveDirigeantStatus(undefined, true)).toBe("TNS");
    expect(resolveDirigeantStatus(undefined, false)).toBe("TNS");
  });
});
