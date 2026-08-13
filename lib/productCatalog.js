// Static copy (name/description) paired with live price from the payments
// adapter. Prices are never hardcoded here -- they've changed four times in
// a single day before and will again; only the copy is static.
const { getProvider } = require('./payments');

const PRODUCT_TYPES = ['speak', 'private'];

// Current list prices, for reference and for the dev-only stub provider
// (lib/payments/stub.js) -- production price is still always fetched live
// from the payment provider above, never from this constant. Kept here so
// the stub has exactly one place to read the "real" number from instead of
// drifting out of sync with it.
const CURRENT_PRICES_EUR = {
  speak: 25,
  private: 15,
};

const COPY = {
  speak: {
    fr: { name: 'Takalam Speak', blurb: 'Groupes de 10, 2 sessions live par semaine, 90 minutes.' },
    en: { name: 'Takalam Speak', blurb: 'Groups of 10, 2 live sessions a week, 90 minutes.' },
  },
  private: {
    fr: { name: 'Takalam Private', blurb: 'Individuel, 50 minutes, contre un objectif precis.' },
    en: { name: 'Takalam Private', blurb: 'One to one, 50 minutes, against a stated goal.' },
  },
};

// Synchronous, no network call -- for places (e.g. the webhook handler) that
// just need display copy and already have the price from elsewhere.
function getProductLabel(productType, locale = 'fr') {
  const lang = locale === 'en' ? 'en' : 'fr';
  return COPY[productType] ? COPY[productType][lang] : null;
}

async function getProduct(productType, locale = 'fr') {
  const lang = locale === 'en' ? 'en' : 'fr';
  const copy = COPY[productType][lang];
  const provider = getProvider();
  const { priceEur, name } = await provider.getProductPrice(productType);
  return { type: productType, name: name || copy.name, blurb: copy.blurb, priceEur };
}

async function getAllProducts(locale = 'fr') {
  return Promise.all(PRODUCT_TYPES.map((type) => getProduct(type, locale)));
}

module.exports = { PRODUCT_TYPES, CURRENT_PRICES_EUR, getProduct, getAllProducts, getProductLabel };
