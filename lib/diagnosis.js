// Turns already-graded test data into the student-facing diagnosis shown on
// results.html: one headline, one true strength, one concrete blocker, and
// which product to recommend.
//
// The product recommendation is deterministic, not left to the LLM -- it's
// the one output on this page with real money attached, and the brief's
// routing rule is simple enough to just compute directly. Claude only writes
// the qualitative narrative, and is told explicitly to ground it in the data
// it's given rather than invent anything.

const SPECIFIC_GOALS = new Set(['exam', 'interview', 'presentation', 'writing']);
const DEADLINE_WEEKS_THRESHOLD = 6;

function recommendProduct({ goal, goalDeadlineWeeks }) {
  const hasHardDeadline = Number.isFinite(goalDeadlineWeeks) && goalDeadlineWeeks > 0 && goalDeadlineWeeks < DEADLINE_WEEKS_THRESHOLD;
  const hasSpecificGoal = SPECIFIC_GOALS.has(goal);
  return hasHardDeadline || hasSpecificGoal ? 'private' : 'speak';
}

const DIAGNOSIS_TOOL_SCHEMA = {
  name: 'record_diagnosis',
  description: 'Write a short, honest, teacher-voiced diagnosis of one student\'s spoken English test.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'One plain sentence stating the CEFR band, without flattery.' },
      strength: { type: 'string', description: 'One true, specific thing this student is already good at, drawn only from the transcripts/metrics given. Do not invent a strength the data does not support.' },
      blocker: { type: 'string', description: 'The one specific, concrete thing stopping them -- named plainly, e.g. structural, not "improve fluency" style vagueness.' },
    },
    required: ['headline', 'strength', 'blocker'],
  },
};

async function generateNarrative({ speakingResults, claudeResults, finalBandLabel, grammarBand, readingBand, apiKey }) {
  const prompt = buildDiagnosisPrompt({ speakingResults, claudeResults, finalBandLabel, grammarBand, readingBand });
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      tools: [DIAGNOSIS_TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'record_diagnosis' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Claude API error ${resp.status}: ${errText}`);
  }
  const data = await resp.json();
  const toolUse = (data.content || []).find((c) => c.type === 'tool_use');
  if (!toolUse || !toolUse.input) {
    throw new Error('Claude did not return a structured diagnosis');
  }
  return toolUse.input;
}

function buildDiagnosisPrompt({ speakingResults, claudeResults, finalBandLabel, grammarBand, readingBand }) {
  const transcriptBlocks = (speakingResults || [])
    .map((r, i) => {
      if (!r.transcript) return `Prompt ${i + 1}: [no usable transcript]`;
      const claude = claudeResults ? claudeResults[i] : null;
      const m = r.metrics || {};
      return [
        `Prompt ${i + 1}: "${r.promptText}"`,
        `Transcript: "${r.transcript}"`,
        claude ? `Grading: band ${claude.band}, grammar ${claude.grammar_range}/5, vocabulary ${claude.vocabulary_range}/5, coherence ${claude.coherence}/5, freeze indicators: ${(claude.freeze_indicators || []).join(', ') || 'none'}` : '',
        `Metrics: ${m.wpm} wpm, longest fluent run ${m.longestFluentRun} words, filler frequency ${m.fillerFrequency}.`,
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');

  return `You are writing a short results-page diagnosis for a spoken English placement test, addressed directly to the student who took it. Write as a specific, honest teacher describing this exact person, not generic advice. Never invent a strength or blocker the data below does not support. Do not use em dashes.

Final band: ${finalBandLabel}. Grammar & vocabulary band: ${grammarBand}. Reading band: ${readingBand}.

${transcriptBlocks}

Call record_diagnosis with a headline (one plain sentence stating the band, no flattery), a strength (one true, specific thing they're already good at, grounded in the transcripts above), and a blocker (the one concrete thing stopping them, named specifically rather than as generic advice like "improve fluency").`;
}

async function generateDiagnosis({ speakingResults, claudeResults, finalBandLabel, grammarBand, readingBand, goal, goalDeadlineWeeks, apiKey }) {
  const narrative = await generateNarrative({ speakingResults, claudeResults, finalBandLabel, grammarBand, readingBand, apiKey });
  return {
    ...narrative,
    recommended_product: recommendProduct({ goal, goalDeadlineWeeks }),
  };
}

module.exports = { generateDiagnosis, recommendProduct };
