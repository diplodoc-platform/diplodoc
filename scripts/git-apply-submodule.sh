#!/bin/bash

# Git Submodule Branch Apply - Submodule Handler
#
# This script is called by git-apply.sh for each submodule.
# It processes a single submodule: checks for changes, normalizes line endings,
# and checks out the specified branch (or default branch if not found).
#
# This script runs in bash context (not sh), so we can use bash features like 'local'.
#
# Environment variables (set by git-apply.sh):
#   BRANCH_NAME - Branch name to checkout
#   UNSAFE_MODE - 1 if unsafe mode enabled, 0 otherwise
#   name - Submodule name (from git submodule foreach)
#   path - Submodule path (from git submodule foreach)

set -e

# Helper function to handle errors based on unsafe mode
handle_error() {
    local error_msg="$1"
    local warning_msg="$2"
    
    if [[ $UNSAFE_MODE -eq 1 ]]; then
        echo "   ⚠️  WARNING: $warning_msg (unsafe mode, continuing)..."
        return 0
    else
        echo "   ❌ ERROR: $error_msg"
        [[ -n "$3" ]] && echo "   $3"
        return 1
    fi
}

# Helper function to get default branch (master or main)
get_default_branch() {
    # Try to get default branch from remote HEAD
    local default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s@^refs/remotes/origin/@@")
    if [[ -n "$default_branch" ]]; then
        echo "$default_branch"
        return 0
    fi
    
    # Fallback: try common branch names
    for branch in master main; do
        if git ls-remote --heads origin "$branch" 2>/dev/null | grep -q "$branch"; then
            echo "$branch"
            return 0
        fi
    done
    
    # Last resort: use current branch if it exists
    local current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [[ -n "$current_branch" && "$current_branch" != "HEAD" ]]; then
        echo "$current_branch"
    else
        # Ultimate fallback
        echo "master"
    fi
}

# Helper function to checkout and pull a branch
try_checkout_pull() {
    local branch="$1"
    local description="$2"
    
    if git checkout "$branch" 2>/dev/null && git pull origin "$branch" 2>/dev/null; then
        echo "   ✅ Successfully checked out and pulled \"$branch\""
        return 0
    else
        handle_error "Failed to checkout/pull $description" "Failed to checkout/pull $description"
        return $?
    fi
}

echo "📦 Processing: $name"

# Check for local changes (both staged and unstaged)
# Normalize line endings first (CRLF -> LF) to avoid false positives
git config core.autocrlf input 2>/dev/null || true

# Check for unstaged changes
has_unstaged=false
if [[ -n "$(git diff --name-only 2>/dev/null)" ]]; then
    has_unstaged=true
fi

# Check for staged changes
has_staged=false
if [[ -n "$(git diff --cached --name-only 2>/dev/null)" ]]; then
    has_staged=true
fi

if [[ "$has_unstaged" == true || "$has_staged" == true ]]; then
    # Check if changes are only line endings (ignore whitespace and line endings)
    diff_output=$(git diff --ignore-all-space --ignore-cr-at-eol 2>/dev/null)
    cached_diff_output=$(git diff --cached --ignore-all-space --ignore-cr-at-eol 2>/dev/null)
    
    if [[ -z "$diff_output" && -z "$cached_diff_output" ]]; then
        # Only line ending changes, normalize them automatically
        git add -A
        # Try to commit, but don't fail if it's not possible (e.g., in CI without commit permissions)
        if git commit -m "chore: normalize line endings" 2>/dev/null; then
            echo "   ✅ Normalized line endings"
        else
            # In CI or if commit fails, just reset the changes
            echo "   ℹ️  Line ending changes detected, resetting (commit not possible)..."
            git reset --hard HEAD 2>/dev/null || true
            git clean -fd 2>/dev/null || true
        fi
    else
        # Real changes
        if ! handle_error "Submodule has uncommitted changes!" "Submodule has uncommitted changes" "Please commit or discard changes before running this script, or use --unsafe flag."; then
            git status --short
            exit 1
        fi
        git status --short
        echo "   ⏭️  Skipping this submodule..."
        echo ""
        exit 0
    fi
fi

# Fetch latest changes
if ! git fetch --quiet origin; then
    if ! handle_error "Failed to fetch from origin" "Failed to fetch"; then
        exit 1
    fi
    echo ""
    exit 0
fi

# Check if branch exists remotely and checkout/pull
if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
    echo "   ✅ Branch \"$BRANCH_NAME\" exists, checking out..."
    try_checkout_pull "$BRANCH_NAME" "branch"
else
    default_branch=$(get_default_branch)
    echo "   ℹ️  Branch \"$BRANCH_NAME\" not found, using default branch: $default_branch..."
    try_checkout_pull "$default_branch" "default branch ($default_branch)"
fi

echo ""
