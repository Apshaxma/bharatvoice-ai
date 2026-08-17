import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // One row per transcription run (success or failure) — powers per-user
    // history and doubles as an audit log with latency + provider metadata.
    transcriptions: defineTable({
      userId: v.optional(v.id("users")),
      transcript: v.string(),
      languageCode: v.optional(v.string()),
      languageProbability: v.optional(v.number()),
      mode: v.string(), // transcribe | codemix | translit | verbatim | translate
      provider: v.string(), // sarvam | mock
      model: v.string(),
      status: v.union(v.literal("success"), v.literal("error")),
      errorType: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      requestId: v.string(),
      audioDurationMs: v.optional(v.number()),
      audioBytes: v.optional(v.number()),
      sttLatencyMs: v.number(),
      totalLatencyMs: v.number(),
    }).index("by_user", ["userId"]),

    // One conversation per chat session — the agent's memory.
    conversations: defineTable({
      userId: v.optional(v.id("users")),
      title: v.string(),
      source: v.string(), // voice | text
      messageCount: v.number(),
    }).index("by_user", ["userId"]),

    // Individual user/assistant/tool messages within a conversation.
    agentMessages: defineTable({
      conversationId: v.id("conversations"),
      userId: v.optional(v.id("users")),
      role: v.union(v.literal("user"), v.literal("assistant"), v.literal("tool")),
      content: v.string(),
      languageCode: v.optional(v.string()),
      toolCalls: v.optional(v.array(v.any())),
      model: v.optional(v.string()),
      latencyMs: v.optional(v.number()),
    })
      .index("by_conversation", ["conversationId"])
      .index("by_user", ["userId"]),

    // One row per agent run — the observability backbone: intent, tool calls,
    // latencies, model usage and self-evaluation score for every turn.
    agentRuns: defineTable({
      userId: v.optional(v.id("users")),
      conversationId: v.optional(v.id("conversations")),
      requestId: v.string(),
      inputType: v.string(), // voice | text
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
    })
      .index("by_user", ["userId"])
      .index("by_conversation", ["conversationId"]),

    // Human-in-the-loop queue. Sensitive tool calls land here and only run
    // after the user explicitly approves them.
    approvals: defineTable({
      userId: v.optional(v.id("users")),
      conversationId: v.optional(v.id("conversations")),
      runId: v.optional(v.id("agentRuns")),
      toolName: v.string(),
      args: v.any(),
      summary: v.string(),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
      decidedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_status", ["status"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
