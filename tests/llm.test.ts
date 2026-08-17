/**
 * LLM layer tests.
 *
 * Beyond unit coverage of the JSON helpers, the mock planner/responder tests
 * double as an offline evaluation harness: a labelled set of utterances in
 * Hindi, Hinglish, Marathi, Tamil and English, asserting intent + tool-call
 * accuracy. The same corpus is trivially reusable against a live provider.
 */

import { describe, expect, test } from "bun:test";
import {
  MockLLMProvider,
  OpenAICompatibleLLMProvider,
  VlyLLMProvider,
  createLLMProvider,
  extractJson,
  parseLlmJson,
  type LLMMessage,
} from "../src/convex/ai/llm";

const provider = new MockLLMProvider();

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

describe("extractJson", () => {
  test("passes bare JSON through", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  test("strips markdown fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });

  test("extracts JSON embedded in prose", () => {
    expect(extractJson('Here you go: {"a": 1} thanks!')).toBe('{"a": 1}');
  });
});

describe("parseLlmJson", () => {
  test("returns null for unparseable output", () => {
    expect(parseLlmJson("not json at all")).toBeNull();
    expect(parseLlmJson("")).toBeNull();
    expect(parseLlmJson("[1,2,3]")).toBeNull(); // not an object
  });

  test("parses valid JSON objects", () => {
    expect(parseLlmJson<{ a: number }>('{"a": 2}')?.a).toBe(2);
    expect(
      parseLlmJson<{ intent: string }>('```json\n{"intent": "weather_query"}\n```')
        ?.intent,
    ).toBe("weather_query");
  });
});

// ---------------------------------------------------------------------------
// Mock planner — labelled eval set (intent + tool extraction)
// ---------------------------------------------------------------------------

function plannerMessages(userText: string): LLMMessage[] {
  return [
    {
      role: "system",
      content:
        "You are the PLANNER of BharatVoice. Respond with STRICT JSON only: {\"intent\": ..., \"toolCalls\": [...]}",
    },
    {
      role: "user",
      content: `User's message: "${userText}"\nDetected language: auto`,
    },
  ];
}

async function plan(userText: string) {
  const result = await provider.complete(plannerMessages(userText), {
    temperature: 0.1,
    maxTokens: 400,
  });
  expect(result.error).toBeNull();
  return JSON.parse(result.content) as {
    intent: string;
    toolCalls: { name: string; args: Record<string, unknown> }[];
  };
}

describe("mock planner — intent and tool extraction", () => {
  test("Hindi weather query → weather intent, Mumbai tool call", async () => {
    const p = await plan("कल मुंबई से पुणे जाना है। मौसम कैसा रहेगा?");
    expect(p.intent).toBe("weather_query");
    expect(p.toolCalls.map((t) => t.name)).toContain("getWeather");
    const weather = p.toolCalls.find((t) => t.name === "getWeather");
    expect(weather?.args.city).toBe("Mumbai");
  });

  test("Hinglish (Roman script) weather query still resolves", async () => {
    const p = await plan("kal mumbai se pune jaana hai, mausam kaisa rahega?");
    expect(p.intent).toBe("weather_query");
    expect(p.toolCalls[0]?.name).toBe("getWeather");
    expect(p.toolCalls[0]?.args.city).toBe("Mumbai");
  });

  test("Marathi tomorrow query → weather, tomorrow", async () => {
    const p = await plan("उद्या मुंबईमध्ये पाऊस पडेल का?");
    expect(p.intent).toBe("weather_query");
    expect(p.toolCalls[0]?.args.city).toBe("Mumbai");
    expect(p.toolCalls[0]?.args.date).toBe("tomorrow");
  });

  test("Tamil script query → weather", async () => {
    const p = await plan("நாளை மும்பையில் மழை பெய்யுமா?");
    expect(p.intent).toBe("weather_query");
  });

  test("English Chennai query → Chennai, tomorrow", async () => {
    const p = await plan("Will it rain in Chennai tomorrow?");
    expect(p.intent).toBe("weather_query");
    expect(p.toolCalls[0]?.args.city).toBe("Chennai");
    expect(p.toolCalls[0]?.args.date).toBe("tomorrow");
  });

  test("Marathi cab booking → book_cab intent, gated tool declared", async () => {
    const p = await plan("मला मुंबई ते पुणे प्रवासासाठी कॅब बुक करायची आहे");
    expect(p.intent).toBe("book_cab");
    expect(p.toolCalls.map((t) => t.name)).toContain("bookCab");
    expect(p.toolCalls[0]?.args.from).toBe("Mumbai");
    expect(p.toolCalls[0]?.args.to).toBe("Pune");
  });

  test("general chat triggers no tools", async () => {
    const p = await plan("नमस्ते! तुम्ही कसे आहात?");
    expect(p.toolCalls).toHaveLength(0);
    expect(p.intent).toBe("general_chat");
  });
});

// ---------------------------------------------------------------------------
// Mock responder — language-appropriate, tool-grounded answers
// ---------------------------------------------------------------------------

function responderMessages(
  userText: string,
  language: string,
  toolResult?: unknown,
): LLMMessage[] {
  const results = toolResult
    ? `\n\nTool results you can ground your answer in:\n__TOOL_RESULT__\n${JSON.stringify([toolResult])}\n__END__`
    : "";
  return [
    {
      role: "system",
      content: `You are the RESPONDER of BharatVoice. Answer the user in their own language. The user is speaking ${language}.${results}`,
    },
    { role: "user", content: userText },
  ];
}

describe("mock responder — grounded multilingual answers", () => {
  test("Hindi weather answer cites tool data in Devanagari", async () => {
    const res = await provider.complete(
      responderMessages("कल मुंबई से पुणे जाना है। मौसम कैसा रहेगा?", "hi-IN", {
        tool: "getWeather",
        status: "done",
        result: {
          city: "Mumbai",
          temperatureMax: 31,
          temperatureMin: 24,
          precipitationProbability: 15,
        },
      }),
    );
    expect(res.error).toBeNull();
    expect(res.content).toContain("31");
    expect(/[\u0900-\u097F]/.test(res.content)).toBe(true);
  });

  test("English request gets an English answer", async () => {
    const res = await provider.complete(
      responderMessages("What's the weather in Chennai tomorrow?", "en-IN", {
        tool: "getWeather",
        status: "done",
        result: {
          city: "Chennai",
          temperatureMax: 33,
          temperatureMin: 27,
          precipitationProbability: 55,
        },
      }),
    );
    expect(res.content).toContain("Chennai");
    expect(res.content).toContain("33");
  });

  test("denied cab approval is acknowledged in the user's language", async () => {
    const res = await provider.complete(
      responderMessages("मला कॅब बुक करायची आहे", "hi-IN", {
        tool: "bookCab",
        status: "skipped_user_denied",
      }),
    );
    expect(/[\u0900-\u097F]/.test(res.content)).toBe(true);
  });

  test("language detection prefers Marathi over generic Devanagari", async () => {
    const res = await provider.complete(
      responderMessages("उद्या मुंबईमध्ये हवामान कसे आहे?", "mr-IN"),
    );
    // The "उद्या" keyword routes to the Marathi greeting ("नमस्कार"), not
    // the Hindi one ("नमस्ते").
    expect(res.content).toContain("नमस्कार");
    expect(res.content).not.toContain("नमस्ते");
  });
});

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

describe("LLM provider factory — vendor-independent", () => {
  test("mock mode forces the mock", () => {
    expect(
      createLLMProvider({ mockMode: true, apiKey: "sk-test" }).name,
    ).toBe("mock-llm");
  });

  test("no keys at all falls back to mock", () => {
    expect(createLLMProvider({ mockMode: false, apiKey: "" }).name).toBe(
      "mock-llm",
    );
    expect(
      createLLMProvider({ mockMode: false, apiKey: "", openAiApiKey: "" })
        .name,
    ).toBe("mock-llm");
  });

  test("VLY gateway key selects the gateway provider", () => {
    const p = createLLMProvider({
      mockMode: false,
      apiKey: "sk-test",
      model: "gpt-5-mini",
    });
    expect(p).toBeInstanceOf(VlyLLMProvider);
    expect(p.name).toBe("vly-gateway");
    expect(p.model).toBe("gpt-5-mini");
  });

  test("an OpenAI-compatible key selects the generic provider", () => {
    const p = createLLMProvider({
      mockMode: false,
      apiKey: "",
      openAiApiKey: "sk-test",
      openAiModel: "llama-3.1-8b",
      openAiBaseUrl: "http://localhost:11434/v1",
    });
    expect(p).toBeInstanceOf(OpenAICompatibleLLMProvider);
    expect(p.name).toBe("openai-compatible");
    expect(p.model).toBe("llama-3.1-8b");
  });

  test("an OpenAI-compatible key wins over the gateway key", () => {
    const p = createLLMProvider({
      mockMode: false,
      apiKey: "vly-key",
      openAiApiKey: "sk-openai",
    });
    expect(p).toBeInstanceOf(OpenAICompatibleLLMProvider);
  });
});
