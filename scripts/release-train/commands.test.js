#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalAction, hasLabel, parseCommand, trainIdFromLabels } from './commands.js';

test('parseCommand accepts every alias and action', () => {
  for (const alias of ['release-train', 'rt', 'train']) {
    for (const action of ['retry', 'resume', 'start']) {
      const parsed = parseCommand(`/${alias} ${action}`);
      assert.equal(parsed.alias, alias);
      assert.equal(parsed.action, action);
    }
  }
});

test('retry is an alias of resume', () => {
  assert.equal(parseCommand('/rt retry').canonical, 'resume');
  assert.equal(parseCommand('/rt resume').canonical, 'resume');
  assert.equal(canonicalAction('start'), 'start');
});

test('parseCommand reads key=value arguments', () => {
  const parsed = parseCommand('/train resume prs=cli#123,transform#456');
  assert.equal(parsed.canonical, 'resume');
  assert.equal(parsed.args.prs, 'cli#123,transform#456');
});

test('parseCommand finds the command on any line and ignores prose', () => {
  const parsed = parseCommand('CI was red, fixed now.\n\n/rt resume\n\nthanks');
  assert.equal(parsed.canonical, 'resume');
  assert.equal(parseCommand('please /rt resume inline'), null);
  assert.equal(parseCommand('no command here'), null);
  assert.equal(parseCommand(''), null);
});

test('parseCommand reports unknown actions instead of silently ignoring them', () => {
  const parsed = parseCommand('/rt explode');
  assert.equal(parsed.unknownAction, true);
  assert.equal(parsed.canonical, null);
});

test('parseCommand honours configured aliases and actions', () => {
  assert.equal(parseCommand('/rt resume', { aliases: ['train'] }), null);
  assert.equal(parseCommand('/rt start', { actions: ['resume'] }).unknownAction, true);
});

test('trainIdFromLabels reads the release-train label', () => {
  assert.equal(trainIdFromLabels([{ name: 'bug' }, { name: 'release-train:rt-42' }]), 'rt-42');
  assert.equal(trainIdFromLabels(['release-train:rt-7']), 'rt-7');
  assert.equal(trainIdFromLabels([{ name: 'bug' }]), null);
  assert.equal(trainIdFromLabels([]), null);
});

test('hasLabel matches by name', () => {
  assert.equal(hasLabel([{ name: 'release-train-drift' }], 'release-train-drift'), true);
  assert.equal(hasLabel(['other'], 'release-train-drift'), false);
});
