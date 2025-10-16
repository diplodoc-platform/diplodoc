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
#
# Usage:
#   ./git-apply.sh                    # All submodules to master (default)
#   ./git-apply.sh <branch_name>      # Apply specific branch
#   ./git-apply.sh feature-branch     # Example
#
# Arguments:
#   $1 - Branch name to checkout in submodules (optional, defaults to master)
#        If not provided or empty, all submodules will be checked out to master

set -e

BRANCH_NAME="${1:-master}"

# If no branch name provided, default to master
if [[ -z "$1" ]]; then
  echo "No branch specified, using default: master"
  echo ""
fi

echo "========================================="
echo "Applying branch: $BRANCH_NAME"
echo "========================================="
echo ""

# Export variables for use in submodule foreach
export BRANCH_NAME

# Use git submodule foreach to process each submodule
git submodule foreach --quiet '
  echo "📦 Processing: $name"
  
  # Check for local changes (both staged and unstaged)
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "   ❌ ERROR: Submodule has uncommitted changes!"
    echo "   Please commit or discard changes before running this script."
    git status --short
    exit 1
  fi
  
  # Fetch latest changes
  git fetch --quiet origin
  
  # Check if branch exists remotely
  if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
    echo "   ✅ Branch \"$BRANCH_NAME\" exists, checking out..."
    git checkout "$BRANCH_NAME"
    git pull origin "$BRANCH_NAME"
  else
    echo "   ℹ️  Branch \"$BRANCH_NAME\" not found, keeping master..."
    git checkout master
    git pull origin master
  fi
  
  echo ""
'