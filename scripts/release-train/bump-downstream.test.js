#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBumpCommitMessage } from './bump-downstream.js';

test('formatBumpCommitMessage lists name@version pairs and links the issue', () => {
  const message = formatBumpCommitMessage({
    trainId: 'rt-11',
    issueRef: { owner: 'diplodoc-platform', repo: 'diplodoc', number: 106 },
    publishedVersions: { '@diplodoc/utils': '1.2.3', '@diplodoc/transform': 'v4.5.6' },
  });
  assert.equal(
    message,
    'chore: bump @diplodoc deps for release train rt-11 ' +
      '(@diplodoc/utils@1.2.3, @diplodoc/transform@4.5.6)\n\n' +
      'Release train: diplodoc-platform/diplodoc#106',
  );
});

test('formatBumpCommitMessage degrades without train id or issue ref', () => {
  assert.equal(
    formatBumpCommitMessage({ publishedVersions: { '@diplodoc/utils': '1.2.3' } }),
    'chore: bump @diplodoc deps for release train (@diplodoc/utils@1.2.3)',
  );
  assert.equal(
    formatBumpCommitMessage({
      trainId: 'rt-1',
      issueRef: { owner: 'o', repo: 'r' },
      publishedVersions: { '@diplodoc/utils': '1.2.3' },
    }),
    'chore: bump @diplodoc deps for release train rt-1 (@diplodoc/utils@1.2.3)',
  );
});
