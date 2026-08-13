// Provider-agnostic downstream logic. api/webhook/<provider>.js does only
// provider-specific verification + parsing, then hands the normalized event
// here. Nothing below this line knows which MoR sent the event.
const { sql } = require('../db');
const { sendEmail } = require('../email');
const { sendWhatsApp } = require('../whatsapp');
const { getProductLabel } = require('../productCatalog');

const PURCHASE_EVENT_TYPES = new Set(['order_created', 'subscription_created']);

// Matches the address api/submit-test.js already sends the internal test
// report to -- same owner, kept as a fallback default if OWNER_EMAIL isn't set.
const OWNER_EMAIL_DEFAULT = 'mohammedsaidelbouzdoudi99@gmail.com';

async function handleWebhookEvent(provider, event) {
  if (!PURCHASE_EVENT_TYPES.has(event.type)) {
    return { skipped: true, reason: `unhandled event type "${event.type}"` };
  }

  // ON CONFLICT DO NOTHING on (provider, provider_order_id) is the
  // idempotency guard: a redelivered webhook must not double-charge the
  // owner's attention (duplicate email/WhatsApp) or double-count revenue.
  const rows = await sql`
    INSERT INTO payment (attempt_id, provider, provider_order_id, buyer_email, buyer_name, product_type, amount_eur, status, raw_payload)
    VALUES (${event.attemptId}, ${provider}, ${event.orderId}, ${event.buyerEmail}, ${event.buyerName}, ${event.productType}, ${event.amountEur}, 'paid', ${JSON.stringify(event.raw)})
    ON CONFLICT (provider, provider_order_id) DO NOTHING
    RETURNING id
  `;
  if (rows.length === 0) {
    return { skipped: true, reason: 'duplicate webhook delivery' };
  }

  const locale = event.locale === 'en' ? 'en' : 'fr';
  const label = getProductLabel(event.productType, locale)?.name || event.productType;

  await Promise.allSettled([
    sendConfirmationEmail({ ...event, locale, label }),
    sendWhatsApp(ownerAlertText(event, label)),
  ]);

  return { recorded: true };
}

async function sendConfirmationEmail({ buyerEmail, buyerName, amountEur, locale, label }) {
  if (!buyerEmail) return;
  const copy = locale === 'en'
    ? {
        subject: `Welcome to ${label}`,
        html: `<p>Hi ${escapeHtml(buyerName || '')},</p><p>Your payment for <strong>${escapeHtml(label)}</strong> (&euro;${amountEur}) is confirmed. Said will be in touch on WhatsApp shortly to set up your first session.</p>`,
      }
    : {
        subject: `Bienvenue chez ${label}`,
        html: `<p>Bonjour ${escapeHtml(buyerName || '')},</p><p>Votre paiement pour <strong>${escapeHtml(label)}</strong> (${amountEur}&nbsp;&euro;) est confirm&eacute;. Said vous contactera bient&ocirc;t sur WhatsApp pour organiser votre premi&egrave;re session.</p>`,
      };
  await sendEmail({
    to: buyerEmail,
    from: 'Takalam <onboarding@resend.dev>',
    replyTo: process.env.OWNER_EMAIL || OWNER_EMAIL_DEFAULT,
    subject: copy.subject,
    html: copy.html,
  });
}

function ownerAlertText(event, label) {
  return [
    'New Takalam payment',
    `${event.buyerName || 'Unknown'} (${event.buyerEmail || 'no email'})`,
    `${label} - EUR${event.amountEur}`,
  ].join('\n');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

module.exports = { handleWebhookEvent };
