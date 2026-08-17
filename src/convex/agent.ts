"use node";

/**
 * BharatVoice AI — the agent pipeline.
 *
 * One turn of the agent, end to end:
 *   1. resolve/create the conversation (memory)
 *   2. plan: LLM decides intent + which tools are needed (strict JSON)
 *   3. gate: sensitive tools (bookCab) become approval requests instead of
 *      executing — human-in-the-loop before any side effect
 *   4. act: safe tools execute (weather via Open-Meteo)
 *   5. answer: LLM responds in the user's language, grounded in tool results
 *   6. speak: the browser synthesizes the answer via speechSynthesis — no TTS
 *      vendor or API key is involved
 *   7. observe: every step is timed, logged and persisted to `agentRuns` for
 *      the Insights dashboard, including a self-evaluation score.
 *
 * Speech is vendor-independent end to end: live transcription runs in the
 * browser (Web Speech API) and only text + metadata are ever persisted — no
 * user audio leaves the device, and the upload fallback deletes audio after
 * transcribing.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  createLLMProvider,
  parseLlmJson,
  type LLMMessage,
  type LLMProvider,
} from "./ai/llm";
import { heuristicScore } from "./ai/scoring";
import { getTool, summarizeToolCall } from "./tools";

const MAX_TOOL_CALLS = 3;
const MAX_TOOL_RESULT_CHARS = 2000;

function env(name: string): string {
  return process.env[name] ?? "";
}

function isMockMode(): boolean {
  const raw = env("MOCK_MODE").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function logEvent(event: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "bharatvoice-agent", ts: Date.now(), ...event }));
}

interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  requiresApproval: boolean;
  status: "executed" | "skipped" | "pending";
  result?: Record<string, unknown>;
  latencyMs?: number;
}

function toolRegistryPrompt(): string {
  return [
    "- getWeather (SAFE): get the weather forecast for an Indian city. Args: {\"city\": string, \"date\": \"today\" | \"tomorrow\"}",
    "- bookCab (SENSITIVE — requires human approval, never execute it yourself): book a cab. Args: {\"from\": string, \"to\": string, \"when\": \"today\" | \"tomorrow\"}",
  ].join("\n");
}

function plannerSystemPrompt(date: string): string {
  return [
    "You are the PLANNER of BharatVoice, a production voice agent for Indian languages.",
    `Today is ${date}.`,
    "You decide the user's intent and which tools are needed.",
    "Available tools:",
    toolRegistryPrompt(),
    "Rules:",
    "- Respond with STRICT JSON only, no markdown, no prose.",
    '- Shape: {"intent": "weather_query" | "book_cab" | "general_chat", "toolCalls": [{"name": string, "args": object}]}',
    '- Include a toolCall ONLY when the user clearly asks for that capability.',
    "- For weather, extract the city and date (today/tomorrow). For cabs, extract from/to/when.",
    '- Never include bookCab as a tool you will execute — it is gated behind human approval, just declare it.',
    '- If no tool is needed, return "toolCalls": [].',
  ].join("\n");
}

function responderSystemPrompt(
  languageCode: string | null,
  toolResultsJson: string | null,
): string {
  const langLine = languageCode
    ? `The user is speaking ${languageCode}.`
    : "Detect the user's language from their message (supporting code-mixed Hinglish).";
  const results = toolResultsJson
    ? `\n\nTool results you can ground your answer in:\n__TOOL_RESULT__\n${toolResultsJson}\n__END__`
    : "";
  return [
    "You are the RESPONDER of BharatVoice, a friendly multilingual assistant for India.",
    `Answer the user in their own language. ${langLine}`,
    "Keep it concise (1-3 sentences), natural, spoken-friendly: no markdown, no bullet lists, no emojis.",
    "Use the tool results when they are relevant. If a tool was skipped because the user denied approval, acknowledge that politely.",
    results,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Self-evaluation — a lightweight runtime check of response quality. Runs on
// every turn at zero extra latency; the richer LLM-as-judge layer (ai/judge.ts)
// scores the same turns asynchronously afterwards. Both share one rubric via
// ai/scoring.ts so their numbers agree.
// ---------------------------------------------------------------------------

function selfEvaluate(opts: {
  responseText: string;
  toolCalls: ToolCallRecord[];
  languageCode: string | null;
  totalLatencyMs: number;
}): { score: number; notes: string[] } {
  const result = heuristicScore({
    responseText: opts.responseText,
    toolCalls: opts.toolCalls,
    languageCode: opts.languageCode,
    totalLatencyMs: opts.totalLatencyMs,
  });
  return { score: result.score, notes: result.notes };
}

// ---------------------------------------------------------------------------
// runAgent — one full turn
// ---------------------------------------------------------------------------

export const runAgent = action({
  args: {
    text: v.string(),
    languageCode: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    source: v.optional(v.union(v.literal("voice"), v.literal("text"))),
    sttLatencyMs: v.optional(v.number()),
    languageProbability: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AgentResponse> => {
    const requestId = crypto.randomUUID();
    const totalStartedAt = Date.now();
    const identity = await ctx.auth.getUserIdentity();
    const userId = (identity?.subject ?? null) as Id<"users"> | null;

    const text = args.text.trim();
    const source = args.source ?? "text";
    const languageCode = args.languageCode || null;

    logEvent({
      event: "agent.start",
      requestId,
      userId,
      source,
      languageCode,
      textPreview: text.slice(0, 80),
    });

    // ---- 1. resolve conversation (memory) -------------------------------
    let conversationId = args.conversationId ?? null;
    if (conversationId) {
      const conv = await ctx.runQuery(internal.agentDb.getConversationById, {
        conversationId,
      }).catch(() => null);
      if (!conv || conv.userId !== userId) {
        conversationId = null;
      }
    }

    const isFirstMessage = !conversationId;
    if (!conversationId) {
      conversationId = await ctx.runMutation(
        internal.agentDb.createConversationInternal,
        {
          userId: userId ?? undefined,
          title: text.slice(0, 40) || "New conversation",
          source,
        },
      );
    }

    // ---- 2. plan ---------------------------------------------------------
    const history = await ctx.runQuery(internal.agentDb.getConversationHistory, {
      conversationId,
      limit: 8,
    });
    const llm = createLLMProvider({
      mockMode: isMockMode(),
      apiKey: env("VLY_INTEGRATION_KEY"),
      model: env("AGENT_LLM_MODEL") || undefined,
      openAiApiKey: env("LLM_API_KEY") || undefined,
      openAiBaseUrl: env("LLM_BASE_URL") || undefined,
      openAiModel: env("LLM_MODEL") || undefined,
    });

    const plannerMessages: LLMMessage[] = [
      { role: "system", content: plannerSystemPrompt(new Date().toDateString()) },
      ...history
        .slice()
        .reverse()
        .map((m): LLMMessage => ({ role: toLlmRole(m.role), content: m.content })),
      {
        role: "user",
        content: [
          `User's message: "${text}"`,
          `Detected language: ${languageCode ?? "unknown"}`,
        ].join("\n"),
      },
    ];

    let plan: { intent?: string; toolCalls?: { name?: string; args?: unknown }[] } = {};
    let llmLatencyMs = 0;
    let llmPlanError: string | null = null;
    const planResult = await llm.complete(plannerMessages, {
      temperature: 0.1,
      maxTokens: 400,
    });
    llmLatencyMs += planResult.latencyMs;
    if (planResult.error) {
      llmPlanError = planResult.error;
    } else {
      plan = parseLlmJson<{ intent?: string; toolCalls?: { name?: string; args?: unknown }[] }>(
        planResult.content,
      ) ?? {};
    }

    // ---- 3. normalize + gate tool calls ----------------------------------
    const rawCalls = (plan.toolCalls ?? []).slice(0, MAX_TOOL_CALLS);
    const toolCalls: ToolCallRecord[] = [];
    for (const raw of rawCalls) {
      const name = typeof raw.name === "string" ? raw.name : "";
      const tool = getTool(name);
      if (!tool) continue;
      const args = sanitizeArgs(raw.args);
      toolCalls.push({
        name: tool.name,
        args,
        requiresApproval: tool.requiresApproval,
        status: "pending",
      });
    }

    // Execute safe tools immediately; sensitive ones become approvals.
    const approvalIds: Id<"approvals">[] = [];
    let toolLatencyMs = 0;
    const toApprove = toolCalls.filter((t) => t.requiresApproval);
    const toRun = toolCalls.filter((t) => !t.requiresApproval);

    for (const call of toRun) {
      const started = Date.now();
      const tool = getTool(call.name)!;
      try {
        call.result = await tool.execute(call.args);
        call.status = "executed";
      } catch (err) {
        call.result = {
          error: err instanceof Error ? err.message : "Tool execution failed",
        };
        call.status = "executed";
      }
      call.latencyMs = Date.now() - started;
      toolLatencyMs += call.latencyMs;
    }

    for (const call of toApprove) {
      const approvalId = await ctx.runMutation(internal.agentDb.createApproval, {
        userId: userId ?? undefined,
        conversationId: conversationId ?? undefined,
        toolName: call.name,
        args: call.args,
        summary: summarizeToolCall(call.name, call.args),
      });
      approvalIds.push(approvalId);
      call.status = "pending";
    }

    const hasPendingApprovals = approvalIds.length > 0;

    // ---- 4. answer -------------------------------------------------------
    const toolResultsJson = toolCalls.length
      ? JSON.stringify(
          toolCalls.map((t) => ({
            tool: t.name,
            args: t.args,
            status: t.status === "executed" ? "done" : "pending_approval",
            result: t.result ?? null,
          })),
        ).slice(0, MAX_TOOL_RESULT_CHARS)
      : null;

    const responderMessages: LLMMessage[] = [
      {
        role: "system",
        content: responderSystemPrompt(languageCode, toolResultsJson),
      },
      ...history
        .slice()
        .reverse()
        .map((m): LLMMessage => ({ role: toLlmRole(m.role), content: m.content })),
      { role: "user", content: text },
    ];

    const answerResult = await llm.complete(responderMessages, {
      temperature: 0.5,
      maxTokens: 500,
    });
    llmLatencyMs += answerResult.latencyMs;

    const responseText = (answerResult.content || "").trim();
    const responseLanguage = languageCode ?? null;

    // ---- 5. speak — the client synthesizes the answer with the browser's
    // speechSynthesis, so no TTS vendor or API key is involved. --------------
    const audioUrl = null;
    const ttsProviderName = "browser";
    const ttsLatencyMs = 0;

    const totalLatencyMs = Date.now() - totalStartedAt;
    const failedTurn = !responseText || !!answerResult.error;
    const runStatus: "success" | "error" | "pending_approval" = failedTurn
      ? "error"
      : hasPendingApprovals
        ? "pending_approval"
        : "success";
    const eval_ =
      runStatus !== "success"
        ? { score: 0, notes: [runStatus === "error" ? "generation failed" : "awaiting approval"] }
        : selfEvaluate({
            responseText,
            toolCalls,
            languageCode: responseLanguage,
            totalLatencyMs,
          });

    // ---- 6. persist -------------------------------------------------------
    await ctx.runMutation(internal.agentDb.insertMessage, {
      conversationId,
      userId: userId ?? undefined,
      role: "user",
      content: text,
      languageCode: languageCode ?? undefined,
      model: llm.model,
    });
    await ctx.runMutation(internal.agentDb.insertMessage, {
      conversationId,
      userId: userId ?? undefined,
      role: "assistant",
      content: responseText || "I couldn't generate a response. Please try again.",
      languageCode: responseLanguage ?? undefined,
      toolCalls: toolCalls.map((t) => ({
        name: t.name,
        args: t.args,
        status: t.status,
        result: t.result ?? null,
        latencyMs: t.latencyMs ?? null,
      })),
      model: llm.model,
      latencyMs: llmLatencyMs,
    });
    await ctx.runMutation(internal.agentDb.touchConversation, {
      conversationId,
      title: isFirstMessage ? text.slice(0, 40) : undefined,
      messageDelta: 2,
    });

    const runId = await ctx.runMutation(internal.agentDb.recordAgentRun, {
      userId: userId ?? undefined,
      conversationId: conversationId ?? undefined,
      requestId,
      inputType: source,
      transcript: text,
      detectedLanguage: languageCode ?? undefined,
      languageProbability: args.languageProbability ?? undefined,
      intent: plan.intent,
      toolCalls: toolCalls.map((t) => ({
        name: t.name,
        args: t.args,
        status: t.status,
        result: t.result ?? null,
        latencyMs: t.latencyMs ?? null,
      })),
      responseText: responseText || undefined,
      responseLanguage: responseLanguage ?? undefined,
      sttLatencyMs: args.sttLatencyMs ?? undefined,
      llmLatencyMs: llmLatencyMs || undefined,
      toolLatencyMs: toolLatencyMs || undefined,
      ttsLatencyMs: ttsLatencyMs || undefined,
      totalLatencyMs,
      llmProvider: llm.name,
      llmModel: llm.model,
      ttsProvider: ttsProviderName,
      evalScore: eval_.score,
      evalNotes: eval_.notes.join(", "),
      status: runStatus,
      errorType: llmPlanError || answerResult.error ? "llm" : undefined,
      errorMessage: llmPlanError ?? answerResult.error ?? undefined,
    });

    logEvent({
      event: "agent.done",
      requestId,
      userId,
      conversationId,
      status: runStatus,
      intent: plan.intent ?? null,
      toolCalls: toolCalls.map((t) => `${t.name}:${t.status}`),
      llmLatencyMs,
      toolLatencyMs,
      ttsLatencyMs,
      totalLatencyMs,
      evalScore: eval_.score,
      approvals: approvalIds.length,
    });

    return {
      ok: true,
      requestId,
      runId,
      conversationId,
      status: runStatus,
      transcript: text,
      detectedLanguage: languageCode ?? null,
      languageProbability: args.languageProbability ?? null,
      intent: plan.intent ?? null,
      toolCalls: toolCalls.map((t) => ({
        name: t.name,
        args: t.args,
        status: t.status,
        result: t.result ?? null,
        latencyMs: t.latencyMs ?? null,
      })),
      responseText,
      responseLanguage,
      audioUrl,
      ttsProvider: ttsProviderName,
      ttsLatencyMs,
      sttLatencyMs: args.sttLatencyMs ?? null,
      llmLatencyMs,
      toolLatencyMs,
      totalLatencyMs,
      llmProvider: llm.name,
      llmModel: llm.model,
      evalScore: eval_.score,
      approvals: hasPendingApprovals
        ? approvalIds.map((id, i) => ({
            approvalId: id,
            toolName: toApprove[i]?.name ?? "unknown",
            summary: summarizeToolCall(
              toApprove[i]?.name ?? "unknown",
              toApprove[i]?.args ?? {},
            ),
          }))
        : [],
    };
  },
});

// ---------------------------------------------------------------------------
// resumeApproval — continue a gated turn after the human decides
// ---------------------------------------------------------------------------

export const resumeApproval = action({
  args: {
    runId: v.id("agentRuns"),
    approvalIds: v.array(v.id("approvals")),
  },
  handler: async (ctx, args): Promise<ResumeApprovalResponse> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = (identity?.subject ?? null) as Id<"users"> | null;
    const runId = args.runId;
    const totalStartedAt = Date.now();

    const run = await ctx.runQuery(internal.agentDb.getRunById, {
      runId,
    });
    if (!run || run.userId !== userId) throw new Error("Run not found");

    const approvals = await ctx.runQuery(internal.agentDb.getApprovalsByIds, {
      ids: args.approvalIds,
    });
    if (approvals.length === 0) throw new Error("No approvals found");

    const executed: ToolCallRecord[] = [];
    let toolLatencyMs = 0;
    for (const approval of approvals) {
      const tool = getTool(approval.toolName);
      const record: ToolCallRecord = {
        name: approval.toolName,
        args: approval.args as Record<string, unknown>,
        requiresApproval: true,
        status: "skipped",
      };
      if (approval.status === "approved" && tool) {
        const started = Date.now();
        try {
          record.result = await tool.execute(approval.args as Record<string, unknown>);
          record.status = "executed";
        } catch (err) {
          record.result = {
            error: err instanceof Error ? err.message : "Tool execution failed",
          };
          record.status = "executed";
        }
        record.latencyMs = Date.now() - started;
        toolLatencyMs += record.latencyMs;
      }
      executed.push(record);
    }

    const llm = createLLMProvider({
      mockMode: isMockMode(),
      apiKey: env("VLY_INTEGRATION_KEY"),
      model: env("AGENT_LLM_MODEL") || undefined,
      openAiApiKey: env("LLM_API_KEY") || undefined,
      openAiBaseUrl: env("LLM_BASE_URL") || undefined,
      openAiModel: env("LLM_MODEL") || undefined,
    });

    const toolResultsJson = JSON.stringify(
      executed.map((t) => ({
        tool: t.name,
        args: t.args,
        status: t.status === "executed" ? "done" : "skipped_user_denied",
        result: t.result ?? null,
      })),
    ).slice(0, MAX_TOOL_RESULT_CHARS);

    const responderMessages: LLMMessage[] = [
      {
        role: "system",
        content: responderSystemPrompt(run.detectedLanguage ?? null, toolResultsJson),
      },
      { role: "user", content: run.transcript },
    ];

    const answerResult = await llm.complete(responderMessages, {
      temperature: 0.5,
      maxTokens: 500,
    });
    const responseText = (answerResult.content || "").trim();
    const llmLatencyMs = answerResult.latencyMs;

    // Speech is synthesized client-side (browser speechSynthesis).
    const audioUrl = null;
    const ttsProviderName = "browser";
    const ttsLatencyMs = 0;

    const totalLatencyMs = Date.now() - totalStartedAt;
    const eval_ = selfEvaluate({
      responseText,
      toolCalls: executed,
      languageCode: run.detectedLanguage ?? null,
      totalLatencyMs,
    });

    const finalToolCalls = [...(run.toolCalls ?? []), ...executed];
    await ctx.runMutation(internal.agentDb.updateAgentRun, {
      runId,
      patch: {
        status: "success",
        responseText,
        responseLanguage: run.detectedLanguage,
        toolCalls: finalToolCalls,
        llmLatencyMs,
        toolLatencyMs,
        ttsLatencyMs,
        totalLatencyMs,
        ttsProvider: ttsProviderName,
        evalScore: eval_.score,
        evalNotes: eval_.notes.join(", "),
      },
    });

    if (run.conversationId) {
      await ctx.runMutation(internal.agentDb.insertMessage, {
        conversationId: run.conversationId,
        userId: userId ?? undefined,
        role: "assistant",
        content: responseText || "The action was processed.",
        languageCode: run.detectedLanguage ?? undefined,
        toolCalls: executed.map((t) => ({
          name: t.name,
          args: t.args,
          status: t.status,
          result: t.result ?? null,
          latencyMs: t.latencyMs ?? null,
        })),
        model: llm.model,
        latencyMs: llmLatencyMs,
      });
      await ctx.runMutation(internal.agentDb.touchConversation, {
        conversationId: run.conversationId,
        messageDelta: 1,
      });
    }

    logEvent({
      event: "agent.approval_resumed",
      requestId: run.requestId,
      userId,
      runId,
      toolCalls: executed.map((t) => `${t.name}:${t.status}`),
      totalLatencyMs,
    });

    return {
      ok: true,
      runId,
      conversationId: run.conversationId ?? null,
      requestId: run.requestId,
      status: "success",
      responseText,
      responseLanguage: run.detectedLanguage ?? null,
      audioUrl,
      ttsProvider: ttsProviderName,
      toolCalls: executed.map((t) => ({
        name: t.name,
        args: t.args,
        status: t.status,
        result: t.result ?? null,
        latencyMs: t.latencyMs ?? null,
      })),
      totalLatencyMs,
      llmProvider: llm.name,
      llmModel: llm.model,
    };
  },
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Map a stored message role onto the LLM message shape (tool→assistant). */
function toLlmRole(
  role: "user" | "assistant" | "tool",
): "system" | "user" | "assistant" {
  if (role === "user") return "user";
  return "assistant";
}

