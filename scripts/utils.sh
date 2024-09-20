#!/usr/bin/env bash

SCRIPT=$(cat <<EOF
    const graph = require('./graph.json');
    const roots = Object.values(graph.graph.nodes).map((entry) => entry.data.root);

    roots.join('\n');
EOF)

function projects {
  npx nx graph --file=graph.json > /dev/null
  node -pe "$SCRIPT"
  rm -f graph.json
}
