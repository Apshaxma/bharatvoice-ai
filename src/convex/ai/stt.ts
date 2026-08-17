/**
 * Speech-to-text provider abstraction for BharatVoice AI.
 *
 * The agent pipeline talks to a `SpeechToTextProvider` interface — never to a
 * vendor SDK directly. That keeps the rest of the system testable (mock
 * provider), replaceable (swap Sarvam for another vendor later) and honest
 * about what happens when a provider fails.
 *
 * This module is intentionally free of Convex imports so it can be unit-tested
 * and driven by evaluation scripts outside the Convex runtime.
 */

import {
  getLanguageInfo,
  LANGUAGES,
  type TranscriptionMode,
} from "./languages";

/** Result of a single transcription request, provider-agnostic. */
export interface STTResult {
  /** Transcribed text. Empty when no speech was detected. */
  transcript: string;
  /** Detected BCP-47 language code. Null when the provider could not decide. */
  languageCode: string | null;
  /** Provider confidence in the detected language (0–1). */
  languageProbability: number | null;
  /** Provider request id when available (used for tracing/audit). */
  providerRequestId: string | null;
  /** Wall-clock time spent in the provider call, ms. */
  latencyMs: number;
  /** Human-safe failure reason. Null on success. */
  error: string | null;
  /** Machine-readable error category for metrics. Null on success. */
  errorType: "provider" | "timeout" | "network" | "no_speech" | "invalid_audio" | null;
}

export interface STTRequest {
  /** Raw audio bytes (WAV/WebM/MP3/OGG etc). */
  audio: Uint8Array;
  /** Audio MIME type, e.g. "audio/webm;codecs=opus". */
  mimeType: string;
  /** Pin a language, or null for automatic detection. */
  languageCode: string | null;
  /** Output mode: transcribe | codemix | translit | verbatim | translate. */
  mode: TranscriptionMode["code"];
}

export interface SpeechToTextProvider {
  readonly name: string;
  readonly model: string;
  transcribe(request: STTRequest): Promise<STTResult>;
}

/** Retry policy for transient provider failures. */
export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Status codes considered transient (retryable). */
  retryableStatuses: number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  baseDelayMs: 400,
  maxDelayMs: 3000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

export function isTransientStatus(status: number, policy: RetryPolicy): boolean {
  return policy.retryableStatuses.includes(status);
}

/** Exponential backoff delay for the nth retry (0-indexed). */
export function backoffDelayMs(attempt: number, policy: RetryPolicy): number {
  const delay = policy.baseDelayMs * 2 ** attempt;
  return Math.min(delay, policy.maxDelayMs);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sarvam AI speech-to-text provider.
 *
 * REST endpoint: POST https://api.sarvam.ai/speech-to-text
 * Authentication: `api-subscription-key` header
 * Models: `saaras:v3` (recommended) / `saaras:v4` (latest, 22 Indic + English)
 *
 * Passing `language_code=unknown` makes the API auto-detect the language and
 * return it alongside `language_probability`, so a single call covers both
 * transcription and language identification.
 */
export class SarvamSTTProvider implements SpeechToTextProvider {
  readonly name = "sarvam";
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly retryPolicy: RetryPolicy;

  constructor(options: {
    apiKey: string;
    model?: string;
    endpoint?: string;
    timeoutMs?: number;
    retryPolicy?: RetryPolicy;
  }) {
    if (!options.apiKey) throw new Error("SarvamSTTProvider: apiKey is required");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "saaras:v3";
    this.endpoint = options.endpoint ?? "https://api.sarvam.ai/speech-to-text";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  }

  async transcribe(request: STTRequest): Promise<STTResult> {
    let lastStatus = 0;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(backoffDelayMs(attempt - 1, this.retryPolicy));
      }

      const started = Date.now();
      try {
        const result = await this.callOnce(request);
        result.latencyMs = Date.now() - started;
        return result;
      } catch (err) {
        lastError = err;
        const status = err instanceof ProviderHttpError ? err.status : 0;
        lastStatus = status;
        const retryable =
          err instanceof ProviderHttpError && isTransientStatus(status, this.retryPolicy);
        if (!retryable) break;
      }
    }

    const latencyMs = 0; // provider never answered
    const errorType = lastStatus === 0 ? "network" : "provider";
    return {
      transcript: "",
      languageCode: null,
      languageProbability: null,
      providerRequestId: null,
      latencyMs,
      error: "Speech recognition is temporarily unavailable. Please try again.",
      errorType,
    };
  }

  private async callOnce(request: STTRequest): Promise<STTResult> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([request.audio as BlobPart], { type: request.mimeType || "application/octet-stream" }),
      "audio.webm",
    );
    form.append("model", this.model);
    form.append("mode", request.mode);
    form.append("language_code", request.languageCode ?? "unknown");

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          // Key transport is plain HTTPS; disable Sarvam's optional key encryption.
          "api-subscription-key-encrypted": "false",
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const aborted =
        err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
      if (aborted) {
        return {
          transcript: "",
          languageCode: null,
          languageProbability: null,
          providerRequestId: null,
          latencyMs: 0,
          error: "Speech recognition timed out. Please try again.",
          errorType: "timeout",
        };
      }
      throw err; // network failure — handled by the retry loop
    }

    if (!response.ok) {
      throw new ProviderHttpError(response.status, await safeResponseText(response));
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return {
        transcript: "",
        languageCode: null,
        languageProbability: null,
        providerRequestId: null,
        latencyMs: 0,
        error: "Speech recognition returned an unreadable response.",
        errorType: "provider",
      };
    }

    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    const languageCode = typeof body.language_code === "string" ? body.language_code : null;
    const probability =
      typeof body.language_probability === "number" ? body.language_probability : null;
    const requestId = typeof body.request_id === "string" ? body.request_id : null;

    if (!transcript) {
      return {
        transcript: "",
        languageCode,
        languageProbability: probability,
        providerRequestId: requestId,
        latencyMs: 0,
        error: "No speech detected in the audio. Please try again.",
        errorType: "no_speech",
      };
    }

    return {
      transcript,
      languageCode,
      languageProbability: probability,
      providerRequestId: requestId,
      latencyMs: 0,
      error: null,
      errorType: null,
    };
  }
}

