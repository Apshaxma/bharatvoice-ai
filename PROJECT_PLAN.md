# BharatVoice AI — Project Plan

**Human-facing title:** BharatVoice AI
**Tagline:** A production-oriented multilingual voice agent built for India's languages.

A multilingual, real-time Indian-language voice agent. Speak in Hindi, Marathi,
Tamil, Telugu, Bengali or English — BharatVoice detects the language,
transcribes the speech, plans an action, calls tools (live weather, gated cab
bookings), answers in the caller's language and speaks the answer back, while
logging every stage for observability and scoring its own performance.

This plan documents what was built, why, and how it is operated, tested and
evaluated.

---

## 1. Project goals

1. **A real product, not a notebook.** Browser speech capture → hosted
   transcription → LLM agent → tool calls → hosted TTS → audio playback, all
   wired through a real backend with a database, auth and per-user state.
2. **A production-shaped agent pipeline.** Plan/act/answer separation, tool
   registry with a safety policy, conversation memory, human-in-the-loop for
   sensitive actions, per-run observability and runtime self-evaluation.
3. **Genuinely multilingual.** 23 Indian languages (+ English) in the language
   registry; automatic language detection from speech; answers and speech
   generated in the detected language; code-mixed Hinglish preserved.
4. **Provably replaceable providers.** STT, LLM and TTS sit behind interfaces
   with deterministic mocks, so the entire product runs offline, tests never
   touch external services, and vendors can be swapped without touching the
   agent.
5. **A portfolio artifact that demonstrates AI systems engineering:**
   reliability (retries, backoff, graceful degradation), observability
   (structured logs, latency breakdown, model usage), evaluation (self-scored
   turns + unit-level evals) and privacy (raw audio deleted after
   transcription, text-only retention).

## 2. Architecture

```
Browser (React 19 + Vite)
  ├─ MediaRecorder (WebM/Opus) ────────────┐
  ├─ speechSynthesis (browser TTS fallback) │
  └─ Assistant UI (chat + pipeline trace)   │
                                           ▼
                      ┌─────────────────────────────────────┐
                      │         Convex backend              │
                      │                                     │
                      │  audio.ts   (storage upload URL)    │
                      │  transcribe.ts  (STT action)        │
                      │     └── ai/stt.ts   (Sarvam | mock) │
                      │  agent.ts   (runAgent action)       │
                      │     ├── ai/llm.ts (gateway | mock)  │
                      │     ├── tools/*  (weather, cab)     │
                      │     ├── ai/tts.ts (Sarvam | browser)│
                      │     └── agentDb.ts (DB layer)       │
                      │  schema.ts   (auth + product tables)│
                      └──────────────┬──────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
        Open-Meteo (weather)   VLY AI gateway (LLM)   Sarvam AI (STT/TTS)
        no key required        billed via project     optional keys
```

**One agent turn end to end:**

1. **Listen** — MediaRecorder captures audio in the browser; bytes are PUT to
   Convex storage.
2. **Transcribe** — the `transcribeAudio` action runs Sarvam Saaras (or the
   deterministic mock), requesting automatic language detection
   (`language_code=unknown`) so one call returns both transcript and language
   with confidence. **The raw audio is deleted immediately after; only text +
   metadata are persisted.**
3. **Understand** — a *planner* LLM call classifies intent and decides which
   tools are needed (strict JSON, temperature 0.1).
4. **Gate** — tool calls are checked against the registry policy. Safe tools
   (`getWeather`) execute; sensitive tools (`bookCab`) become rows in the
   `approvals` table and *never* execute without the user approving.
5. **Act** — safe tools run with timing captured (Open-Meteo geocoding +
   forecast, with a deterministic mock fallback so the agent never crashes on
   network failure).
6. **Answer** — a *responder* LLM call generates 1–3 spoken-friendly sentences
   in the user's detected language, grounded in the tool results (or
   acknowledging a denied approval).
7. **Speak** — Sarvam Bulbul TTS synthesizes the answer and the audio is served
   back; when no TTS key is configured the client falls back to browser
   `speechSynthesis` so the product still works.
8. **Observe** — every stage's latency, the intent, tool calls, model usage and
   a self-evaluation score are persisted to `agentRuns` and surfaced in the
   Insights dashboard.

## 3. Components

