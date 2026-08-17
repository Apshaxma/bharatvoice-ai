# BharatVoice AI

> A production-oriented multilingual voice agent built for India's languages.

Speak in Hindi, Marathi, Tamil, Telugu, Bengali or English — BharatVoice
**detects the language, transcribes the speech, plans an action, calls real
tools** (live weather, gated cab bookings), **answers in your language** and
**speaks the answer back**, while logging every stage and scoring its own
performance.

Built to demonstrate production AI-agent engineering: provider abstraction,
retries and backoff, deterministic offline mocks, human-in-the-loop safety,
per-run observability, and runtime self-evaluation.

## The 15-point pipeline

Every turn runs: **listen → detect language → transcribe → understand intent →
maintain conversation memory → decide tools → call tools (gated by approval
policy) → generate answer → translate/answer in the user's language → convert
to speech → play it back → self-evaluate → log latency/tools/models → require
human approval for sensitive actions → stay deployable as a real app.**

## Architecture

```
Browser (React 19 + Vite)
  ├─ MediaRecorder (WebM/Opus) ────────────┐
  ├─ speechSynthesis (browser TTS fallback) │
  └─ Assistant UI (chat + pipeline trace)   │
                                           ▼
┌──────────────────────────────────────────────────────┐
│ Convex backend                                        │
│  audio.ts          → storage upload URL               │
│  transcribe.ts     → STT action (Sarvam Saaras | mock)│
│  agent.ts          → runAgent / resumeApproval        │
│  ai/stt.ts         → SpeechToTextProvider abstraction │
│  ai/llm.ts         → LLMProvider (VLY gateway | mock) │
│  ai/tts.ts         → TTSProvider (Sarvam Bulbul)      │
│  tools/*           → registry + weather (Open-Meteo)  │
│  agentDb.ts        → conversations, runs, approvals   │
└──────────────┬───────────────────────────────────────┘
               │
   ┌───────────┼───────────────┐
   ▼           ▼               ▼
 Open-Meteo  VLY AI gateway  Sarvam AI (STT/TTS)
```

### One turn, end to end

1. **Listen** — `MediaRecorder` captures audio; bytes are PUT to Convex storage.
2. **Transcribe** — the `transcribeAudio` action calls Sarvam Saaras (or the
   deterministic mock) with `language_code=unknown`, so one call returns the
   transcript **and** the detected language with confidence. Raw audio is
   deleted immediately — only text + metadata are stored.
3. **Understand** — a *planner* LLM call classifies intent and declares needed
   tools as strict JSON.
4. **Gate** — tool calls are checked against the registry. Safe tools
   (`getWeather`) run; sensitive tools (`bookCab`) become approval requests and
   **never execute without your explicit decision**.
5. **Act** — safe tools run (Open-Meteo geocoding + forecast, with a mock
   fallback so the agent never crashes on network failure).
6. **Answer** — a *responder* LLM call writes 1–3 spoken-friendly sentences in
   the detected language, grounded in tool results.
7. **Speak** — Sarvam Bulbul TTS (or browser `speechSynthesis` when no key is
   set) plays the answer.
8. **Observe** — per-stage latency, intent, tool calls, model usage and a
   self-evaluation score persist to `agentRuns` and surface in the **Insights**
   tab.

## Tech stack

- **Frontend:** React 19 · Vite · TypeScript · Tailwind v4 · shadcn/ui · Framer Motion · Lucide
- **Backend & DB:** Convex (actions, queries, storage, reactive subscriptions)
- **Auth:** Convex Auth (email OTP + anonymous)
- **Speech-to-text:** Sarvam AI `saaras:v3` (22 Indic + English, auto language detection)
- **Text-to-speech:** Sarvam AI `bulbul:v3` → browser synthesis fallback
- **LLM:** VLY AI gateway (OpenAI-compatible, many models behind one key) → deterministic mock fallback
- **Weather:** Open-Meteo (free, no key)
- **Tests:** Bun's built-in runner — `bun test`

## Repository layout

```
src/
  convex/
    ai/          language registry, STT/LLM/TTS provider abstractions (+ mocks)
    tools/       tool registry, weather tool, approval policy
    agent.ts     the agent pipeline (runAgent, resumeApproval)
    agentDb.ts   conversations, messages, runs, metrics, approvals
    transcribe.ts, audio.ts   transcription service + upload URL
    schema.ts    auth tables + product tables
  components/assistant/  Assistant chat · pipeline trace · approvals · history · insights
  pages/         Landing · Auth · Dashboard layout · NotFound
  lib/voice.ts   MediaRecorder capture + browser speech synthesis
tests/           unit + offline eval suite (bun test)
PROJECT_PLAN.md  goals, architecture, risks, testing/eval/deployment strategy
```

## Getting started

```bash
bun install
bun convex dev        # local Convex dev (codegen)
bun dev               # Vite dev server
bun test              # unit + offline eval suite
bun tsc -b --noEmit   # typecheck
```

### Environment variables (set via the platform's Keys UI, never `.env`)

| Variable | Purpose | Required |
|---|---|---|
| `VLY_INTEGRATION_KEY` | LLM gateway token (auto-injected) | auto |
| `SARVAM_API_KEY` | Sarvam speech-to-text **and** text-to-speech | no* |
| `SARVAM_STT_MODEL` | e.g. `saaras:v3` / `saaras:v4` | no |
| `SARVAM_TTS_MODEL` | e.g. `bulbul:v3` | no |
| `SARVAM_TTS_SPEAKER` | e.g. `shubh` | no |
| `AGENT_LLM_MODEL` | e.g. `gpt-5-mini` / `claude-sonnet-4-5` | no |
| `MOCK_MODE` | `true` forces every provider to its mock | no |

\* Without `SARVAM_API_KEY` the app runs fully in **mock mode**: STT returns
realistic sample utterances, the LLM planner/responder are deterministic, and
answers are spoken by the browser. The UI reports the active mode via
`getRuntimeInfo`.

## Human-in-the-loop

Sensitive actions (cab bookings) land in the **Approvals** tab as pending
requests. Approving executes the tool and resumes the turn (the responder
answers grounded in the real result); denying acknowledges the cancellation —
the sensitive tool's result is never fabricated.

## Observability

- Structured JSON log lines per run (`service: bharatvoice-agent` /
  `bharatvoice-transcribe`) with request ids for trace correlation.
- `agentRuns` rows: intent, tool calls, per-stage latency (STT/LLM/tools/TTS),
  providers + models, self-eval score, status (success/error/pending_approval).
- **Insights** tab: success rate, latency breakdown, tool counts, model/intent/
  language distributions, runs-per-day chart, recent-run table.

## Testing & evaluation

`bun test` runs 50 tests across 5 files with zero external dependencies:

- **languages** — registry integrity (23 codes, uniqueness, lookups, labels)
- **stt** — retry/backoff math, mock provider modes, factory rules
- **llm** — JSON extraction, and an **offline eval set**: Hindi/Hinglish/
  Marathi/Tamil/English utterances asserting intent + tool-call accuracy
- **weather** — WMO mapping, deterministic mock fallback
- **tools** — approval policy invariant, booking shape, summaries

Every successful agent turn also scores itself (0–1) on grounding, language
match, conciseness and latency budget. The upgrade path (documented in
`PROJECT_PLAN.md`) is LLM-as-judge and a labelled eval corpus against a live
provider.

## Deployment

The Freebuff Web platform runs the Vite frontend and Convex backend as managed
services; publish through the platform flow. Secrets live in the platform's
Keys UI. No self-hosted servers.

---

Built with React, Convex, Sarvam AI, Open-Meteo and the VLY AI gateway.
