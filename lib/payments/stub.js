// Dev-only stand-in for a merchant of record. Implements the interface
// documented in ./index.js with no network calls and no real money, so
// `vercel dev` can exercise the full test -> results -> checkout path
// without Lemon Squeezy credentials. Select it with PAYMENT_PROVIDER=stub.
// Not wired into any deploy config -- only reachable via that env var.

const { CURRENT_PRICES_EUR } = require('../productCatalog');

const STUB_PRICES = {
  speak: { priceEur: CURRENT_PRICES_EUR.speak, name: 'Takalam Speak (stub)' },
  private: { priceEur: CURRENT_PRICES_EUR.private, name: 'Takalam Private (stub)' },
};

async function createCheckout({ productType, attemptId, locale }) {
  const params = new URLSearchParams();
  if (attemptId) params.set('id', attemptId);
  if (locale) params.set('locale', locale);
  params.set('stub_paid', productType);
  return { mode: 'redirect', url: `/results?${params.toString()}` };
}

function verifyWebhook() {
  return true;
}

function parseWebhookEvent(rawBody) {
  const body = JSON.parse(rawBody.toString('utf8'));
  return {
    type: body.type || 'order_created',
    orderId: body.orderId || `stub-${Date.now()}`,
    buyerEmail: body.buyerEmail || null,
    buyerName: body.buyerName || null,
    amountEur: body.amountEur ?? STUB_PRICES[body.productType]?.priceEur ?? null,
    productType: body.productType || null,
    attemptId: body.attemptId || null,
    locale: body.locale || null,
    raw: body,
  };
}

async function getProductPrice(productType) {
  return STUB_PRICES[productType] || { priceEur: null, name: null };
}

async function refund() {
  return { status: 'refunded' };
}

async function listTransactions() {
  return [];
}

module.exports = {
  createCheckout,
  verifyWebhook,
  parseWebhookEvent,
  getProductPrice,
  refund,
  listTransactions,
};