| Component | File(s) | Responsibility |
|---|---|---|
| Language registry | `src/convex/ai/languages.ts` | Single source of truth for 23 BCP-47 codes, labels, scripts, STT modes |
| STT abstraction | `src/convex/ai/stt.ts` | `SpeechToTextProvider` interface, Sarvam provider with retry/backoff, mock provider, factory |
| LLM abstraction | `src/convex/ai/llm.ts` | `LLMProvider` interface, VLY gateway provider, deterministic mock planner/responder, JSON extraction helpers |
| TTS abstraction | `src/convex/ai/tts.ts` | `TTSProvider` interface, Sarvam Bulbul provider, browser fallback decision |
| Agent pipeline | `src/convex/agent.ts` | `runAgent` action (plan → gate → act → answer → speak → observe) and `resumeApproval` action |
| DB layer | `src/convex/agentDb.ts` | Conversations, messages, runs, metrics aggregation, approvals (internal + user-facing functions) |
| Tool registry | `src/convex/tools/index.ts` | Tool definitions with `requiresApproval` policy and human-readable summaries |
| LLM-as-judge | `src/convex/ai/judge.ts`, `src/convex/ai/scoring.ts`, `src/convex/eval.ts`, `src/convex/crons.ts` | Async LLM scoring of completed turns with shared rubric + heuristic fallback; manual trigger and 30-min cron |
| Weather tool | `src/convex/tools/weather.ts` | Open-Meteo geocoding + forecast, WMO code mapping, mock fallback |
| Transcription service | `src/convex/transcribe.ts` | Upload → provider → persist → delete audio; structured errors |
| Voice helpers | `src/lib/voice.ts` | MediaRecorder capture, browser speech synthesis |
| Assistant UI | `src/components/assistant/*` | Chat with pipeline progress, tool trace, approvals queue, history, insights |
| Landing page | `src/pages/Landing.tsx` | Themed landing (saffron/ivory Devanagari aesthetic) with live pipeline demo |
| Schema | `src/convex/schema.ts` | Auth tables + `transcriptions`, `conversations`, `agentMessages`, `agentRuns`, `approvals` |

## 4. Technology choices

- **Frontend:** React 19 + Vite + TypeScript, Tailwind v4, shadcn/ui, Framer
  Motion, Lucide icons — the Freebuff Web template stack.
- **Backend/database:** Convex (serverless functions + reactive queries +
  storage). Chosen because the agent needs a hosted action runtime (external
  HTTP calls), a database for memory/audit, and file storage for audio — all
  in one deployable unit with per-user auth built in.
- **Auth:** Convex Auth (email OTP + anonymous) — existing template wiring.
- **Speech-to-text:** Sarvam AI `saaras:v3/v4` (22 Indic languages + English,
  single-call language detection). Abstracted behind an interface with a mock.
- **Text-to-speech:** Sarvam AI `bulbul:v3`, with browser `speechSynthesis` as
  a zero-key fallback.
- **LLM:** the VLY AI gateway (OpenAI-compatible, many models behind one key,
  usage billed to the project). Abstracted behind an interface with a mock.
- **Weather:** Open-Meteo (free, no key) with geocoding; deterministic mock
  fallback.
- **Testing:** Bun's built-in test runner (`bun test`) — no new dependency.
- **Why mocks everywhere:** the whole pipeline — recording, transcription,
  planning, tools, answering, speaking — runs offline and in CI with
  `MOCK_MODE=true` or no keys, and every test is deterministic.

## 5. Development phases

1. **Scaffold + plan** — template setup, schema, this document. ✅
2. **Language + provider layer** — registry, STT/LLM/TTS abstractions with
   mock implementations. ✅
3. **Transcription service** — upload, provider call, audit persistence,
   audio deletion. ✅
4. **Agent pipeline** — planner/responder split, tool registry, execution,
   memory, self-evaluation. ✅
5. **Human-in-the-loop** — approval queue + `resumeApproval` continuation
   turn. ✅
6. **Observability** — `agentRuns` + metrics aggregation + Insights UI. ✅
7. **Frontend** — themed landing page, protected dashboard, assistant chat
   with pipeline trace, history, approvals, insights. ✅
8. **Tests + evaluation** — unit suite for the pure modules, offline eval of
   the mock planner. ✅
9. **LLM-as-judge** — asynchronous judge (manual trigger + 30-min cron),
   heuristic fallback, Insights surfacing. ✅
