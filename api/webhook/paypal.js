const { getProvider } = require('../../lib/payments');
const { handleWebhookEvent } = require('../../lib/payments/handleWebhookEvent');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Signature verification needs the exact raw bytes PayPal signed -- read
  // the stream directly rather than anything that could re-serialize a
  // parsed body.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  const provider = getProvider('paypal');

  // Unlike Lemon Squeezy's local HMAC check, PayPal's verification is a
  // network call -- this must be awaited, see lib/payments/index.js.
  const verified = await provider.verifyWebhook(rawBody, req.headers);
  if (!verified) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let event;
  try {
    event = provider.parseWebhookEvent(rawBody, req.headers);
  } catch (err) {
    console.error('[webhook/paypal] Failed to parse event:', err);
    res.status(400).json({ error: 'Malformed webhook payload' });
    return;
  }

  try {
    const result = await handleWebhookEvent('paypal', event);
    res.status(200).json(result);
  } catch (err) {
    console.error('[webhook/paypal] Failed to handle event:', err);
    // 500 so PayPal retries delivery -- handleWebhookEvent's ON CONFLICT DO
    // NOTHING guard makes a retry safe.
    res.status(500).json({ error: 'Failed to process webhook' });
  }
};
