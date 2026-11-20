#!/usr/bin/env node

import {$, minimist} from 'zx';
import {readdir, rm} from 'node:fs/promises';
import process from 'node:process';

import {json, roots} from './nx.js';

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

    const {packages} = json('package-lock.json');
    const infra = ROOTS.find((root) => root.endsWith('/infra'));

    for (const root of ROOTS) {
        const scope = `${root}/node_modules/@diplodoc`;
        const entries = await readdir(scope).catch((error) => {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        });

        // Remove leftovers from standalone installs and keep the workspace
        // lockfile's nested resolutions, including versions that differ from
        // the root workspace link.
        for (const entry of entries) {
            const location = `${scope}/${entry}`;
            if (!packages[location]) {
                await rm(location, {recursive: true, force: true});
            }
        }

        // Playwright resolves tsconfig extends against the adjacent node_modules.
        // Add the Infra workspace link when npm did not install a local copy.
        const infraLocation = `${scope}/infra`;
        if (!infra || root === infra || packages[infraLocation]) {
            continue;
        }

        const back = '../'.repeat(root.split('/').length + 2);

        await $`mkdir -p ${scope}`;
        await $`ln -sfn ${back + infra} ${infraLocation}`;
    }
} else {
    if (!flags.quick) {
        for (const root of ROOTS) {
            await $`cd ${root} && npm i --no-workspaces`;
        }

        await $`npm i --no-workspaces`;
    }
}
