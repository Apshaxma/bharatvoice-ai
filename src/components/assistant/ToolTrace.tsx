import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
  AudioLines,
  Bot,
  CheckCircle2,
  Clock,
  CloudSun,
  Loader2,
  Mic,
  ShieldAlert,
  Sparkles,
  Volume2,
} from "lucide-react";
import { getLanguageLabel } from "@/convex/ai/languages";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AgentResponse = FunctionReturnType<typeof api.agent.runAgent>;

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function resultSummary(
  name: string,
  result: Record<string, unknown> | null,
): string | null {
  if (!result) return null;
  if (name === "getWeather") {
    const city = result.city;
    const tMax = result.temperatureMax;
    const tMin = result.temperatureMin;
    const precip = result.precipitationProbability;
    if (city != null && tMax != null) {
      return `${city} · ${tMax}°C / ${tMin}°C · ${precip}% rain`;
    }
  }
  if (name === "bookCab") {
    const bookingId = result.bookingId;
    const fare = result.fareInr;
    if (bookingId != null) {
      return `${bookingId} · ₹${fare} · ETA ${result.etaMinutes} min`;
    }
  }
  if (result.error) return String(result.error);
  return JSON.stringify(result).slice(0, 120);
}

function intentLabel(intent: string | null): string {
  if (!intent) return "general";
  const map: Record<string, string> = {
    weather_query: "weather query",
    book_cab: "cab booking",
    general_chat: "general chat",
  };
  return map[intent] ?? intent;
}

/**
 * The observable trace of one agent turn: STT → planner → tools → responder →
 * TTS, with per-stage latency and the self-evaluation score. Rendered after
 * each completed run in the Assistant tab.
 */
export function ToolTrace({ response }: { response: AgentResponse }) {
  const steps: {
    icon: typeof Mic;
    label: string;
    value: string;
    ms: number | null;
    tone?: "ok" | "warn";
  }[] = [];

  if (response.sttLatencyMs != null) {
    steps.push({
      icon: Mic,
      label: "Speech-to-text",
      value: response.detectedLanguage
        ? getLanguageLabel(response.detectedLanguage)
        : "transcribed",
      ms: response.sttLatencyMs,
    });
  }

  steps.push({
    icon: Sparkles,
    label: "Intent",
    value: intentLabel(response.intent),
    ms: response.llmLatencyMs,
  });

  if (response.toolCalls.length > 0) {
    response.toolCalls.forEach((call) => {
      const pending = call.status === "pending";
      const summary = resultSummary(call.name, call.result);
      steps.push({
        icon: pending ? ShieldAlert : call.name === "getWeather" ? CloudSun : Bot,
        label: pending ? `${call.name} (needs approval)` : call.name,
        value: summary ?? (pending ? "queued for approval" : "done"),
        ms: call.latencyMs,
        tone: pending ? "warn" : "ok",
      });
    });
  }

  steps.push({
    icon: AudioLines,
    label: "Response",
    value: response.responseLanguage
      ? getLanguageLabel(response.responseLanguage)
      : "generated",
    ms: null,
  });

  steps.push({
    icon: Volume2,
    label: "Speech",
    value: response.ttsProvider === "browser" ? "browser TTS" : response.ttsProvider,
    ms: response.ttsLatencyMs,
  });

  return (
    <div className="mt-3 rounded-xl border border-border/80 bg-muted/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Loader2 className="size-3" />
          Pipeline trace
        </span>
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className="gap-1 border-border/70 bg-background/60 px-2 py-0 text-[10px] font-medium"
          >
            <CheckCircle2 className="size-3 text-leaf" />
            self-eval {response.evalScore.toFixed(2)}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1 border-border/70 bg-background/60 px-2 py-0 text-[10px] font-medium"
          >
            <Clock className="size-3" />
            total {formatMs(response.totalLatencyMs)}
          </Badge>
        </div>
      </div>

      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li
            key={i}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs hover:bg-background/60"
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md",
                step.tone === "warn"
                  ? "bg-amber-500/15 text-amber-600"
                  : "bg-saffron/12 text-saffron",
              )}
            >
              <step.icon className="size-3.5" />
            </span>
            <span className="w-28 shrink-0 font-medium text-foreground/90">
              {step.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {step.value}
            </span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {formatMs(step.ms)}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-2 border-t border-border/60 pt-2 text-[10.5px] leading-4 text-muted-foreground/80">
        {response.llmProvider} · {response.llmModel}
        {response.toolLatencyMs > 0 && ` · tools ${formatMs(response.toolLatencyMs)}`}
      </p>
    </div>
  );
}
