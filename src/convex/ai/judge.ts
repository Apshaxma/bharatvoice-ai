/**
 * LLM-as-judge evaluation layer for BharatVoice AI.
 *
 * The agent's instant self-evaluation (`agent.ts`) is deliberately cheap — a
 * heuristic that runs at zero extra latency on every turn. This module adds a
 * proper judge: an LLM that scores completed turns against a five-criterion
 * rubric (completeness, grounding, language, conciseness, latency) and reports
 * a 0–1 score with per-criterion notes.
 *
 * The judge is intentionally *asynchronous*: it runs after the user already
 * got their answer (manual trigger from Insights, or the scheduled cron), so
 * scoring never adds latency to the conversation.
 *
 * The judge talks to the same `LLMProvider` interface as the agent:
 *   - live mode: the configured gateway model (e.g. gpt-5-mini)
 *   - mock mode: the deterministic JUDGE branch of `MockLLMProvider`
 * If the LLM call fails or returns malformed output, the judge degrades to the
 * shared heuristic scorer (`heuristicScore`) instead of failing the run.
 *
 * Pure module — no Convex imports — so it can be unit-tested.
 */

import { parseLlmJson, type LLMMessage, type LLMProvider } from "./llm";
import {
  heuristicScore,
  languageScriptMatches,
  type ScoreCriterion,
  type ScoreToolCall,
} from "./scoring";

export type { ScoreCriterion as JudgeCriterion, ScoreToolCall as JudgeToolCall } from "./scoring";
export { heuristicScore, languageScriptMatches } from "./scoring";

/** A completed agent turn, shaped for evaluation. */
export interface JudgeInput {
  transcript: string;
  detectedLanguage: string | null;
  intent: string | null;
  toolCalls: ScoreToolCall[];
  responseText: string;
  responseLanguage: string | null;
  totalLatencyMs: number;
}

export interface JudgeResult {
  /** 0–1, higher is better. */
  score: number;
  /** Per-rubric-dimension breakdown when the LLM provided it. */
  criteria: ScoreCriterion[];
  notes: string[];
  /** "llm-judge" when the LLM scored it, "heuristic-fallback" otherwise. */
  provider: string;
  model: string;
  latencyMs: number;
  /** Non-null when the LLM path failed and the fallback was used. */
  error: string | null;
}

export interface JudgeProvider {
  judge(input: JudgeInput): Promise<JudgeResult>;
}

const JUDGE_SYSTEM_PROMPT = [
  "You are the JUDGE of BharatVoice, an independent evaluation model for a multilingual voice agent.",
  "You score ONE completed agent turn on five criteria, each 0..1:",
  "- completeness: the response is non-empty, self-contained and answers the user's request",
  "- grounding: when tools were executed, the response correctly uses their results (numbers/outcomes); when a tool was skipped or denied, the response acknowledges that instead of fabricating an outcome",
  "- language: the response is in the user's language (script matches the detected language; code-mixing is fine for Hinglish)",
  "- conciseness: 1-3 sentences, spoken-friendly, no markdown, no lists, no emojis",
  "- latency: the total turn took under 12 seconds",
  "Respond with STRICT JSON only, no markdown:",
  '{"score": 0..1 (weighted .3 completeness, .3 grounding, .2 language, .1 conciseness, .1 latency), "criteria": [{"name": string, "score": 0..1, "note": string}], "notes": [string]}',
].join("\n");

/** Clamp and round any value to a 0–1 score with 2 decimals. */
function normalizeScore(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

/**
 * Judge implemented as an LLM call over the `LLMProvider` interface, with the
 * heuristic scorer as a graceful-degradation fallback.
 */
export class LlmJudgeProvider implements JudgeProvider {
  readonly name = "llm-judge";
  readonly model: string;
  private readonly llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
    this.model = llm.model;
  }

  async judge(input: JudgeInput): Promise<JudgeResult> {
    const started = Date.now();
    const messages: LLMMessage[] = [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Turn to evaluate (JSON):\n${JSON.stringify(input)}`,
      },
    ];

    const llmResult = await this.llm.complete(messages, {
      temperature: 0,
      maxTokens: 400,
    });
    const latencyMs = Date.now() - started;

    const fallback = (reason: string): JudgeResult => {
      const h = heuristicScore({
        responseText: input.responseText,
        toolCalls: input.toolCalls,
        languageCode: input.detectedLanguage,
        totalLatencyMs: input.totalLatencyMs,
      });
      return {
        score: h.score,
        criteria: h.criteria,
        notes: h.notes,
        provider: "heuristic-fallback",
        model: this.model,
        latencyMs,
        error: reason,
      };
    };

    if (llmResult.error) {
      return fallback(`LLM judge failed: ${llmResult.error}`);
    }

    const parsed = parseLlmJson<{
      score?: unknown;
      criteria?: unknown;
      notes?: unknown;
    }>(llmResult.content);
    if (!parsed || typeof parsed.score !== "number") {
      return fallback("LLM judge returned unparseable output");
    }

    const criteria: ScoreCriterion[] = Array.isArray(parsed.criteria)
      ? parsed.criteria
          .filter(
            (c): c is { name?: unknown; score?: unknown; note?: unknown } =>
              typeof c === "object" && c !== null,
          )
          .slice(0, 10)
          .map((c) => ({
            name: typeof c.name === "string" ? c.name : "criterion",
            score: normalizeScore(c.score),
            note: typeof c.note === "string" ? c.note : "",
          }))
      : [];
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter((n): n is string => typeof n === "string").slice(0, 8)
      : [];

    return {
      score: normalizeScore(parsed.score),
      criteria,
      notes,
      provider: this.name,
      model: this.model,
      latencyMs,
      error: null,
    };
  }
}

/** Factory — the judge always wraps the same LLM the agent uses. */
export function createJudgeProvider(llm: LLMProvider): JudgeProvider {
  return new LlmJudgeProvider(llm);
}
