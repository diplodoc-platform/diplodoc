import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { loadYaml } from './release-train/yaml-loader.js';

for (const [filename, job, command] of [
  ['update-submodules.yml', 'update-submodules', 'npm run deps-graph'],
  ['deps-graph-check.yml', 'deps-graph-check', 'npm run deps-graph:check'],
]) {
  test(`${filename} isolates YAML tooling from workspace dependencies`, () => {
    const workflow = loadYaml(
      new URL(`../.github/workflows/${filename}`, import.meta.url),
    );
    const steps = workflow.jobs[job].steps;
    const install = steps.find((step) => step.id === 'yaml-tools');
    assert.ok(install, 'expected a dedicated YAML tooling step');
    assert.match(
      install.run,
      /mktemp -d "\$RUNNER_TEMP\/diplodoc-yaml\.XXXXXX"/,
    );
    assert.match(install.run, /npm install --prefix "\$yaml_tools_dir"/);
    for (const flag of [
      '--no-save',
      '--package-lock=false',
      '--workspaces=false',
      '--ignore-scripts',
    ]) {
      assert.ok(install.run.includes(flag), `missing isolation flag: ${flag}`);
    }
    assert.doesNotMatch(install.run, /--legacy-peer-deps|--force/);
    assert.match(install.run, /node-path=\$yaml_tools_dir\/node_modules/);
    assert.match(install.run, /"\$GITHUB_OUTPUT"/);
    assert.equal(
      steps.find((step) => step.run === command)?.env?.NODE_PATH,
      '${{ steps.yaml-tools.outputs.node-path }}',
    );
  });
}

test('workspace i18next peers use the declared root TypeScript like standalone components', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.ok(manifest.dependencies.typescript);
  for (const name of ['i18next', 'react-i18next']) {
    assert.ok(
      manifest.devDependencies[name],
      `${name} must be resolved at the root`,
    );
    assert.equal(manifest.overrides[name]?.typescript, '$typescript');
  }
});

test('workspace lock keeps the shared i18next packages and declared TypeScript', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const { packages } = JSON.parse(
    readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
  );
  for (const name of ['i18next', 'react-i18next']) {
    assert.ok(
      packages[`node_modules/${name}`],
      `missing ${name} in workspace lock`,
    );
    assert.equal(
      packages[''].devDependencies[name],
      manifest.devDependencies[name],
    );
  }
  assert.equal(
    packages['node_modules/typescript'].version,
    manifest.dependencies.typescript,
  );
  for (const [location, entry] of Object.entries(packages)) {
    if (location.endsWith('/node_modules/typescript')) {
      assert.notEqual(
        entry.name,
        '@typescript/typescript6',
        `stale TypeScript alias: ${location}`,
      );
    }
  }
});
