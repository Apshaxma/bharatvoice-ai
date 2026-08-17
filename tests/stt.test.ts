/**
 * Speech-to-text layer tests: retry policy math, mock provider behavior and
 * the provider factory rules (mock mode / missing key / live provider).
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RETRY_POLICY,
  MockSTTProvider,
  SarvamSTTProvider,
  backoffDelayMs,
  createSTTProvider,
  isTransientStatus,
  supportedLanguageCount,
} from "../src/convex/ai/stt";

describe("retry policy", () => {
  test("transient statuses are retryable, hard failures are not", () => {
    expect(isTransientStatus(408, DEFAULT_RETRY_POLICY)).toBe(true);
    expect(isTransientStatus(429, DEFAULT_RETRY_POLICY)).toBe(true);
    expect(isTransientStatus(500, DEFAULT_RETRY_POLICY)).toBe(true);
    expect(isTransientStatus(503, DEFAULT_RETRY_POLICY)).toBe(true);
    expect(isTransientStatus(400, DEFAULT_RETRY_POLICY)).toBe(false);
    expect(isTransientStatus(401, DEFAULT_RETRY_POLICY)).toBe(false);
    expect(isTransientStatus(404, DEFAULT_RETRY_POLICY)).toBe(false);
  });

  test("backoff grows exponentially and is capped at maxDelayMs", () => {
    const policy = {
      maxRetries: 5,
      baseDelayMs: 400,
      maxDelayMs: 3000,
      retryableStatuses: [500],
    };
    expect(backoffDelayMs(0, policy)).toBe(400);
    expect(backoffDelayMs(1, policy)).toBe(800);
    expect(backoffDelayMs(2, policy)).toBe(1600);
    expect(backoffDelayMs(3, policy)).toBe(3000);
    expect(backoffDelayMs(9, policy)).toBe(3000);
  });
});

describe("mock STT provider", () => {
  const provider = new MockSTTProvider();
  const audio = new Uint8Array(4096);

  test("pinned language returns that language's transcript, no confidence", async () => {
    const result = await provider.transcribe({
      audio,
      mimeType: "audio/webm",
      languageCode: "hi-IN",
      mode: "transcribe",
    });
    expect(result.error).toBeNull();
    expect(result.errorType).toBeNull();
    expect(result.languageCode).toBe("hi-IN");
    expect(result.languageProbability).toBeNull();
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.providerRequestId).toMatch(/^mock_/);
  });

  test("auto-detect returns a language with plausible confidence", async () => {
    const result = await provider.transcribe({
      audio: new Uint8Array(1337),
      mimeType: "audio/webm",
      languageCode: null,
      mode: "transcribe",
    });
    expect(result.error).toBeNull();
    expect(result.languageCode).not.toBeNull();
    expect(result.languageProbability).toBeGreaterThan(0.8);
    expect(result.languageProbability).toBeLessThanOrEqual(1);
  });

  test("translit mode returns romanized text", async () => {
    const result = await provider.transcribe({
      audio,
      mimeType: "audio/webm",
      languageCode: "hi-IN",
      mode: "translit",
    });
    expect(/[a-z]/.test(result.transcript)).toBe(true);
    expect(result.transcript).toContain("mumbai");
  });

  test("translate mode returns English", async () => {
    const result = await provider.transcribe({
      audio,
      mimeType: "audio/webm",
      languageCode: "mr-IN",
      mode: "translate",
    });
    expect(result.transcript).toContain("Mumbai");
  });

  test("codemix mode mixes scripts", async () => {
    const result = await provider.transcribe({
      audio,
      mimeType: "audio/webm",
      languageCode: "hi-IN",
      mode: "codemix",
    });
    expect(/[\u0900-\u097F]/.test(result.transcript)).toBe(true);
    expect(/[a-z]/.test(result.transcript)).toBe(true);
  });

  test("unsupported pinned language echoes the pin but uses the Hindi sample", async () => {
    const result = await provider.transcribe({
      audio,
      mimeType: "audio/webm",
      languageCode: "xx-XX",
      mode: "transcribe",
    });
    // The pin is echoed back (the provider returns what was requested), while
    // the sample transcript falls back to the default Hindi utterance.
    expect(result.languageCode).toBe("xx-XX");
    expect(/[\u0900-\u097F]/.test(result.transcript)).toBe(true);
  });
});

describe("provider factory", () => {
  test("mock mode forces the mock even with a key", () => {
    const provider = createSTTProvider({ mockMode: true, apiKey: "sk-test" });
    expect(provider.name).toBe("mock");
  });

  test("missing key falls back to mock", () => {
    const provider = createSTTProvider({ mockMode: false, apiKey: "" });
    expect(provider.name).toBe("mock");
  });

  test("key + no mock returns the live Sarvam provider", () => {
    const provider = createSTTProvider({ mockMode: false, apiKey: "sk-test" });
    expect(provider).toBeInstanceOf(SarvamSTTProvider);
    expect(provider.name).toBe("sarvam");
  });

  test("language count matches the registry", () => {
    expect(supportedLanguageCount()).toBe(23);
  });
});
