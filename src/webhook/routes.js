const express = require('express');
const { verifySignature } = require('./signature');
const { parsePushPayload } = require('./payload');

function createWebhookRouter({ processor, secret = process.env.GITHUB_WEBHOOK_SECRET } = {}) {
  const router = express.Router();

  router.post('/github', (request, response) => {
    const event = request.get('X-GitHub-Event');
    const deliveryId = request.get('X-GitHub-Delivery');
    console.log(JSON.stringify({ deliveryId, event, status: 'received' }));
    if (!verifySignature(request.body, request.get('X-Hub-Signature-256'), secret)) {
      console.error(JSON.stringify({ deliveryId, event, status: 'rejected', reason: 'invalid_signature' }));
      return response.status(401).json({ error: 'Invalid webhook signature' });
    }
    if (event === 'installation' || event === 'installation_repositories') {
      if (!processor) return response.status(503).json({ error: 'Webhook processor is not configured' });
      processor.handleLifecycle({ event, body: request.body }).catch((error) => {
        console.error(JSON.stringify({ deliveryId, event, status: 'failed', error: error.message }));
      });
      console.log(JSON.stringify({ deliveryId, event, status: 'accepted' }));
      return response.status(202).json({ accepted: true, deliveryId, event });
    }
    if (event !== 'push') {
      console.log(JSON.stringify({ deliveryId, event, status: 'ignored' }));
      return response.status(200).json({ accepted: true, ignored: true, event });
    }
    if (!deliveryId) {
      console.error(JSON.stringify({ event, status: 'rejected', reason: 'missing_delivery_id' }));
      return response.status(400).json({ error: 'Missing X-GitHub-Delivery header' });
    }

    let payload;
    try {
      payload = parsePushPayload(request.body);
    } catch (error) {
      console.error(JSON.stringify({ deliveryId, event, status: 'rejected', reason: error.message }));
      return response.status(400).json({ error: error.message });
    }

    if (!processor) {
      console.error(JSON.stringify({ deliveryId, event, status: 'rejected', reason: 'processor_not_configured' }));
      return response.status(503).json({ error: 'Webhook processor is not configured' });
    }
    processor.enqueue({ deliveryId, payload }).catch((error) => {
      console.error(JSON.stringify({ deliveryId, event, status: 'failed', error: error.message }));
    });
    console.log(JSON.stringify({ deliveryId, event, status: 'accepted' }));
    return response.status(202).json({ accepted: true, deliveryId, event });
  });

  return router;
}

module.exports = { createWebhookRouter };