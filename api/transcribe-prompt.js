const { computeFluencyMetrics } = require('../lib/scoring');
const { transcribeAudio } = require('../lib/transcribe');

// Called right after each speaking prompt finishes recording, while the
// student is reading the next prompt, so the slow Whisper round trip
// happens off the critical path instead of stacking up at final submit.
// Always resolves with 200 and a {transcript, metrics} or {error} body,
// matching the shape submit-test.js expects when it receives this result
// back as a precomputed speakingResultN field.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(200).json({ error: 'Transcription unavailable' });
    return;
  }

  let formData;
  try {
    formData = await parseMultipart(req);
  } catch (err) {
    console.error('[transcribe-prompt] Failed to parse submission body:', err);
    res.status(400).json({ error: 'Could not read submission.' });
    return;
  }

  const audioFile = formData.get('audio');
  if (!audioFile || typeof audioFile === 'string') {
    res.status(400).json({ error: 'No audio received.' });
    return;
  }

  const duration = Number(formData.get('duration')) || 0;

  try {
    const whisperResult = await transcribeAudio(audioFile, process.env.OPENAI_API_KEY);
    const metrics = computeFluencyMetrics(whisperResult, duration);
    res.status(200).json({ transcript: whisperResult.text || '', metrics });
  } catch (err) {
    console.error('[transcribe-prompt] Whisper transcription failed:', err);
    res.status(200).json({ error: 'Transcription failed' });
  }
};

async function parseMultipart(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuffer = Buffer.concat(chunks);
  const contentType = req.headers['content-type'] || '';
  const request = new Request('http://localhost/api/transcribe-prompt', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: bodyBuffer,
  });
  return request.formData();
}
