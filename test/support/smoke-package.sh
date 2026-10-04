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

for resolution in "nodenext nodenext" "esnext bundler" "commonjs node10"; do
  set -- $resolution
  npx tsc --noEmit --strict --skipLibCheck false --target es2022 --module "$1" --moduleResolution "$2" consumer.ts
  echo "types: ok (TypeScript $(npx tsc --version | cut -d' ' -f2), module $1, moduleResolution $2)"
done
