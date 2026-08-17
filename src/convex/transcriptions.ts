import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Persist one run (success or failure). Internal-only: called from the
 * `transcribeAudio` action, which cannot write to the database directly.
 */
export const recordRun = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    transcript: v.string(),
    languageCode: v.optional(v.string()),
    languageProbability: v.optional(v.number()),
    mode: v.string(),
    provider: v.string(),
    model: v.string(),
    status: v.union(v.literal("success"), v.literal("error")),
    errorType: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    requestId: v.string(),
    audioDurationMs: v.optional(v.number()),
    audioBytes: v.optional(v.number()),
    sttLatencyMs: v.number(),
    totalLatencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("transcriptions", args);
  },
});

/** Recent transcription runs for the signed-in user (successes and failures). */
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
    return await ctx.db
      .query("transcriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

/** Delete the signed-in user's entire transcription history. */
export const clearHistory = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { deleted: 0 };
    const rows = await ctx.db
      .query("transcriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    let deleted = 0;
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return { deleted };
  },
});
