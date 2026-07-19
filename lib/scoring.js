// Shared scoring and fluency-metric helpers for the level test.
// Kept outside /api so Vercel does not expose it as its own function route.

const LEVELS = ['below-b1', 'b1', 'b2', 'c1'];

const CEFR_LABELS = {
  'below-b1': 'Below B1',
  'b1': 'B1',
  'b2': 'B2',
  'c1': 'C1+',
};

const GRAMMAR_LEVEL_TO_BAND = {
  A2: 'below-b1',
  B1: 'b1',
  B2: 'b2',
  C1: 'c1',
};

function bandFromGrammarLevel(level) {
  return GRAMMAR_LEVEL_TO_BAND[level] || 'below-b1';
}

// Coarse mapping on purpose: 4 questions cannot support fine-grained bands.
function bandFromReadingScore(correctCount) {
  if (correctCount >= 4) return 'c1';
  if (correctCount === 3) return 'b2';
  if (correctCount === 2) return 'b1';
  return 'below-b1';
}

function levelIndex(band) {
  const idx = LEVELS.indexOf(band);
  return idx === -1 ? 0 : idx;
}

// Median of the three prompt bands (prompts rise in difficulty by design,
// so the middle result is a fairer read than the mean of a rising sequence).
function speakingOverallBand(promptBands) {
  const valid = promptBands.filter(Boolean);
  if (valid.length === 0) return null;
  const idxs = valid.map(levelIndex).sort((a, b) => a - b);
  const mid = idxs[Math.floor((idxs.length - 1) / 2)];
  return LEVELS[mid];
}

function computeFinalBand({ speakingBand, grammarBand, readingBand }) {
  if (!speakingBand) return null;
  const speakingIdx = levelIndex(speakingBand);
  if (speakingIdx <= 0) return 'below-b1';

  const grammarIdx = levelIndex(grammarBand);
  const readingIdx = levelIndex(readingBand);
  const weighted = speakingIdx * 0.6 + grammarIdx * 0.25 + readingIdx * 0.15;
  const rounded = Math.round(weighted);
  const capped = Math.min(rounded, speakingIdx);
  return LEVELS[Math.max(0, Math.min(capped, LEVELS.length - 1))];
}

const FILLER_REGEX = /\b(um+|uh+|erm+|hmm+|like|you know)\b/gi;
const REPEATED_WORD_REGEX = /\b(\w+)\s+\1\b/gi;

function computeFluencyMetrics(whisperResult, recordedSeconds) {
  const text = (whisperResult && whisperResult.text) ? whisperResult.text.trim() : '';
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const duration = (whisperResult && whisperResult.duration) || recordedSeconds || 0;
  const minutes = duration > 0 ? duration / 60 : 0;
  const wpm = minutes > 0 ? Math.round(wordCount / minutes) : 0;

  const fillerMatches = text.match(FILLER_REGEX) || [];
  const repeatedMatches = text.match(REPEATED_WORD_REGEX) || [];
  const fillerCount = fillerMatches.length + repeatedMatches.length;
  const fillerFrequency = wordCount > 0 ? Number((fillerCount / wordCount).toFixed(3)) : 0;

  const chunks = text.split(FILLER_REGEX).map((c) => c.trim()).filter(Boolean);
  const longestFluentRun = chunks.reduce(
    (max, chunk) => Math.max(max, chunk.split(/\s+/).filter(Boolean).length),
    0
  );

  let silenceRatio = null;
  if (whisperResult && Array.isArray(whisperResult.segments) && whisperResult.segments.length && duration > 0) {
    const spoken = whisperResult.segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
    silenceRatio = Number(Math.max(0, (duration - spoken) / duration).toFixed(3));
  }

  return {
    wordCount,
    durationSeconds: Math.round(duration),
    wpm,
    fillerCount,
    fillerFrequency,
    longestFluentRun,
    silenceRatio,
  };
}

module.exports = {
  LEVELS,
  CEFR_LABELS,
  bandFromGrammarLevel,
  bandFromReadingScore,
  speakingOverallBand,
  computeFinalBand,
  computeFluencyMetrics,
};
