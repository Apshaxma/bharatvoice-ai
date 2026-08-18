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

Every turn is also **scored twice**: instantly by a zero-latency heuristic, and
asynchronously by an **LLM-as-judge** that evaluates the completed turn against
a five-criterion rubric (completeness, grounding, language, conciseness,
latency) without slowing down the conversation.

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
│  transcribe.ts     → STT action (mock; live is browser)│
│  agent.ts          → runAgent / resumeApproval        │
│  ai/stt.ts         → SpeechToTextProvider (mock)      │
│  ai/llm.ts         → LLMProvider (any LLM | mock)     │
│  tools/*           → registry + weather (Open-Meteo)  │
│  agentDb.ts        → conversations, runs, approvals   │
└──────────────┬───────────────────────────────────────┘
               │
   ┌───────────┼───────────────┐
   ▼           ▼               ▼
 Open-Meteo  Your LLM (any   VLY AI gateway
 (no key)    OpenAI-compatible) (auto key)
```

### One turn, end to end

1. **Listen** — the mic is tapped; live speech is recognized in the browser
   via the Web Speech API (no upload, no key). Browsers without it fall back
   to `MediaRecorder` → backend mock STT.
2. **Transcribe** — recognition is browser-native; only text + metadata are
   ever stored. Raw audio never leaves the device.
3. **Understand** — a *planner* LLM call classifies intent and declares needed
   tools as strict JSON.
4. **Gate** — tool calls are checked against the registry. Safe tools
   (`getWeather`) run; sensitive tools (`bookCab`) become approval requests and
   **never execute without your explicit decision**.
5. **Act** — safe tools run (Open-Meteo geocoding + forecast, with a mock
   fallback so the agent never crashes on network failure).
6. **Answer** — a *responder* LLM call writes 1–3 spoken-friendly sentences in
   the detected language, grounded in tool results.
7. **Speak** — the browser's `speechSynthesis` speaks the answer in the
   detected language. No TTS vendor or key.
8. **Observe** — per-stage latency, intent, tool calls, model usage and a
   self-evaluation score persist to `agentRuns` and surface in the **Insights**
   tab.

## Tech stack

- **Frontend:** React 19 · Vite · TypeScript · Tailwind v4 · shadcn/ui · Framer Motion · Lucide
- **Backend & DB:** Convex (actions, queries, storage, reactive subscriptions)
- **Auth:** Convex Auth (email OTP + anonymous)
- **Speech-to-text:** browser Web Speech API (`SpeechRecognition`) → deterministic mock fallback
- **Text-to-speech:** browser `speechSynthesis` (no vendor or key)
- **LLM:** pluggable & vendor-independent — any OpenAI-compatible endpoint, the VLY AI gateway, or the deterministic offline mock
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
| `VLY_INTEGRATION_KEY` | VLY AI gateway token (auto-injected) | auto |
| `AGENT_LLM_MODEL` | Model id on the VLY gateway, e.g. `gpt-5-mini` | no |
| `LLM_API_KEY` | Key for **any** OpenAI-compatible LLM endpoint | no* |
| `LLM_BASE_URL` | OpenAI-compatible base URL (default `https://api.openai.com/v1`) | no |
| `LLM_MODEL` | Model id for the OpenAI-compatible endpoint, e.g. `gpt-4o-mini`, `llama-3.1-8b`, `deepseek-chat` | no |
| `MOCK_MODE` | `true` forces the mock LLM | no |

\* Speech is fully browser-native (Web Speech API recognition + `speechSynthesis`)
— no speech keys are ever needed. With **no LLM keys** the agent runs on the
deterministic offline mock brain; set `LLM_API_KEY` to point at any
OpenAI-compatible model, or use the auto-injected VLY gateway key. An explicit
`LLM_API_KEY` always wins over the gateway.

## LLM-as-judge evaluation

Completed turns are scored by an LLM judge (`src/convex/ai/judge.ts`) that
reads the same rubric as the runtime heuristic and returns a 0–1 score with
per-criterion notes:

- **Manual** — the "Run LLM judge" button on the **Insights** tab scores your
  recent unscored runs immediately.
- **Automatic** — a scheduled job (`crons.ts`) scores unscored runs every 30
  minutes.
- **Resilient** — the judge uses the same `LLMProvider` as the agent (your
  configured LLM live, deterministic mock brain offline). If the judge model fails or
  returns malformed output, it falls back to the shared heuristic scorer
  instead of failing the run.

Judge scores persist on `agentRuns` (`judgeScore`, `judgeCriteria`,
`judgeNotes`, provider/model, latency) and roll up into the Insights
statistics and per-run table.

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

`bun test` runs 59 tests across 6 files with zero external dependencies:

- **languages** — registry integrity (23 codes, uniqueness, lookups, labels)
- **stt** — mock provider modes and factory rules
- **llm** — JSON extraction, and an **offline eval set**: Hindi/Hinglish/
  Marathi/Tamil/English utterances asserting intent + tool-call accuracy
- **weather** — WMO mapping, deterministic mock fallback
- **tools** — approval policy invariant, booking shape, summaries
- **judge** — the LLM-as-judge layer: rubric scoring via the mock brain,
  determinism, and heuristic fallback on judge-model failure

Every successful agent turn also scores itself (0–1) on grounding, language
match, conciseness and latency budget — and the LLM-as-judge layer re-scores
completed turns asynchronously against the same rubric.

## Deployment (Vercel + Convex Cloud)

The app is split into two deployable parts: the **Vite frontend** (static,
Vercel) and the **Convex backend** (functions + database, Convex Cloud).

### Frontend → Vercel

1. Push this repo to GitHub and **Import** it in Vercel. The repo already
   ships `vercel.json` (SPA rewrites, `bun install` / `bun run build`, output
   `dist`), so no project settings are needed.
2. Add the build-time env var in Vercel (**Settings → Environment Variables**):

   | Variable | Value |
   |---|---|
   | `VITE_CONVEX_URL` | your Convex deployment URL, e.g. `https://<deployment>.convex.site` (same value the app uses locally) |

   This is the **only** env var Vercel needs — `src/convex/_generated` is
   committed, so the build runs `tsc` without any Convex credentials.
3. Deploy. Client-side routing (`/dashboard`, `/auth`, …) is handled by the
   SPA rewrite in `vercel.json`.

### Backend → Convex Cloud

1. Create a deployment at [convex.new](https://convex.new) (or use the
   platform's Convex deployment).
2. Push functions + schema from your machine:

   ```bash
   npx convex deploy --team <team> --project <project> --deployment <name>
   ```

   or set a `CONVEX_DEPLOY_KEY` and run `npx convex deploy` (e.g. in CI).
3. Set **server-side** env vars in the **Convex dashboard** (never Vercel —
   they're read via `process.env` inside actions):

   | Variable | Purpose |
   |---|---|
   | `VLY_INTEGRATION_KEY` | VLY AI gateway token (auto-injected by the platform) |
   | `AGENT_LLM_MODEL` | Model id on the VLY gateway, e.g. `gpt-5-mini` |
   | `LLM_API_KEY` | Key for any OpenAI-compatible LLM endpoint |
   | `LLM_BASE_URL` | OpenAI-compatible base URL |
   | `LLM_MODEL` | Model id for that endpoint |
   | `MOCK_MODE` | `true` forces the offline mock brain |

   With no keys the agent runs fully offline on the deterministic mock.
   `CONVEX_SITE_URL` (used by Convex Auth) is set automatically on the
   deployment.

> The Freebuff Web platform can also run both halves as managed services;
> publish through the platform flow. Secrets live in the platform's Keys UI.

---

Built with React, Convex, browser-native speech, Open-Meteo and a pluggable LLM layer.
