import { api } from "@/convex/_generated/api";
import { LANGUAGES, getLanguageLabel } from "@/convex/ai/languages";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AudioLines,
  Check,
  CornerDownLeft,
  Loader2,
  Mic,
  Plus,
  ShieldAlert,
  Square,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  browserSpeechAvailable,
  browserSpeechRecognitionAvailable,
  isMediaRecorderSupported,
  speakText,
  startListeningSession,
  startRecordingSession,
  stopSpeaking,
  type ListeningSession,
} from "@/lib/voice";
import { cn } from "@/lib/utils";
import { ToolTrace } from "./ToolTrace";

const SUGGESTIONS = [
  {
    text: "कल मुंबई से पुणे जाना है। मौसम कैसा रहेगा?",
    hint: "Weather · Hindi",
  },
  {
    text: "उद्या मुंबईमध्ये पाऊस पडेल का?",
    hint: "Weather · Marathi",
  },
  {
    text: "Will it rain in Chennai tomorrow?",
    hint: "Weather · English",
  },
  {
    text: "मला मुंबई ते पुणे प्रवासासाठी कॅब बुक करायची आहे",
    hint: "Cab booking · Marathi (needs approval)",
  },
];

const PIPELINE_STAGES = [
  { key: "transcribing", label: "Listen" },
  { key: "planning", label: "Understand" },
  { key: "acting", label: "Act" },
  { key: "answering", label: "Answer" },
  { key: "speaking", label: "Speak" },
] as const;

type StageKey = (typeof PIPELINE_STAGES)[number]["key"];

