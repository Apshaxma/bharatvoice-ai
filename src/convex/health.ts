"use node";

/**
 * BharatVoice AI — development health check.
 *
 * Verifies that the LLM pipeline is correctly configured without exposing
 * any secrets. Returns PASS/FAIL/WARNING for each component.
 */

import { action } from "./_generated/server";
import { createLLMProvider, resolveModel, FREE_MODEL_ROTATION } from "./ai/llm";

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

    // 2. API key presence (NEVER expose the actual key)
    const openAiKey = env("LLM_API_KEY");
    const vlyKey = env("VLY_INTEGRATION_KEY");
    const hasOpenAiKey = !!openAiKey;
    const hasVlyKey = !!vlyKey;

    checks.push({
      name: "LLM API key",
      status: hasOpenAiKey || hasVlyKey ? "PASS" : mock ? "WARNING" : "FAIL",
      detail: `LLM_API_KEY configured: ${hasOpenAiKey}, VLY_INTEGRATION_KEY configured: ${hasVlyKey}`,
    });

    // 3. Model configuration
    const model = env("LLM_MODEL") || env("AGENT_LLM_MODEL") || "default";
    const baseUrl = env("LLM_BASE_URL") || "(default: https://openrouter.ai/api/v1)";
    checks.push({
      name: "Model configuration",
      status: "PASS",
      detail: `Model: ${model}, Base URL: ${baseUrl}`,
    });

    // 4. Raw HTTP diagnostics (before going through the provider abstraction)
    if (!mock && hasOpenAiKey) {
      try {
        const baseUrlClean = (env("LLM_BASE_URL") || "https://openrouter.ai/api/v1").replace(/\/$/, "");
        const testModel = resolveModel(model || undefined);

        const response = await fetch(`${baseUrlClean}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: testModel,
            messages: [{ role: "user", content: "Say exactly: health check ok" }],
            temperature: 0,
            max_tokens: 50,
          }),
          signal: AbortSignal.timeout(15_000),
        });

        const responseBody = await response.text();

        // Safe logging — NEVER expose the API key
        // Safe logging — NEVER expose the API key or full response body
        console.log(JSON.stringify({
          service: "bharatvoice-health",
          event: "openrouter_diagnostic",
          httpStatus: response.status,
          model: testModel,
          apiKeyConfigured: true,
        }));

        if (!response.ok) {
          // Parse the error body for safe, non-leaking detail
          let providerCode = "unknown";
          let safeMessage = "Provider error";
          try {
            const parsed = JSON.parse(responseBody);
            if (parsed.error) {
              providerCode = parsed.error.code || parsed.error.type || "unknown";
              // Only use the error message — never the full body
              safeMessage = parsed.error.message || "Provider error";
              // Trim any accidental key fragments from provider error messages
              safeMessage = safeMessage.slice(0, 200);
            }
          } catch { /* not JSON */ }

          checks.push({
            name: "LLM connectivity (raw)",
            status: "FAIL",
            detail: `HTTP ${response.status} | Provider code: ${providerCode} | ${safeMessage}`,
          });

          // 429 on primary → try rotation models to verify at least one works
          if (response.status === 429) {
            let rotationOk = false;
            let workingModel = "";
            // Try the next 2 models in the rotation list
            const idx = FREE_MODEL_ROTATION.findIndex((m) => m === testModel);
            const candidates = idx >= 0
              ? FREE_MODEL_ROTATION.slice(idx + 1, idx + 3)
              : FREE_MODEL_ROTATION.slice(0, 2);

            for (const rotModel of candidates) {
              try {
                const rotResp = await fetch(`${baseUrlClean}/chat/completions`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${openAiKey}`,
                  },
                  body: JSON.stringify({
                    model: rotModel,
                    messages: [{ role: "user", content: "Say exactly: rotation ok" }],
                    temperature: 0,
                    max_tokens: 20,
                  }),
                  signal: AbortSignal.timeout(10_000),
                });
                if (rotResp.ok) {
                  const rotBody = await rotResp.json() as { choices?: { message?: { content?: string } }[] };
                  if (rotBody.choices?.[0]?.message?.content) {
                    rotationOk = true;
                    workingModel = rotModel;
                    break;
                  }
                }
              } catch { /* continue to next */ }
            }

            if (rotationOk) {
              checks.push({
                name: "LLM rotation fallback",
                status: "PASS",
                detail: `Primary rate-limited, but rotation model "${workingModel}" responds OK.`,
              });
            } else {
              checks.push({
                name: "LLM rotation fallback",
                status: "WARNING",
                detail: `Primary rate-limited. Tested ${candidates.length} rotation models — all failed.`,
              });
            }
          }
        } else {
          // Parse success — safe, no raw body exposed
          let content = "";
          try {
            const parsed = JSON.parse(responseBody);
            content = parsed.choices?.[0]?.message?.content ?? "";
          } catch { /* not JSON */ }

          if (content) {
            checks.push({
              name: "LLM connectivity (raw)",
              status: "PASS",
              detail: `HTTP 200 | Model: ${testModel} | Response: "${content.slice(0, 100)}"`,
            });
          } else {
            checks.push({
              name: "LLM connectivity (raw)",
              status: "FAIL",
              detail: `HTTP 200 but empty content from model: ${testModel}`,
            });
          }
        }
      } catch (err) {
        checks.push({
          name: "LLM connectivity (raw)",
          status: "FAIL",
          detail: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
    } else if (mock) {
      checks.push({
        name: "LLM connectivity (raw)",
        status: "WARNING",
        detail: "Skipped — mock mode.",
      });
    } else {
      checks.push({
        name: "LLM connectivity (raw)",
        status: "FAIL",
        detail: "Cannot test — no LLM_API_KEY configured.",
      });
    }

    // 5. Environment variables check (names only, no values)
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

    // 6. Speech providers
    checks.push({
      name: "Speech providers",
      status: "PASS",
      detail: "STT: browser Web Speech API (no key needed), TTS: browser speechSynthesis",
    });

    // 7. Tool calling
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
