#!/usr/bin/env bash

set -e

ROOT=$(dirname $0)

. $ROOT/git-init.sh
. $ROOT/git-apply.sh master

# maybe npm ci?
echo "Install dependencies"
npm i

npm run reset -- -u -q

echo "Build CLI"
npx nx build @diplodoc/cli

npm i