/** Keep tool args small and JSON-safe: only string/number/boolean scalars. */
function sanitizeArgs(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value.slice(0, 100);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export interface ResumeApprovalResponse {
  ok: boolean;
  runId: Id<"agentRuns">;
  conversationId: Id<"conversations"> | null;
  requestId: string;
  status: "success";
  responseText: string;
  responseLanguage: string | null;
  audioUrl: string | null;
  ttsProvider: string;
  toolCalls: {
    name: string;
    args: Record<string, unknown>;
    status: string;
    result: Record<string, unknown> | null;
    latencyMs: number | null;
  }[];
  totalLatencyMs: number;
  llmProvider: string;
  llmModel: string;
}

export interface AgentResponse {
  ok: boolean;
  requestId: string;
  runId: Id<"agentRuns">;
  conversationId: Id<"conversations">;
  status: "success" | "pending_approval" | "error";
  transcript: string;
  detectedLanguage: string | null;
  languageProbability: number | null;
  intent: string | null;
  toolCalls: {
    name: string;
    args: Record<string, unknown>;
    status: string;
    result: Record<string, unknown> | null;
    latencyMs: number | null;
  }[];
  responseText: string;
  responseLanguage: string | null;
  audioUrl: string | null;
  ttsProvider: string;
  ttsLatencyMs: number;
  sttLatencyMs: number | null;
  llmLatencyMs: number;
  toolLatencyMs: number;
  totalLatencyMs: number;
  llmProvider: string;
  llmModel: string;
  evalScore: number;
  approvals: { approvalId: Id<"approvals">; toolName: string; summary: string }[];
}
