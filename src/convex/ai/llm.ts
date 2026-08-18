/**
 * LLM provider abstraction for BharatVoice AI.
 *
 * The agent talks to an `LLMProvider` interface — never to a vendor SDK
 * directly. That keeps the pipeline testable (deterministic mock), replaceable
 * (swap the gateway for a direct vendor SDK) and honest about failures.
 *
 * This module is free of Convex imports so it can be unit-tested outside the
 * Convex runtime.
 */

import { vly } from "../../lib/vly-integrations";
import {
  heuristicScore,
  type ScoreToolCall,
} from "./scoring";

// ---------------------------------------------------------------------------
// Structured error types for the LLM layer
// ---------------------------------------------------------------------------

export type LLMErrorType =
  | "authentication"
  | "rate_limit"
  | "provider_denied"
  | "model_not_found"
  | "invalid_request"
  | "timeout"
  | "network"
  | "provider_unavailable"
  | "unknown";

export interface LLMStructuredError {
  type: LLMErrorType;
  message: string;
  httpStatus: number | null;
  providerCode: string | null;
  model: string;
}

/** Map an HTTP status + body to a structured error. */
export function mapHttpToStructuredError(
  status: number,
  body: string,
  model: string,
): LLMStructuredError {
  let providerCode: string | null = null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const errObj = parsed.error as Record<string, unknown> | undefined;
    if (errObj) {
      if (typeof errObj.code === "string") providerCode = errObj.code;
    }
  } catch {
    // body isn't JSON — use raw text
  }

  switch (status) {
    case 401:
      return {
        type: "authentication",
        message: "AI authentication failed. Check the OpenRouter API key.",
        httpStatus: 401,
        providerCode,
        model,
      };
    case 403:
      return {
        type: "provider_denied",
        message:
          "AI provider access was denied. Check the selected model/provider.",
        httpStatus: 403,
        providerCode,
        model,
      };
    case 429:
      return {
        type: "rate_limit",
        message: "AI is temporarily rate-limited. Please try again.",
        httpStatus: 429,
        providerCode,
        model,
      };
    case 404:
      return {
        type: "model_not_found",
        message: `AI model "${model}" was not found. Check OPENROUTER_MODEL.`,
        httpStatus: 404,
        providerCode,
        model,
      };
    case 400:
      return {
        type: "invalid_request",
        message: "AI request was invalid. Check the model configuration.",
        httpStatus: 400,
        providerCode,
        model,
      };
    case 502:
    case 503:
    case 504:
      return {
        type: "provider_unavailable",
        message: "AI provider is temporarily unavailable. Please try again.",
        httpStatus: status,
        providerCode,
        model,
      };
    default:
      return {
        type: "unknown",
        message: `AI provider returned HTTP ${status}.`,
        httpStatus: status,
        providerCode,
        model,
      };
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Provider interfaces
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResult {
  content: string;
  latencyMs: number;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Non-null when the provider call itself failed. */
  error: string | null;
  /** Structured error when the failure has a known category. */
  structuredError?: LLMStructuredError;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(
    messages: LLMMessage[],
    options?: LLMOptions,
  ): Promise<LLMResult>;
}

/** Strip markdown fences / stray prose so `JSON.parse` survives LLM output. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return candidate.trim();
  return candidate.slice(start, end + 1);
}

/**
 * Parse LLM JSON output safely; returns null when unparseable or when the
 * result is not a JSON object (arrays/primitives can't be a tool plan).
 */
export function parseLlmJson<T>(text: string): T | null {
  try {
    const parsed = JSON.parse(extractJson(text)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// VLY gateway provider (auto-injected key)
// ---------------------------------------------------------------------------

export class VlyLLMProvider implements LLMProvider {
  readonly name = "vly-gateway";
  readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMOptions = {},
  ): Promise<LLMResult> {
    const started = Date.now();
    const result = await vly.ai.completion({
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.4,
      maxTokens: options.maxTokens ?? 700,
    });
    const latencyMs = Date.now() - started;

    if (!result.success || !result.data) {
      return {
        content: "",
        latencyMs,
        provider: this.name,
        model: this.model,
        error: result.error || "LLM request failed",
      };
    }

    const choice = result.data.choices?.[0];
    const content = choice?.message?.content ?? "";
    return {
      content,
      latencyMs,
      provider: this.name,
      model: this.model,
      promptTokens: result.data.usage?.promptTokens,
      completionTokens: result.data.usage?.completionTokens,
      error: content ? null : "LLM returned an empty response",
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (OpenRouter, Groq, Together, Ollama, etc.)
// ---------------------------------------------------------------------------

export class OpenAICompatibleLLMProvider implements LLMProvider {
  readonly name = "openai-compatible";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    if (!options.apiKey)
      throw new Error("OpenAICompatibleLLMProvider: apiKey is required");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "openrouter/auto";
    this.baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(
      /\/$/,
      "",
    );
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMOptions = {},
  ): Promise<LLMResult> {
    const started = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay =
          BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) +
          Math.random() * 500;
        await sleep(delay);
      }

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: options.temperature ?? 0.4,
            max_tokens: options.maxTokens ?? 700,
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          const structured = mapHttpToStructuredError(
            response.status,
            detail,
            this.model,
          );

          // Retry only on transient errors (429, 5xx)
          if (isRetryable(response.status) && attempt < MAX_RETRIES) {
            console.log(
              JSON.stringify({
                service: "bharatvoice-llm",
                event: "retry",
                status: response.status,
                attempt: attempt + 1,
                model: this.model,
                baseUrl: this.baseUrl.replace(/\/v1$/, ""),
              }),
            );
            continue;
          }

          return {
            content: "",
            latencyMs: Date.now() - started,
            provider: this.name,
            model: this.model,
            error: structured.message,
            structuredError: structured,
          };
        }

        const body = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = body.choices?.[0]?.message?.content ?? "";
        return {
          content,
          latencyMs: Date.now() - started,
          provider: this.name,
          model: this.model,
          promptTokens: body.usage?.prompt_tokens,
          completionTokens: body.usage?.completion_tokens,
          error: content ? null : "LLM returned an empty response",
        };
      } catch (err) {
        const aborted =
          err instanceof DOMException &&
          (err.name === "TimeoutError" || err.name === "AbortError");
        // Timeout is retryable
        if (aborted && attempt < MAX_RETRIES) continue;
        return {
          content: "",
          latencyMs: Date.now() - started,
          provider: this.name,
          model: this.model,
          error: aborted
            ? "AI request timed out. Please try again."
            : "AI request failed. Check your network connection.",
          structuredError: {
            type: aborted ? "timeout" : "network",
            message: aborted
              ? "AI request timed out. Please try again."
              : "AI request failed. Check your network connection.",
            httpStatus: null,
            providerCode: null,
            model: this.model,
          },
        };
      }
    }

    // Should never reach here, but TypeScript needs it
    return {
      content: "",
      latencyMs: Date.now() - started,
      provider: this.name,
      model: this.model,
      error: "Unexpected error in LLM retry loop",
    };
  }
}

