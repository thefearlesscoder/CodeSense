const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const { createApp } = require('../src/webhook/app');

function sign(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('accepts a signed push and rejects a tampered body', async () => {
  const secret = 'route-test-secret';
  const jobs = [];
  const server = await listen(createApp({
    secret,
    processor: { enqueue: async (job) => jobs.push(job) },
  }));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/webhook/github`;
  const body = JSON.stringify({
    after: 'abc123',
    repository: { id: 123, full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
    commits: [],
  });

  try {
    const accepted = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'route-test-1',
        'x-hub-signature-256': sign(Buffer.from(body), secret),
      },
      body,
    });
    assert.equal(accepted.status, 202);
    assert.equal(jobs.length, 1);

    const rejected = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'route-test-2',
        'x-hub-signature-256': sign(Buffer.from(body), secret),
      },
      body: `${body} `,
    });
    assert.equal(rejected.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
