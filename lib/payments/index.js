// Payments adapter boundary. Every caller (api/checkout.js, api/products.js,
// api/webhook/*, results.html's backing endpoints) goes through the interface
// below, never through a provider's SDK/API shape directly. Swapping the
// provider means writing one new file that implements this interface and
// flipping PAYMENT_PROVIDER -- nothing else changes.
//
// PAYMENT_PROVIDER defaults to 'paypal': Lemon Squeezy declined the store
// application (30 Jul 2026, dispute/supportability risk on live tutoring)
// and Stripe doesn't support Moroccan merchants, so lemonsqueezy.js is dead
// code kept only for reference -- do not wire new config to it.
//
// Provider interface:
//   createCheckout({ productType, attemptId, buyerEmail, locale })
//     -> Promise<{ mode: 'redirect', url: string }>
//        ('redirect' is the only mode Milestone 1 needs; a future overlay-
//        style provider can return a different mode and the frontend branches
//        on it, but no such branch exists yet -- do not build it speculatively.
//        api/checkout.js itself may substitute a 'whatsapp' mode when the
//        provider throws -- that's a fallback at the caller, not something
//        a provider implements.)
//   verifyWebhook(rawBody: Buffer, headers: object) -> boolean | Promise<boolean>
//     (PayPal's verification is a network call, hence the Promise option --
//     api/webhook/<provider>.js must `await` this, even for providers that
//     resolve synchronously.)
//   parseWebhookEvent(rawBody: Buffer, headers: object) -> {
//     type: string, orderId: string, buyerEmail: string, buyerName: string,
//     amountEur: number, productType: 'speak'|'private', attemptId: string|null,
//     locale: string|null, raw: object,
//   }
//   getProductPrice(productType) -> Promise<{ priceEur: number, name: string }>
//   refund(orderId) -> Promise<{ status: string }>
//   listTransactions(filters) -> Promise<object[]>

const providers = {
  paypal: () => require('./paypal'),
  lemonsqueezy: () => require('./lemonsqueezy'),
  stub: () => require('./stub'),
};

function getProvider(name) {
  const key = name || process.env.PAYMENT_PROVIDER || 'paypal';
  const load = providers[key];
  if (!load) {
    throw new Error(`Unknown payment provider "${key}"`);
  }
  return load();
}

module.exports = { getProvider };
