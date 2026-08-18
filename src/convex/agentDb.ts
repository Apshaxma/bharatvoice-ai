/**
 * Database layer for the BharatVoice agent: conversations, messages, runs,
 * approvals and the observability metrics used by the Insights tab.
 *
 * All mutations/queries live here (no "use node"), while the agent pipeline
 * in `agent.ts` orchestrates them via internal functions.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Internal helpers (called from the agent action)
// ---------------------------------------------------------------------------

export const createConversationInternal = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    title: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversations", {
      userId: args.userId,
      title: args.title,
      source: args.source,
      messageCount: 0,
    });
  },
});

export const touchConversation = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.optional(v.string()),
    messageDelta: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return;
    await ctx.db.patch(args.conversationId, {
      title: args.title ?? conv.title,
      messageCount: Math.max(0, conv.messageCount + (args.messageDelta ?? 0)),
    });
  },
});

export const insertMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.optional(v.id("users")),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("tool")),
    content: v.string(),
    languageCode: v.optional(v.string()),
    toolCalls: v.optional(v.array(v.any())),
    model: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMessages", {
      conversationId: args.conversationId,
      userId: args.userId,
      role: args.role,
      content: args.content,
      languageCode: args.languageCode,
      toolCalls: args.toolCalls,
      model: args.model,
      latencyMs: args.latencyMs,
    });
  },
});

export const recordAgentRun = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    conversationId: v.optional(v.id("conversations")),
    requestId: v.string(),
    inputType: v.string(),
    transcript: v.string(),
    detectedLanguage: v.optional(v.string()),
    languageProbability: v.optional(v.number()),
    intent: v.optional(v.string()),
    toolCalls: v.optional(v.array(v.any())),
    responseText: v.optional(v.string()),
    responseLanguage: v.optional(v.string()),
    sttLatencyMs: v.optional(v.number()),
    llmLatencyMs: v.optional(v.number()),
    toolLatencyMs: v.optional(v.number()),
    ttsLatencyMs: v.optional(v.number()),
    totalLatencyMs: v.number(),
    llmProvider: v.optional(v.string()),
    llmModel: v.optional(v.string()),
    ttsProvider: v.optional(v.string()),
    evalScore: v.optional(v.number()),
    evalNotes: v.optional(v.string()),
    status: v.union(
      v.literal("success"),
      v.literal("error"),
      v.literal("pending_approval"),
    ),
    errorType: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRuns", args);
  },
});

export const updateAgentRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    patch: v.any(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    await ctx.db.patch(args.runId, args.patch);
  },
});

export const createApproval = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    conversationId: v.optional(v.id("conversations")),
    runId: v.optional(v.id("agentRuns")),
    toolName: v.string(),
    args: v.any(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("approvals", {
      userId: args.userId,
      conversationId: args.conversationId,
      runId: args.runId,
      toolName: args.toolName,
      args: args.args,
      summary: args.summary,
      status: "pending",
    });
  },
});

export const getConversationById = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

export const getRunById = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const getApprovalsByIds = internalQuery({
  args: { ids: v.array(v.id("approvals")) },
  handler: async (ctx, args) => {
    const out: Doc<"approvals">[] = [];
    for (const id of args.ids) {
      const a = await ctx.db.get(id);
      if (a) out.push(a);
    }
    return out;
  },
});

export const getConversationHistory = internalQuery({
  args: { conversationId: v.id("conversations"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 8, 1), 20);
    return await ctx.db
      .query("agentMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Recent runs that have not yet been scored by the LLM judge. When `userId`
 * is omitted (scheduled job) it scans deployment-wide; runs already scored
 * (judgeScore set or judgeStatus "done") are skipped.
 */
export const getRunsToEvaluate = internalQuery({
  args: {
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    // Over-fetch then filter: judge errors (judgeScore set but judgeStatus
    // "error") are included so the cron can re-judge them; only "done" runs
    // are excluded. The extra headroom (limit*3) ensures we find enough after
    // filtering.
    const recent = args.userId
      ? await ctx.db
          .query("agentRuns")
          .withIndex("by_user", (q) => q.eq("userId", args.userId))
          .order("desc")
          .take(limit * 3)
      : await ctx.db.query("agentRuns").order("desc").take(limit * 3);
    return recent
      .filter((r) => r.judgeStatus !== "done")
      .slice(0, limit);
  },
});

// ---------------------------------------------------------------------------
// Conversations (user-facing)
// ---------------------------------------------------------------------------

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const renameConversation = mutation({
  args: { conversationId: v.id("conversations"), title: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== userId) throw new Error("Not found");
    const title = args.title.trim().slice(0, 60) || conv.title;
    await ctx.db.patch(args.conversationId, { title });
    return { ok: true };
  },
});

export const deleteConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== userId) throw new Error("Not found");
    const messages = await ctx.db
      .query("agentMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);
    await ctx.db.delete(args.conversationId);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const listMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== userId) return [];
    return await ctx.db
      .query("agentMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("asc")
      .take(500);
  },
});

// ---------------------------------------------------------------------------
// Runs + metrics (Insights tab)
// ---------------------------------------------------------------------------

export const listRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