10. **Docs** — README, this plan. ✅
11. **Future** — streaming STT/TTS, labelled eval corpus + CI gating on judge
    scores, more verticals (food delivery, tickets), rate limiting and
    per-user quotas, WebSocket real-time channel.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vendor API drift (Sarvam) | Provider interfaces + factory functions; providers isolated in `ai/*`; docs pinned in comments; mock mode keeps the app alive |
| LLM returns malformed JSON | `extractJson`/`parseLlmJson` with fence stripping; plan failure degrades to a chat-only turn, still logged |
| Weather API down | `getWeather` never throws — deterministic mock fallback |
| No API keys configured | `MOCK_MODE`/missing-key → mocks everywhere; `getRuntimeInfo` tells the UI which mode it is in |
| Audio privacy | Raw audio deleted after transcription; only text + metadata stored; documented in UI |
| Sensitive side effects | `requiresApproval` policy — bookings queue for explicit human decision |
| Transient provider failures | Retry policy with exponential backoff on 408/429/5xx |

## 7. Testing strategy

- **Unit tests (Bun):** the pure modules were designed to be importable
  outside Convex. `tests/` covers:
  - language registry integrity (23 codes, uniqueness, lookups, labels)
  - retry policy (transient statuses, exponential backoff caps)
  - mock STT (pinned language, auto-detect confidence, translit/translate
    modes, provider factory rules)
  - JSON extraction + mock LLM planner/responder across Hindi, Hinglish,
    Marathi, Tamil, English (intent, cities, dates, tool selection)
  - weather (WMO mapping, mock fallback structure)
  - tool registry (approval policy, summaries, booking shape)
- **Eval-style tests** double as the evaluation harness: the labelled
  utterances in `tests/llm.test.ts` assert intent/tool accuracy of the mock
  planner and are trivially reusable against a live provider.
- **Type safety:** `bun tsc -b --noEmit` runs on every change (CI).
- **Manual E2E:** voice → STT → agent → TTS loop exercised in the preview.

## 8. Evaluation strategy

Two layers, deliberately separated so scoring never slows the conversation:

1. **Runtime self-evaluation (every turn):** the agent scores each successful
   response 0–1 on non-emptiness, grounding in tool numbers, language/script
   match with the user, conciseness, and latency budget. This is a cheap
   heuristic that runs at zero extra latency; scores + notes persist on
   `agentRuns`.
2. **LLM-as-judge (asynchronous):** `src/convex/ai/judge.ts` scores completed
   turns against the same five-criterion rubric via an LLM call over the
   `LLMProvider` interface — the gateway model in live mode, the deterministic
   mock brain in mock mode. It runs after the user already got their answer:
   - **manual trigger** — "Run LLM judge" button on the Insights tab scores
     the current user's recent unscored runs;
   - **automatic** — a scheduled job (`crons.ts`) scores unscored runs every
     30 minutes deployment-wide;
   - **resilient** — if the judge model fails or returns malformed output, it
     degrades to the shared heuristic scorer (`ai/scoring.ts`) instead of
     failing the run. The agent, the mock brain and the fallback all share
     that one scorer so the numbers agree everywhere.

   Judge results (`judgeScore`, `judgeCriteria`, `judgeNotes`, provider/model,
   latency, status) persist on `agentRuns` and roll up into Insights metrics
   (`avgJudgeScore`, `judgedCount`) and the per-run table.

**Still on the roadmap:** labelled offline eval sets that run the full mock
pipeline (extend the `tests/llm.test.ts` and `tests/judge.test.ts` corpora into
a scored dataset), transcript-level metrics (WER for STT, semantic similarity
for answers), and regression-gating eval scores in CI.

## 9. Deployment strategy

- **Hosting:** the Freebuff Web platform runs the Vite frontend and the Convex
  backend (auth, storage, actions) as managed services; the project is
  deployed through the platform's publish flow. No self-hosted servers.
- **Configuration:** all secrets live in the platform's environment/Keys UI
  (never in the repo or `.env`): `SARVAM_API_KEY`, optional
  `SARVAM_STT_MODEL`/`SARVAM_TTS_MODEL`/`SARVAM_TTS_SPEAKER`,
  `AGENT_LLM_MODEL`, `MOCK_MODE`. The VLY integration key is injected
  automatically.
- **Operational behavior:** structured JSON log lines per run
  (`service: bharatvoice-agent` / `bharatvoice-transcribe`) with request ids
  for trace correlation; per-user metrics queries; graceful degradation to
  mocks if any upstream fails.
