// PayPal adapter: Orders API for one-off Private sessions, Subscriptions API
// for recurring Speak. Implements the interface documented in ./index.js,
// plus one PayPal-specific extra (captureOrder) that only api/paypal-return.js
// calls directly -- it isn't part of the shared provider interface because
// no other provider needs a post-redirect capture step.
//
// PayPal is a payment processor, not a merchant of record the way Lemon
// Squeezy would have been -- Takalam remains responsible for its own
// invoicing and taxes on money that comes through it (see privacy.html's
// Payments section).

const { CURRENT_PRICES_EUR } = require('../productCatalog');

const API_BASE = process.env.PAYPAL_ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`${key} environment variable is not set.`);
  return v;
}

// Re-fetched per call rather than cached across invocations: a serverless
// function's process lifetime is unpredictable, and a stale token failing
// mid-request is worse than one extra token call (PayPal's token endpoint is
// not rate-limited tightly enough for this volume to matter).
async function getAccessToken() {
  const clientId = requireEnv('PAYPAL_CLIENT_ID');
  const secret = requireEnv('PAYPAL_CLIENT_SECRET');
  const resp = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) throw new Error(`PayPal OAuth token request failed: ${resp.status}`);
  const data = await resp.json();
  return data.access_token;
}

async function paypalFetch(path, options = {}) {
  const token = await getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

function returnUrl() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://takalamenglish.ma').replace(/\/$/, '');
  return `${site}/api/paypal-return`;
}

// custom_id is capped at 127 chars by PayPal on both Orders and
// Subscriptions -- a pipe-joined triplet is well inside that and avoids a
// JSON round trip through their API just to carry three short values.
function packCustomId({ productType, attemptId, locale }) {
  return [productType, attemptId || '', locale || 'fr'].join('|').slice(0, 127);
}

function unpackCustomId(customId) {
  const [productType, attemptId, locale] = String(customId || '').split('|');
  return { productType: productType || null, attemptId: attemptId || null, locale: locale || 'fr' };
}

async function createCheckout({ productType, attemptId, locale }) {
  if (productType === 'speak') return createSubscription({ attemptId, locale });
  if (productType === 'private') return createOrder({ attemptId, locale });
  throw new Error(`Unknown product "${productType}"`);
}

async function createOrder({ attemptId, locale }) {
  const resp = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: packCustomId({ productType: 'private', attemptId, locale }),
        description: 'Takalam Private -- 1:1 English session',
        amount: { currency_code: 'EUR', value: CURRENT_PRICES_EUR.private.toFixed(2) },
      }],
      application_context: {
        return_url: returnUrl(),
        cancel_url: returnUrl(),
        user_action: 'PAY_NOW',
        brand_name: 'Takalam',
      },
    }),
  });
  if (!resp.ok) throw new Error(`PayPal order creation failed: ${resp.status}`);
  const data = await resp.json();
  const approve = (data.links || []).find((l) => l.rel === 'approve');
  if (!approve) throw new Error('PayPal order response had no approve link.');
  return { mode: 'redirect', url: approve.href };
}

async function createSubscription({ attemptId, locale }) {
  const planId = requireEnv('PAYPAL_PLAN_SPEAK');
  const resp = await paypalFetch('/v1/billing/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: planId,
      custom_id: packCustomId({ productType: 'speak', attemptId, locale }),
      application_context: {
        return_url: returnUrl(),
        cancel_url: returnUrl(),
        user_action: 'SUBSCRIBE_NOW',
        brand_name: 'Takalam',
      },
    }),
  });
  if (!resp.ok) throw new Error(`PayPal subscription creation failed: ${resp.status}`);
  const data = await resp.json();
  const approve = (data.links || []).find((l) => l.rel === 'approve');
  if (!approve) throw new Error('PayPal subscription response had no approve link.');
  return { mode: 'redirect', url: approve.href };
}

// Creating an Order never moves money by itself -- api/paypal-return.js
// calls this once the buyer comes back from approving on paypal.com. Returns
// the captured order so the caller can read purchase_units[0].custom_id back
// out (PayPal echoes it) to recover attemptId/locale for the redirect.
// Subscriptions need no equivalent: PayPal activates them on approval.
async function captureOrder(orderId) {
  const resp = await paypalFetch(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST' });
  if (!resp.ok) throw new Error(`PayPal order capture failed: ${resp.status}`);
  return resp.json();
}

// Same purpose as captureOrder above but for reading a subscription back
// (e.g. to recover custom_id for the return redirect) without mutating it.
async function getSubscription(subscriptionId) {
  const resp = await paypalFetch(`/v1/billing/subscriptions/${subscriptionId}`);
  if (!resp.ok) throw new Error(`PayPal subscription lookup failed: ${resp.status}`);
  return resp.json();
}

// PayPal verification is a network call (unlike Lemon Squeezy's local HMAC
// check), so this resolves a Promise -- see the note in ./index.js about
// api/webhook/paypal.js needing to `await` it.
async function verifyWebhook(rawBody, headers) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return false;
  }
  const resp = await paypalFetch('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  if (!resp.ok) return false;
  const data = await resp.json();
  return data.verification_status === 'SUCCESS';
}

