#!/usr/bin/env node

import {$, minimist} from 'zx';
import {roots} from './nx.js';
import process from 'node:process';

const ROOTS = await roots();
const flags = minimist(process.argv.slice(2), {
    boolean: ['metapackage', 'quick'],
    alias: {
        u: 'metapackage',
        q: 'quick',
    },
    default: {
        quick: false,
        metapackage: true,
    }
});

if (!flags.quick) {
    for (const root of ROOTS) {
        await $`rm -rf ${root}/node_modules`;
    }

    await $`rm -rf node_modules`;
}

if (flags.metapackage) {
    if (!flags.quick) {
        await $`npm i`;
    }

    for (const root of ROOTS) {
        await $`rm -rf ${root}/node_modules/@diplodoc`;
    }

    // @diplodoc/infra is a workspace, so npm keeps a single link for it in the
    // root node_modules and never places a copy next to a consumer. Tools that
    // walk up node_modules find it there; Playwright does not — it resolves the
    // "extends" specifier of a tsconfig only against node_modules adjacent to
    // that file, and devops/testpack dies with "Failed to resolve extends path
    // @diplodoc/infra/tsconfig.json". Link the workspace back into every root so
    // a shallow resolver sees it too.
    const infra = ROOTS.find((root) => root.endsWith('/infra'));
    if (infra) {
        for (const root of ROOTS) {
            if (root === infra) {
                continue;
            }

            const back = '../'.repeat(root.split('/').length + 2);

            await $`mkdir -p ${root}/node_modules/@diplodoc`;
            await $`ln -sfn ${back + infra} ${root}/node_modules/@diplodoc/infra`;
        }
    }
} else {
    if (!flags.quick) {
        for (const root of ROOTS) {
            await $`cd ${root} && npm i --no-workspaces`;
        }

        await $`npm i --no-workspaces`;
    }
}