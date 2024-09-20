import {$} from 'zx';
import {resolve} from 'node:path';
import {readFileSync, unlinkSync} from 'node:fs';

export function json(path) {
    const data = readFileSync(path, 'utf8');

    return JSON.parse(data);
}

export async function graph() {
    const file = resolve('graph.json');

    await $`npx nx graph --file=${file}`;

    const data = json(file);

    unlinkSync(file);

    return data.graph;
}

export async function roots() {
    return Object.values((await graph()).nodes).map((entry) => entry.data.root);
}