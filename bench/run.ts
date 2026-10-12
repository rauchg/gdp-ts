/**
 * Runs `tsc -p <dir>/<config> --extendedDiagnostics` several times per
 * generated project and records every run plus the per-metric median in
 * bench/results.json (entries are replaced by label + project).
 *
 *   node bench/run.ts --ts local bench/out/baseline-5000 bench/out/gdp-5000
 *   node bench/run.ts --ts 5.9.3 --runs 5 bench/out/{baseline,gdp}-20000
 *   node bench/run.ts --ts local --label "7.0.2 --singleThreaded" bench/out/gdp-20000 -- --singleThreaded
 *   node bench/run.ts --ts local --config tsconfig.layer3-auth.json --config tsconfig.layer6-all.json bench/out/gdp-10000
 *
 * --ts local uses the workspace's node_modules/.bin/tsc; any other value runs
 * `pnpm dlx --package=typescript@<v> tsc`. Runs are interleaved across all
 * (project, config) targets (A B C A B C ...) so drift (thermals, background
 * load) hits all of them alike, after --warmup unrecorded runs of each.
 * Entries for a non-default --config are recorded as "<project>:<layer>".
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const resultsFile = join(here, "results.json");

const dashDash = process.argv.indexOf("--");
const ownArgs = dashDash === -1 ? process.argv.slice(2) : process.argv.slice(2, dashDash);
const extraTscArgs = dashDash === -1 ? [] : process.argv.slice(dashDash + 1);

const { values: args, positionals } = parseArgs({
  args: ownArgs,
  allowPositionals: true,
  options: {
    ts: { type: "string", default: "local" },
    runs: { type: "string", default: "5" },
    warmup: { type: "string", default: "1" },
    label: { type: "string" },
    "node-options": { type: "string" },
    /** Config file name(s) inside each project dir, e.g. tsconfig.layer3-auth.json (see generate.ts). */
    config: { type: "string", multiple: true, default: ["tsconfig.json"] },
  },
});

const dirs = positionals.map((d) => resolve(d));
if (dirs.length === 0) throw new Error("usage: node bench/run.ts [--ts local|<version>] [--runs 5] [--config f]... dir... [-- extra tsc args]");

const runs = Number(args.runs);
const warmup = Number(args.warmup);
const local = args.ts === "local";
const localVersion = JSON.parse(readFileSync(join(repoRoot, "node_modules", "typescript", "package.json"), "utf8")).version as string;
const tsVersion = local ? localVersion : args.ts!;
const label = args.label ?? tsVersion;

const METRICS = ["files", "lines", "types", "instantiations", "memoryKB", "checkSeconds", "totalSeconds"] as const;
type Metric = (typeof METRICS)[number];
type Metrics = Record<Metric, number>;

function parse(stdout: string): Metrics {
  const kv = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const m = /^([A-Za-z][A-Za-z /]*?):\s+(\S+)\s*$/.exec(line);
    if (m) kv.set(m[1]!, m[2]!);
  }
  const num = (key: string) => {
    const raw = kv.get(key);
    if (raw === undefined) throw new Error(`missing "${key}" in tsc output:\n${stdout}`);
    return Number.parseFloat(raw);
  };
  // TS 7 prints "Lines"; TS 5.x/6.x print "Lines of Library", "Lines of TypeScript", ...
  const lines = kv.has("Lines")
    ? num("Lines")
    : [...kv.keys()].filter((k) => k.startsWith("Lines of ")).reduce((sum, k) => sum + num(k), 0);
  return {
    files: num("Files"),
    lines,
    types: num("Types"),
    instantiations: num("Instantiations"),
    memoryKB: num("Memory used"),
    checkSeconds: num("Check time"),
    totalSeconds: num("Total time"),
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function tsc(dir: string, config: string): { ok: true; metrics: Metrics } | { ok: false; error: string } {
  const tscArgs = ["-p", join(dir, config), "--extendedDiagnostics", ...extraTscArgs];
  const [cmd, cmdArgs] = local
    ? [join(repoRoot, "node_modules", ".bin", "tsc"), tscArgs]
    : ["pnpm", ["dlx", `--package=typescript@${tsVersion}`, "tsc", ...tscArgs]];
  const env = { ...process.env };
  if (args["node-options"]) env.NODE_OPTIONS = args["node-options"];
  const r = spawnSync(cmd, cmdArgs, { cwd: repoRoot, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const out = (r.stdout + "\n" + r.stderr).trim().split("\n");
    // Node OOMs print "FATAL ERROR: ... JavaScript heap out of memory" followed by a long stack.
    const fatal = out.filter((l) => /FATAL ERROR|heap out of memory|error TS\d+/.test(l)).slice(0, 5);
    const summary = fatal.length > 0 ? fatal : out.slice(-12);
    return { ok: false, error: `exit ${r.status ?? r.signal}: ${summary.join("\n")}` };
  }
  if (/error TS\d+/.test(r.stdout)) return { ok: false, error: "type errors:\n" + r.stdout.slice(0, 4000) };
  return { ok: true, metrics: parse(r.stdout) };
}

interface Entry {
  label: string;
  tsVersion: string;
  tscArgs: string[];
  nodeOptions: string | null;
  project: string;
  config: string;
  manifest: Record<string, unknown> | null;
  runs: Metrics[];
  median: Metrics | null;
  error: string | null;
}

const configTag = (config: string) =>
  config === "tsconfig.json" ? "" : ":" + config.replace(/^tsconfig\./, "").replace(/\.json$/, "");

const results: Entry[] = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : [];
const targets = dirs.flatMap((dir) =>
  args.config!.map((config) => {
    const manifestFile = join(dir, "manifest.json");
    const entry: Entry = {
      label,
      tsVersion,
      tscArgs: extraTscArgs,
      nodeOptions: args["node-options"] ?? null,
      project: basename(dir) + configTag(config),
      config,
      manifest: existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null,
      runs: [],
      median: null,
      error: null,
    };
    return { dir, config, entry };
  }),
);

for (let i = 0; i < warmup + runs; i++) {
  for (const { dir, config, entry } of targets) {
    if (entry.error) continue;
    const r = tsc(dir, config);
    const tag = i < warmup ? "warmup" : `run ${i - warmup + 1}/${runs}`;
    if (!r.ok) {
      entry.error = r.error;
      console.log(`[${label}] ${entry.project} ${tag}: FAILED ${r.error.split("\n")[0]}`);
      continue;
    }
    if (i >= warmup) entry.runs.push(r.metrics);
    console.log(
      `[${label}] ${entry.project} ${tag}: check ${r.metrics.checkSeconds}s total ${r.metrics.totalSeconds}s ` +
        `mem ${Math.round(r.metrics.memoryKB / 1024)}MB types ${r.metrics.types} inst ${r.metrics.instantiations}`,
    );
  }
}

for (const { entry } of targets) {
  if (entry.runs.length > 0) {
    entry.median = Object.fromEntries(METRICS.map((m) => [m, median(entry.runs.map((r) => r[m]))])) as Metrics;
  }
  const at = results.findIndex((e) => e.label === entry.label && e.project === entry.project);
  if (at === -1) results.push(entry);
  else results[at] = entry;
  console.log(`${entry.label} ${entry.project}: ${entry.error ? "FAILED" : JSON.stringify(entry.median)}`);
}
writeFileSync(resultsFile, JSON.stringify(results, null, 2) + "\n");
process.exitCode = targets.some(({ entry }) => entry.error !== null) ? 1 : 0;
