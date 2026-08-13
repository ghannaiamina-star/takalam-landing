// Thin Meta WhatsApp Cloud API sender for owner alerts. Business-initiated
// messages (not a reply within a customer's 24h session) require a
// pre-approved message template -- so this always sends a single-variable
// template rather than free text. Said needs Meta Business verification and
// template approval before this can actually deliver (see the plan's
// "before this can go live" section); until then it logs and no-ops instead
// of failing the request that triggered it.
const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';

async function sendWhatsApp(message) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_ID;
  const to = process.env.SAID_WHATSAPP_TO;
  const templateName = process.env.META_WHATSAPP_TEMPLATE_NAME || 'takalam_owner_alert';

  if (!token || !phoneId || !to) {
    console.warn('[whatsapp] Not configured (missing META_WHATSAPP_TOKEN / META_WHATSAPP_PHONE_ID / SAID_WHATSAPP_TO) -- skipping alert:', message);
    return { sent: false, reason: 'not_configured' };
  }

  const resp = await fetch(`${GRAPH_API_BASE}/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en_US' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: message }] }],
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error(`[whatsapp] Send failed (${resp.status}): ${errText}`);
    return { sent: false, reason: 'api_error' };
  }
  return { sent: true };
}

module.exports = { sendWhatsApp };
