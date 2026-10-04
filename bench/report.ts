/**
 * Prints Markdown tables from bench/results.json (written by bench/run.ts).
 *
 *   node bench/report.ts
 *
 * Every number is the median of the recorded runs; gdp cells show the delta
 * against the baseline project of the same size, label, and TS version.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Metrics {
  files: number;
  lines: number;
  types: number;
  instantiations: number;
  memoryKB: number;
  checkSeconds: number;
  totalSeconds: number;
}
interface Entry {
  label: string;
  project: string;
  manifest: { files: number; nonBlankLines: number; nameCallSites: number; proofKinds: number; tsExpectErrorLines: number } | null;
  runs: Metrics[];
  median: Metrics | null;
  error: string | null;
}

const here = dirname(fileURLToPath(import.meta.url));
const allResults: Entry[] = JSON.parse(readFileSync(join(here, "results.json"), "utf8"));
// "gdp-10000:layer3-auth" entries come from `run.ts --config tsconfig.layer*.json`.
const layerResults = allResults.filter((e) => e.project.includes(":"));
const results = allResults.filter((e) => !e.project.includes(":"));

const sizeOf = (project: string) => Number(project.split(":")[0]!.split("-")[1]);
const variantOf = (project: string) => project.split("-")[0];
const labels = [...new Set(results.map((e) => e.label))];
const sizes = [...new Set(results.map((e) => sizeOf(e.project)))].sort((a, b) => a - b);
const find = (label: string, variant: string, size: number) =>
  results.find((e) => e.label === label && e.project === `${variant}-${size}`);

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const secs = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(1)) + " s";
const mb = (kb: number) => int(kb / 1024) + " MB";
const pct = (a: number, b: number) => {
  const d = ((b - a) / a) * 100;
  return (d >= 0 ? "+" : "") + (Math.abs(d) >= 100 ? d.toFixed(0) : d.toFixed(1)) + "%";
};
const ratio = (a: number, b: number) => (b / a).toFixed(1) + "x";

// Table 1: everything per label and size.
for (const label of labels) {
  const rows: string[] = [];
  for (const size of sizes) {
    const base = find(label, "baseline", size);
    const gdp = find(label, "gdp", size);
    if (!base && !gdp) continue;
    for (const [variant, e] of [["baseline", base], ["gdp", gdp]] as const) {
      if (!e) continue;
      if (!e.median) {
        const why = /heap out of memory/.test(e.error ?? "") ? "out of memory" : "failed";
        rows.push(`| ${int(size)} | ${variant} | ${e.manifest ? int(e.manifest.files) : ""} | ${e.manifest ? int(e.manifest.nonBlankLines) : ""} | ${why} | ${why} | ${why} | ${why} | ${why} | ${why} |`);
        continue;
      }
      const m = e.median;
      const b = variant === "gdp" && base?.median ? base.median : null;
      const cell = (v: string, x: number, y: number | undefined) => (b && y !== undefined ? `${v} (${pct(y, x)})` : v);
      rows.push(
        `| ${int(size)} | ${variant} | ${e.manifest ? int(e.manifest.files) : ""} | ${e.manifest ? int(e.manifest.nonBlankLines) : ""} | ${int(m.lines)} | ` +
          `${cell(int(m.types), m.types, b?.types)} | ${cell(int(m.instantiations), m.instantiations, b?.instantiations)} | ` +
          `${cell(mb(m.memoryKB), m.memoryKB, b?.memoryKB)} | ${cell(secs(m.checkSeconds), m.checkSeconds, b?.checkSeconds)} | ` +
          `${cell(secs(m.totalSeconds), m.totalSeconds, b?.totalSeconds)} |`,
      );
    }
  }
  if (rows.length === 0) continue;
  console.log(`\n#### TypeScript ${label}\n`);
  console.log("| Size | Variant | Generated files | Generated LOC | tsc Lines | Types | Instantiations | Memory used | Check time | Total time |");
  console.log("| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of rows) console.log(r);
}

// Table 2: cross-version summary.
console.log("\n#### Summary: baseline vs gdp\n");
console.log("| TS | Size | Check baseline | Check gdp | Check delta | Total baseline | Total gdp | Total delta | Memory baseline | Memory gdp | Memory delta |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const label of labels) {
  for (const size of sizes) {
    const be = find(label, "baseline", size);
    const b = be?.median;
    const g = find(label, "gdp", size);
    if (!be || !b || !g) continue;
    // Check time with the min-max of the recorded runs, so noisy configurations are visible.
    const checkCell = (e: Entry) => {
      const xs = e.runs.map((r) => r.checkSeconds);
      const fmt = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(1));
      return `${secs(e.median!.checkSeconds)} (${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))})`;
    };
    if (!g.median) {
      console.log(`| ${label} | ${int(size)} | ${checkCell(be)} | out of memory | | ${secs(b.totalSeconds)} | out of memory | | ${mb(b.memoryKB)} | out of memory | |`);
      continue;
    }
    const m = g.median;
    console.log(
      `| ${label} | ${int(size)} | ${checkCell(be)} | ${checkCell(g)} | ${pct(b.checkSeconds, m.checkSeconds)} (${ratio(b.checkSeconds, m.checkSeconds)}) | ` +
        `${secs(b.totalSeconds)} | ${secs(m.totalSeconds)} | ${pct(b.totalSeconds, m.totalSeconds)} | ` +
        `${mb(b.memoryKB)} | ${mb(m.memoryKB)} | ${pct(b.memoryKB, m.memoryKB)} |`,
    );
  }
}

// Table 4 (printed after table 3): where the time goes, by layer.
function printLayers() {
  const LAYERS = ["layer1-core", "layer2-data", "layer3-auth", "layer4-policy", "layer5-service", "layer6-all"];
  const DESCRIBE: Record<string, string> = {
    "layer1-core": "core (ids, db helpers, http, session)",
    "layer2-data": "+ db.ts, model.ts (identical in both)",
    "layer3-auth": "+ checks/ (baseline) or proofs/ (gdp)",
    "layer4-policy": "+ policy.ts",
    "layer5-service": "+ service.ts (sensitive functions)",
    "layer6-all": "+ handlers.ts, routes.ts, main.ts (full program)",
  };
  for (const label of [...new Set(layerResults.map((e) => e.label))]) {
    for (const size of [...new Set(layerResults.filter((e) => e.label === label).map((e) => sizeOf(e.project)))]) {
      const get = (variant: string, layer: string) =>
        layerResults.find((e) => e.label === label && e.project === `${variant}-${size}:${layer}`)?.median;
      console.log(`\n#### Where the time goes: TypeScript ${label}, ${int(size)} files (cumulative roots)\n`);
      console.log(
        "| Layer | Check baseline | Check gdp | Check added, baseline | Check added, gdp | Share of the extra gdp check time | Instantiations added, baseline | Instantiations added, gdp | Memory baseline | Memory gdp |",
      );
      console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
      const allB = get("baseline", "layer6-all");
      const allG = get("gdp", "layer6-all");
      const extra = allB && allG ? allG.checkSeconds - allB.checkSeconds : NaN;
      let prevB: Metrics | null = null;
      let prevG: Metrics | null = null;
      for (const layer of LAYERS) {
        const b = get("baseline", layer);
        const g = get("gdp", layer);
        if (!b || !g) continue;
        const added = (x: Metrics, prev: Metrics | null, k: "checkSeconds" | "instantiations") => x[k] - (prev?.[k] ?? 0);
        const share = (added(g, prevG, "checkSeconds") - added(b, prevB, "checkSeconds")) / extra;
        console.log(
          `| ${DESCRIBE[layer]} | ${secs(b.checkSeconds)} | ${secs(g.checkSeconds)} | ` +
            `+${secs(added(b, prevB, "checkSeconds"))} | +${secs(added(g, prevG, "checkSeconds"))} | ${Math.round(share * 100)}% | ` +
            `+${int(added(b, prevB, "instantiations"))} | +${int(added(g, prevG, "instantiations"))} | ${mb(b.memoryKB)} | ${mb(g.memoryKB)} |`,
        );
        prevB = b;
        prevG = g;
      }
    }
  }
}

// Table 3: marginal cost per name() call site (proofs, policies, and sensitive functions amortized in).
console.log("\n#### Marginal cost per name() call site (gdp minus baseline, divided by name() sites)\n");
console.log("| TS | Size | name() sites | Check time per site | Memory per site |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const label of labels) {
  for (const size of sizes) {
    const b = find(label, "baseline", size)?.median;
    const g = find(label, "gdp", size);
    if (!b || !g?.median || !g.manifest) continue;
    const sites = g.manifest.nameCallSites;
    console.log(
      `| ${label} | ${int(size)} | ${int(sites)} | ${(((g.median.checkSeconds - b.checkSeconds) / sites) * 1e6).toFixed(0)} µs | ` +
        `${((g.median.memoryKB - b.memoryKB) / sites).toFixed(0)} KB |`,
    );
  }
}
printLayers();
