const {
  CEFR_LABELS,
  bandFromGrammarLevel,
  bandFromReadingScore,
  speakingOverallBand,
  computeFinalBand,
  computeFluencyMetrics,
} = require('../lib/scoring');

const REPORT_TO = 'mohammedsaidelbouzdoudi99@gmail.com';
const REPORT_FROM = 'Takalam Level Test <onboarding@resend.dev>';
const REPORT_REPLY_TO = 'mohammedsaidelbouzdoudi99@gmail.com';

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // per-clip safety cap, real clips are ~KB
const MAX_TOTAL_ATTACHMENT_BYTES = 30 * 1024 * 1024; // combined safety cap, well under Resend's limit

const CEFR_TOOL_SCHEMA = {
  name: 'record_cefr_assessment',
  description: 'Record a strict CEFR speaking assessment for three prompts.',
  input_schema: {
    type: 'object',
    properties: {
      prompts: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            band: { type: 'string', enum: ['below-b1', 'b1', 'b2', 'c1'] },
            grammar_range: { type: 'integer', minimum: 1, maximum: 5 },
            vocabulary_range: { type: 'integer', minimum: 1, maximum: 5 },
            coherence: { type: 'integer', minimum: 1, maximum: 5 },
            freeze_indicators: { type: 'array', items: { type: 'string' } },
            example_errors: {
              type: 'array',
              items: { type: 'string' },
              minItems: 2,
              maxItems: 2,
            },
          },
          required: [
            'band',
            'grammar_range',
            'vocabulary_range',
            'coherence',
            'freeze_indicators',
            'example_errors',
          ],
        },
      },
    },
    required: ['prompts'],
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const missingKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY'].filter(
    (key) => !process.env[key]
  );
  if (missingKeys.length) {
    console.error(`[submit-test] Missing environment variable(s): ${missingKeys.join(', ')}`);
  }
  if (!process.env.RESEND_API_KEY) {
    // Without Resend there is no way to deliver the report at all.
    res.status(500).json({ error: 'Server is not configured to send results. Contact the site owner.' });
    return;
  }

  let formData;
  try {
    formData = await parseMultipart(req);
  } catch (err) {
    console.error('[submit-test] Failed to parse submission body:', err);
    res.status(400).json({ error: 'Could not read submission.' });
    return;
  }

  const name = String(formData.get('name') || '').trim();
  const whatsapp = String(formData.get('whatsapp') || '').trim();
  if (!name || !whatsapp) {
    res.status(400).json({ error: 'Name and WhatsApp number are required.' });
    return;
  }

  let section1 = {};
  let section2 = {};
  let prompts = [];
  let promptVariants = [];
  try {
    section1 = JSON.parse(formData.get('section1') || '{}');
    section2 = JSON.parse(formData.get('section2') || '{}');
    prompts = JSON.parse(formData.get('prompts') || '[]');
    promptVariants = JSON.parse(formData.get('promptVariants') || '[]');
  } catch (err) {
    console.error('[submit-test] Failed to parse section JSON:', err);
  }

  const grammarBand = bandFromGrammarLevel(section1.finalLevel);
  const readingBand = bandFromReadingScore(Number(section2.correctCount) || 0);

  let gradingIncomplete = missingKeys.includes('OPENAI_API_KEY') || missingKeys.includes('ANTHROPIC_API_KEY');
  const speakingResults = [];
  const attachments = [];
  const attachmentNotes = [];
  const slug = slugify(name);
  let totalAttachmentBytes = 0;

  for (let i = 0; i < 3; i += 1) {
    const audioFile = formData.get(`audio${i}`);
    const promptText = prompts[i] || `Prompt ${i + 1}`;
    if (!audioFile || typeof audioFile === 'string') {
      speakingResults.push({ promptText, error: 'No recording received' });
      gradingIncomplete = true;
      continue;
    }

    // Attach the raw clip for manual pronunciation/accent review, independent
    // of whether transcription succeeds below.
    if (audioFile.size > MAX_ATTACHMENT_BYTES || totalAttachmentBytes + audioFile.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      attachmentNotes.push(`Prompt ${i + 1} recording (${(audioFile.size / 1024 / 1024).toFixed(1)}MB) was too large to attach.`);
    } else {
      try {
        const buf = Buffer.from(await audioFile.arrayBuffer());
        attachments.push({
          filename: `${slug}-prompt${i + 1}.${extFromFile(audioFile)}`,
          content: buf.toString('base64'),
        });
        totalAttachmentBytes += audioFile.size;
      } catch (err) {
        console.error(`[submit-test] Failed to read audio file for prompt ${i}:`, err);
        attachmentNotes.push(`Prompt ${i + 1} recording could not be attached.`);
      }
    }

    if (missingKeys.includes('OPENAI_API_KEY')) {
      speakingResults.push({ promptText, error: 'Transcription unavailable' });
      continue;
    }
    try {
      const whisperResult = await transcribeAudio(audioFile, process.env.OPENAI_API_KEY);
      const metrics = computeFluencyMetrics(whisperResult, Number(formData.get(`audioDuration${i}`)) || 0);
      speakingResults.push({ promptText, transcript: whisperResult.text || '', metrics });
    } catch (err) {
      console.error(`[submit-test] Whisper transcription failed for prompt ${i}:`, err);
      speakingResults.push({ promptText, error: 'Transcription failed' });
      gradingIncomplete = true;
    }
  }

  let claudeResults = null;
  const transcribedOk = speakingResults.filter((r) => r.transcript);
  if (!missingKeys.includes('ANTHROPIC_API_KEY') && transcribedOk.length > 0) {
    try {
      claudeResults = await gradeWithClaude(speakingResults, process.env.ANTHROPIC_API_KEY);
    } catch (err) {
      console.error('[submit-test] Claude grading failed:', err);
      gradingIncomplete = true;
    }
  } else if (transcribedOk.length === 0) {
    gradingIncomplete = true;
  }

  const promptBands = claudeResults ? claudeResults.map((r) => r.band) : [];
  const speakingBand = speakingOverallBand(promptBands);
  const finalBand = speakingBand
    ? computeFinalBand({ speakingBand, grammarBand, readingBand })
    : null;

  const finalBandLabel = finalBand ? CEFR_LABELS[finalBand] : 'Pending manual review';

  const html = buildReportEmail({
    name,
    whatsapp,
    timestamp: new Date().toISOString(),
    gradingIncomplete,
    finalBandLabel,
    grammarBand,
    readingBand,
    section1,
    section2,
    speakingBand: speakingBand ? CEFR_LABELS[speakingBand] : 'Not graded',
    speakingResults,
    claudeResults,
    passageId: section2.passageId,
    promptVariants,
    attachmentNotes,
  });

  try {
    await sendReportEmail(html, `Takalam Level Test: ${name}, ${finalBandLabel}`, attachments);
  } catch (err) {
    console.error('[submit-test] Resend delivery failed:', err);
    res.status(502).json({ error: 'Could not deliver results. Please try again.' });
    return;
  }

  res.status(200).json({ success: true });
};

