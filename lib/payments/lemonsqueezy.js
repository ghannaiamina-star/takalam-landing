// The only file in the codebase that knows Lemon Squeezy's specific shapes:
// buy-link URL format, webhook signature scheme, and REST API. Everything
// here implements the interface documented in ./index.js.
const crypto = require('crypto');

const API_BASE = 'https://api.lemonsqueezy.com/v1';

// Buy-link query-param custom data only works on hosted buy links (what this
// builds). If a future change creates checkouts via the Create-Checkout API
// instead, do NOT also append these query params to that URL -- Lemon
// Squeezy signs API-created checkout URLs and appending params breaks the
// signature ("invalid signature"). Pick one method per checkout, never mix.
const VARIANT_ENV = {
  speak: 'LEMONSQUEEZY_VARIANT_SPEAK',
  private: 'LEMONSQUEEZY_VARIANT_PRIVATE',
};

function variantId(productType) {
  const envKey = VARIANT_ENV[productType];
  const id = envKey && process.env[envKey];
  if (!id) {
    throw new Error(`No Lemon Squeezy variant configured for product "${productType}" (expected ${envKey})`);
  }
  return id;
}

function productTypeForVariant(id) {
  return Object.keys(VARIANT_ENV).find((type) => process.env[VARIANT_ENV[type]] === String(id)) || null;
}

async function createCheckout({ productType, attemptId, buyerEmail, locale }) {
  const storeSubdomain = process.env.LEMONSQUEEZY_STORE_SUBDOMAIN;
  if (!storeSubdomain) {
    throw new Error('LEMONSQUEEZY_STORE_SUBDOMAIN environment variable is not set.');
  }
  const id = variantId(productType);
  const params = new URLSearchParams();
  if (attemptId) params.set('checkout[custom][attempt_id]', attemptId);
  if (locale) params.set('checkout[custom][locale]', locale);
  if (buyerEmail) params.set('checkout[email]', buyerEmail);
  const url = `https://${storeSubdomain}.lemonsqueezy.com/checkout/buy/${id}?${params.toString()}`;
  return { mode: 'redirect', url };
}

function verifyWebhook(rawBody, headers) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const signature = headers['x-signature'] || headers['X-Signature'];
  if (!secret || !signature) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseWebhookEvent(rawBody) {
  const body = JSON.parse(rawBody.toString('utf8'));
  const attrs = (body.data && body.data.attributes) || {};
  const customData = (body.meta && body.meta.custom_data) || {};
  const variant = attrs.variant_id || attrs.first_order_item?.variant_id;

  return {
    type: body.meta && body.meta.event_name,
    orderId: String(body.data && body.data.id),
    buyerEmail: attrs.user_email || attrs.customer_email || null,
    buyerName: attrs.user_name || attrs.customer_name || null,
    amountEur: typeof attrs.total === 'number' ? attrs.total / 100 : null,
    productType: customData.product_type || productTypeForVariant(variant),
    attemptId: customData.attempt_id || null,
    locale: customData.locale || null,
    raw: body,
  };
}

async function getProductPrice(productType) {
  const id = variantId(productType);
  const resp = await fetch(`${API_BASE}/variants/${id}`, {
    headers: {
      Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
      Accept: 'application/vnd.api+json',
    },
  });
  if (!resp.ok) {
    throw new Error(`Lemon Squeezy variant lookup failed: ${resp.status}`);
  }
  const data = await resp.json();
  const attrs = data.data.attributes;
  return {
    priceEur: typeof attrs.price === 'number' ? attrs.price / 100 : null,
    name: attrs.name,
  };
}

// Not called anywhere in Milestone 1 (no admin panel yet) -- exists so the
// interface is complete and the later admin milestone doesn't need to touch
// the adapter boundary. Endpoint shape is best-effort from Lemon Squeezy's
// public API docs and has not been exercised against a live order; verify
// before the first real use.
async function refund(orderId) {
  const resp = await fetch(`${API_BASE}/orders/${orderId}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
      Accept: 'application/vnd.api+json',
    },
  });
  if (!resp.ok) {
    throw new Error(`Lemon Squeezy refund failed: ${resp.status}`);
  }
  const data = await resp.json();
  return { status: data.data?.attributes?.status || 'unknown' };
}

async function listTransactions(filters = {}) {
  const params = new URLSearchParams();
  if (process.env.LEMONSQUEEZY_STORE_ID) params.set('filter[store_id]', process.env.LEMONSQUEEZY_STORE_ID);
  if (filters.status) params.set('filter[status]', filters.status);
  const resp = await fetch(`${API_BASE}/orders?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
      Accept: 'application/vnd.api+json',
    },
  });
  if (!resp.ok) {
    throw new Error(`Lemon Squeezy order list failed: ${resp.status}`);
  }
  const data = await resp.json();
  return data.data || [];
}

module.exports = {
  createCheckout,
  verifyWebhook,
  parseWebhookEvent,
  getProductPrice,
  refund,
  listTransactions,
};
