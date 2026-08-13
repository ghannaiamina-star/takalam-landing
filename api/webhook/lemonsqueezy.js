const { getProvider } = require('../../lib/payments');
const { handleWebhookEvent } = require('../../lib/payments/handleWebhookEvent');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Signature verification needs the exact raw bytes Lemon Squeezy signed --
  // read the stream directly rather than anything that could re-serialize a
  // parsed body (same class of bug as any provider's HMAC webhook check).
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  const provider = getProvider('lemonsqueezy');

  if (!provider.verifyWebhook(rawBody, req.headers)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let event;
  try {
    event = provider.parseWebhookEvent(rawBody, req.headers);
  } catch (err) {
    console.error('[webhook/lemonsqueezy] Failed to parse event:', err);
    res.status(400).json({ error: 'Malformed webhook payload' });
    return;
  }

  try {
    const result = await handleWebhookEvent('lemonsqueezy', event);
    res.status(200).json(result);
  } catch (err) {
    console.error('[webhook/lemonsqueezy] Failed to handle event:', err);
    // 500 so Lemon Squeezy retries delivery -- handleWebhookEvent's ON
    // CONFLICT DO NOTHING guard makes a retry safe.
    res.status(500).json({ error: 'Failed to process webhook' });
  }
};
