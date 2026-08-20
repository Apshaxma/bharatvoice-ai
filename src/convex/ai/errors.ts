/**
 * BharatVoice AI — user-facing error messages.
 *
 * Maps internal LLM errors to safe, human-readable strings.
 * Never exposes API keys, stack traces, request IDs, or internal details.
 *
 * This module is free of Convex imports so it can be unit-tested directly.
 */

import type { LLMStructuredError } from "./llm";

/**
 * Map an LLM error + optional structured error to a user-friendly message.
 * The frontend displays this string directly to the user.
 */
export function friendlyErrorMessage(
  llmError: string | null,
  structuredError?: { type?: string; message?: string },
): string {
  if (structuredError?.message) return structuredError.message;
  if (!llmError) return "";

  const lower = llmError.toLowerCase();
  if (lower.includes("401") || lower.includes("authentication") || lower.includes("auth"))
    return "AI authentication failed. Check the OpenRouter API key.";
  if (lower.includes("403") || lower.includes("denied"))
    return "AI provider access was denied. Check the selected model/provider.";
  if (lower.includes("429") || lower.includes("rate limit"))
    return "AI is temporarily rate-limited. Please try again.";
  if (lower.includes("502") || lower.includes("503") || lower.includes("504"))
    return "AI provider is temporarily unavailable. Please try again.";
  if (lower.includes("404") || lower.includes("not found"))
    return "AI model not found. Check the model configuration.";
  if (lower.includes("timeout"))
    return "AI request timed out. Please try again.";
  if (lower.includes("empty"))
    return "The AI returned an empty response. Please try again.";
  if (lower.includes("network") || lower.includes("fetch"))
    return "Unable to connect to the AI service. Check your connection.";
  if (lower.includes("llm_api_key") || lower.includes("openrouter"))
    return "AI configuration is incomplete. Check the API key in the Convex dashboard.";

  return "The AI service is temporarily unavailable. Please try again.";
}
