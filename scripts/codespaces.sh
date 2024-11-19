#!/usr/bin/env bash

set -e

GITHUB_TOKEN= gh auth login --with-token <<< $GITHUB_TOKEN
GITHUB_TOKEN= gh auth refresh --scopes repo

unset GITHUB_TOKEN