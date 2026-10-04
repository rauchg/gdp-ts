#!/usr/bin/env bash
# Installs a packed gdp-ts tarball into an empty project, the way a user
# would, and checks that it works from plain JavaScript and type-checks with
# the oldest supported TypeScript, under each common module resolution.
#
#   pnpm pack --pack-destination /tmp/pack
#   test/support/smoke-package.sh /tmp/pack/gdp-ts-*.tgz
set -euo pipefail

tarball="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
typescript="${TS_VERSION:-5.4}"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
cd "$dir"

echo '{ "name": "consumer", "private": true, "type": "module" }' > package.json
npm install --no-audit --no-fund --loglevel=error "$tarball" "typescript@$typescript"

cat > runtime.js <<'EOF'
import { defineProof, name } from "gdp-ts";
const IsShort = defineProof("IsShort");
const out = name("hi", (s) => `${IsShort.prove(s).kind}:${s.value}`);
if (out !== "IsShort:hi") throw new Error(`unexpected result: ${out}`);
console.log("runtime: ok");
EOF
node runtime.js

cat > lint-runtime.js <<'EOF'
const plugin = (await import("gdp-ts/lint/plugin")).default;
const eslint = (await import("gdp-ts/lint/eslint")).default;
const oxlint = (await import("gdp-ts/lint/oxlint")).default;
if (!plugin.rules["no-exported-prover"]) throw new Error("plugin rules missing");
if (!Array.isArray(eslint()) || !oxlint().jsPlugins.length) throw new Error("presets malformed");
console.log("lint runtime: ok (no linter installed)");
EOF
node lint-runtime.js

cat > consumer.ts <<'EOF'
import { defineProof, name, type Named, type Proof } from "gdp-ts";

const IsShort = defineProof("IsShort");
interface IsShort<S> extends Proof<"IsShort", [S]> {}

function isShort<S>(s: Named<S, string>): IsShort<S> | null {
  return s.value.length < 5 ? IsShort.prove(s) : null;
}
function shout<S>(s: Named<S, string>, _proof: IsShort<S>): string {
  return s.value.toUpperCase();
}

name("hi", "there", (a, b) => {
  const proof = isShort(a);
  if (!proof) return;
  shout(a, proof);
  // @ts-expect-error the proof is about `a`, not `b`
  shout(b, proof);
});
EOF

cat > lint-consumer.ts <<'EOF'
import eslint, { type GdpLintOptions } from "gdp-ts/lint/eslint";
import oxlint from "gdp-ts/lint/oxlint";

const options: GdpLintOptions = { proofs: ["src/proofs/**"], strict: true };
export const configs = [eslint(options), oxlint(options)];
EOF

for resolution in "nodenext nodenext" "esnext bundler"; do
  set -- $resolution
  npx tsc --noEmit --strict --skipLibCheck false --target es2022 --module "$1" --moduleResolution "$2" consumer.ts lint-consumer.ts
  echo "types: ok (TypeScript $(npx tsc --version | cut -d' ' -f2), module $1, moduleResolution $2)"
done
# node10 predates "exports", so only the main entry point exists there.
npx tsc --noEmit --strict --skipLibCheck false --target es2022 --module commonjs --moduleResolution node10 consumer.ts
echo "types: ok (TypeScript $(npx tsc --version | cut -d' ' -f2), module commonjs, moduleResolution node10, main entry only)"
