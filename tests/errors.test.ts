/**
 * Error mapping tests.
 *
 * Validates that every known LLM error type maps to the correct
 * user-facing message, and that structured errors take priority.
 */

import { describe, expect, test } from "bun:test";
import { friendlyErrorMessage } from "../src/convex/ai/errors";

describe("friendlyErrorMessage", () => {
  // --- Structured error priority ---

  test("structured error message is returned verbatim when provided", () => {
    const result = friendlyErrorMessage("any error", {
      type: "rate_limit",
      message: "Custom rate limit message",
    });
    expect(result).toBe("Custom rate limit message");
  });

  test("returns empty string when both inputs are null/empty", () => {
    expect(friendlyErrorMessage(null)).toBe("");
    expect(friendlyErrorMessage(null, undefined)).toBe("");
  });

  // --- HTTP status code mappings ---

  test("401 → authentication failed", () => {
    expect(friendlyErrorMessage("HTTP 401 Unauthorized")).toContain("authentication");
  });

  test("authentication keyword → authentication failed", () => {
    expect(friendlyErrorMessage("authentication failed at provider")).toContain("authentication");
  });

  test("auth keyword → authentication failed", () => {
    expect(friendlyErrorMessage("auth error")).toContain("authentication");
  });

  test("403 → provider denied", () => {
    expect(friendlyErrorMessage("HTTP 403 Forbidden")).toContain("denied");
  });

  test("denied keyword → provider denied", () => {
    expect(friendlyErrorMessage("access denied by provider")).toContain("denied");
  });

  test("429 → rate limited", () => {
    expect(friendlyErrorMessage("HTTP 429 Too Many Requests")).toContain("rate-limited");
  });

  test("rate limit keyword → rate limited", () => {
    expect(friendlyErrorMessage("rate limit exceeded")).toContain("rate-limited");
  });

  test("502 → provider unavailable", () => {
    expect(friendlyErrorMessage("HTTP 502 Bad Gateway")).toContain("unavailable");
  });

  test("503 → provider unavailable", () => {
    expect(friendlyErrorMessage("HTTP 503 Service Unavailable")).toContain("unavailable");
  });

  test("504 → provider unavailable", () => {
    expect(friendlyErrorMessage("HTTP 504 Gateway Timeout")).toContain("unavailable");
  });

  test("404 → model not found", () => {
    expect(friendlyErrorMessage("HTTP 404 Not Found")).toContain("not found");
  });

  test("not found keyword → model not found", () => {
    expect(friendlyErrorMessage("model not found on provider")).toContain("not found");
  });

  test("timeout → request timed out", () => {
    expect(friendlyErrorMessage("request timeout after 30s")).toContain("timed out");
  });

  test("empty → empty response", () => {
    expect(friendlyErrorMessage("LLM returned an empty response")).toContain("empty response");
  });

  test("network → connection error", () => {
    expect(friendlyErrorMessage("network error: fetch failed")).toContain("connect");
  });

  test("fetch keyword → connection error", () => {
    expect(friendlyErrorMessage("fetch failed")).toContain("connect");
  });

  test("llm_api_key → configuration incomplete", () => {
    expect(friendlyErrorMessage("LLM_API_KEY is missing")).toContain("configuration is incomplete");
  });

  test("openrouter keyword → configuration incomplete", () => {
    // "openrouter" without auth/rate-limit keywords triggers config message
    expect(friendlyErrorMessage("openrouter connection refused")).toContain("configuration is incomplete");
  });

  // --- Default fallback ---

  test("unknown error → generic unavailable message", () => {
    expect(friendlyErrorMessage("something completely unexpected")).toContain("unavailable");
  });

  // --- Case insensitivity ---

  test("case insensitive matching", () => {
    expect(friendlyErrorMessage("TIMEOUT error")).toContain("timed out");
    expect(friendlyErrorMessage("RATE LIMIT exceeded")).toContain("rate-limited");
    expect(friendlyErrorMessage("NETWORK failure")).toContain("connect");
  });

  // --- Priority order (first match wins) ---

  test("401 takes priority over generic 'error' in the message", () => {
    // "error" matches nothing specific, "401" matches auth
    const result = friendlyErrorMessage("401 error from provider");
    expect(result).toContain("authentication");
  });
});