export const metrics = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(500);

    if (runs.length === 0) {
      return {
        totalRuns: 0,
        successRate: 0,
        errorCount: 0,
        pendingCount: 0,
        avgTotalLatencyMs: 0,
        avgSttLatencyMs: 0,
        avgLlmLatencyMs: 0,
        avgToolLatencyMs: 0,
        avgTtsLatencyMs: 0,
        totalToolCalls: 0,
        avgEvalScore: 0,
        avgJudgeScore: 0,
        judgedCount: 0,
        intentCounts: {},
        languageCounts: {},
        modelUsage: {},
        provider: {},
        runsByDay: [],
      };
    }

    const intentCounts: Record<string, number> = {};
    const languageCounts: Record<string, number> = {};
    const modelUsage: Record<string, number> = {};
    const provider: Record<string, number> = {};
    const dayBuckets = new Map<string, { runs: number; success: number; error: number }>();
    let successCount = 0;
    let errorCount = 0;
    let pendingCount = 0;
    let totalToolCalls = 0;
    let totalLatency = 0;
    let sttLatency = 0;
    let llmLatency = 0;
    let toolLatency = 0;
    let ttsLatency = 0;
    let evalSum = 0;
    let evalCount = 0;
    let judgeSum = 0;
    let judgeCount = 0;
    let sttCount = 0;
    let llmCount = 0;
    let toolCount = 0;
    let ttsCount = 0;

    for (const run of runs) {
      if (run.status === "success") successCount += 1;
      else if (run.status === "error") errorCount += 1;
      else pendingCount += 1;

      const day = new Date(run._creationTime).toISOString().slice(0, 10);
      const bucket = dayBuckets.get(day) ?? { runs: 0, success: 0, error: 0 };
      bucket.runs += 1;
      if (run.status === "success") bucket.success += 1;
      if (run.status === "error") bucket.error += 1;
      dayBuckets.set(day, bucket);

      if (run.intent) intentCounts[run.intent] = (intentCounts[run.intent] ?? 0) + 1;
      if (run.detectedLanguage)
        languageCounts[run.detectedLanguage] = (languageCounts[run.detectedLanguage] ?? 0) + 1;
      if (run.llmModel) modelUsage[run.llmModel] = (modelUsage[run.llmModel] ?? 0) + 1;
      if (run.llmProvider) provider[run.llmProvider] = (provider[run.llmProvider] ?? 0) + 1;

      totalLatency += run.totalLatencyMs;
      if (run.sttLatencyMs != null) {
        sttLatency += run.sttLatencyMs;
        sttCount += 1;
      }
      if (run.llmLatencyMs != null) {
        llmLatency += run.llmLatencyMs;
        llmCount += 1;
      }
      if (run.toolLatencyMs != null) {
        toolLatency += run.toolLatencyMs;
        toolCount += 1;
      }
      if (run.ttsLatencyMs != null) {
        ttsLatency += run.ttsLatencyMs;
        ttsCount += 1;
      }
      totalToolCalls += (run.toolCalls ?? []).length;
      if (run.evalScore != null) {
        evalSum += run.evalScore;
        evalCount += 1;
      }
      if (run.judgeScore != null) {
        judgeSum += run.judgeScore;
        judgeCount += 1;
      }
    }

    const last14: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last14.push(d.toISOString().slice(0, 10));
    }

    const runsByDay = last14.map((day) => {
      const b = dayBuckets.get(day);
      return {
        day,
        runs: b?.runs ?? 0,
        success: b?.success ?? 0,
        error: b?.error ?? 0,
      };
    });

    return {
      totalRuns: runs.length,
      successRate: Math.round((successCount / runs.length) * 1000) / 10,
      errorCount,
      pendingCount,
      avgTotalLatencyMs: Math.round(totalLatency / runs.length),
      avgSttLatencyMs: sttCount ? Math.round(sttLatency / sttCount) : 0,
      avgLlmLatencyMs: llmCount ? Math.round(llmLatency / llmCount) : 0,
      avgToolLatencyMs: toolCount ? Math.round(toolLatency / toolCount) : 0,
      avgTtsLatencyMs: ttsCount ? Math.round(ttsLatency / ttsCount) : 0,
      totalToolCalls,
      avgEvalScore: evalCount ? Math.round((evalSum / evalCount) * 100) / 100 : 0,
      avgJudgeScore: judgeCount ? Math.round((judgeSum / judgeCount) * 100) / 100 : 0,
      judgedCount: judgeCount,
      intentCounts,
      languageCounts,
      modelUsage,
      provider,
      runsByDay,
    };
  },
});

// ---------------------------------------------------------------------------
// Approvals (human-in-the-loop)
// ---------------------------------------------------------------------------

export const listPendingApprovals = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("approvals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .order("desc")
      .take(50);
  },
});

export const listRecentApprovals = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    return await ctx.db
      .query("approvals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

export const decideApproval = mutation({
  args: {
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("approved"), v.literal("denied")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const approval = await ctx.db.get(args.approvalId);
    if (!approval || approval.userId !== userId) throw new Error("Not found");
    if (approval.status !== "pending") throw new Error("Already decided");
    await ctx.db.patch(args.approvalId, {
      status: args.decision,
      decidedAt: Date.now(),
    });
    return { ok: true };
  },
});
