#!/usr/bin/env bash

set -e

if [[ -z "$(which git)" ]]; then
    echo "Required `git` binary not detected!";
    exit 1;
fi

echo "Init submodules"

if [[ "$CODESPACES" -eq "true" ]]; then
    git config --local url."https://github.com/".insteadOf git@github.com:
fi

git submodule update --init --recursive -j 8 | grep "Submodule path" || true;
