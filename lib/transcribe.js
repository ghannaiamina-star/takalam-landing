// Shared Whisper transcription helper for the level test.
// Kept outside /api so Vercel does not expose it as its own function route.

async function transcribeAudio(file, apiKey) {
  const form = new FormData();
  form.append('file', file, file.name || 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  // This is an English placement test -- the spoken language is known, so
  // never let Whisper auto-detect. Auto-detection has misidentified accented
  // English as Arabic, producing an Arabic transcript that then gets graded
  // as if the student hadn't spoken English at all.
  form.append('language', 'en');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Whisper API error ${resp.status}: ${errText}`);
  }
  return resp.json();
}

module.exports = { transcribeAudio };
