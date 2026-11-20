#!/usr/bin/env bash

set -eo pipefail

# File with list of repositories in format:
# [+|-] [name] [path] [URL]
CONFIG_FILE="submodules.conf"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: Configuration file $CONFIG_FILE not found!" >&2
    exit 1
fi

# Function to check if submodule exists at path
submodule_exists() {
    local path="$1"
    grep -q "^\[submodule \"$path\"\]" .gitmodules
}

ADDED_SUBMODULES=()
FAILED_SUBMODULES=()
REMOVED_SUBMODULES=()

while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip comments and empty lines
    [[ "$line" =~ ^# || -z "$line" ]] && continue

    # Split line into components
    read -r action name path repo extra <<< "$line"

    # Check required parameters
    if [[ -z "$repo" || -z "$path" || -n "$extra" || ( "$action" != '+' && "$action" != '-' ) ]]; then
        echo "Error: Invalid entry - $line" >&2
        FAILED_SUBMODULES+=("$line")
        continue
    fi

    if [[ "$action" == "+" ]]; then
        # Check if submodule already exists at the specified path
        if submodule_exists "$path"; then
            echo "Check if submodule already exists at the specified path"
            continue
        fi

        if git submodule add -- "$repo" "$path"; then
            echo "✅ Successfully added: $repo"
            ADDED_SUBMODULES+=("$repo")
        else
            echo "❌ Failed to add: $repo" >&2
            FAILED_SUBMODULES+=("$repo")
        fi
    elif [[ "$action" == "-" ]]; then
        if submodule_exists "$path"; then
            if git submodule deinit -- "$path" && git rm -- "$path"; then
                echo "✅ Successfully removed: $path"
                REMOVED_SUBMODULES+=("$path")
            else
                echo "❌ Failed to remove: $path" >&2
                FAILED_SUBMODULES+=("$path")
            fi
        else
            echo "Submodule $path does not exist, nothing to remove."
        fi
    fi
done < "$CONFIG_FILE"

# Sort .gitmodules
awk 'BEGIN { I=0 ; J=0 ; K="" } ; /^\[submodule/{ N+=1 ; J=1 ; K=$2 ; gsub(/("vendor\/|["\]])/, "", K) } ; { print K, N, J, $0 } ; { J+=1 }' .gitmodules \
    | sort \
    | awk '{ $1="" ; $2="" ; $3="" ; print }' \
    | sed 's/^ *//g' \
    | awk '/^\[/{ print ; next } { print "\t" $0 }' \
    > .gitmodules.sorted

# ВOutput results
if [ "${#ADDED_SUBMODULES[@]}" -gt 0 ]; then
  echo 'Added submodules:'
  printf '\e[32m%s\e[0m\n' "${ADDED_SUBMODULES[@]}"
fi

if [ "${#REMOVED_SUBMODULES[@]}" -gt 0 ]; then
  echo 'Removed submodules:'
  printf '\e[31m%s\e[0m\n' "${REMOVED_SUBMODULES[@]}"
fi

if [ "${#FAILED_SUBMODULES[@]}" -gt 0 ]; then
  echo 'Failed submodule operations:'
  printf '\e[33m%s\e[0m\n' "${FAILED_SUBMODULES[@]}"
fi

cp .gitmodules.sorted .gitmodules
rm .gitmodules.sorted

[[ "${#FAILED_SUBMODULES[@]}" -eq 0 ]]
