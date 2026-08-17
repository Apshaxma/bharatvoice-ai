import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  Car,
  Check,
  CheckCircle2,
  Clock,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function ApprovalsTab() {
  const pending = useQuery(api.agentDb.listPendingApprovals) ?? [];
  const recent = useQuery(api.agentDb.listRecentApprovals, { limit: 20 }) ?? [];
  const decideApproval = useMutation(api.agentDb.decideApproval);
  const resumeApproval = useAction(api.agent.resumeApproval);
  const [busy, setBusy] = useState<string | null>(null);

  const handleDecision = async (
    approvalId: Id<"approvals">,
    runId: Id<"agentRuns"> | null,
    decision: "approved" | "denied",
  ) => {
    if (busy) return;
    setBusy(approvalId);
    try {
      await decideApproval({ approvalId, decision });
      if (runId) {
        await resumeApproval({ runId, approvalIds: [approvalId] });
      }
      toast.success(
        decision === "approved"
          ? "Approved — the action was executed and the answer is ready."
          : "Denied — the action was skipped.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Human-in-the-loop
        </h1>
        <p className="text-sm text-muted-foreground">
          Sensitive tool calls never execute on their own — you approve or deny
          each one.
        </p>
      </div>

      {/* Pending queue */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldAlert className="size-3.5 text-amber-500" />
          Awaiting your decision
          {pending.length > 0 && (
            <Badge className="bg-saffron px-1.5 text-[10px] text-white">
              {pending.length}
            </Badge>
          )}
        </h2>

        {pending.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-2 border-dashed border-border/80 py-10 text-center shadow-none">
            <ShieldCheck className="size-7 text-leaf" />
            <p className="text-sm text-muted-foreground">
              Nothing pending. Ask the assistant to “book a cab” to see this
              queue in action.
            </p>
          </Card>
        ) : (
          pending.map((approval) => (
            <Card
              key={approval._id}
              className="border-amber-500/25 bg-amber-500/[0.04] p-4 shadow-none"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
                    {approval.toolName === "bookCab" ? (
                      <Car className="size-5" />
                    ) : (
                      <WrenchFallback />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {approval.summary}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
                      >
                        {approval.toolName}
                      </Badge>
                      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
                        <Clock className="size-3" />
                        {formatDistanceToNow(approval._creationTime, {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-background/70 p-2 font-mono text-[10.5px] leading-4 text-muted-foreground">
                      {JSON.stringify(approval.args, null, 2)}
                    </pre>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    className="gap-1.5 text-xs text-destructive hover:text-destructive"
                    onClick={() =>
                      handleDecision(
                        approval._id,
                        approval.runId ?? null,
                        "denied",
                      )
                    }
                  >
                    <X className="size-3.5" />
                    Deny
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    className="gap-1.5 text-xs"
                    onClick={() =>
                      handleDecision(
                        approval._id,
                        approval.runId ?? null,
                        "approved",
                      )
                    }
                  >
                    {busy === approval._id ? (
                      <Clock className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    Approve
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </section>

      {/* Recent decisions */}
      <section className="space-y-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recent decisions
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {recent.map((approval) => (
              <Card
                key={approval._id}
                className="flex items-center gap-3 border-border/70 p-3 shadow-none"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    approval.status === "approved"
                      ? "bg-leaf/15 text-leaf"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {approval.status === "approved" ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <X className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground/85">
                    {approval.summary}
                  </p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {approval.status} ·{" "}
                    {approval.decidedAt
                      ? formatDistanceToNow(approval.decidedAt, {
                          addSuffix: true,
                        })
                      : "recently"}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WrenchFallback() {
  return <ShieldAlert className="size-5" />;
}
