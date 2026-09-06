const crypto = require('crypto');
const { sql } = require('../lib/db');
const { uploadFile } = require('../lib/blob');
const { parseMultipart } = require('../lib/multipart');
const { getProduct, PRODUCT_TYPES } = require('../lib/productCatalog');
const { sendEmail } = require('../lib/email');

const REPORT_TO = 'mohammedsaidelbouzdoudi99@gmail.com';
const REPORT_FROM = 'Takalam Registration <onboarding@resend.dev>';

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: 'Server is not configured to receive registrations. Contact the site owner.' });
    return;
  }

  let formData;
  try {
    formData = await parseMultipart(req);
  } catch (err) {
    console.error('[register] Failed to parse submission body:', err);
    res.status(400).json({ error: 'Could not read submission.' });
    return;
  }

  const name = String(formData.get('name') || '').trim();
  const whatsapp = String(formData.get('whatsapp') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const productType = String(formData.get('productType') || '').trim();
  const quantityRaw = Number(formData.get('quantity'));
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.round(quantityRaw) : 1;
  const attemptId = String(formData.get('attemptId') || '').trim() || null;
  const locale = String(formData.get('locale') || 'fr').trim() === 'en' ? 'en' : 'fr';
  const message = String(formData.get('message') || '').trim();

  if (!name || !whatsapp) {
    res.status(400).json({ error: 'Name and WhatsApp number are required.' });
    return;
  }
  if (!PRODUCT_TYPES.includes(productType)) {
    res.status(400).json({ error: `Unknown product "${productType}"` });
    return;
  }

  const screenshotFile = formData.get('screenshot');
  if (!screenshotFile || typeof screenshotFile === 'string') {
    res.status(400).json({ error: 'A payment screenshot is required.' });
    return;
  }
  if (screenshotFile.size > MAX_SCREENSHOT_BYTES) {
    res.status(400).json({ error: 'Screenshot is too large (max 8MB).' });
    return;
  }

  let product;
  try {
    product = await getProduct(productType, locale);
  } catch (err) {
    console.error('[register] Failed to load product price:', err);
    res.status(502).json({ error: 'Could not load current pricing. Please try again.' });
    return;
  }
  const amountEur = productType === 'private' ? product.priceEur * quantity : product.priceEur;

  let screenshotUrl = null;
  try {
    const buf = Buffer.from(await screenshotFile.arrayBuffer());
    const ext = extFromFile(screenshotFile);
    screenshotUrl = await uploadFile(buf, `${slugify(name)}-payment.${ext}`, screenshotFile.type, 'payment-screenshots');
  } catch (err) {
    console.error('[register] Screenshot upload failed:', err);
    res.status(502).json({ error: 'Could not upload screenshot. Please try again.' });
    return;
  }

  const providerOrderId = crypto.randomUUID();
  try {
    await sql`
      INSERT INTO payment (attempt_id, provider, provider_order_id, buyer_email, buyer_name, product_type, amount_eur, status, raw_payload)
      VALUES (${attemptId}, 'manual', ${providerOrderId}, ${email || null}, ${name}, ${productType}, ${amountEur}, 'pending_review', ${JSON.stringify({
        whatsapp, quantity, screenshotUrl, message: message || null, locale,
      })})
    `;
  } catch (err) {
    console.error('[register] Failed to persist registration:', err);
    res.status(502).json({ error: 'Could not save your registration. Please try again.' });
    return;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `
    <div style="font-family:Arial,sans-serif;color:#1a2332;max-width:640px;">
      <h2 style="color:#0d4f37;">New manual registration</h2>
      <p><strong>Name:</strong> ${esc(name)}<br/>
      <strong>WhatsApp:</strong> ${esc(whatsapp)}<br/>
      <strong>Email:</strong> ${esc(email || 'not given')}<br/>
      <strong>Product:</strong> ${esc(product.name)}${productType === 'private' ? ` &times; ${esc(quantity)}` : ''}<br/>
      <strong>Amount:</strong> &euro;${esc(amountEur)}<br/>
      ${attemptId ? `<strong>Test attempt:</strong> ${esc((process.env.SITE_URL || '') + '/results?id=' + attemptId)}<br/>` : ''}
      <strong>Order ref:</strong> ${esc(providerOrderId)}</p>
      ${message ? `<p><strong>Message:</strong><br/>${esc(message)}</p>` : ''}
      <p><strong>Payment screenshot:</strong> <a href="${esc(screenshotUrl)}">${esc(screenshotUrl)}</a></p>
      <p style="color:#7a5c00;">Verify the payment, then confirm the student by WhatsApp or email.</p>
    </div>`;

  try {
    await sendEmail({
      to: REPORT_TO,
      from: REPORT_FROM,
      replyTo: email || REPORT_TO,
      subject: `Takalam registration: ${name} - ${product.name}`,
      html,
    });
  } catch (err) {
    // The registration is already durably saved above -- a failed owner
    // notification must never make the student think their submission was
    // lost. Log loudly, but the response to the student stays a success.
    console.error('[register] Owner notification email failed:', err);
  }

  res.status(200).json({ success: true, orderRef: providerOrderId });
};

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'student';
}

function extFromFile(file) {
  const type = (file.type || '').toLowerCase();
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  const nameMatch = /\.([a-z0-9]+)$/i.exec(file.name || '');
  return nameMatch ? nameMatch[1] : 'bin';
}
