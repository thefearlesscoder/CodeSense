const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { verifySignature } = require('../src/webhook/signature');
const { parsePushPayload } = require('../src/webhook/payload');
const { DeliveryStore } = require('../src/webhook/delivery-store');

function signature(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

test('verifies GitHub signatures against the raw body', () => {
  const body = Buffer.from('{"ref":"refs/heads/main"}');
  const valid = signature(body, 'test-secret');
  assert.equal(verifySignature(body, valid, 'test-secret'), true);
  assert.equal(verifySignature(Buffer.from('{"ref":"changed"}'), valid, 'test-secret'), false);
  assert.equal(verifySignature(body, valid, 'wrong-secret'), false);
});

test('normalizes and deduplicates push file lists', () => {
  const payload = parsePushPayload(Buffer.from(JSON.stringify({
    after: 'abc123',
    repository: { id: 123, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' }, default_branch: 'main' },
    commits: [
      { added: ['src/a.js'], modified: ['./src/a.js', 'README.md'], removed: ['src/old.js'] },
      { added: [], modified: ['src/old.js'], removed: [] },
    ],
  })));

  assert.deepEqual(payload.changedPaths, ['src/a.js']);
  assert.deepEqual(payload.removedPaths, ['src/old.js']);
});

test('rejects unsafe repository paths', () => {
  assert.throws(() => parsePushPayload(Buffer.from(JSON.stringify({
    after: 'abc123',
    repository: { id: 123, full_name: 'owner/repo' },
    commits: [{ added: ['../secret.js'] }],
  }))));
});

test('deduplicates delivery processing', () => {
  const store = new DeliveryStore();
  assert.equal(store.begin('delivery-1'), true);
  assert.equal(store.begin('delivery-1'), false);
  store.complete('delivery-1');
  assert.equal(store.has('delivery-1'), true);
});
