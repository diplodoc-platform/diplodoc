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
} else {
    if (!flags.quick) {
        for (const root of ROOTS) {
            await $`cd ${root} && npm i --no-workspaces`;
        }

        await $`npm i --no-workspaces`;
    }
}