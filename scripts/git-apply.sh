#!/bin/bash

# Git Submodule Branch Apply
#
# This script applies a specific branch to all git submodules.
# If the branch exists in a submodule, it will be checked out.
# If the branch doesn't exist, the submodule will be checked out to master.
#
# This script replaces the old git-head.sh and provides more flexibility
# by allowing to specify any branch name instead of hardcoded master.
#
# Features:
# - Checks for uncommitted changes before switching branches
# - Fails with error if any submodule has local modifications
# - Ensures clean state for reliable branch switching
# - Optional --unsafe flag to ignore checkout failures
#
# Usage:
#   ./git-apply.sh                           # All submodules to master (default)
#   ./git-apply.sh <branch_name>             # Apply specific branch
#   ./git-apply.sh <branch_name> --unsafe    # Apply branch, ignore failures
#   ./git-apply.sh feature-branch            # Example
#   ./git-apply.sh feature-branch --unsafe   # Example with unsafe mode
#
# Arguments:
#   $1 - Branch name to checkout in submodules (optional, defaults to master)
#        If not provided or empty, all submodules will be checked out to master
#   $2 - --unsafe flag (optional). If set, ignores checkout failures and continues

set -e

# Parse arguments - simplified
BRANCH_NAME=""
UNSAFE_MODE=0

for arg in "$@"; do
  if [[ "$arg" == "--unsafe" ]]; then
    UNSAFE_MODE=1
  elif [[ "$arg" != --* ]]; then
    BRANCH_NAME="$arg"
  fi
done

# Default to master if no branch specified
if [[ -z "$BRANCH_NAME" ]]; then
  BRANCH_NAME="master"
  echo "No branch specified, using default: master"
  echo ""
fi

echo "========================================="
echo "Applying branch: $BRANCH_NAME"
[[ $UNSAFE_MODE -eq 1 ]] && echo "Mode: UNSAFE (ignoring checkout failures)" || echo "Mode: SAFE (strict error checking)"
echo "========================================="
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Export variables for use in submodule script
export BRANCH_NAME
export UNSAFE_MODE

# Use git submodule foreach to process each submodule
# Call the separate bash script for each submodule
git submodule foreach --quiet "bash \"$SCRIPT_DIR/git-apply-submodule.sh\""