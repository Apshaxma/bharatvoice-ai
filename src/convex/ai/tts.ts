/**
 * Text-to-speech provider abstraction for BharatVoice AI.
 *
 * The agent pipeline talks to a `TTSProvider` interface — never to a vendor
 * SDK directly. Sarvam Bulbul v3 is the production provider; when no API key
 * is configured the app falls back to the browser's built-in speech synthesis
 * on the client (see src/lib/voice.ts), so the product works without keys.
 *
 * Pure module — no Convex imports — so it can be unit-tested.
 */

export interface TTSResult {
  provider: string;
  model: string;
  /** Decoded audio bytes (WAV/MP3). Null when synthesis failed. */
  audio: Uint8Array | null;
  mimeType: string;
  latencyMs: number;
  error: string | null;
}

export interface TTSProvider {
  readonly name: string;
  readonly model: string;
  synthesize(text: string, languageCode: string): Promise<TTSResult>;
}

/**
 * Sarvam AI Bulbul v3.
 *
 * POST https://api.sarvam.ai/text-to-speech
 * Auth: `api-subscription-key` header
 * Body: { text, language_code, speaker, model, pace, output_audio_codec }
 * Response: { request_id, audios: [base64-encoded audio strings] }
 *
 * Reference: https://docs.sarvam.ai/api-reference/text-to-speech/convert
 */
export class SarvamTTSProvider implements TTSProvider {
  readonly name = "sarvam";
  readonly model: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly speaker: string;
  private readonly timeoutMs: number;

  constructor(options: {
    apiKey: string;
    model?: string;
    speaker?: string;
    endpoint?: string;
    timeoutMs?: number;
  }) {
    if (!options.apiKey) throw new Error("SarvamTTSProvider: apiKey is required");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "bulbul:v3";
    this.speaker = options.speaker ?? "shubh";
    this.endpoint = options.endpoint ?? "https://api.sarvam.ai/text-to-speech";
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async synthesize(text: string, languageCode: string): Promise<TTSResult> {
    const started = Date.now();
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          language_code: languageCode,
          speaker: this.speaker,
          model: this.model,
          pace: 1,
          speech_sample_rate: 24000,
          output_audio_codec: "mp3",
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return {
          provider: this.name,
          model: this.model,
          audio: null,
          mimeType: "audio/mpeg",
          latencyMs: Date.now() - started,
          error: `TTS provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        };
      }

      const body = (await response.json()) as { audios?: string[] };
      const chunks = body.audios ?? [];
      if (chunks.length === 0 || !chunks[0]) {
        return {
          provider: this.name,
          model: this.model,
          audio: null,
          mimeType: "audio/mpeg",
          latencyMs: Date.now() - started,
          error: "TTS provider returned no audio",
        };
      }

      // Concatenate base64 chunks (Sarvam splits long text into several).
      const binary = Buffer.concat(
        chunks.map((c) => Buffer.from(c, "base64")),
      );
      return {
        provider: this.name,
        model: this.model,
        audio: new Uint8Array(binary),
        mimeType: "audio/mpeg",
        latencyMs: Date.now() - started,
        error: null,
      };
    } catch (err) {
      const aborted =
        err instanceof DOMException &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      return {
        provider: this.name,
        model: this.model,
        audio: null,
        mimeType: "audio/mpeg",
        latencyMs: Date.now() - started,
        error: aborted
          ? "Speech synthesis timed out"
          : "Speech synthesis failed",
      };
    }
  }
}

export interface TTSProviderConfig {
  mockMode: boolean;
  apiKey: string;
  model?: string;
  speaker?: string;
}

/**
 * Provider factory. The app never hard-fails on TTS: when no key is present,
 * the client uses browser speech synthesis and `provider` is reported as
 * "browser".
 */
export function createTTSProvider(
  config: TTSProviderConfig,
): TTSProvider | null {
  const useMock = config.mockMode || !config.apiKey;
  if (useMock) return null;
  try {
    return new SarvamTTSProvider({
      apiKey: config.apiKey,
      model: config.model,
      speaker: config.speaker,
    });
  } catch {
    return null;
  }
}
