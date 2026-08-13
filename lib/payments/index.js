// Payments adapter boundary. Every caller (api/checkout.js, api/products.js,
// api/webhook/*, results.html's backing endpoints) goes through the interface
// below, never through a provider's SDK/API shape directly. Swapping the
// merchant of record (Lemon Squeezy -> Paddle -> Dodo, per the brief's own
// contingency plan) means writing one new file that implements this
// interface and flipping PAYMENT_PROVIDER -- nothing else changes.
//
// Provider interface:
//   createCheckout({ productType, attemptId, buyerEmail, locale })
//     -> Promise<{ mode: 'redirect', url: string }>
//        ('redirect' is the only mode Milestone 1 needs; a future overlay-
//        style provider can return a different mode and the frontend branches
//        on it, but no such branch exists yet -- do not build it speculatively.)
//   verifyWebhook(rawBody: Buffer, headers: object) -> boolean
//   parseWebhookEvent(rawBody: Buffer, headers: object) -> {
//     type: string, orderId: string, buyerEmail: string, buyerName: string,
//     amountEur: number, productType: 'speak'|'private', attemptId: string|null,
//     locale: string|null, raw: object,
//   }
//   getProductPrice(productType) -> Promise<{ priceEur: number, name: string }>
//   refund(orderId) -> Promise<{ status: string }>
//   listTransactions(filters) -> Promise<object[]>

const providers = {
  lemonsqueezy: () => require('./lemonsqueezy'),
  stub: () => require('./stub'),
};

function getProvider(name) {
  const key = name || process.env.PAYMENT_PROVIDER || 'lemonsqueezy';
  const load = providers[key];
  if (!load) {
    throw new Error(`Unknown payment provider "${key}"`);
  }
  return load();
}

module.exports = { getProvider };