async function parseMultipart(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuffer = Buffer.concat(chunks);
  const contentType = req.headers['content-type'] || '';
  const request = new Request('http://localhost/api/submit-test', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: bodyBuffer,
  });
  return request.formData();
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '') || 'student';
}

function extFromFile(file) {
  const type = (file.type || '').toLowerCase();
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('webm')) return 'webm';
  const nameMatch = /\.([a-z0-9]+)$/i.exec(file.name || '');
  return nameMatch ? nameMatch[1] : 'webm';
}

async function transcribeAudio(file, apiKey) {
  const form = new FormData();
  form.append('file', file, file.name || 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

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

async function gradeWithClaude(speakingResults, apiKey) {
  const rubric = buildRubricPrompt(speakingResults);
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      tools: [CEFR_TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'record_cefr_assessment' },
      messages: [{ role: 'user', content: rubric }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Claude API error ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const toolUse = (data.content || []).find((c) => c.type === 'tool_use');
  if (!toolUse || !toolUse.input || !Array.isArray(toolUse.input.prompts)) {
    throw new Error('Claude did not return structured grading');
  }
  return toolUse.input.prompts;
}

function buildRubricPrompt(speakingResults) {
  const transcriptBlocks = speakingResults
    .map((r, i) => {
      if (!r.transcript) return `Prompt ${i + 1}: "${r.promptText}"\n[No usable transcript: ${r.error || 'unknown error'}]`;
      const m = r.metrics || {};
      return [
        `Prompt ${i + 1}: "${r.promptText}"`,
        `Transcript: "${r.transcript}"`,
        `Metrics: words per minute ${m.wpm}, filler frequency ${m.fillerFrequency} (${m.fillerCount} filler/repeat instances out of ${m.wordCount} words), longest fluent run ${m.longestFluentRun} words, silence ratio ${m.silenceRatio === null ? 'unavailable' : m.silenceRatio}, recording length ${m.durationSeconds}s.`,
      ].join('\n');
    })
    .join('\n\n');

  return `You are a strict CEFR speaking examiner grading a spoken English placement test. Grade honestly and conservatively. Do not round up out of politeness. Use the transcripts and the fluency metrics together; if metrics suggest heavy hesitation or very low word counts, that should pull the band down even if vocabulary looks reasonable on paper.

CEFR band reference:
- below-b1: Frequent basic errors, very limited vocabulary, long pauses, cannot sustain a coherent answer, often answers off topic or with single words.
- b1: Can describe familiar topics in simple connected speech, noticeable grammar errors, limited range of vocabulary, some hesitation.
- b2: Can explain a viewpoint with reasonable fluency and detail, occasional errors that do not block understanding, decent range of vocabulary and connectors.
- c1: Fluent and spontaneous, wide vocabulary and idiomatic range, coherent and well structured argument, only minor and infrequent errors.

Grade each of the three prompts below (they rise in difficulty: introduction, then a problem narrative, then an opinion argument).

${transcriptBlocks}

For each prompt return: band, grammar_range (1-5), vocabulary_range (1-5), coherence (1-5), freeze_indicators (a list of observed signs such as hesitation, avoidance, or unusually short answers; empty list if none), and example_errors (exactly two errors quoted verbatim from that prompt's transcript; if there are fewer than two clear errors, quote what is available and note "no further errors observed" for the second). Do not use em dashes anywhere in your response. Call the record_cefr_assessment tool with your results.`;
}

function buildReportEmail(data) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const CHECK = '&#10003;';
  const CROSS = '&#10007;';
  const mark = (ok) => ok
    ? `<span style="color:#1a7a4c;font-weight:700;">${CHECK}</span>`
    : `<span style="color:#b23b3b;font-weight:700;">${CROSS}</span>`;

  const trajectory = data.section1.trajectory || [];
  const promptBandList = (data.claudeResults || [])
    .map((c, i) => `Prompt ${i + 1}: ${esc(c.band)}`)
    .join(', ') || 'not graded';

  const speakingBlocks = data.speakingResults
    .map((r, i) => {
      const claude = data.claudeResults ? data.claudeResults[i] : null;
      return `
        <div style="margin:16px 0;padding:12px;border:1px solid #e5e0d5;border-radius:8px;">
          <p style="margin:0 0 6px;font-weight:600;">Prompt ${i + 1}: ${esc(r.promptText)}</p>
          ${claude ? `<p style="margin:0 0 6px;font-size:13px;">Band: <strong>${esc(claude.band)}</strong> &middot; grammar ${claude.grammar_range}/5 &middot; vocabulary ${claude.vocabulary_range}/5 &middot; coherence ${claude.coherence}/5</p>
          <p style="margin:0 0 6px;font-size:13px;">Freeze indicators: ${claude.freeze_indicators && claude.freeze_indicators.length ? esc(claude.freeze_indicators.join(', ')) : 'none observed'}</p>
          <p style="margin:0 0 6px;font-size:13px;">Example errors: ${esc((claude.example_errors || []).join(' | '))}</p>` : '<p style="margin:0 0 6px;font-size:13px;color:#b00;">Not graded</p>'}
          ${r.metrics ? `<p style="margin:0 0 6px;font-size:13px;color:#555;">WPM ${r.metrics.wpm} &middot; filler freq ${r.metrics.fillerFrequency} (${r.metrics.fillerCount} instances) &middot; longest fluent run ${r.metrics.longestFluentRun} words &middot; silence ratio ${r.metrics.silenceRatio === null ? 'n/a' : r.metrics.silenceRatio} &middot; length ${r.metrics.durationSeconds}s</p>` : ''}
          ${r.transcript ? `<p style="margin:0;white-space:pre-wrap;">${esc(r.transcript)}</p>` : `<p style="margin:0;color:#b00;">${esc(r.error || 'No transcript')}</p>`}
        </div>`;
    })
    .join('');

  const trajectorySequence = trajectory.length
    ? trajectory.map((t) => `${esc(t.level)} ${t.correct ? CHECK : CROSS}`).join(' &rarr; ')
    : 'no items answered';

  const grammarRows = trajectory.length
    ? trajectory.map((t, i) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${i + 1}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${esc(t.level)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${esc(t.question)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${esc(t.studentAnswer)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${esc(t.correctAnswer)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;text-align:center;">${mark(t.correct)}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" style="padding:6px 8px;">No grammar and vocabulary item detail available.</td></tr>`;

  const readingDetail = data.section2.itemDetail || [];
  const readingRows = readingDetail.length
    ? readingDetail.map((r, i) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${i + 1}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${esc(r.question)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${esc(r.studentAnswer)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;">${esc(r.correctAnswer)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e0d5;text-align:center;">${mark(r.correct)}</td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="padding:6px 8px;">No reading item detail available.</td></tr>`;

  return `
  <div style="font-family:Arial,sans-serif;color:#1a2332;max-width:680px;">
    <h2 style="color:#0d4f37;">Takalam Level Test result</h2>
    ${data.gradingIncomplete ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:6px;color:#7a5c00;"><strong>Grading incomplete.</strong> One or more automated steps failed. Review the raw data below manually.</p>' : ''}

    <p><strong>Name:</strong> ${esc(data.name)}<br/>
    <strong>WhatsApp:</strong> ${esc(data.whatsapp)}<br/>
    <strong>Final band:</strong> ${esc(data.finalBandLabel)}<br/>
    <strong>Submitted:</strong> ${esc(data.timestamp)}</p>

    <h3 style="color:#0d4f37;">Section scores</h3>
    <p><strong>Grammar &amp; vocabulary:</strong> ${esc(data.grammarBand)} (final adaptive level: ${esc(data.section1.finalLevel || 'n/a')}, ${esc(trajectory.length)} items answered)<br/>
    <strong>Reading:</strong> ${esc(data.readingBand)} (${esc(data.section2.correctCount)}/4 correct)<br/>
    <strong>Speaking overall:</strong> ${esc(data.speakingBand)} (${esc(promptBandList)})</p>

    <h3 style="color:#0d4f37;">Test variant</h3>
    <p><strong>Reading passage:</strong> ${esc(data.passageId || 'n/a')}<br/>
    <strong>Speaking prompt variants:</strong> ${esc((data.promptVariants || []).join(', ') || 'n/a')}</p>
    ${data.attachmentNotes && data.attachmentNotes.length ? `<p style="background:#fff3cd;padding:8px 12px;border-radius:6px;color:#7a5c00;">${data.attachmentNotes.map(esc).join('<br/>')}</p>` : ''}

    <h3 style="color:#0d4f37;">Speaking assessment</h3>
    ${speakingBlocks}

    <div style="margin-top:28px;padding:16px;background:#f7f5ee;border:1px solid #e5e0d5;border-radius:10px;">
      <h3 style="color:#0d4f37;margin-top:0;">Item detail</h3>
      <p style="font-size:13px;color:#555;">Full answer log for internal review. Not shown to the student.</p>

      <p style="font-size:13px;"><strong>Adaptive difficulty trajectory:</strong><br/>${trajectorySequence}</p>

      <p style="font-weight:600;font-size:13px;margin-bottom:6px;">Grammar &amp; vocabulary items</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff;">
        <thead>
          <tr style="background:#efece0;">
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">#</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Level</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Question</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Student answer</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Correct answer</th>
            <th style="text-align:center;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Result</th>
          </tr>
        </thead>
        <tbody>${grammarRows}</tbody>
      </table>

      <p style="font-weight:600;font-size:13px;margin:16px 0 6px;">Reading items (${esc(data.passageId || 'n/a')})</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff;">
        <thead>
          <tr style="background:#efece0;">
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">#</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Question</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Student answer</th>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Correct answer</th>
            <th style="text-align:center;padding:6px 8px;border-bottom:1px solid #e5e0d5;">Result</th>
          </tr>
        </thead>
        <tbody>${readingRows}</tbody>
      </table>
    </div>
  </div>`;
}

async function sendReportEmail(html, subject, attachments) {
  const body = {
    from: REPORT_FROM,
    to: [REPORT_TO],
    reply_to: REPORT_REPLY_TO,
    subject,
    html,
  };
  if (attachments && attachments.length) {
    body.attachments = attachments;
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Resend API error ${resp.status}: ${errText}`);
  }
}
