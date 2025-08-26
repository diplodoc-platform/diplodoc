#!/bin/bash

# File with exceptions
EXCEPTIONS_FILE=".gitmodules-ignore"
# File with current submodules
GITMODULES_FILE=".gitmodules"
# Output file
SUBMODULES_CONF="submodules.conf"
# Temporary file for unique lines
TEMP_CONF="submodules.conf.tmp"

# Get list of repositories from GitHub
REPOS_URL="https://api.github.com/orgs/diplodoc-platform/repos?per_page=100"
REPOS=$(curl -s $REPOS_URL | jq -r '.[] | [.name, .ssh_url] | @tsv' | sort)

# Read exceptions
EXCEPTIONS=$(cat $EXCEPTIONS_FILE)

# Read current submodules
CURRENT_SUBMODULES=$(grep 'submodule' $GITMODULES_FILE | sed 's/^\[submodule "\(.*\)"\]$/\1/' | sort)

# Save comments from the beginning of submodules.conf file
HEAD_COMMENTS=$(head -n $(grep -n '^[^#]' $SUBMODULES_CONF | cut -d: -f1 | head -n 1) $SUBMODULES_CONF)

# Clear temporary file and write comments
> $TEMP_CONF
echo "$HEAD_COMMENTS" >> $TEMP_CONF

# Function to determine submodule path
determine_path() {
    local repo_name=$1
    if [[ $repo_name == *"-action" ]]; then
        echo "actions/${repo_name%-action}"
    elif [[ $repo_name == *"-extension" ]]; then
        echo "extensions/${repo_name%-extension}"
    else
        echo "${repo_name}"
    fi
}

# Go through all repositories and compare with current submodules
while IFS=$'\t' read -r repo_name repo_url; do
    # Check if repository is an exception
    if echo "$EXCEPTIONS" | grep -q -w "$repo_name"; then
        printf "\e[33m%s\e[0m is ignored\n" "$repo_name"
        continue
    fi

    # Determine path for new submodule
    submodule_path=$(determine_path "$repo_name")
    # Check if repository exists in current submodules
    if ! echo "$CURRENT_SUBMODULES" | grep -q -w "$submodule_path"; then
        # Form line to add
        new_line="+ $submodule_path $submodule_path $repo_url"
        # Add line to temporary file if it's not already there
        if ! grep -qF -- "$new_line" $TEMP_CONF; then
            echo "$new_line" >> $TEMP_CONF
            printf "\e[32m%s\e[0m exists on GitHub but not in .gitmodules\n" "$repo_name"
        fi
    fi
done <<< "$REPOS"

# Check which submodules exist in .gitmodules but not in GitHub
for submodule in $CURRENT_SUBMODULES; do
    submodule_name=$(basename $submodule)
    if ! echo "$REPOS" | grep -q -w "$submodule_name"; then
        # Find URL for submodule to remove
        submodule_url=$(grep -A 2 "\[submodule \"$submodule\"\]" $GITMODULES_FILE | grep 'url =' | sed 's/url = //' | sed 's/^ *//')
        # Form line to remove
        remove_line="- $submodule $submodule $(echo $submodule_url | xargs)"
        # Add line to temporary file if it's not already there
        if ! grep -qF -- "$remove_line" $TEMP_CONF; then
            echo "$remove_line" >> $TEMP_CONF
            printf "\e[31m%s\e[0m exists in .gitmodules but not on GitHub\n" "$submodule"
        fi
    fi
done

# Overwrite main file with unique lines
mv $TEMP_CONF $SUBMODULES_CONF
