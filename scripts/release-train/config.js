import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildDepsGraph } from '../deps-graph.js';
import { loadYaml } from './yaml-loader.js';

const ROOT = process.cwd();

export function loadConfig(configPath = join(ROOT, 'release-train.yml')) {
  if (!existsSync(configPath)) {
    throw new Error(`Release train config not found: ${configPath}`);
  }
  const raw = loadYaml(configPath);
  const defaults = raw.defaults || {};
  const capabilities = raw.capabilities || {};
  const repos = raw.repos || {};
  const graph = buildDepsGraph();
  const nodesByRepo = new Map(graph.nodes.map((n) => [n.repo, n]));

  const repoEntries = Object.entries(repos).map(([slug, repoCfg]) => {
    const node = nodesByRepo.get(slug);
    return {
      slug,
      npm: repoCfg.npm || node?.npm,
      path: node?.path,
      auto_approve_release:
        repoCfg.auto_approve_release ?? defaults.auto_approve_release ?? true,
      auto_merge_feature:
        repoCfg.auto_merge_feature ?? defaults.auto_merge_feature ?? false,
      merge_method: repoCfg.merge_method ?? defaults.merge_method ?? 'rebase',
    };
  });

  return {
    defaults,
    capabilities,
    repos: Object.fromEntries(repoEntries.map((e) => [e.slug, e])),
    graph,
    nodesByRepo,
    nodesByNpm: new Map(graph.nodes.map((n) => [n.npm, n])),
    org: defaults.org || 'diplodoc-platform',
  };
}

export function repoFullName(config, slug) {
  return `${config.org}/${slug}`;
}

export function snapshotWorkflowForRepo(config, slug) {
  return config.capabilities?.update_snapshots?.[slug]?.workflow || null;
}

export function snapshotFailurePatterns(config) {
  return config.capabilities?.snapshot_failure_patterns || [
    'e2e',
    'integration',
    'playwright',
    'snapshot',
    'screenshot',
  ];
}

/** Extra bot logins configured in release-train.yml (`capabilities.known_bots`),
 * merged with the built-in defaults in gh.js's isBotLogin(). */
export function knownBotLogins(config) {
  return config.capabilities?.known_bots || [];
}