const EVENT_TYPE_MAP = {
  'PAYMENT.CAPTURE.COMPLETED': 'order_created',
  'BILLING.SUBSCRIPTION.ACTIVATED': 'subscription_created',
};

function parseWebhookEvent(rawBody) {
  const body = JSON.parse(rawBody.toString('utf8'));
  const resource = body.resource || {};
  const type = EVENT_TYPE_MAP[body.event_type] || body.event_type;

  if (body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const { productType, attemptId, locale } = unpackCustomId(resource.custom_id);
    return {
      type,
      orderId: resource.id, // capture id -- refund() needs this, not the parent order id
      buyerEmail: resource.payer?.email_address || null,
      buyerName: [resource.payer?.name?.given_name, resource.payer?.name?.surname].filter(Boolean).join(' ') || null,
      amountEur: resource.amount?.value != null ? Number(resource.amount.value) : null,
      productType,
      attemptId,
      locale,
      raw: body,
    };
  }

  if (body.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
    const { productType, attemptId, locale } = unpackCustomId(resource.custom_id);
    return {
      type,
      orderId: resource.id, // subscription id
      buyerEmail: resource.subscriber?.email_address || null,
      buyerName: [resource.subscriber?.name?.given_name, resource.subscriber?.name?.surname].filter(Boolean).join(' ') || null,
      amountEur: resource.billing_info?.last_payment?.amount?.value != null
        ? Number(resource.billing_info.last_payment.amount.value)
        : CURRENT_PRICES_EUR.speak,
      productType,
      attemptId,
      locale,
      raw: body,
    };
  }

  return { type, orderId: resource.id || null, buyerEmail: null, buyerName: null, amountEur: null, productType: null, attemptId: null, locale: null, raw: body };
}

async function getProductPrice(productType) {
  // Private has no PayPal-side "product" resource -- its Order is created
  // with a dynamic amount we set ourselves, sourced from the same constant
  // createOrder() uses, so there's nothing further to fetch live.
  if (productType === 'private') {
    return { priceEur: CURRENT_PRICES_EUR.private, name: null };
  }
  const planId = requireEnv('PAYPAL_PLAN_SPEAK');
  const resp = await paypalFetch(`/v1/billing/plans/${planId}`);
  if (!resp.ok) throw new Error(`PayPal plan lookup failed: ${resp.status}`);
  const data = await resp.json();
  const cycle = (data.billing_cycles || []).find((c) => c.tenure_type === 'REGULAR');
  const price = cycle?.pricing_scheme?.fixed_price?.value;
  return { priceEur: price != null ? Number(price) : null, name: data.name || null };
}

// Only meaningful for a captured Order, and orderId here must be the capture
// id parseWebhookEvent stored (not the original order id) -- PayPal refunds
// against the capture, not the order. Not called anywhere in Milestone 1 (no
// admin panel yet) and not exercised against a live refund; verify before
// the first real use, same caveat lib/payments/lemonsqueezy.js's refund()
// carries. Has no equivalent for a Speak subscription -- that's a
// cancellation, not a refund, and isn't implemented here.
async function refund(captureId) {
  const resp = await paypalFetch(`/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!resp.ok) throw new Error(`PayPal refund failed: ${resp.status}`);
  const data = await resp.json();
  return { status: (data.status || 'unknown').toLowerCase() };
}

// Same caveat as lemonsqueezy.js's listTransactions(): not called anywhere
// in Milestone 1, best-effort against PayPal's Transaction Search API docs
// (which needs its own scope on the app credentials), unexercised against a
// live account -- verify before the first real use.
async function listTransactions(filters = {}) {
  const params = new URLSearchParams();
  params.set('start_date', new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString());
  params.set('end_date', new Date().toISOString());
  if (filters.status) params.set('transaction_status', filters.status);
  const resp = await paypalFetch(`/v1/reporting/transactions?${params.toString()}`);
  if (!resp.ok) throw new Error(`PayPal transaction search failed: ${resp.status}`);
  const data = await resp.json();
  return data.transaction_details || [];
}

module.exports = {
  createCheckout,
  captureOrder,
  getSubscription,
  verifyWebhook,
  parseWebhookEvent,
  getProductPrice,
  refund,
  listTransactions,
};
