const { getAllProducts } = require('../lib/productCatalog');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const locale = req.query.locale === 'en' ? 'en' : 'fr';
  try {
    const products = await getAllProducts(locale);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    res.status(200).json({ products });
  } catch (err) {
    console.error('[products] Failed to fetch live prices:', err);
    res.status(502).json({ error: 'Could not load current prices.' });
  }
};
