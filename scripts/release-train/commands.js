/**
 * Parser for release train issue-comment commands.
 *
 * Supported forms (any alias × any action):
 *
 *   /release-train retry
 *   /rt resume prs=cli#123,transform#456
 *   /train start
 *
 * Pure module — the workflow side effects live in handle-command.js.
 */

export const DEFAULT_ALIASES = ['release-train', 'rt', 'train'];
export const DEFAULT_ACTIONS = ['retry', 'resume', 'start'];

/** `retry` is just a friendlier spelling of `resume`. */
export function canonicalAction(action) {
  return action === 'retry' ? 'resume' : action;
}

/**
 * Find the first command in a comment body.
 * @returns {{alias: string, action: string, canonical: string, args: Record<string,string>}|null}
 */
export function parseCommand(body, options = {}) {
  const aliases = options.aliases?.length ? options.aliases : DEFAULT_ALIASES;
  const actions = options.actions?.length ? options.actions : DEFAULT_ACTIONS;

  for (const rawLine of String(body ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('/')) continue;

    const [command, ...rest] = line.slice(1).split(/\s+/);
    if (!aliases.includes(command.toLowerCase())) continue;

    const action = (rest.shift() || '').toLowerCase();
    if (!actions.includes(action)) {
      return { alias: command.toLowerCase(), action, canonical: null, args: {}, unknownAction: true };
    }

    const args = {};
    for (const token of rest) {
      const eq = token.indexOf('=');
      if (eq <= 0) continue;
      args[token.slice(0, eq).toLowerCase()] = token.slice(eq + 1);
    }

    return {
      alias: command.toLowerCase(),
      action,
      canonical: canonicalAction(action),
      args,
    };
  }

  return null;
}

/** Extract the train id from the issue labels (`release-train:<id>`). */
export function trainIdFromLabels(labels = []) {
  for (const label of labels) {
    const name = typeof label === 'string' ? label : label?.name;
    if (!name) continue;
    const match = name.match(/^release-train:(.+)$/);
    if (match) return match[1];
  }
  return null;
}

export function hasLabel(labels = [], wanted) {
  return labels.some((label) => (typeof label === 'string' ? label : label?.name) === wanted);
}
