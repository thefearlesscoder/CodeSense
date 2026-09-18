const express = require('express');
const { createWebhookRouter } = require('./routes');

function createApp(options = {}) {
  const app = express();

  app.use('/webhook/github', express.raw({ type: 'application/json', limit: '1mb' }));
  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });
  app.use('/webhook', createWebhookRouter(options));

  return app;
}

module.exports = { createApp };