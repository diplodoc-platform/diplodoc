#!/usr/bin/env bash

set -e

if [[ -z "$(which git)" ]]; then
    echo "Required `git` binary not detected!";
    exit 1;
fi

echo "Init submodules"

if [[ "$CODESPACES" == "true" ]] || [[ "$USE_GIT_ENDPOINTS" == "true" ]]; then
    echo "Modify codespaces environment"
    git config --global url."https://".insteadOf git://
    git config --global url."https://github.com/".insteadOf git@github.com:
fi

git submodule update --init --recursive -j 30 | grep "Submodule path" || true;
