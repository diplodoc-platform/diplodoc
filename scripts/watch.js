#!/usr/bin/env node

import {$, minimist} from 'zx';
import {roots} from './nx.js';

const PROJECT = '@diplodoc/testpack';
const DOCS_INPUT = 'devops/testpack/docs/input';
const DOCS_OUTPUT = 'devops/testpack/docs/output';

const ROOTS = await roots();

// Unlink non local diplodoc packages
for (const root of ROOTS) {
    await $`rm -rf ${root}/node_modules/@diplodoc`;
}

$.stdio = ["inherit", "pipe", "pipe"];

console.log('Build CLI');
await quiet($`nx build ${PROJECT} --parallel=5 --verbose`);

console.log('Build testpack documentation');
await quiet($`docs -i ${DOCS_INPUT} -o ${DOCS_OUTPUT}`);

console.log('Start documentation server');
await wait('Documentations served', $({cwd: 'devops/testpack'})`npm start`);

console.log('Start watching');
await quiet($`nx watch -d -p ${PROJECT} -- nx build @diplodoc/cli --parallel=5 --verbose \\&\\& docs -i ${DOCS_INPUT} -o ${DOCS_OUTPUT}`);

async function wait(match, command) {
    let resolve
    const promise = new Promise((_resolve) => {
        resolve = _resolve;
    });

    (async () => {
        for await (const chunk of command.stdout) {
            const lines = String(chunk).split('\n');

            for (const line of lines) {
                if (line.includes(match)) {
                    console.log(line);
                    resolve();
                }
            }
        }
    })();

    (async () => {
        for await (const chunk of command.stderr) {
            const lines = String(chunk).split('\n');

            for (const line of lines) {
                if (line.includes(match)) {
                    console.log(line);
                    resolve();
                }
            }
        }
    })();

    return promise;
}

async function quiet(command) {
    (async () => {
        for await (const chunk of command.stdout) {
            const lines = String(chunk).split('\n');

            for (const line of lines) {
                if (line.includes('> nx run @diplodoc')) {
                    if (!line.includes('left as is')) {
                        console.log(line);
                    }
                }

                if (line.match(/^Build time:/)) {
                    console.log(line);
                }
            }
        }
    })();

    (async () => {
        for await (const chunk of command.stderr) {
            const lines = String(chunk).split('\n');

            for (const line of lines) {
                if (line.includes('npm warn config ignoring workspace config')) {
                    continue;
                }

                console.log(line);
            }
        }
    })();

    return command;
}