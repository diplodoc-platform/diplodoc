#!/usr/bin/env bash

set -e

. ./git-init.sh
. ./git-head.sh

# maybe npm ci?
npm install
npx nx build
