#!/bin/bash

# E2E Test Runner for Diplodoc Metapackage
#
# This script orchestrates full end-to-end testing of the Diplodoc metapackage:
# 1. Initializes all git submodules to master branch (via git:init)
# 2. Applies optional branch override to all submodules (via git:override)
#    - If branch exists in a submodule, it will be checked out
#    - If branch doesn't exist, submodule stays on master
# 3. Installs all dependencies (npm i)
# 4. Resets node_modules to ensure proper linking (npm run reset -- -u)
# 5. Runs e2e tests from @diplodoc/testpack
#
# Usage:
#   ./test.sh
#   SUBMODULES_OVERRIDE="feature-branch" ./test.sh
#
# Environment Variables:
#   SUBMODULES_OVERRIDE - Branch name to checkout in all submodules
#                         Example: "feature-xyz" or "fix/issue-123"

set -e

npm run git:init
npm run git:apply -- "$SUBMODULES_OVERRIDE"

npm i

npm run reset -- -u
npm run test