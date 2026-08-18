import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  AudioLines,
  BarChart3,
  CheckCircle2,
  Clock,
  Gauge,
  Loader2,
  Mic,
  ShieldAlert,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getLanguageLabel } from "@/convex/ai/languages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export default function InsightsTab() {
  const metrics = useQuery(api.agentDb.metrics);
  const runs = useQuery(api.agentDb.listRuns, { limit: 30 }) ?? [];
  const runJudgeEvaluation = useAction(api.eval.runJudgeEvaluation);
  const [evaluating, setEvaluating] = useState(false);

  const handleJudge = async () => {
    if (evaluating) return;
    setEvaluating(true);
    try {
      const res = await runJudgeEvaluation({ limit: 10 });
      if (res.evaluated === 0) {
        toast.info(res.message ?? "No unscored runs to evaluate.");
      } else {
        toast.success(
          `LLM judge scored ${res.evaluated} run${res.evaluated === 1 ? "" : "s"}`,
          {
            description:
              res.avgScore != null
                ? `Average judge score ${res.avgScore.toFixed(2)} / 1.00`
                : undefined,
          },
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Judge evaluation failed. Try again.",
      );
    } finally {
      setEvaluating(false);
    }
  };

  if (!metrics) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading metrics…
      </div>
    );
  }

  const statCards = [
    {
      label: "Total runs",
      value: String(metrics.totalRuns),
      icon: Activity,
      sub: `${metrics.errorCount} failed · ${metrics.pendingCount} awaiting approval`,
    },
    {
      label: "Success rate",
      value: `${metrics.successRate}%`,
      icon: CheckCircle2,
      sub: "turns completed end-to-end",
    },
    {
      label: "Avg total latency",
      value: formatMs(metrics.avgTotalLatencyMs),
      icon: Clock,
      sub: "STT → plan → act → answer → speak",
    },
    {
      label: "Tool calls",
      value: String(metrics.totalToolCalls),
      icon: Wrench,
      sub: "weather fetches · cab bookings",
    },
    {
      label: "Avg self-eval",
      value: metrics.avgEvalScore.toFixed(2),
      icon: CheckCircle2,
      sub: "instant runtime score (0–1)",
    },
    {
      label: "Avg judge score",
      value: metrics.judgedCount > 0 ? metrics.avgJudgeScore.toFixed(2) : "—",
      icon: Gauge,
      sub:
        metrics.judgedCount > 0
          ? `${metrics.judgedCount} turns · LLM rubric`
          : "run the LLM judge to score turns",
    },
  ];

  const stageCards = [
    { label: "Speech-to-text", ms: metrics.avgSttLatencyMs, icon: Mic },
    { label: "LLM (plan + answer)", ms: metrics.avgLlmLatencyMs, icon: Sparkles },
    { label: "Tools", ms: metrics.avgToolLatencyMs, icon: Wrench },
    { label: "TTS", ms: metrics.avgTtsLatencyMs, icon: AudioLines },
  ];

  const modelEntries = Object.entries(metrics.modelUsage).sort(
    (a, b) => b[1] - a[1],
  );
  const intentEntries = Object.entries(metrics.intentCounts).sort(
    (a, b) => b[1] - a[1],
  );
  const languageEntries = Object.entries(metrics.languageCounts).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Agent observability
          </h1>
          <p className="text-sm text-muted-foreground">
            Latency, failures, tool calls, model usage and LLM-judge scores —
            logged per run, per user.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={evaluating}
          onClick={handleJudge}
          className="gap-1.5 text-xs"
        >
          {evaluating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Gauge className="size-3.5 text-saffron" />
          )}
          {evaluating ? "Judging…" : "Run LLM judge"}
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-6">
        {statCards.map((card) => (
          <Card
            key={card.label}
            className="border-border/70 p-4 shadow-none"
          >
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <card.icon className="size-3.5 text-saffron" />
              <span className="text-[10.5px] font-semibold uppercase tracking-wider">
                {card.label}
              </span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
              {card.value}
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {card.sub}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-2.5 lg:grid-cols-3">
        {/* Latency chart */}
        <Card className="border-border/70 shadow-none lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="size-4 text-saffron" />
              Runs per day (last 14 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {metrics.totalRuns === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No runs yet — say something to the assistant.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.runsByDay} barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(d: string) => d.slice(5)}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    width={28}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                    }}
                  />
                  <Bar dataKey="success" stackId="a" fill="var(--color-leaf)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="error" stackId="a" fill="var(--destructive)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Stage latency */}
        <Card className="border-border/70 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="size-4 text-saffron" />
              Stage latency (avg)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {stageCards.map((stage) => (
              <div key={stage.label} className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <stage.icon className="size-3.5" />
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground/85">
                      {stage.label}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {formatMs(stage.ms)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-saffron"
                      style={{
                        width: `${Math.min(
                          100,
                          (stage.ms / Math.max(metrics.avgTotalLatencyMs, 1)) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Distribution cards */}
      <div className="grid gap-2.5 md:grid-cols-3">
        <DistributionCard
          title="Models used"
          entries={modelEntries}
          empty="No LLM usage yet"
        />
        <DistributionCard
          title="Intents"
          entries={intentEntries.map(([k, v]) => [labelIntent(k), v])}
          empty="No intents yet"
        />
        <DistributionCard
          title="Languages"
          entries={languageEntries.map(([k, v]) => [getLanguageLabel(k), v])}
          empty="No language data yet"
        />
      </div>

      {/* Recent runs table */}
      <Card className="border-border/70 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {runs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No agent runs logged yet.
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b border-border/70 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3 font-semibold">When</th>
                  <th className="pb-2 pr-3 font-semibold">Input</th>
                  <th className="pb-2 pr-3 font-semibold">Intent</th>
                  <th className="pb-2 pr-3 font-semibold">Tools</th>
                  <th className="pb-2 pr-3 font-semibold">Latency</th>
                  <th className="pb-2 pr-3 font-semibold">Self-eval</th>
                  <th className="pb-2 pr-3 font-semibold">Judge</th>
                  <th className="pb-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run._id}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {formatDistanceToNow(run._creationTime, {
                        addSuffix: true,
                      })}
                    </td>
                    <td className="max-w-56 truncate py-2 pr-3 font-medium text-foreground/85">
                      {run.inputType === "voice" && (
                        <Mic className="mr-1 inline size-3 text-saffron" />
                      )}
                      {run.transcript}
                    </td>
                    <td className="py-2 pr-3 capitalize text-muted-foreground">
                      {labelIntent(run.intent ?? null)}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {(run.toolCalls ?? [])
                        .map((t) => (t as { name?: string }).name ?? "?")
                        .join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums text-muted-foreground">
                      {formatMs(run.totalLatencyMs)}
                    </td>
                    <td className="py-2 pr-3 font-mono tabular-nums text-muted-foreground">
                      {run.evalScore != null ? run.evalScore.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {run.judgeStatus === "error" && run.judgeError ? (
                        <Badge
                          variant="destructive"
                          className="px-2 py-0 text-[10px] font-medium"
                        >
                          error
                        </Badge>
                      ) : run.judgeScore != null ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "gap-1 px-2 py-0 text-[10px] font-medium",
                            run.judgeScore >= 0.8 && "border-leaf/40 text-leaf",
                            run.judgeScore >= 0.5 &&
                              run.judgeScore < 0.8 &&
                              "border-amber-500/40 text-amber-600",
                            run.judgeScore < 0.5 &&
                              "border-destructive/40 text-destructive",
                          )}
                        >
                          {run.judgeScore.toFixed(2)}
                        </Badge>
                      ) : (
                        <span className="text-[10.5px] text-muted-foreground">
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "gap-1 px-2 py-0 text-[10px] font-medium",
                          run.status === "success" && "border-leaf/40 text-leaf",
                          run.status === "error" && "border-destructive/40 text-destructive",
                          run.status === "pending_approval" &&
                            "border-amber-500/40 text-amber-600",
                        )}
                      >
                        {run.status === "success" && (
                          <CheckCircle2 className="size-2.5" />
                        )}
                        {run.status === "error" && (
                          <ShieldAlert className="size-2.5" />
                        )}
                        {run.status === "pending_approval" && (
                          <ShieldAlert className="size-2.5" />
                        )}
                        {run.status.replace("_", " ")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function labelIntent(intent: string | null): string {
  const map: Record<string, string> = {
    weather_query: "weather",
    book_cab: "book cab",
    general_chat: "general",
  };
  return intent ? (map[intent] ?? intent) : "—";
}

function DistributionCard({
  title,
  entries,
  empty,
}: {
  title: string;
  entries: [string, number][];
  empty: string;
}) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <Card className="border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            {empty}
          </p>
        ) : (
          entries.slice(0, 6).map(([label, count]) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <span className="w-20 truncate text-muted-foreground">{label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-saffron/80"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
              <span className="w-6 text-right font-mono tabular-nums text-muted-foreground">
                {count}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
