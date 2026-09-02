import assert from 'node:assert/strict';
import test from 'node:test';

import { canAccessMarketingTracking } from './lib/marketing-tracking-access.js';

test('libera somente a conta do Estúdio Gi Pitori', () => {
  assert.equal(canAccessMarketingTracking('gipitorifotografias@gmail.com'), true);
  assert.equal(canAccessMarketingTracking(' GIPITORIFOTOGRAFIAS@gmail.com '), true);
});

test('bloqueia outras contas e identidades ausentes', () => {
  assert.equal(canAccessMarketingTracking('outra-conta@gmail.com'), false);
  assert.equal(canAccessMarketingTracking(null), false);
  assert.equal(canAccessMarketingTracking(undefined), false);
});
