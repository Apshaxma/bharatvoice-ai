/**
 * Speech-to-text layer tests.
 *
 * Live transcription runs in the browser (Web Speech API); the backend STT
 * layer is a deterministic mock behind the provider interface. These tests
 * cover the mock provider's behavior and the factory rules.
 */

import { describe, expect, test } from "bun:test";
import {
  MockSTTProvider,
  createSTTProvider,
  supportedLanguageCount,
} from "../src/convex/ai/stt";

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

  test("transcribe reports real latency (not zero)", async () => {
    const result = await provider.transcribe({
      audio,
      mimeType: "audio/webm",
      languageCode: "hi-IN",
      mode: "transcribe",
    });
    // The mock sleeps 280–700 ms, so latencyMs must be > 200 at minimum
    expect(result.latencyMs).toBeGreaterThan(200);
    expect(result.latencyMs).toBeLessThan(2000);
  });
});

describe("provider factory", () => {
  test("backend STT is always the deterministic mock (no vendor involved)", () => {
    expect(createSTTProvider().name).toBe("mock");
    expect(createSTTProvider({ mockMode: true }).name).toBe("mock");
    expect(createSTTProvider({ mockMode: false }).name).toBe("mock");
  });

  test("language count matches the registry", () => {
    expect(supportedLanguageCount()).toBe(23);
  });
});
