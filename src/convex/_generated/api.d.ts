/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agentDb from "../agentDb.js";
import type * as ai_errors from "../ai/errors.js";
import type * as ai_judge from "../ai/judge.js";
import type * as ai_languages from "../ai/languages.js";
import type * as ai_llm from "../ai/llm.js";
import type * as ai_scoring from "../ai/scoring.js";
import type * as ai_stt from "../ai/stt.js";
import type * as audio from "../audio.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as crons from "../crons.js";
import type * as eval from "../eval.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as tools_index from "../tools/index.js";
import type * as tools_weather from "../tools/weather.js";
import type * as transcribe from "../transcribe.js";
import type * as transcriptions from "../transcriptions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentDb: typeof agentDb;
  "ai/errors": typeof ai_errors;
  "ai/judge": typeof ai_judge;
  "ai/languages": typeof ai_languages;
  "ai/llm": typeof ai_llm;
  "ai/scoring": typeof ai_scoring;
  "ai/stt": typeof ai_stt;
  audio: typeof audio;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  crons: typeof crons;
  eval: typeof eval;
  health: typeof health;
  http: typeof http;
  "tools/index": typeof tools_index;
  "tools/weather": typeof tools_weather;
  transcribe: typeof transcribe;
  transcriptions: typeof transcriptions;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
