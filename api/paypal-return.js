// PayPal sends the buyer back here after they approve on paypal.com.
// Approving an Order does not move money by itself, so a one-off Private
// purchase is only actually charged once this handler captures it.
// Subscriptions activate themselves on approval -- there's nothing to
// capture there, this just reads the subscription back to find where to
// send the buyer.
const paypal = require('../lib/payments/paypal');

module.exports = async (req, res) => {
  const { token: orderId, subscription_id: subscriptionId } = req.query;
  let attemptId = null;
  let locale = 'fr';
  let failed = false;

  if (orderId) {
    try {
      const captured = await paypal.captureOrder(orderId);
      const customId = captured?.purchase_units?.[0]?.custom_id;
      const unpacked = unpackCustomId(customId);
      attemptId = unpacked.attemptId;
      locale = unpacked.locale;
    } catch (err) {
      console.error('[paypal-return] Order capture failed:', err);
      failed = true;
    }
  } else if (subscriptionId) {
    try {
      const sub = await paypal.getSubscription(subscriptionId);
      const unpacked = unpackCustomId(sub?.custom_id);
      attemptId = unpacked.attemptId;
      locale = unpacked.locale;
    } catch (err) {
      // The subscription itself is still active on PayPal's side even if
      // this lookup fails -- only the redirect destination degrades.
      console.error('[paypal-return] Subscription lookup failed:', err);
    }
  }

  const prefix = locale === 'en' ? '/en' : '';
  const destination = failed
    ? `${prefix}/?checkout=failed`
    : attemptId
      ? `${prefix}/results?id=${encodeURIComponent(attemptId)}&paid=1`
      : `${prefix}/?checkout=success`;

  res.writeHead(302, { Location: destination });
  res.end();
};

function unpackCustomId(customId) {
  const [productType, attemptId, locale] = String(customId || '').split('|');
  return { productType: productType || null, attemptId: attemptId || null, locale: locale || 'fr' };
}
