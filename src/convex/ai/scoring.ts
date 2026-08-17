/**
 * Shared response-scoring primitives for BharatVoice AI.
 *
 * `heuristicScore` is the cheap, deterministic runtime scorer. It is used in
 * three places so the numbers always agree:
 *   1. the agent's instant self-evaluation (agent.ts),
 *   2. the mock brain's JUDGE branch (llm.ts),
 *   3. the LLM judge's fallback when the judge model fails (judge.ts).
 *
 * Pure module — no Convex imports — so it can be unit-tested.
 */

/** Shape of a tool call as seen by the scorer. */
export interface ScoreToolCall {
  status: string;
  result?: Record<string, unknown> | null;
}

/** One rubric dimension: name, 0–1 score, one-line note. */
export interface ScoreCriterion {
  name: string;
  score: number;
  note: string;
}

export interface HeuristicResult {
  /** Weighted total, rounded to 2 decimals, clamped to [0, 1]. */
  score: number;
  notes: string[];
  criteria: ScoreCriterion[];
}

/** Unicode ranges by BCP-47 code, used to check the response's script. */
const SCRIPT_RANGES: Record<string, RegExp> = {
  "hi-IN": /[\u0900-\u097F]/,
  "mr-IN": /[\u0900-\u097F]/,
  "bn-IN": /[\u0980-\u09FF]/,
  "ta-IN": /[\u0B80-\u0BFF]/,
  "te-IN": /[\u0C00-\u0C7F]/,
  "kn-IN": /[\u0C80-\u0CFF]/,
  "ml-IN": /[\u0D00-\u0D7F]/,
  "gu-IN": /[\u0A80-\u0AFF]/,
  "pa-IN": /[\u0A00-\u0A7F]/,
  "ur-IN": /[\u0600-\u06FF]/,
  "en-IN": /[a-zA-Z]/,
};

/** Whether a text's script plausibly matches the detected language. */
export function languageScriptMatches(text: string, languageCode: string): boolean {
  const range = SCRIPT_RANGES[languageCode];
  if (!range) return true; // unknown script → don't penalize
  return range.test(text);
}

/**
 * Deterministic 0–1 score with a five-criterion breakdown:
 *   completeness .3 · grounding .3 · language .2 · conciseness .1 · latency .1
 *
 * When there is nothing to ground against (no tool results) or no detected
 * language, those criteria score neutrally (1.0) rather than penalizing the
 * answer.
 */
export function heuristicScore(input: {
  responseText: string;
  toolCalls: ScoreToolCall[];
  languageCode: string | null;
  totalLatencyMs: number;
}): HeuristicResult {
  const notes: string[] = [];
  const criteria: ScoreCriterion[] = [];
  let score = 0;

  const text = input.responseText.trim();

  // completeness (0.3)
  const completenessOk = text.length >= 10;
  if (completenessOk) {
    score += 0.3;
    notes.push("non-empty response");
  } else {
    notes.push("response too short");
  }
  criteria.push({
    name: "completeness",
    score: completenessOk ? 1 : 0,
    note: completenessOk ? "responded" : "too short",
  });

  // grounding (0.3)
  const executed = input.toolCalls.filter((t) => t.status === "executed");
  const numbers = executed
    .flatMap((t) => Object.values(t.result ?? {}))
    .filter((val): val is number => typeof val === "number");
  let groundingOk: boolean;
  if (executed.length > 0 && numbers.length > 0) {
    groundingOk = numbers.some((n) => text.includes(String(n)));
    if (groundingOk) {
      score += 0.3;
      notes.push("answer cites tool data");
    } else {
      notes.push("answer missing tool numbers");
    }
  } else {
    groundingOk = true;
    score += 0.3;
    notes.push("no tool results to ground against");
  }
  criteria.push({
    name: "grounding",
    score: groundingOk ? 1 : 0,
    note: groundingOk
      ? "grounded in tool results"
      : "not grounded in tool results",
  });

  // language (0.2)
  let languageOk = true;
  if (input.languageCode && text) {
    languageOk = languageScriptMatches(text, input.languageCode);
    if (languageOk) {
      score += 0.2;
      notes.push("language matches user");
    } else {
      notes.push("script mismatch with user language");
    }
  } else {
    score += 0.2;
    notes.push("language unknown — no penalty");
  }
  criteria.push({
    name: "language",
    score: languageOk ? 1 : 0,
    note: languageOk ? "matches user language" : "script mismatch",
  });

  // conciseness (0.1)
  const conciseOk = text.length <= 400;
  if (conciseOk) {
    score += 0.1;
    notes.push("concise");
  }
  criteria.push({
    name: "conciseness",
    score: conciseOk ? 1 : 0,
    note: conciseOk ? "concise" : "too long",
  });

  // latency (0.1)
  const latencyOk = input.totalLatencyMs < 12_000;
  if (latencyOk) {
    score += 0.1;
    notes.push("within latency budget");
  }
  criteria.push({
    name: "latency",
    score: latencyOk ? 1 : 0,
    note: latencyOk ? "within budget" : "too slow",
  });

  return { score: Math.min(1, Math.round(score * 100) / 100), notes, criteria };
}
