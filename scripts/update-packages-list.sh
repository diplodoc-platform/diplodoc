#!/usr/bin/env bash

# Script to update the packages list in update-deps.yml workflow
# This script extracts packages from .gitmodules (packages/ and extensions/ only)
# and updates the workflow file with the current list

set -e

GITMODULES_FILE=".gitmodules"
WORKFLOW_FILE="devops/lint/scaffolding/.github/workflows/update-deps.yml"

if [[ ! -f "$GITMODULES_FILE" ]]; then
    echo "Error: $GITMODULES_FILE not found!" >&2
    exit 1
fi

if [[ ! -f "$WORKFLOW_FILE" ]]; then
    echo "Error: $WORKFLOW_FILE not found!" >&2
    exit 1
fi

# Packages to exclude from the list (they have their own release workflows)
EXCLUDED_PACKAGES=("cli")

# Extract packages and extensions from .gitmodules
packages=()
extensions=()

while IFS= read -r line; do
    if [[ "$line" =~ path\ =\ packages/([^[:space:]]+) ]]; then
        pkg_name="${BASH_REMATCH[1]}"
        # Check if package is in exclusion list
        excluded=false
        for excl in "${EXCLUDED_PACKAGES[@]}"; do
            if [[ "$pkg_name" == "$excl" ]]; then
                excluded=true
                break
            fi
        done
        if ! $excluded; then
            packages+=("$pkg_name")
        fi
    elif [[ "$line" =~ path\ =\ extensions/([^[:space:]]+) ]]; then
        extensions+=("${BASH_REMATCH[1]}")
    fi
done < "$GITMODULES_FILE"

# Sort arrays
IFS=$'\n' packages=($(sort <<<"${packages[*]}")); unset IFS
IFS=$'\n' extensions=($(sort <<<"${extensions[*]}")); unset IFS

# Create temporary file for new workflow content
TEMP_FILE=$(mktemp)

# Read workflow file and find the options section to replace
in_package_input=false
in_options=false
options_written=false

while IFS= read -r line; do
    # Detect package input section
    if [[ "$line" =~ ^[[:space:]]*package: ]]; then
        in_package_input=true
        echo "$line" >> "$TEMP_FILE"
        continue
    fi
    
    # Detect version input section (end of package input)
    if [[ "$line" =~ ^[[:space:]]*version: ]]; then
        in_package_input=false
        in_options=false
        echo "$line" >> "$TEMP_FILE"
        continue
    fi
    
    # Inside package input section
    if $in_package_input; then
        # Write default value
        if [[ "$line" =~ ^[[:space:]]*default: ]]; then
            echo "        default: '@diplodoc/transform'" >> "$TEMP_FILE"
            continue
        fi
        
        # Detect options start
        if [[ "$line" =~ ^[[:space:]]*options: ]]; then
            in_options=true
            echo "$line" >> "$TEMP_FILE"
            
            # Write packages
            echo "          # === packages ===" >> "$TEMP_FILE"
            for pkg in "${packages[@]}"; do
                echo "          - '@diplodoc/$pkg'" >> "$TEMP_FILE"
            done
            
            # Write extensions
            echo "          # === extensions ===" >> "$TEMP_FILE"
            for ext in "${extensions[@]}"; do
                echo "          - '@diplodoc/$ext-extension'" >> "$TEMP_FILE"
            done
            
            options_written=true
            continue
        fi
        
        # Skip old options entries (lines starting with - or # inside options)
        if $in_options; then
            if [[ "$line" =~ ^[[:space:]]*-[[:space:]] ]] || [[ "$line" =~ ^[[:space:]]*#[[:space:]] ]]; then
                continue
            fi
        fi
        
        # Write default and type lines
        echo "$line" >> "$TEMP_FILE"
        continue
    fi
    
    # Write all other lines
    echo "$line" >> "$TEMP_FILE"
done < "$WORKFLOW_FILE"

# Replace original file
mv "$TEMP_FILE" "$WORKFLOW_FILE"

echo "✅ Updated $WORKFLOW_FILE with current packages list"
echo ""
echo "Packages (${#packages[@]}):"
printf "  - %s\n" "${packages[@]}"
echo ""
echo "Extensions (${#extensions[@]}):"
printf "  - %s\n" "${extensions[@]}"