/**
 * Shared YAML loader with fallback to devops/infra's js-yaml install.
 * Used by config.js, deps-graph.js, sync-release-train-repos.js so the
 * resolution logic lives in exactly one place.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

let cachedYaml = null;

function resolveYamlModule() {
  if (cachedYaml) return cachedYaml;
  try {
    cachedYaml = require('js-yaml');
    return cachedYaml;
  } catch {
    const infraRequire = createRequire(join(ROOT, 'devops/infra/package.json'));
    cachedYaml = infraRequire('js-yaml');
    return cachedYaml;
  }
}

/** Load and parse a YAML file, falling back to devops/infra's js-yaml if not hoisted. */
export function loadYaml(path) {
  const yaml = resolveYamlModule();
  return yaml.load(readFileSync(path, 'utf8'));
}

/** Dump a JS value as YAML text using the same resolved js-yaml module. */
export function dumpYaml(value, options) {
  const yaml = resolveYamlModule();
  return yaml.dump(value, options);
}
