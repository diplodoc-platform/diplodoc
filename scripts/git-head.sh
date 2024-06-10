#!/usr/bin/env bash

set -e

if [[ -z "$(which git)" ]]; then
    echo "Required `git` binary not detected!";
    exit 1;
fi

echo "Update submodules to master HEAD"

git submodule foreach 'git checkout master && git pull || true';
