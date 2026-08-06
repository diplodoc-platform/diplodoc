#!/bin/bash
# Fast type check with the native TypeScript 7 compiler.
#
#   scripts/typecheck-native.sh                # every project in the repo
#   scripts/typecheck-native.sh packages/cli   # a single project
#
# Why a script instead of a plain devDependency: `typescript@7` ships a `tsc`
# binary, and so does `typescript@6`. Installing both makes `node_modules/.bin/tsc`
# resolve to whichever npm linked last - verified to pick 7 - so builds, ESLint and
# ts-jest would silently switch compilers. Keeping the native compiler in a cache
# directory outside the dependency tree removes that ambiguity: `tsc` always means
# the version declared in package.json, and TypeScript 7 is only ever reached
# through this script.
#
# The compiler is a type check only. Emit, publishing and linting stay on the
# version from package.json.

set -u

TS_NATIVE_VERSION="${TS_NATIVE_VERSION:-7.0.2}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/node_modules/.cache/ts-native/$TS_NATIVE_VERSION"
TSC="$CACHE/node_modules/typescript/bin/tsc"

if [ ! -x "$TSC" ] && [ ! -f "$TSC" ]; then
  echo "Installing typescript@$TS_NATIVE_VERSION into $CACHE"
  mkdir -p "$CACHE"
  printf '{"name":"ts-native-cache","private":true,"version":"1.0.0"}\n' > "$CACHE/package.json"
  ( cd "$CACHE" && npm install --silent --no-audit --no-fund --no-package-lock \
      "typescript@$TS_NATIVE_VERSION" >/dev/null ) || {
    echo "failed to install typescript@$TS_NATIVE_VERSION" >&2
    exit 1
  }
fi

if [ $# -gt 0 ]; then
  TARGETS="$*"
else
  # Nested projects are listed explicitly: they are not part of the workspaces.
  TARGETS="$(ls -d devops/*/ extensions/*/ packages/*/ 2>/dev/null) packages/transform/e2e packages/transform/playground"
fi

FAILED=""
TOTAL=0
CHECKED=0

for dir in $TARGETS; do
  dir="${dir%/}"
  [ -f "$ROOT/$dir/tsconfig.json" ] || continue
  CHECKED=$((CHECKED + 1))

  START=$(date +%s%N)
  OUT="$( cd "$ROOT/$dir" && node "$TSC" --noEmit -p tsconfig.json 2>&1 )"
  STATUS=$?
  MS=$(( ($(date +%s%N) - START) / 1000000 ))
  TOTAL=$((TOTAL + MS))

  if [ $STATUS -eq 0 ]; then
    printf '%-32s ok   %6s ms\n' "$dir" "$MS"
  else
    printf '%-32s FAIL %6s ms  (%s errors)\n' "$dir" "$MS" "$(echo "$OUT" | grep -c 'error TS')"
    echo "$OUT" | grep 'error TS' | head -10 | sed 's/^/    /'
    FAILED="$FAILED $dir"
  fi
done

echo "---"
echo "checked $CHECKED projects in ${TOTAL} ms with typescript@$TS_NATIVE_VERSION"

if [ -n "$FAILED" ]; then
  echo "failed:$FAILED"
  exit 1
fi
