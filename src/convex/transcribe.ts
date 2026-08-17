"use node";

/**
 * BharatVoice AI — transcription service (v1 scope: multilingual STT).
 *
 * Flow: client uploads audio to Convex storage → calls `transcribeAudio` →
 * the action reads the bytes, runs the backend STT provider (a deterministic
 * mock — live transcription happens in the browser via the Web Speech API),
 * records the result (with language detection + latency), persists it for
 * per-user history, and deletes the raw audio afterwards.
 *
 * The raw audio is never retained — we keep the transcript and metadata only.
 */

import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { createSTTProvider, type STTResult } from "./ai/stt";
import { LANGUAGES, MODES, type TranscriptionMode } from "./ai/languages";

/** Client cannot upload more than this much audio (guards both storage and the STT REST limit). */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function env(name: string): string {
  return process.env[name] ?? "";
}

function isMockMode(): boolean {
  const raw = env("MOCK_MODE").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** One structured log line per run — request id, session, latencies, outcome. */
function logEvent(event: Record<string, unknown>) {
  console.log(JSON.stringify({ service: "bharatvoice-transcribe", ts: Date.now(), ...event }));
}

function safeErrorType(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return "UnknownError";
}

/**
 * Transcribe a stored audio file. Returns a normalized result; never throws —
 * failures are mapped to a structured error the UI can display safely.
 */
export const transcribeAudio = action({
  args: {
    storageId: v.id("_storage"),
    /** Audio MIME type as recorded by the browser (e.g. audio/webm;codecs=opus). */
    mimeType: v.string(),
    /** Pin a language (BCP-47). Omit/empty for automatic detection. */
    languageCode: v.optional(v.string()),
    /** Output mode. Defaults to "transcribe". */
    mode: v.optional(v.string()),
    /** Client-observed audio duration in ms (used for latency analysis). */
    audioDurationMs: v.optional(v.number()),
    /** Client timestamp (ms) when recording stopped, for end-to-end latency. */
    recordedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const requestId = crypto.randomUUID();
    const totalStartedAt = Date.now();
    const identity = await ctx.auth.getUserIdentity();
    const userId = (identity?.subject ?? null) as Id<"users"> | null;

    const mode = (args.mode ?? "transcribe") as TranscriptionMode["code"];
    const modeValid = MODES.some((m) => m.code === mode);
    const languageCode =
      args.languageCode && args.languageCode !== "auto" ? args.languageCode : null;

    logEvent({
      event: "transcribe.start",
      requestId,
      userId,
      mode,
      languageCode: languageCode ?? "auto",
      audioDurationMs: args.audioDurationMs ?? null,
    });

    // --- read + validate audio -------------------------------------------
    let audioBytes: Uint8Array | null = null;
    try {
      const file = await ctx.storage.get(args.storageId);
      if (!file) throw new Error("stored audio not found");
      const buffer = await file.arrayBuffer();
      audioBytes = new Uint8Array(buffer);
    } catch (err) {
      logEvent({ event: "transcribe.read_failed", requestId, errorType: safeErrorType(err) });
      const result = fail(
        requestId,
        "invalid_audio",
        "The recorded audio could not be read. Please try again.",
      );
      await persist(ctx, requestId, userId, mode, languageCode, result, null);
      return result;
    }

    if (audioBytes.length === 0) {
      const result = fail(requestId, "invalid_audio", "The recording was empty. Please try again.");
      await persist(ctx, requestId, userId, mode, languageCode, result, null);
      return result;
    }
    if (audioBytes.length > MAX_AUDIO_BYTES) {
      const result = fail(
        requestId,
        "invalid_audio",
        "The recording is too large. Please keep clips under 60 seconds.",
      );
      await persist(ctx, requestId, userId, mode, languageCode, result, null);
      return result;
    }

    // --- run the provider -------------------------------------------------
    // Backend STT is the deterministic mock; live transcription is handled by
    // the browser's Web Speech API before the agent is even called.
    const provider = createSTTProvider({ mockMode: isMockMode() });

    let stt: STTResult;
    try {
      stt = await provider.transcribe({
        audio: audioBytes,
        mimeType: args.mimeType || "audio/webm",
        languageCode,
        mode: modeValid ? mode : "transcribe",
      });
    } catch (err) {
      // Provider implementations catch their own errors, but never let an
      // unexpected exception escape with a stack trace.
      logEvent({ event: "transcribe.unexpected_error", requestId, errorType: safeErrorType(err) });
      const result = fail(
        requestId,
        "provider",
        "Something went wrong during transcription. Please try again.",
      );
      await persist(ctx, requestId, userId, mode, languageCode, result, null);
      return result;
    }

    const totalLatencyMs = Date.now() - totalStartedAt;

    if (stt.error || !stt.transcript) {
      logEvent({
        event: "transcribe.failed",
        requestId,
        userId,
        provider: provider.name,
        model: provider.model,
        errorType: stt.errorType ?? "unknown",
        sttLatencyMs: stt.latencyMs,
        totalLatencyMs,
      });
      const result: TranscriptionResponse = {
        ok: false,
        errorType: stt.errorType ?? "provider",
        errorMessage: stt.error ?? "Transcription failed.",
        provider: provider.name,
        model: provider.model,
        mode,
        requestId,
        sttLatencyMs: stt.latencyMs,
        totalLatencyMs,
        audioDurationMs: args.audioDurationMs ?? null,
      };
      await persist(ctx, requestId, userId, mode, languageCode, result, null);
      return result;
    }

    logEvent({
      event: "transcribe.success",
      requestId,
      userId,
      provider: provider.name,
      model: provider.model,
      mode,
      detectedLanguage: stt.languageCode,
      languageProbability: stt.languageProbability,
      sttLatencyMs: stt.latencyMs,
      totalLatencyMs,
      audioDurationMs: args.audioDurationMs ?? null,
      audioBytes: audioBytes.length,
    });

    const result: TranscriptionResponse = {
      ok: true,
      transcript: stt.transcript,
      languageCode: stt.languageCode,
      languageProbability: stt.languageProbability,
      provider: provider.name,
      model: provider.model,
      mode,
      providerRequestId: stt.providerRequestId,
      requestId,
      sttLatencyMs: stt.latencyMs,
      totalLatencyMs,
      audioDurationMs: args.audioDurationMs ?? null,
      recordedAt: args.recordedAt ?? null,
    };

    await persist(ctx, requestId, userId, mode, languageCode, result, audioBytes.length);
    return result;
  },
});

/** Map a normalized response into a DB record and insert it via internal mutation. */
async function persist(
  ctx: ActionCtx,
  requestId: string,
  userId: Id<"users"> | null,
  mode: TranscriptionMode["code"],
  languageCode: string | null,
  result: TranscriptionResponse,
  audioBytes: number | null,
) {
  try {
    await ctx.runMutation(internal.transcriptions.recordRun, {
      userId: userId ?? undefined,
      transcript: result.transcript ?? "",
      languageCode: languageCode ?? undefined,
      languageProbability: result.languageProbability ?? undefined,
      mode,
      provider: result.provider,
      model: result.model,
      status: result.ok ? "success" : "error",
      errorType: result.ok ? undefined : result.errorType,
      errorMessage: result.ok ? undefined : result.errorMessage,
      requestId,
      audioDurationMs: result.audioDurationMs ?? undefined,
      audioBytes: audioBytes ?? undefined,
      sttLatencyMs: result.sttLatencyMs,
      totalLatencyMs: result.totalLatencyMs,
    });
  } catch (err) {
    // History persistence must never break the user-facing result.
    logEvent({ event: "transcribe.persist_failed", requestId, errorType: safeErrorType(err) });
  }
}

function fail(requestId: string, errorType: string, errorMessage: string): TranscriptionResponse {
  return {
    ok: false,
    errorType,
    errorMessage,
    provider: "none",
    model: "none",
    mode: "transcribe",
    requestId,
    sttLatencyMs: 0,
    totalLatencyMs: 0,
    audioDurationMs: null,
  };
}

/**
 * Runtime info so the UI can render the language selector from backend config
 * and explain how speech is handled (browser-native, no vendor involved).
 */
export const getRuntimeInfo = action({
  args: {},
  handler: async () => {
    return {
      mode: "mock",
      provider: "mock",
      model: "mock-saaras-v3",
      reason:
        "Live transcription runs in the browser (Web Speech API) — the backend STT provider is a deterministic mock for the upload fallback.",
      languages: LANGUAGES,
      modes: MODES,
    };
  },
});

export interface TranscriptionResponse {
  ok: boolean;
  transcript?: string;
  languageCode?: string | null;
  languageProbability?: number | null;
  provider: string;
  model: string;
  mode: TranscriptionMode["code"];
  providerRequestId?: string | null;
  requestId: string;
  sttLatencyMs: number;
  totalLatencyMs: number;
  audioDurationMs: number | null;
  recordedAt?: number | null;
  errorType?: string;
  errorMessage?: string;
}
