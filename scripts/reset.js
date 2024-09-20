#!/usr/bin/env node

import {$} from 'zx';
import {roots} from './nx.js';
import process from "node:process";

const FLAGS = process.argv.slice(2).filter((arg) => /^-/.test(arg));
const ROOTS = await roots();

const metapackage = FLAGS.includes('--metapackage') || FLAGS.includes('-u');

for (const root of ROOTS) {
    await $`rm -rf ${root}/node_modules`;
}

await $`rm -rf node_modules`;

if (metapackage) {
    await $`npm i`;
} else {
    for (const root of ROOTS) {
        await $`cd ${root} && npm i --no-workspaces`;
    }

    await $`npm i --no-workspaces`;
}