// ---------------------------------------------------------------------------
// Mock brain — deterministic offline demo/test provider
// ---------------------------------------------------------------------------

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock-llm";
  readonly model = "mock-bharat-1b";

  private readonly cities: { name: string; aliases: string[] }[] = [
    { name: "Mumbai", aliases: ["mumbai", "मुंबई", "बॉम्बे", "bombay", "मुम्बई"] },
    { name: "Pune", aliases: ["pune", "पुणे", "पुना"] },
    { name: "Delhi", aliases: ["delhi", "दिल्ली", "dilli"] },
    { name: "Bengaluru", aliases: ["bengaluru", "bangalore", "बेंगलुरु", "बेंगलूरु", "ಬೆಂಗಳೂರು"] },
    { name: "Chennai", aliases: ["chennai", "चेन्नई", "madras", "मद्रास"] },
    { name: "Kolkata", aliases: ["kolkata", "कोलकाता", "calcutta", "कलकत्ता"] },
    { name: "Hyderabad", aliases: ["hyderabad", "हैदराबाद"] },
    { name: "Jaipur", aliases: ["jaipur", "जयपुर"] },
    { name: "Ahmedabad", aliases: ["ahmedabad", "अहमदाबाद"] },
    { name: "Goa", aliases: ["goa", "गोवा"] },
  ];

  private readonly weatherWords = [
    "weather", "mausam", "मौसम", "मौसम", "barish", "बारिश", "बरसात", "rain", "paani",
    "पानी", "paus", "पाऊस", "varsham", "వర్షం", "mazhai", "மழை", "brishti", "বৃষ্টি",
    "male", "ಮಳೆ", "varsaaadh", "વરસાદ", "meenh", "ਮੀਂਹ", "mazha", "മഴ", "temperature",
    "गर्मी", "thandi", "ठंड", "forecast", "पूर्वानुमान", "गरम", "heat", "sardi",
  ];

  private readonly cabWords = [
    "cab", "taxi", "कैब", "कॅब", "टैक्सी", "book a ride", "ride", "ओला", "uber",
    "ola", "drop me", "pick me", "car book", "कार बुक", "कॅब बुक", "वाहन",
  ];

  private readonly dateWords = [
    { key: "today", words: ["today", "aaj", "आज", "आज", "aadu", "ఈరోజు", "இன்று", "आजच"] },
    { key: "tomorrow", words: ["tomorrow", "kal", "कल", "उद्या", "नाळे", "రేపు", "நாளை", "আগামীকাল", "ಇನ್ನು", "नाश्ता"] },
  ];

  private readonly intents: Record<string, string> = {
    weather: "weather_query",
    cab: "book_cab",
  };

  complete(
    messages: LLMMessage[],
    _options: LLMOptions = {},
  ): Promise<LLMResult> {
    // Simulate provider latency so latency instrumentation is exercised.
    const latencyMs = 180 + Math.random() * 220;
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

    const wantsPlan = system.includes("PLANNER");
    const wantsAnswer = system.includes("RESPONDER");
    const wantsJudge = system.includes("JUDGE");

    let content: string;
    if (wantsPlan) {
      content = JSON.stringify(this.plan(lastUser));
    } else if (wantsAnswer) {
      content = this.answer(lastUser, system);
    } else if (wantsJudge) {
      content = JSON.stringify(this.judge(lastUser));
    } else {
      content = "मैं यहाँ हूँ। बताइए, मैं कैसे मदद कर सकता हूँ?";
    }

    return Promise.resolve({
      content,
      latencyMs,
      provider: this.name,
      model: this.model,
      promptTokens: messages.reduce((n, m) => n + m.content.length, 0),
      completionTokens: content.length,
      error: null,
    });
  }

  /** Mock planner: deterministic intent + tool-call extraction. */
  private plan(text: string): {
    intent: string;
    toolCalls: { name: string; args: Record<string, unknown> }[];
  } {
    const lower = text.toLowerCase();
    const city = this.cities.find((c) =>
      c.aliases.some((a) => lower.includes(a.toLowerCase())),
    );
    const date = this.resolveDate(lower);

    const wantsWeather = this.weatherWords.some((w) => lower.includes(w));
    const wantsCab = this.cabWords.some((w) => lower.includes(w));

    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
    if (wantsWeather) {
      toolCalls.push({
        name: "getWeather",
        args: {
          city: city?.name ?? "Mumbai",
          date: date ?? "today",
        },
      });
    }
    if (wantsCab) {
      toolCalls.push({
        name: "bookCab",
        args: {
          from: city?.name ?? "Mumbai",
          to: "Pune",
          when: date ?? "today",
        },
      });
    }

    const intent = wantsWeather
      ? this.intents.weather
      : wantsCab
        ? this.intents.cab
        : "general_chat";

    return { intent, toolCalls };
  }

  private resolveDate(lower: string): string | null {
    for (const entry of this.dateWords) {
      if (entry.words.some((w) => lower.includes(w))) return entry.key;
    }
    return null;
  }

  /** Mock responder: template answer in the detected language using tool data. */
  private answer(userText: string, systemText: string): string {
    const lower = userText.toLowerCase();
    const language = this.detectLanguage(userText);

    const context = `${userText}\n${systemText}`;
    const resultMatch = context.match(
      /__TOOL_RESULT__\s*([\s\S]*?)(?:__END__|$)/,
    );
    let entries: {
      tool?: string;
      status?: string;
      result?: Record<string, unknown> | null;
    }[] = [];
    if (resultMatch) {
      try {
        const parsed = JSON.parse(resultMatch[1].trim());
        if (Array.isArray(parsed)) entries = parsed;
      } catch {
        // malformed tool result — fall through to generic answers
      }
    }

    const weatherEntry = entries.find(
      (e) => e.tool === "getWeather" && e.status === "done",
    );
    const cabEntry = entries.find((e) => e.tool === "bookCab");

    const city = this.cities.find((c) =>
      c.aliases.some((a) => lower.includes(a.toLowerCase())),
    )?.name ?? "Mumbai";
    const date = this.resolveDate(lower) === "tomorrow" ? "tomorrow" : "today";

    if (weatherEntry?.result && weatherEntry.result.temperatureMax !== undefined) {
      return this.weatherAnswer(language, city, date, weatherEntry.result);
    }
    if (cabEntry) {
      if (cabEntry.status === "skipped_user_denied") {
        return this.cabDeniedAnswer(language);
      }
      return this.cabAnswer(language, city);
    }
    if (this.cabWords.some((w) => lower.includes(w))) {
      return this.cabAnswer(language, city);
    }
    return this.greetingAnswer(language, city);
  }

  private cabDeniedAnswer(lang: string): string {
    const byLang: Record<string, string> = {
      "hi-IN": "ठीक है, मैंने कैब बुकिंग रद्द कर दी है। किसी और चीज़ में मदद चाहिए तो बताइए।",
      "mr-IN": "ठीक आहे, मी कॅब बुकिंग रद्द केली आहे. आणखी काही हवे असल्यास सांगा.",
      "en-IN": "Okay, I've cancelled the cab booking. Let me know if you need anything else.",
    };
    return byLang[lang] ?? byLang["en-IN"];
  }

  private weatherAnswer(
    lang: string,
    city: string,
    date: string,
    r: Record<string, unknown>,
  ): string {
    const tMax = r.temperatureMax ?? r.tempMax ?? 28;
    const tMin = r.temperatureMin ?? r.tempMin ?? 21;
    const precip = r.precipitationProbability ?? r.precip ?? 40;
    const desc = (r.description as string) ?? "partly cloudy";

    const byLang: Record<string, string> = {
      "hi-IN": `कल ${city} में मौसम साफ़ रहेगा। अधिकतम तापमान ${tMax}°C और न्यूनतम ${tMin}°C रहेगा। बारिश की संभावना ${precip}% है। ${desc === "rain" ? "छाता साथ रखें!" : "मौसम यात्रा के लिए ठीक रहेगा।"}`,
      "mr-IN": `उद्या ${city} मध्ये हवामान चांगले राहील. कमाल तापमान ${tMax}°C आणि किमान ${tMin}°C असेल. पावसाची शक्यता ${precip}% आहे.`,
      "ta-IN": `நாளை ${city} இல் வானிலை நன்றாக இருக்கும். அதிகபட்சம் ${tMax}°C, குறைந்தபட்சம் ${tMin}°C. மழை வாய்ப்பு ${precip}%.`,
      "te-IN": `రేపు ${city} లో వాతావరణం బాగుంటుంది. గరిష్టం ${tMax}°C, కనిష్టం ${tMin}°C. వర్షం అవకాశం ${precip}%.`,
      "bn-IN": `আগামীকাল ${city} তে আবহাওয়া ভালো থাকবে। সর্বোচ্চ ${tMax}°C, সর্বনিম্ন ${tMin}°C। বৃষ্টির সম্ভাবনা ${precip}%।`,
      "kn-IN": `ನಾಳೆ ${city} ನಲ್ಲಿ ಹವಾಮಾನ ಚೆನ್ನಾಗಿರುತ್ತದೆ. ಗರಿಷ್ಠ ${tMax}°C, ಕನಿಷ್ಠ ${tMin}°C. ಮಳೆಯ ಸಂಭವ ${precip}%.`,
      "gu-IN": `આવતીકાલે ${city} માં હવામાન સારું રહેશે. મહત્તમ ${tMax}°C, લઘુત્તમ ${tMin}°C. વરસાદની શક્યતા ${precip}%.`,
      "pa-IN": `ਕੱਲ੍ਹ ${city} ਵਿੱਚ ਮੌਸਮ ਵਧੀਆ ਰਹੇਗਾ। ਵੱਧ ਤੋਂ ਵੱਧ ${tMax}°C, ਘੱਟੋ ਘੱਟ ${tMin}°C। ਮੀਂਹ ਦੀ ਸੰਭਾਵਨਾ ${precip}%.`,
      "ml-IN": `നാളെ ${city} യിൽ കാലാവസ്ഥ നല്ലതായിരിക്കും. പരമാവധി ${tMax}°C, കുറഞ്ഞത് ${tMin}°C. മഴ സാധ്യത ${precip}%.`,
    };
    const template =
      byLang[lang] ??
      `Tomorrow in ${city} the weather will be clear. High of ${tMax}°C and low of ${tMin}°C, with a ${precip}% chance of rain. Good weather for the trip.`;
    return `${template} ${date === "today" ? "" : ""}`.trim();
  }

  private cabAnswer(lang: string, city: string): string {
    const byLang: Record<string, string> = {
      "hi-IN": `मैंने ${city} से पुणे के लिए कैब बुक कर दी है। ड्राइवर 4 मिनट में पहुँचेंगे, किराया लगभग ₹1,240 होगा। यात्रा शुभ हो!`,
      "mr-IN": `${city} ते पुणेसाठी कॅब बुक केली आहे. ड्रायव्हर ४ मिनिटांत पोहोचेल, भाडे सुमारे ₹१,२४० असेल.`,
      "en-IN": `I've booked your cab from ${city} to Pune. The driver will arrive in about 4 minutes and the fare is approximately ₹1,240. Safe travels!`,
    };
    return byLang[lang] ?? byLang["en-IN"];
  }

  private greetingAnswer(lang: string, city: string): string {
    const byLang: Record<string, string> = {
      "hi-IN": `नमस्ते! मैं आपका भारतवॉइस सहायक हूँ। आप मुझसे मौसम, कैब बुकिंग या किसी भी सवाल के लिए बात कर सकते हैं। ${city} के बारे में पूछिए!`,
      "mr-IN": `नमस्कार! मी तुमचा भारतवॉइस सहायक आहे. मला हवामान, कॅब बुकिंग किंवा इतर काहीही विचारा.`,
      "en-IN": `Hello! I'm your BharatVoice assistant. Ask me about the weather in ${city}, book a cab, or anything else — in Hindi, Marathi, Tamil and 20 more Indian languages.`,
    };
    return byLang[lang] ?? byLang["en-IN"];
  }

  /** Mock judge: deterministic 0–1 score of one completed turn. */
  private judge(userContent: string): Record<string, unknown> {
    const turn = this.parseJudgeTurn(userContent);
    const h = heuristicScore({
      responseText: turn.responseText,
      toolCalls: turn.toolCalls,
      languageCode: turn.detectedLanguage,
      totalLatencyMs: turn.totalLatencyMs,
    });
    return { score: h.score, criteria: h.criteria, notes: h.notes };
  }

  private parseJudgeTurn(userContent: string): {
    responseText: string;
    detectedLanguage: string | null;
    toolCalls: ScoreToolCall[];
    totalLatencyMs: number;
  } {
    let raw: unknown = null;
    try {
      const start = userContent.indexOf("{");
      raw = JSON.parse(start === -1 ? userContent : userContent.slice(start));
    } catch {
      return { responseText: "", detectedLanguage: null, toolCalls: [], totalLatencyMs: 0 };
    }
    const obj = (raw ?? {}) as Record<string, unknown>;
    const toolCalls = Array.isArray(obj.toolCalls)
      ? (obj.toolCalls as Record<string, unknown>[]).map((t) => ({
          status: typeof t.status === "string" ? t.status : "unknown",
          result:
            t.result && typeof t.result === "object"
              ? (t.result as Record<string, unknown>)
              : null,
        }))
      : [];
    return {
      responseText: typeof obj.responseText === "string" ? obj.responseText : "",
      detectedLanguage:
        typeof obj.detectedLanguage === "string" ? obj.detectedLanguage : null,
      toolCalls,
      totalLatencyMs: typeof obj.totalLatencyMs === "number" ? obj.totalLatencyMs : 0,
    };
  }

  private detectLanguage(text: string): string {
    if (/[తెలుగు\u0C00-\u0C7F]/.test(text)) return "te-IN";
    if (/[\u0B80-\u0BFF]/.test(text)) return "ta-IN";
    if (/[\u0980-\u09FF]/.test(text)) return "bn-IN";
    if (/[\u0C80-\u0CFF]/.test(text)) return "kn-IN";
    if (/[\u0D00-\u0D7F]/.test(text)) return "ml-IN";
    if (/[\u0A80-\u0AFF]/.test(text)) return "gu-IN";
    if (/[\u0A00-\u0A7F]/.test(text)) return "pa-IN";
    if (/कॅब|उद्या|पाऊस|हवामान/.test(text)) return "mr-IN";
    if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
    return "en-IN";
  }
}

// ---------------------------------------------------------------------------
// Provider factory — vendor-independent by design:
//   MOCK_MODE=true or no keys at all  → mock (fully offline demo/tests)
//   LLM_API_KEY set                   → any OpenAI-compatible endpoint
//   VLY_INTEGRATION_KEY set           → the VLY AI gateway
// An explicit OpenAI-compatible key wins over the gateway key.
// ---------------------------------------------------------------------------

export interface LLMProviderConfig {
  mockMode: boolean;
  apiKey: string;
  model?: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  openAiModel?: string;
}

export function createLLMProvider(config: LLMProviderConfig): LLMProvider {
  const useMock = config.mockMode || (!config.apiKey && !config.openAiApiKey);
  if (useMock) return new MockLLMProvider();
  if (config.openAiApiKey) {
    return new OpenAICompatibleLLMProvider({
      apiKey: config.openAiApiKey,
      model: config.openAiModel ?? config.model,
      baseUrl: config.openAiBaseUrl,
    });
  }
  return new VlyLLMProvider(config.model ?? "gpt-5-mini");
}