export class ProviderHttpError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`Speech provider returned HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

/**
 * Deterministic mock provider.
 *
 * Used when MOCK_MODE=true or when no API key is configured, so the full
 * pipeline (recording → upload → action → store → UI) runs without paid APIs
 * and tests never depend on external services.
 *
 * Behavior: returns a realistic weather-query sample for the pinned language
 * (or a rotating selection when auto-detecting), with plausible confidence
 * values and simulated provider latency.
 */
export class MockSTTProvider implements SpeechToTextProvider {
  readonly name = "mock";
  readonly model = "mock-saaras-v3";

  /** Sample utterances used for mock auto-detection, rotating per call. */
  private readonly samples: { languageCode: string; transcript: string }[] = [
    { languageCode: "hi-IN", transcript: "कल मुंबई से पुणे जाना है। मौसम कैसा रहेगा?" },
    { languageCode: "mr-IN", transcript: "उद्या मुंबईमध्ये पाऊस पडेल का?" },
    { languageCode: "ta-IN", transcript: "நாளை மும்பையில் மழை பெய்யுமா?" },
    { languageCode: "te-IN", transcript: "రేపు ముంబైలో వర్షం పడుతుందా?" },
    { languageCode: "bn-IN", transcript: "আগামীকাল মুম্বাইয়ে বৃষ্টি হবে?" },
    { languageCode: "en-IN", transcript: "What's the weather in Mumbai tomorrow?" },
    { languageCode: "kn-IN", transcript: "ನಾಳೆ ಮುಂಬೈನಲ್ಲಿ ಮಳೆ ಬರುತ್ತದೆಯೇ?" },
    { languageCode: "gu-IN", transcript: "આવતીકાલે મુંબઈમાં વરસાદ પડશે?" },
    { languageCode: "pa-IN", transcript: "ਕੱਲ੍ਹ ਮੁੰਬਈ ਵਿੱਚ ਮੀਂਹ ਪਵੇਗਾ?" },
    { languageCode: "ml-IN", transcript: "നാളെ മുംബൈയിൽ മഴ പെയ്യുമോ?" },
  ];

  private readonly latinSamples: Record<string, string> = {
    "hi-IN": "kal mumbai se pune jaana hai. mausam kaisa rahega?",
    "mr-IN": "udya mumbaimadhye paaus padel ka?",
    "ta-IN": "naalai mumbayil mazhai peyyumaa?",
    "te-IN": "reppu mumbai lo varsham paduthundaa?",
    "bn-IN": "agami kal mumbaayei brishti hobe?",
    "en-IN": "What's the weather in Mumbai tomorrow?",
    "kn-IN": "naale mumbainalli male barutteyaa?",
    "gu-IN": "aavatikaale mumbaaimaa varsaadh padeshe?",
    "pa-IN": "kalh mumbaai vich meenh pavega?",
    "ml-IN": "naale mumbayil mazha peyyumo?",
  };

  private readonly codemixSamples: Record<string, string> = {
    "hi-IN": "कल mumbai से pune जाना है। मौसम कैसा रहेगा?",
    "mr-IN": "उद्या मुंबईमध्ये rain पडेल का?",
    "ta-IN": "நாளை மும்பையில் மழை பெய்யுமா?",
    "te-IN": "రేపు ముంబైలో వర్షం పడుతుందా?",
    "bn-IN": "আগামীকাল মুম্বাইয়ে বৃষ্টি হবে?",
    "en-IN": "What's the weather in Mumbai tomorrow?",
    "kn-IN": "ನಾಳೆ ಮುಂಬೈನಲ್ಲಿ ಮಳೆ ಬರುತ್ತದೆಯೇ?",
    "gu-IN": "આવતીકાલે મુંબઈમાં વરસાદ પડશે?",
    "pa-IN": "ਕੱਲ੍ਹ ਮੁੰਬਈ ਵਿੱਚ ਮੀਂਹ ਪਵੇਗਾ?",
    "ml-IN": "നാളെ മുംബൈയിൽ മഴ പെയ്യുമോ?",
  };

  private readonly englishSamples: Record<string, string> = {
    "hi-IN": "I need to travel from Mumbai to Pune tomorrow. What will the weather be like?",
    "mr-IN": "Will it rain in Mumbai tomorrow?",
    "ta-IN": "Will it rain in Mumbai tomorrow?",
    "te-IN": "Will it rain in Mumbai tomorrow?",
    "bn-IN": "Will it rain in Mumbai tomorrow?",
    "en-IN": "What's the weather in Mumbai tomorrow?",
    "kn-IN": "Will it rain in Mumbai tomorrow?",
    "gu-IN": "Will it rain in Mumbai tomorrow?",
    "pa-IN": "Will it rain in Mumbai tomorrow?",
    "ml-IN": "Will it rain in Mumbai tomorrow?",
  };

  async transcribe(request: STTRequest): Promise<STTResult> {
    // Simulate provider latency so latency instrumentation is exercised.
    await sleep(280 + Math.random() * 420);

    const pick = this.pickSample(request.languageCode, request.audio.byteLength);
    const transcript = this.render(pick.transcript, request.mode, pick.languageCode);
    const languageCode = request.languageCode ?? pick.languageCode;

    return {
      transcript,
      languageCode,
      languageProbability: request.languageCode
        ? null
        : 0.88 + Math.min(0.1, (request.audio.byteLength % 97) / 1000),
      providerRequestId: `mock_${request.audio.byteLength}_${Date.now().toString(36)}`,
      latencyMs: 0,
      error: null,
      errorType: null,
    };
  }

  private pickSample(
    languageCode: string | null,
    byteLength: number,
  ): { languageCode: string; transcript: string } {
    if (languageCode) {
      const known = this.samples.find((s) => s.languageCode === languageCode);
      if (known) return known;
      // Fall back to a deterministic Hindi sample for unsupported pins.
      return { languageCode: "hi-IN", transcript: this.samples[0].transcript };
    }
    // Rotate through samples based on audio size so repeated runs vary.
    const index = byteLength % this.samples.length;
    return this.samples[index];
  }

  private render(
    transcript: string,
    mode: TranscriptionMode["code"],
    languageCode: string,
  ): string {
    if (mode === "translit") return this.latinSamples[languageCode] ?? transcript;
    if (mode === "codemix") return this.codemixSamples[languageCode] ?? transcript;
    if (mode === "translate") return this.englishSamples[languageCode] ?? transcript;
    if (mode === "verbatim") return `${transcript} … हाँ, हाँ।`;
    return transcript;
  }
}

export interface STTProviderConfig {
  /** Set to true to force the mock provider regardless of credentials. */
  mockMode: boolean;
  /** Sarvam API key. Empty means mock fallback. */
  apiKey: string;
  /** Override for the Sarvam model id. */
  model?: string;
}

/**
 * Provider factory. The rule is simple:
 *   MOCK_MODE=true  → mock
 *   no API key      → mock (app must still run)
 *   otherwise       → Sarvam
 */
export function createSTTProvider(config: STTProviderConfig): SpeechToTextProvider {
  const useMock = config.mockMode || !config.apiKey;
  if (useMock) return new MockSTTProvider();
  return new SarvamSTTProvider({ apiKey: config.apiKey, model: config.model });
}

/** Number of languages in the registry (used for labels like "23 languages"). */
export function supportedLanguageCount(): number {
  return LANGUAGES.length;
}

/** Validate a language code against the registry; used by request validation. */
export function isSupportedLanguage(code: string | null | undefined): code is string {
  if (!code) return false;
  return getLanguageInfo(code) !== null;
}
