"use node";

/**
 * BharatVoice AI — LLM-as-judge evaluation service.
 *
 * Scores completed agent turns asynchronously (never during the live turn)
 * with the LLM judge (ai/judge.ts), writing results onto `agentRuns`:
 *
 *   - `runJudgeEvaluation`  — user-scoped action, triggered from the Insights
 *                             tab to evaluate that user's recent unscored runs.
 *   - `evaluatePendingCron` — deployment-wide internal action, invoked by the
 *                             scheduled job in crons.ts every 30 minutes.
 *
 * The judge uses the same LLM provider as the agent (mock brain in mock mode,
 * gateway model in live mode) and degrades to the shared heuristic scorer if
 * the judge model fails, so evaluation never blocks on provider health.
 */

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { createJudgeProvider, type JudgeInput } from "./ai/judge";
import { createLLMProvider, type LLMProvider } from "./ai/llm";

function env(name: string): string {
  return process.env[name] ?? "";
}

function isMockMode(): boolean {
  const raw = env("MOCK_MODE").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** One structured log line per judged run — request id, score, latency. */
function logEvent(event: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "bharatvoice-judge", ts: Date.now(), ...event }));
}

/** Map a stored run onto the judge's input shape (defensively). */
function toJudgeInput(run: Doc<"agentRuns">): JudgeInput {
  const toolCalls = (run.toolCalls ?? []).map((t) => {
    const call = (t ?? {}) as Record<string, unknown>;
    return {
      name: typeof call.name === "string" ? call.name : "unknown",
      status: typeof call.status === "string" ? call.status : "unknown",
      result:
        call.result && typeof call.result === "object"
          ? (call.result as Record<string, unknown>)
          : null,
    };
  });
  return {
    transcript: run.transcript,
    detectedLanguage: run.detectedLanguage ?? null,
    intent: run.intent ?? null,
    toolCalls,
    responseText: run.responseText ?? "",
    responseLanguage: run.responseLanguage ?? null,
    totalLatencyMs: run.totalLatencyMs,
  };
}

/** Minimal action context surface used by the shared judge loop. */
type EvaluateCtx = {
  runMutation: (
    fn: typeof internal.agentDb.updateAgentRun,
    args: { runId: Id<"agentRuns">; patch: unknown },
  ) => Promise<unknown>;
};

/** Judge a batch of runs sequentially and persist each result. */
async function evaluateRuns(
  ctx: EvaluateCtx,
  llm: LLMProvider,
  runs: Doc<"agentRuns">[],
): Promise<number[]> {
  const judge = createJudgeProvider(llm);
  const scores: number[] = [];
  for (const run of runs) {
    const started = Date.now();
    const result = await judge.judge(toJudgeInput(run));
    const status = result.error ? "error" : "done";
    try {
      await ctx.runMutation(internal.agentDb.updateAgentRun, {
        runId: run._id,
        patch: {
          judgeScore: result.score,
          judgeCriteria: result.criteria.length ? result.criteria : undefined,
          judgeNotes: result.notes.length ? result.notes.join(", ") : undefined,
          judgeProvider: result.provider,
          judgeModel: result.model,
          judgeLatencyMs: result.latencyMs,
          judgeStatus: status,
          judgeError: result.error ?? undefined,
        },
      });
    } catch (err) {
      logEvent({
        event: "judge.persist_failed",
        runId: run._id,
        requestId: run.requestId,
        error: err instanceof Error ? err.message : "unknown",
      });
      continue;
    }
    scores.push(result.score);
    logEvent({
      event: "judge.run_scored",
      runId: run._id,
      requestId: run.requestId,
      inputType: run.inputType,
      score: result.score,
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - started,
      error: result.error ?? null,
    });
  }
  return scores;
}

function createLlm(): LLMProvider {
  return createLLMProvider({
    mockMode: isMockMode(),
    apiKey: env("VLY_INTEGRATION_KEY"),
    model: env("AGENT_LLM_MODEL") || undefined,
  });
}

/**
 * Score the current user's recent unscored runs. Called from the Insights tab.
 * Scoped to the signed-in user via the internal query.
 */
export const runJudgeEvaluation = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = (identity?.subject ?? null) as Id<"users"> | null;
    const limit = Math.min(Math.max(args.limit ?? 10, 1), 25);

    const runs = await ctx.runQuery(internal.agentDb.getRunsToEvaluate, {
      userId: userId ?? undefined,
      limit,
    });
    if (runs.length === 0) {
      return {
        ok: true,
        evaluated: 0,
        scores: [],
        avgScore: null,
        message: "No unscored runs to evaluate.",
      };
    }

    const scores = await evaluateRuns(ctx, createLlm(), runs);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    return {
      ok: true,
      evaluated: scores.length,
      scores,
      avgScore: Math.round(avgScore * 100) / 100,
      message: null,
    };
  },
});

/**
 * Deployment-wide scoring of the most recent unscored runs. Runs without a
 * user identity (scheduled job) — the internal query skips the user filter
 * when none is provided.
 */
export const evaluatePendingCron = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    const runs = await ctx.runQuery(internal.agentDb.getRunsToEvaluate, { limit });
    if (runs.length === 0) return { evaluated: 0 };
    const scores = await evaluateRuns(ctx, createLlm(), runs);
    logEvent({
      event: "judge.cron_batch",
      evaluated: scores.length,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
    });
    return { evaluated: scores.length };
  },
});
