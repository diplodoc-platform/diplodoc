#!/usr/bin/env node

// npm run deps update

import {$} from 'zx';
import {roots, json} from './nx.js';
import process from 'node:process';

const not = (actor) => (...args) => !actor(...args);
const FLAGS = (arg) => /^-/.test(arg);

const command = process.argv[2];
const args = process.argv.slice(3).filter(not(FLAGS));
const flags = process.argv.slice(3).filter(FLAGS);

switch (command) {
    case 'update': await update(); break;
    default: throw 'Unknown command ' + command;
}

async function update() {
    const dryRun = flags.includes('--dry-run');
    const commit = flags.includes('--commit');
    const deps = args.slice();
    const projects = await roots();

    const work = [];

    for (const root of projects) {
        const pkg = json(`${root}/package.json`);

        for (const dep of deps) {
            const [, name, version = 'latest'] = /^(.+?)(?:@(.+?))?$/.exec(dep);

            for (const [key, mode] of [
                ['dependencies', '--save'],
                ['devDependencies', '--save-dev'],
            ]) {
                const dependencies = pkg[key] || {};

                if (dependencies[name] && dependencies[name] !== '*') {
                    work.push({pkg: pkg.name, name, key, mode, root, prev: dependencies[name], next: version});
                }
            }
        }
    }

    if (!work.length) {
        return;
    }

    const groups = groupBy('pkg', work);
    for (const [pkg, deps] of groups) {
        console.log(`[${pkg}]:`);

        const groups = groupBy('key', deps);
        for (const [key, deps] of groups) {
            console.log(`  ${key}:`);

            const {root, mode} = deps[0];
            const log = deps.map(({name, prev, next}) => `    ${name}: ${prev} -> ${next}`);
            const next = deps.map(({name, next}) => `${name}@${next}`);

            console.log(log.join('\n'));

            if (dryRun) {
                continue;
            }

            await $`
                cd ${root} 
                npm i ${next} ${mode} --no-workspaces
                npm i ${next} ${mode}
            `;

            if (commit) {
                const diff = await $`cd ${root}; git status -s`;
                const isDirty = diff.stdout.match('package.json') || diff.stdout.match('package-lock.json');

                if (!isDirty) {
                    continue;
                }

                const message = 'deps: ' + deps.map(({name, prev, next}) => `${name}[${prev}->${next}]`).join(', ');
                await $`
                    cd ${root}
                    git add package.json package-lock.json 
                    git commit -m ${message}
                `;
            }
        }
    }
}

function groupBy(key, collection) {
    return Object.entries(collection.reduce((result, entry) => {
        const prop = entry[key];

        result[prop] = result[prop] || [];
        result[prop].push(entry);

        return result;
    }, {}));
}

