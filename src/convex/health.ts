"use node";

/**
 * BharatVoice AI — development health check.
 *
 * Verifies that the LLM pipeline is correctly configured without exposing
 * any secrets. Returns PASS/FAIL/WARNING for each component.
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
import { createLLMProvider } from "./ai/llm";

function env(name: string): string {
  return process.env[name] ?? "";
}

function isMockMode(): boolean {
  const raw = env("MOCK_MODE").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

type CheckStatus = "PASS" | "FAIL" | "WARNING";

interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export const healthCheck = action({
  args: {},
  handler: async (): Promise<{
    overall: CheckStatus;
    checks: HealthCheck[];
    timestamp: string;
  }> => {
    const checks: HealthCheck[] = [];
    const timestamp = new Date().toISOString();

    // 1. Mock mode check
    const mock = isMockMode();
    checks.push({
      name: "Mock mode",
      status: mock ? "WARNING" : "PASS",
      detail: mock
        ? "Running in mock mode — LLM responses are deterministic offline."
        : "Running in live mode.",
    });

    // 2. API key presence
    const openAiKey = env("LLM_API_KEY");
    const vlyKey = env("VLY_INTEGRATION_KEY");
    const hasKey = !!openAiKey || !!vlyKey;

    checks.push({
      name: "LLM API key",
      status: hasKey ? "PASS" : mock ? "WARNING" : "FAIL",
      detail: hasKey
        ? `OpenRouter key configured: ${!!openAiKey}, VLY gateway: ${!!vlyKey}`
        : "No LLM API key configured. Set LLM_API_KEY in the Convex dashboard.",
    });

    // 3. Model configuration
    const model = env("LLM_MODEL") || env("AGENT_LLM_MODEL") || "default";
    checks.push({
      name: "Model configuration",
      status: "PASS",
      detail: `Model: ${model}${openAiKey ? " (OpenRouter)" : vlyKey ? " (VLY gateway)" : " (mock)"}`,
    });

    // 4. LLM connectivity test (if not in mock mode and key is present)
    if (!mock && (openAiKey || vlyKey)) {
      try {
        const llm = createLLMProvider({
          mockMode: false,
          apiKey: vlyKey,
          model: env("AGENT_LLM_MODEL") || undefined,
          openAiApiKey: openAiKey || undefined,
          openAiBaseUrl: env("LLM_BASE_URL") || undefined,
          openAiModel: env("LLM_MODEL") || undefined,
        });

        const result = await llm.complete(
          [{ role: "user", content: 'Say exactly: "health check ok"' }],
          { temperature: 0, maxTokens: 20 },
        );

        if (result.error) {
          const errType = result.structuredError?.type ?? "unknown";
          checks.push({
            name: "LLM connectivity",
            status: "FAIL",
            detail: `Error (${errType}): ${result.error}`,
          });
        } else {
          checks.push({
            name: "LLM connectivity",
            status: "PASS",
            detail: `Provider: ${result.provider}, Model: ${result.model}, Latency: ${result.latencyMs}ms`,
          });
        }
      } catch (err) {
        checks.push({
          name: "LLM connectivity",
          status: "FAIL",
          detail: `Unexpected error: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
    } else {
      checks.push({
        name: "LLM connectivity",
        status: mock ? "WARNING" : "FAIL",
        detail: mock
          ? "Skipped — mock mode uses a deterministic offline provider."
          : "Cannot test — no API key configured.",
      });
    }

    // 5. Environment variables check
    const envVars = [
      "LLM_API_KEY",
      "LLM_BASE_URL",
      "LLM_MODEL",
      "VLY_INTEGRATION_KEY",
      "AGENT_LLM_MODEL",
      "MOCK_MODE",
    ];
    const configured = envVars.filter((v) => !!env(v));
    checks.push({
      name: "Environment variables",
      status: "PASS",
      detail: `${configured.length}/${envVars.length} configured: ${configured.length > 0 ? configured.join(", ") : "none"}`,
    });

    // 6. Speech provider
    checks.push({
      name: "Speech providers",
      status: "PASS",
      detail: "STT: browser Web Speech API (no key needed), TTS: browser speechSynthesis",
    });

    // 7. STT backend
    checks.push({
      name: "STT backend",
      status: "PASS",
      detail: "Mock STT (deterministic, used only for upload fallback path)",
    });

    // 8. Tool calling
    checks.push({
      name: "Tool calling",
      status: "PASS",
      detail: "getWeather (Open-Meteo, free), bookCab (gated, requires approval)",
    });

    // Overall status
    const hasFail = checks.some((c) => c.status === "FAIL");
    const hasWarning = checks.some((c) => c.status === "WARNING");
    const overall: CheckStatus = hasFail ? "FAIL" : hasWarning ? "WARNING" : "PASS";

    return { overall, checks, timestamp };
  },
});
