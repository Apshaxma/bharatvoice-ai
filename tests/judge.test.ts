/**
 * LLM-as-judge evaluation layer tests.
 *
 * Covers the shared heuristic scorer (used by the agent, the mock brain and
 * the judge's fallback), the LLM judge driven by the deterministic mock brain
 * (so the whole layer is testable offline), and graceful degradation when the
 * judge model returns garbage or fails outright.
 */

import { describe, expect, test } from "bun:test";
import {
  LlmJudgeProvider,
  createJudgeProvider,
  heuristicScore,
  languageScriptMatches,
  type JudgeInput,
} from "../src/convex/ai/judge";
import {
  MockLLMProvider,
  type LLMProvider,
  type LLMResult,
} from "../src/convex/ai/llm";

const goodTurn: JudgeInput = {
  transcript: "कल मुंबई से पुणे जाना है। मौसम कैसा रहेगा?",
  detectedLanguage: "hi-IN",
  intent: "weather_query",
  toolCalls: [
    {
      name: "getWeather",
      status: "executed",
      result: {
        city: "Mumbai",
        temperatureMax: 31,
        temperatureMin: 24,
        precipitationProbability: 15,
      },
    },
  ],
  responseText: "कल मुंबई में मौसम साफ़ रहेगा। अधिकतम 31°C और बारिश की संभावना 15%।",
  responseLanguage: "hi-IN",
  totalLatencyMs: 4000,
};

// ---------------------------------------------------------------------------
// Shared scorer
// ---------------------------------------------------------------------------

describe("languageScriptMatches", () => {
  test("matches Devanagari text to Hindi/Marathi and Latin to English", () => {
    expect(languageScriptMatches("नमस्ते", "hi-IN")).toBe(true);
    expect(languageScriptMatches("Hello", "hi-IN")).toBe(false);
    expect(languageScriptMatches("Hello", "en-IN")).toBe(true);
    expect(languageScriptMatches("নমস্কার", "bn-IN")).toBe(true);
    expect(languageScriptMatches("வணக்கம்", "ta-IN")).toBe(true);
  });

  test("unknown language codes are not penalized", () => {
    expect(languageScriptMatches("anything", "xx-XX")).toBe(true);
  });
});

describe("heuristicScore", () => {
  test("scores a grounded, in-language answer at 1.0", () => {
    const result = heuristicScore({
      responseText: goodTurn.responseText,
      toolCalls: goodTurn.toolCalls,
      languageCode: "hi-IN",
      totalLatencyMs: 4000,
    });
    expect(result.score).toBe(1);
    expect(result.criteria).toHaveLength(5);
    expect(result.criteria.map((c) => c.name)).toEqual([
      "completeness",
      "grounding",
      "language",
      "conciseness",
      "latency",
    ]);
  });

  test("penalizes an answer that ignores executed tool results", () => {
    const result = heuristicScore({
      responseText: "मौसम ठीक रहेगा।",
      toolCalls: goodTurn.toolCalls,
      languageCode: "hi-IN",
      totalLatencyMs: 4000,
    });
    expect(result.score).toBeCloseTo(0.7, 5);
    expect(result.notes).toContain("answer missing tool numbers");
  });

  test("treats missing tool results neutrally", () => {
    const result = heuristicScore({
      responseText: "नमस्ते! मैं आपकी कैसे मदद कर सकता हूँ?",
      toolCalls: [],
      languageCode: "hi-IN",
      totalLatencyMs: 800,
    });
    expect(result.score).toBe(1);
  });

  test("penalizes script mismatch with the detected language", () => {
    const result = heuristicScore({
      responseText: "The weather will be fine tomorrow.",
      toolCalls: [],
      languageCode: "hi-IN",
      totalLatencyMs: 800,
    });
    expect(result.notes).toContain("script mismatch with user language");
    expect(result.score).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// LLM judge driven by the mock brain (offline, deterministic)
// ---------------------------------------------------------------------------

describe("LLM judge with the mock brain", () => {
  const judge = createJudgeProvider(new MockLLMProvider());

  test("scores a well-grounded multilingual turn above 0.8", async () => {
    const result = await judge.judge(goodTurn);
    expect(result.error).toBeNull();
    expect(result.provider).toBe("llm-judge");
    expect(result.model).toBe("mock-bharat-1b");
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.criteria).toHaveLength(5);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  test("is deterministic for identical inputs", async () => {
    const a = await judge.judge(goodTurn);
    const b = await judge.judge(goodTurn);
    expect(a.score).toBe(b.score);
  });

  test("penalizes an answer that does not cite tool numbers", async () => {
    const result = await judge.judge({
      ...goodTurn,
      responseText: "मौसम ठीक रहेगा।",
    });
    expect(result.score).toBeCloseTo(0.7, 5);
  });

  test("garbage judge output falls back to heuristics", async () => {
    const garbage: LLMProvider = {
      name: "garbage",
      model: "garbage-1",
      async complete(): Promise<LLMResult> {
        return {
          content: "I am definitely not JSON",
          latencyMs: 1,
          provider: "garbage",
          model: "garbage-1",
          error: null,
        };
      },
    };
    const result = await new LlmJudgeProvider(garbage).judge(goodTurn);
    expect(result.provider).toBe("heuristic-fallback");
    expect(result.error).toContain("unparseable");
    expect(result.score).toBeGreaterThan(0);
    expect(result.criteria).toHaveLength(5);
  });

  test("judge model failure falls back to heuristics", async () => {
    const broken: LLMProvider = {
      name: "broken",
      model: "broken-1",
      async complete(): Promise<LLMResult> {
        return {
          content: "",
          latencyMs: 5,
          provider: "broken",
          model: "broken-1",
          error: "LLM request failed",
        };
      },
    };
    const result = await new LlmJudgeProvider(broken).judge(goodTurn);
    expect(result.provider).toBe("heuristic-fallback");
    expect(result.error).toContain("LLM judge failed");
  });
});
