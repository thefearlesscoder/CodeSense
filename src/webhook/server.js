#!/usr/bin/env node

require('dotenv').config();

const { createApp } = require('./app');
const { createWebhookProcessor } = require('./processor');

const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '127.0.0.1';
const processor = createWebhookProcessor();
const app = createApp({ processor, secret: process.env.GITHUB_APP_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET });

app.listen(port, host, () => {
  console.log(`RepoGraph webhook service listening on http://${host}:${port}`);
});