export default function AssistantTab() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const paramConv = searchParams.get("conversation");
  const [activeConvId, setActiveConvId] = useState<string | null>(
    paramConv ?? null,
  );

  const conversations = useQuery(api.agentDb.listConversations) ?? [];
  const messages = useQuery(
    api.agentDb.listMessages,
    activeConvId ? { conversationId: activeConvId as Id<"conversations"> } : "skip",
  );

  const runAgent = useAction(api.agent.runAgent);
  const generateUploadUrl = useMutation(api.audio.generateUploadUrl);
  const transcribeAudio = useAction(api.transcribe.transcribeAudio);

  const [input, setInput] = useState("");
  const [language, setLanguage] = useState<string>("auto");
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stage, setStage] = useState<StageKey>("planning");
  const [lastResponse, setLastResponse] = useState<
    Awaited<ReturnType<typeof runAgent>> | null
  >(null);

  // Clear the last trace when the conversation changes (via History links or
  // the switcher) so it never shows under the wrong conversation.
  useEffect(() => {
    setActiveConvId(paramConv);
    setLastResponse(null);
  }, [paramConv]);

  const recorderRef = useRef<Awaited<ReturnType<typeof startRecordingSession>> | null>(
    null,
  );
  const listeningRef = useRef<ListeningSession | null>(null);
  const listeningStartedAtRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isProcessing]);

  const activeConversation = conversations.find(
    (c) => c._id === activeConvId,
  );

  // ------------------------------------------------------------------
  // Send a turn through the agent pipeline
  // ------------------------------------------------------------------
  const sendTurn = async (
    text: string,
    source: "voice" | "text",
    meta?: { sttLatencyMs?: number; languageProbability?: number },
  ) => {
    const trimmed = text.trim();
    if (!trimmed || processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    setLastResponse(null);
    setStage(source === "voice" ? "planning" : "planning");
    try {
      const res = await runAgent({
        text: trimmed,
        languageCode:
          language !== "auto" && language !== "detected"
            ? language
            : undefined,
        conversationId: activeConvId
          ? (activeConvId as Id<"conversations">)
          : undefined,
        source,
        sttLatencyMs: meta?.sttLatencyMs,
        languageProbability: meta?.languageProbability,
      });

      if (activeConvId === null) setActiveConvId(res.conversationId);
      setLastResponse(res);

      // Show user-friendly error if the LLM failed
      if (res.status === "error" && res.errorMessage) {
        toast.error(res.errorMessage, {
          duration: 8000,
          action: {
            label: "Retry",
            onClick: () => {
              void sendTurn(trimmed, source, meta);
            },
          },
        });
      }

      if (res.status !== "error") {
        setStage("speaking");
      }

      if (res.audioUrl) {
        const audio = new Audio(res.audioUrl);
        audio.play().catch(() => {
          speakText(res.responseText, res.responseLanguage);
        });
      } else if (res.responseText && browserSpeechAvailable()) {
        speakText(res.responseText, res.responseLanguage);
      }

      if (res.status === "pending_approval") {
        toast("Approval required", {
          description:
            "The agent wants to book a cab. Review it in the Approvals tab.",
          action: {
            label: "Open approvals",
            onClick: () => navigate("/dashboard/approvals"),
          },
        });
      }
    } catch (err) {
      console.error("Agent run failed:", err);
      // Map common Convex/server errors to friendly messages
      const raw = err instanceof Error ? err.message : String(err);
      let friendly = "Something went wrong. Please try again.";
      if (raw.includes("401") || raw.includes("authentication"))
        friendly = "AI authentication failed. Check the API key.";
      else if (raw.includes("429") || raw.includes("rate limit"))
        friendly = "AI is temporarily rate-limited. Please try again.";
      else if (raw.includes("502") || raw.includes("503") || raw.includes("504"))
        friendly = "AI provider is temporarily unavailable. Please try again.";
      else if (raw.includes("timeout"))
        friendly = "AI request timed out. Please try again.";
      else if (raw.includes("network") || raw.includes("fetch"))
        friendly = "Unable to connect to the AI service.";
      toast.error(friendly, {
        duration: 8000,
        action: {
          label: "Retry",
          onClick: () => {
            // Re-send the last message
            void sendTurn(trimmed, source, meta);
          },
        },
      });
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
      setStage("planning");
    }
  };

  const handleSend = () => {
    const text = input;
    setInput("");
    void sendTurn(text, "text");
  };

  // ------------------------------------------------------------------
  // Voice recording → upload → STT → agent
  // ------------------------------------------------------------------
  const toggleRecording = async () => {
    if (isRecording) {
      stopSpeaking();
      // Stop whichever capture mode is active. For live recognition, stop()
      // delivers the best transcript so far via onFinal → sendTurn.
      if (listeningRef.current) {
        const session = listeningRef.current;
        listeningRef.current = null;
        listeningStartedAtRef.current = null;
        setIsRecording(false);
        session.stop();
        return;
      }
      const session = recorderRef.current;
      recorderRef.current = null;
      setIsRecording(false);
      if (!session) return;
      setStage("transcribing");
      try {
        const { blob, mimeType, durationMs } = await session.stop();
        const uploadUrl = await generateUploadUrl();
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: blob,
        });
        if (!put.ok) throw new Error("Audio upload failed");
        const storageId = uploadUrl.split("/").pop()?.split("?")[0];
        if (!storageId) throw new Error("Upload failed");

        const stt = await transcribeAudio({
          storageId: storageId as Id<"_storage">,
          mimeType,
          languageCode:
            language !== "auto" && language !== "detected"
              ? language
              : undefined,
          mode: "transcribe",
          audioDurationMs: durationMs,
          recordedAt: Date.now(),
        });

        if (!stt.ok || !stt.transcript) {
          toast.error(stt.errorMessage ?? "Could not understand the audio.");
          setStage("planning");
          return;
        }
        await sendTurn(stt.transcript, "voice", {
          sttLatencyMs: stt.sttLatencyMs,
          languageProbability: stt.languageProbability ?? undefined,
        });
      } catch (err) {
        console.error("Recording flow failed:", err);
        toast.error(
          err instanceof Error ? err.message : "Recording failed. Try again.",
        );
        setStage("planning");
      }
    } else {
      // Preferred path: live Web Speech API recognition — no uploads, no keys.
      if (browserSpeechRecognitionAvailable()) {
        const startedAt = Date.now();
        try {
          const session = startListeningSession({
            languageCode:
              language !== "auto" && language !== "detected"
                ? language
                : "hi-IN",
            onInterim: (text) => setInput(text),
            onFinal: (text) => {
              listeningRef.current = null;
              listeningStartedAtRef.current = null;
              setIsRecording(false);
              if (!text) {
                setInput("");
                toast.info("No speech detected. Try again.");
                return;
              }
              setInput(text);
              void sendTurn(text, "voice", {
                sttLatencyMs: Date.now() - startedAt,
              });
            },
            onError: (message) => {
              listeningRef.current = null;
              listeningStartedAtRef.current = null;
              setIsRecording(false);
              toast.error(message);
            },
          });
          listeningRef.current = session;
          listeningStartedAtRef.current = startedAt;
          setIsRecording(true);
          setInput("");
          setStage("transcribing");
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : "Speech recognition failed. Type your question instead.",
          );
        }
        return;
      }

      // Fallback: record audio → upload → backend (mock) STT.
      if (!isMediaRecorderSupported()) {
        toast.error(
          "This browser does not support speech recognition or audio recording. Type instead.",
        );
        return;
      }
      try {
        const session = await startRecordingSession();
        recorderRef.current = session;
        setIsRecording(true);
      } catch {
        toast.error(
          "Microphone access denied. Allow the mic, or type your question instead.",
        );
      }
    }
  };

  const stageIndex = PIPELINE_STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Voice Assistant
          </h1>
          <p className="text-sm text-muted-foreground">
            Speak in any Indian language — the agent listens, understands, acts
            and answers back in your language.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="h-9 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">🌐 Auto-detect</SelectItem>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.nativeName} · {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              setActiveConvId(null);
              setLastResponse(null);
            }}
          >
            <Plus className="size-3.5" />
            New chat
          </Button>
        </div>
      </div>

      {/* Conversation switcher */}
      {conversations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Conversation
          </span>
          <select
            value={activeConvId ?? ""}
            onChange={(e) => {
              setActiveConvId(e.target.value || null);
              setLastResponse(null);
            }}
            className="h-8 max-w-56 cursor-pointer rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none"
          >
            <option value="">New conversation</option>
            {conversations.map((c) => (
              <option key={c._id} value={c._id}>
                {c.title.slice(0, 42)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Messages */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/70 bg-card/60 shadow-none">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {messages && messages.length === 0 && !isProcessing && !lastResponse && (
            <EmptyState
              onPick={(text) => {
                setInput(text);
                void sendTurn(text, "text");
              }}
            />
          )}

          {messages?.map((message) => (
            <MessageBubble key={message._id} message={message} />
          ))}

          {isProcessing && (
            <div className="flex items-end gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-saffron text-white">
                <AudioLines className="size-4" />
              </div>
              <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-border/70 bg-card px-4 py-3">
                <PipelineProgress stageIndex={stageIndex} />
              </div>
            </div>
          )}

          {lastResponse && !isProcessing && (
            <div className="flex items-end gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-saffron text-white">
                <AudioLines className="size-4" />
              </div>
              <div className="min-w-0 max-w-[85%]">
                <div className="rounded-2xl rounded-bl-md border border-border/70 bg-card px-4 py-3 text-sm leading-6 text-foreground/90">
                  {lastResponse.responseText ||
                    lastResponse.errorMessage ||
                    "I couldn't generate a response. Please try again."}
                  {lastResponse.status === "pending_approval" && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700">
                      <ShieldAlert className="size-3.5 shrink-0" />
                      Awaiting your approval for a sensitive action — see the
                      Approvals tab.
                    </div>
                  )}
                </div>
                {lastResponse.toolCalls.length > 0 && (
                  <ToolTrace response={lastResponse} />
                )}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className="border-t border-border/70 bg-background/40 p-3 sm:p-4">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                isRecording
                  ? "Listening… speak now"
                  : 'Type in Hinglish, Hindi, Marathi, Tamil… or press the mic'
              }
              disabled={isProcessing || isRecording}
              className="min-h-14 max-h-40 resize-none rounded-2xl border-border/80 bg-background px-4 py-3.5 text-sm shadow-sm placeholder:text-muted-foreground/60 focus-visible:border-saffron/50 focus-visible:ring-saffron/20"
              rows={1}
            />
            <Button
              type="button"
              size="icon"
              variant={isRecording ? "destructive" : "default"}
              disabled={isProcessing}
              onClick={toggleRecording}
              className={cn(
                "size-11 shrink-0",
                isRecording && "animate-bv-pulse-ring",
              )}
              aria-label={isRecording ? "Stop recording" : "Record voice"}
            >
              {isRecording ? (
                <Square className="size-4 fill-current" />
              ) : (
                <Mic className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              className="size-11 shrink-0"
              disabled={!input.trim() || isProcessing || isRecording}
              onClick={handleSend}
              aria-label="Send"
            >
              {isProcessing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CornerDownLeft className="size-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Mic className="size-3" />
            {isRecording
              ? "Listening — tap the square to stop and send."
              : "Live transcription in your browser — no audio leaves your device."}
          </p>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 py-10 text-center">
      <div className="relative">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-saffron text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.15)]">
          <Mic className="size-7" />
        </div>
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-marigold text-[9px] font-bold text-ink">
          23
        </span>
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          Speak your language. We&apos;ll speak it back.
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Try a weather question in Hindi, Marathi or Tamil — the agent detects
          the language, fetches live weather and replies out loud.
        </p>
      </div>
      <div className="flex max-w-lg flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            type="button"
            onClick={() => onPick(s.text)}
            className="group rounded-full border border-border/80 bg-background px-3 py-1.5 text-left text-xs text-foreground/80 transition-colors hover:border-saffron/50 hover:bg-saffron/5"
          >
            {s.text.slice(0, 46)}
            <span className="ml-1.5 text-[10px] font-medium text-saffron">
              {s.hint}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
}: {
  message: {
    _id: string;
    role: "user" | "assistant" | "tool";
    content: string;
    languageCode?: string | null;
    toolCalls?: unknown[];
  };
}) {
  const isUser = message.role === "user";
  const toolCount = Array.isArray(message.toolCalls)
    ? message.toolCalls.length
    : 0;

  return (
    <div className={cn("flex items-end gap-2", isUser && "justify-end")}>
      {!isUser && (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-saffron text-white">
          <AudioLines className="size-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6",
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md border border-border/70 bg-card text-foreground/90",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <div className="mt-1.5 flex items-center gap-2">
          {message.languageCode && (
            <Badge
              variant="outline"
              className="px-1.5 py-0 text-[9.5px] font-medium text-muted-foreground"
            >
              {getLanguageLabel(message.languageCode)}
            </Badge>
          )}
          {!isUser && toolCount > 0 && (
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[9.5px] font-medium text-muted-foreground"
            >
              <Check className="size-2.5" />
              {toolCount} tool{toolCount > 1 ? "s" : ""}
            </Badge>
          )}
          {!isUser && browserSpeechAvailable() && (
            <button
              type="button"
              className="flex items-center gap-1 text-[10px] font-medium text-saffron transition-opacity hover:opacity-70"
              onClick={() =>
                speakText(message.content, message.languageCode ?? null)
              }
            >
              <Volume2 className="size-3" />
              Listen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineProgress({ stageIndex }: { stageIndex: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin text-saffron" />
        <span className="text-xs font-medium text-foreground/80">
          {PIPELINE_STAGES[stageIndex]?.label ?? "Working"}…
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {PIPELINE_STAGES.map((s, i) => {
          const done = i < stageIndex;
          const current = i === stageIndex;
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  done && "bg-leaf/15 text-leaf",
                  current && "bg-saffron/15 text-saffron",
                  !done && !current && "bg-muted text-muted-foreground/60",
                )}
              >
                {done && <Check className="size-2.5" />}
                {s.label}
              </span>
              {i < PIPELINE_STAGES.length - 1 && (
                <span className="h-px w-2 bg-border" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
