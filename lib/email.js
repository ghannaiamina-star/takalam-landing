// Small shared Resend wrapper for emails outside the existing test-report
// flow (api/submit-test.js keeps its own inline sender -- untouched, still
// works, no reason to churn it). New send sites use this instead of
// duplicating the fetch-to-Resend boilerplate.
async function sendEmail({ to, from, replyTo, subject, html }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo,
      subject,
      html,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Resend API error ${resp.status}: ${errText}`);
  }
}

module.exports = { sendEmail };
