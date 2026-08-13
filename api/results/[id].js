const { sql } = require('../../lib/db');
const { getProduct } = require('../../lib/productCatalog');
const { CEFR_LABELS } = require('../../lib/scoring');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { id } = req.query;
  if (!id) {
    res.status(400).json({ error: 'Missing attempt id.' });
    return;
  }

  let attemptRows;
  try {
    attemptRows = await sql`SELECT * FROM test_attempt WHERE id = ${id}`;
  } catch (err) {
    console.error('[results] Lookup failed:', err);
    res.status(500).json({ error: 'Could not load results.' });
    return;
  }

  const attempt = attemptRows[0];
  if (!attempt) {
    res.status(404).json({ error: 'Results not found.' });
    return;
  }

  const answers = await sql`
    SELECT prompt_index, prompt_text, transcript, audio_url, metrics, band, grammar_range, vocabulary_range, coherence
    FROM test_answer WHERE attempt_id = ${id} ORDER BY prompt_index ASC
  `;

  const diagnosis = attempt.diagnosis || null;
  let recommendedProduct = null;
  if (diagnosis && diagnosis.recommended_product) {
    try {
      recommendedProduct = await getProduct(diagnosis.recommended_product, attempt.locale);
    } catch (err) {
      console.error('[results] Failed to fetch live product price:', err);
    }
  }

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    id: attempt.id,
    name: attempt.name,
    locale: attempt.locale,
    finalBand: attempt.final_band,
    finalBandLabel: attempt.final_band ? CEFR_LABELS[attempt.final_band] : null,
    diagnosis,
    recommendedProduct,
    answers: answers.map((a) => ({
      promptIndex: a.prompt_index,
      promptText: a.prompt_text,
      transcript: a.transcript,
      audioUrl: a.audio_url,
      band: a.band,
      metrics: a.metrics,
    })),
  });
};
