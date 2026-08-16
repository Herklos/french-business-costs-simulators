import { it } from "vitest";
import { computeSimulation, createDefaultInputs } from "./src/lib/simulator";
it("d", () => {
  const base = createDefaultInputs();
  const r = computeSimulation(base);
  for (const m of ["comptant", "credit"] as const) {
    const o = r.allOptions.find((x) => x.owner === "personnel" && x.mode === m)!;
    console.log(`\n=== ${m} — global ${Math.round(o.globalCostAnnual)} €/an`);
    console.log(o.detail.map((d) => `  ${d.label} : ${Math.round(d.value)}`).join("\n"));
  }
  // Meme duree, meme taux : le comptant doit redevenir au moins aussi bon
  const equit = { ...base, financing: { ...base.financing,
    comptant: { ...base.financing.comptant, dureeDetentionMois: 72, tauxOpportunite: 0.0099 },
    credit: { ...base.financing.credit, dureeMois: 72 } } };
  const re = computeSimulation(equit);
  const c = re.allOptions.find((x) => x.owner === "personnel" && x.mode === "comptant")!;
  const k = re.allOptions.find((x) => x.owner === "personnel" && x.mode === "credit")!;
  console.log(`\nA DUREE ET TAUX EGAUX : comptant ${Math.round(c.globalCostAnnual)} vs credit ${Math.round(k.globalCostAnnual)}`);
});
