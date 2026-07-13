#!/usr/bin/env node
/**
 * Final release train report from status artifacts.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { publishSummary, renderSummaryTable } from './render-summary.js';

const statusDir = process.argv[2] || '.release-train-status';
const stateFile = process.argv[3] || 'train-state.json';

let state;
if (existsSync(stateFile)) {
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
} else if (existsSync(statusDir)) {
  const packages = readdirSync(statusDir)
    .filter((f) => f.startsWith('status-') && f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${statusDir}/${f}`, 'utf8')));
  state = { branchName: process.env.BRANCH_NAME || '', packages, dryRun: false };
} else {
  console.error('No state or status artifacts found');
  process.exit(1);
}

const failed = state.packages.filter((p) => p.status === 'failed').length;
publishSummary(state, `Release train report${failed ? ' — failures detected' : ''}`);

if (failed > 0) {
  console.error(`${failed} package(s) failed`);
  process.exit(1);
}
