import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight,
  MessageSquareText,
  Mic,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export default function HistoryTab() {
  const conversations = useQuery(api.agentDb.listConversations) ?? [];
  const deleteConversation = useMutation(api.agentDb.deleteConversation);
  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<Id<"conversations"> | null>(
    null,
  );

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteConversation({ conversationId: pendingDelete });
      toast.success("Conversation deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Conversation history
        </h1>
        <p className="text-sm text-muted-foreground">
          Every session is remembered — the agent carries context across turns.
        </p>
      </div>

      {conversations.length === 0 ? (
        <Card className="flex flex-1 flex-col items-center justify-center gap-3 border-dashed border-border/80 bg-transparent py-16 text-center shadow-none">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <MessageSquareText className="size-5 text-muted-foreground" />
          </div>
          <p className="max-w-xs text-sm text-muted-foreground">
            No conversations yet. Head to the Assistant and say
            <span className="font-medium text-foreground"> namaste</span> in any
            language.
          </p>
          <Button
            size="sm"
            className="mt-1 gap-1.5"
            onClick={() => navigate("/dashboard")}
          >
            <Mic className="size-3.5" />
            Start talking
          </Button>
        </Card>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {conversations.map((conv, i) => (
            <Card
              key={conv._id}
              className="group flex cursor-pointer items-center gap-3 border-border/70 p-4 shadow-none transition-colors hover:border-saffron/50 hover:bg-saffron/5"
              onClick={() => navigate(`/dashboard?conversation=${conv._id}`)}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-saffron/10 text-saffron">
                {conv.source === "voice" ? (
                  <Mic className="size-4" />
                ) : (
                  <MessageSquareText className="size-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {conv.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {conv.messageCount} messages ·{" "}
                  {formatDistanceToNow(conv._creationTime, { addSuffix: true })}
                  {i === 0 ? " · latest" : ""}
                </p>
              </div>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Delete conversation"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(conv._id);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete conversation?</DialogTitle>
            <DialogDescription>
              This permanently removes the conversation and its messages from
              your history. Agent run metrics are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              className={cn("cursor-pointer")}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
