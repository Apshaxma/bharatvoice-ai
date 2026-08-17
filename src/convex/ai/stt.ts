/**
 * Speech-to-text provider abstraction for BharatVoice AI.
 *
 * Live transcription runs entirely in the browser via the Web Speech API
 * (SpeechRecognition — see src/lib/voice.ts), so no speech vendor or API key
 * is involved. This module is the backend fallback layer: a deterministic mock
 * provider that keeps the recording → upload → transcribe → store pipeline
 * fully functional offline and in tests, behind a `SpeechToTextProvider`
 * interface so a real provider can be plugged in later without touching the
 * rest of the system.
 *
 * Pure module — no Convex imports — so it can be unit-tested.
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deterministic mock provider — the only backend STT provider today.
 *
 * Used when recording audio needs to be transcribed server-side (browsers
 * without SpeechRecognition, or the transcription demo), so the full pipeline
 * (recording → upload → action → store → UI) runs without any speech API.
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
  /** Kept for interface stability — backend STT is mock-only today. */
  mockMode?: boolean;
}

/**
 * Provider factory. Live transcription runs in the browser (Web Speech API);
 * the backend provider is the deterministic mock so the app needs no speech
 * vendor or key. A real HTTP provider can be added here later.
 */
export function createSTTProvider(_config?: STTProviderConfig): SpeechToTextProvider {
  return new MockSTTProvider();
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
