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
  },
  {
    schemaValidation: false,
  },
);

export default schema;
