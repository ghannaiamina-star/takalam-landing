const { getProvider } = require('../lib/payments');
const { PRODUCT_TYPES, getProductLabel } = require('../lib/productCatalog');

const WHATSAPP_NUMBER = '212722774753';

function whatsappFallback(productType, locale, attemptId) {
  const label = getProductLabel(productType, locale);
  const name = label ? label.name : productType;
  const text = locale === 'en'
    ? `Hi Takalam! I'd like to book ${name}.${attemptId ? ` (test ${attemptId})` : ''} Could we set up payment here?`
    : `Bonjour Takalam ! Je voudrais réserver ${name}.${attemptId ? ` (test ${attemptId})` : ''} Peut-on organiser le paiement ici ?`;
  return { mode: 'whatsapp', url: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}` };
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
    // hit a dead end. Degrade to the same WhatsApp flow the rest of the site
    // already uses instead of erroring; this is expected until PayPal
    // credentials are live, not a fault, so it stays out of error-level logs.
    console.warn('[checkout] No live checkout available, falling back to WhatsApp:', err.message);
    res.status(200).json(whatsappFallback(product, locale, attemptId));
  }
};
