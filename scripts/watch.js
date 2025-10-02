#!/usr/bin/env node

import {$} from 'zx';
import {log} from 'zx/core'
import {roots} from './nx.js';
import {Transform} from 'node:stream';

const PROJECT = '@diplodoc/testpack';

const ROOTS = await roots();

// Unlink non local diplodoc packages
for (const root of ROOTS) {
    await $`rm -rf ${root}/node_modules/@diplodoc`;
}

$.stdio = ["inherit", "pipe", "pipe"];
$.log = (entry) => {
    if (entry.kind === 'stderr') {
        const message = String(entry.data);
        if (message.includes('npm warn config ignoring workspace config')) {
            return;
        }
    }
    log(entry);
};

try {
    console.log('Build CLI');
    await $`nx build ${PROJECT} --parallel=5 --verbose`;
} catch (error) {
    show(error);
    throw error
}

console.log('Build testpack docs');
const docs = await Docs();

console.log('Serve testpack docs');
const server = await Server(3001);

console.log('Start watching');
const build = $`
    NX_DAEMON=true nx watch -d -p ${PROJECT} -- \\
        echo CHANGED: \\$NX_FILE_CHANGES \\&\\& \\
        nx build @diplodoc/cli --parallel=5 --verbose \\&\\& \\
        echo built
`;

watch(build, [
    ['built', docs.restart],
    ['> nx run @diplodoc', (line) => {
        if (!line.includes('left as is')) {
            console.log(line);
        }
    }],
]);

async function wait(match, process) {
    return new Promise((resolve) => {
        process.pipe(read((line) => {
            if (line.includes(match)) {
                console.log(line);
                resolve(line);
            }
        }));
    });
}

async function watch(process, matchers) {
    process.pipe(read(async (line) => {
        for (const [match, action] of matchers) {
            if (line.includes(match)) {
                console.log(line);
                await action(line);
            }
        }
    }));
}

function read(action) {
    return new Transform({
        async transform(chunk, encoding, callback) {
            callback(null, chunk);
            for (const line of String(chunk).split('\n')) {
                await action(line);
            }
        },
    });
}

function show(error) {
    console.error(error.stdout);
    if (error.stderr) {
        console.error(error.stderr);
    }
}

function Docs() {
    const result = {
        command: null,
        restart: async function() {
            if (result.command) {
                await result.command.kill();
                console.log('Restart docs watch');
            }

            result.command = $({cwd: 'devops/testpack'})`npm run docs`;

            result.command.catch((error) => show(error))

            await wait('Build time', result.command);

            return result;
        },
    };

    process.on('uncaughtException', () => result.command.kill());

    return result.restart();
}

function Server(port) {
    const result = {
        command: null,
        restart: async function() {
            if (result.command) {
                await result.command.kill();
                console.log('Restart docs server');
            }

            result.command = $({cwd: 'devops/testpack'})`PORT=${port} npm run serve`;

            result.command.catch((error) => show(error));

            await wait('Documentation served', result.command);

            return result;
        },
    };

    process.on('uncaughtException', (e) => {
        console.error(e);
        result.command.kill();
    });

    return result.restart();
}


// Добавить алголию
// Добавить логирование в файл
// Добавить вывод ошибок для свалившихся подпрограмм