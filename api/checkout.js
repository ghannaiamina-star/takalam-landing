const { getProvider } = require('../lib/payments');
const { PRODUCT_TYPES } = require('../lib/productCatalog');

// No live payment provider is configured yet (see lib/payments/stub.js) --
// this is the only way to take money right now: a manual bank transfer /
// PayPal registration page, reviewed and confirmed by hand. Once a real
// provider is configured, getProvider().createCheckout() above succeeds and
// this fallback stops firing on its own, no further changes needed here.
function manualRegistrationFallback(productType, locale, attemptId) {
  const params = new URLSearchParams({ product: productType });
  if (attemptId) params.set('attemptId', attemptId);
  // Locale travels via the path prefix (/en/register), matching every other
  // page's i18n detection (assets/i18n.js reads the pathname, not a query
  // param) -- not carried as a query param here.
  const path = locale === 'en' ? '/en/register' : '/register';
  return { mode: 'manual', url: `${path}?${params.toString()}` };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const product = req.query.product;
  const attemptId = req.query.attemptId || null;
  const locale = req.query.locale === 'en' ? 'en' : 'fr';
  const buyerEmail = req.query.email || null;

  if (!PRODUCT_TYPES.includes(product)) {
    res.status(400).json({ error: `Unknown product "${product}"` });
    return;
  }

  try {
    const checkout = await getProvider().createCheckout({ productType: product, attemptId, buyerEmail, locale });
    res.status(200).json(checkout);
  } catch (err) {
    // Online checkout isn't configured for every product/provider yet (or
    // the provider itself is down) -- a student who got this far must never
    // hit a dead end. Degrade to the manual registration flow instead of
    // erroring; this is expected until PayPal credentials are live, not a
    // fault, so it stays out of error-level logs.
    console.warn('[checkout] No live checkout available, falling back to manual registration:', err.message);
    res.status(200).json(manualRegistrationFallback(product, locale, attemptId));
  }
};
