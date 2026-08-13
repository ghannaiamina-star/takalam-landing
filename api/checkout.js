const { getProvider } = require('../lib/payments');
const { PRODUCT_TYPES } = require('../lib/productCatalog');

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
    console.error('[checkout] Failed to create checkout:', err);
    res.status(502).json({ error: 'Checkout is not available right now.' });
  }
};
