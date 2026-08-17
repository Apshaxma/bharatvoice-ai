import { LANGUAGES } from "@/convex/ai/languages";
import { BharatVoiceMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  AudioLines,
  BrainCircuit,
  CheckCircle2,
  CloudSun,
  Languages,
  Mic,
  Microscope,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

const DIALOGUES = [
  {
    user: "कल मुंबई से पुणे जाना है। मौसम कैसा रहेगा?",
    lang: "hi-IN · Hindi",
    reply:
      "कल मुंबई में मौसम साफ़ रहेगा। अधिकतम 31°C और बारिश की संभावना 15%। यात्रा के लिए बढ़िया रहेगा!",
  },
  {
    user: "उद्या मुंबईमध्ये पाऊस पडेल का?",
    lang: "mr-IN · Marathi",
    reply:
      "उद्या मुंबईत २८°C असेल आणि पावसाची शक्यता ६०% आहे. छत्री सोबत ठेवा!",
  },
  {
    user: "Book a cab from Mumbai to Pune",
    lang: "en-IN · English",
    reply:
      "I found an AC Sedan, ~₹1,240, ETA 4 min. Booking is a sensitive action — I'll wait for your approval.",
  },
];

const PIPELINE = [
  {
    icon: Mic,
    title: "Listen",
    desc: "Real-time speech capture with noise suppression — any microphone, any accent.",
  },
  {
    icon: Languages,
    title: "Detect",
    desc: "Language identification across 23 Indian languages, code-mixed Hinglish included.",
  },
  {
    icon: BrainCircuit,
    title: "Understand",
    desc: "An LLM planner resolves intent and decides which tools the request needs.",
  },
  {
    icon: Wrench,
    title: "Act",
    desc: "Tools run — live weather, bookings — gated by a human-approval policy.",
  },
  {
    icon: Sparkles,
    title: "Answer",
    desc: "The response is grounded in tool results and spoken back in your language.",
  },
  {
    icon: AudioLines,
    title: "Speak",
    desc: "Text-to-speech in your language — Sarvam Bulbul, or the browser as fallback.",
  },
];

const FEATURES = [
  {
    icon: Mic,
    title: "Multilingual speech-to-text",
    desc: "Sarvam Saaras v3 transcribes 22 Indian languages + English with automatic language detection in a single call.",
  },
  {
    icon: BrainCircuit,
    title: "Agent memory",
    desc: "Every conversation persists. The agent remembers earlier turns and carries context across them.",
  },
  {
    icon: CloudSun,
    title: "Live tool calling",
    desc: "Weather fetched in real time from Open-Meteo — no API key, no vendor lock-in, mock-safe for demos.",
  },
  {
    icon: ShieldCheck,
    title: "Human-in-the-loop",
    desc: "Sensitive actions like cab bookings never execute automatically. They queue for your explicit approval.",
  },
  {
    icon: Microscope,
    title: "Observability built in",
    desc: "Every turn logs per-stage latency, tool calls, model usage and a self-evaluation score — see it on the Insights tab.",
  },
  {
    icon: Zap,
    title: "Provider abstraction",
    desc: "STT, LLM and TTS sit behind interfaces with retries, backoff and mock fallbacks. Swap vendors without touching the agent.",
  },
];

const EXAMPLES = [
  {
    script: "कल मुंबई से पुणे जाना है। मौसम कैसा रहेगा?",
    lang: "Hindi · auto-detected",
    answer: "Mumbai · 31°C / 24°C · 15% rain",
    detail: "intent → weather_query · tool → getWeather",
  },
  {
    script: "मराठीत मला मुंबई ते पुणे कॅब बुक करायची आहे",
    lang: "Marathi · auto-detected",
    answer: "Cab found · awaiting your approval",
    detail: "intent → book_cab · tool → bookCab (gated)",
  },
  {
    script: "Will it rain in Chennai tomorrow?",
    lang: "English · auto-detected",
    answer: "Chennai · 33°C / 27°C · 55% rain",
    detail: "intent → weather_query · tool → getWeather",
  },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();

  const dashboardTarget = isAuthenticated
    ? "/dashboard"
    : "/auth?returnTo=%2Fdashboard";

  return (
    <div className="min-h-screen bg-ivory text-ink antialiased">
      <Navbar />
      <Hero dashboardTarget={dashboardTarget} />
      <LanguageMarquee />
      <PipelineSection />
      <FeaturesSection />
      <ExamplesSection />
      <TrustBand />
      <CtaSection dashboardTarget={dashboardTarget} />
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Navbar() {
  const { isAuthenticated } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { href: "#pipeline", label: "Pipeline" },
    { href: "#features", label: "Features" },
    { href: "#examples", label: "Examples" },
    { href: "#trust", label: "Under the hood" },
  ];

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all",
        scrolled
          ? "border-b border-ink/10 bg-ivory/90 backdrop-blur-md"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="BharatVoice home">
          <BharatVoiceMark />
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink-soft transition-colors hover:text-saffron"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <Button
              className="gap-1.5 rounded-full bg-saffron px-4 text-white hover:bg-saffron-bright"
              onClick={() => (window.location.href = "/dashboard")}
            >
              Open dashboard
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                className="rounded-full text-ink-soft hover:bg-ink/5 hover:text-ink"
                onClick={() => (window.location.href = "/auth")}
              >
                Sign in
              </Button>
              <Button
                className="gap-1.5 rounded-full bg-saffron px-4 text-black hover:bg-saffron-bright"
                onClick={() =>
                  (window.location.href = "/auth?returnTo=%2Fdashboard")
                }
              >
                Start talking
                <ArrowRight className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero({ dashboardTarget }: { dashboardTarget: string }) {
  return (
    <section className="relative overflow-hidden pt-32 pb-16 sm:pt-40 sm:pb-24">
      {/* Devanagari watermark */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-6 right-0 select-none font-[Noto_Sans_Devanagari] text-[11rem] font-bold leading-none text-saffron/[0.07] sm:text-[16rem]"
      >
        भारतवॉइस
      </span>

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr]">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-saffron/30 bg-saffron/10 px-3.5 py-1.5 text-xs font-semibold text-saffron">
            <Sparkles className="size-3.5" />
            Multilingual voice agent · 23 Indian languages
          </span>

          <h1 className="mt-6 max-w-xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Speak in your language.
            <span className="mt-1 block text-saffron">
              Get answered in your language.
            </span>
          </h1>

          <p className="mt-5 max-w-lg text-base leading-7 text-ink-soft sm:text-lg">
            BharatVoice listens to Hindi, Marathi, Tamil and 20 more Indian
            languages, understands what you mean, calls real tools — weather,
            bookings — and speaks the answer back to you. Out loud.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              className="h-12 gap-2 rounded-full bg-saffron px-6 text-black shadow-[inset_0_-3px_0_rgba(0,0,0,0.15)] hover:bg-saffron-bright"
              onClick={() => (window.location.href = dashboardTarget)}
            >
              <Mic className="size-4" />
              Start talking
            </Button>
            <a href="#pipeline">
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-ink/15 bg-transparent px-6 text-ink hover:bg-ink/5"
              >
                See the pipeline
              </Button>
            </a>
          </div>

          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-ink/10 pt-6">
            {[
              ["23", "languages spoken"],
              ["2", "live tools"],
              ["0", "raw audio stored"],
            ].map(([value, label]) => (
              <div key={label}>
                <dt className="text-2xl font-bold tracking-tight text-ink">
                  {value}
                </dt>
                <dd className="mt-0.5 text-xs leading-4 text-ink-soft">
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </motion.div>

        {/* Phone mock */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: "easeOut" }}
          className="relative mx-auto w-full max-w-sm"
        >
          <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-saffron/20 via-marigold/15 to-transparent blur-2xl" />
          <div className="relative rounded-[2rem] border border-ink/10 bg-white p-5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.25)]">
            {/* phone header */}
            <div className="flex items-center justify-between border-b border-ink/8 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-saffron text-white">
                  <AudioLines className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-bold leading-none">BharatVoice</p>
                  <p className="mt-0.5 text-[10px] text-ink-soft">
                    always listening · auto-detect
                  </p>
                </div>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-0.5 text-[10px] font-semibold text-leaf">
                <span className="size-1.5 rounded-full bg-leaf" />
                live
              </span>
            </div>

            <TypedConversation />

            {/* waveform */}
            <div className="mt-4 flex h-10 items-center justify-center gap-1 rounded-2xl bg-ivory px-4">
              {[0.5, 0.8, 1, 0.6, 0.9, 1.1, 0.7, 1, 0.55, 0.85, 1.05, 0.65].map(
                (height, i) => (
                  <span
                    key={i}
                    className="w-1 origin-center rounded-full bg-saffron/70 animate-bv-wave"
                    style={{
                      height: `${height * 100}%`,
                      animationDelay: `${i * 0.09}s`,
                    }}
                  />
                ),
              )}
            </div>
            <p className="mt-2 text-center text-[10.5px] text-ink-soft">
              Tap once · speak · hear the answer in your language
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function TypedConversation() {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<"user" | "reply">("user");

  useEffect(() => {
    const userTimer = setTimeout(() => setStep("reply"), 1900);
    const nextTimer = setTimeout(() => {
      setIndex((i) => (i + 1) % DIALOGUES.length);
      setStep("user");
    }, 5200);
    return () => {
      clearTimeout(userTimer);
      clearTimeout(nextTimer);
    };
  }, [index, step]);

  const dialogue = DIALOGUES[index];

  return (
    <div className="mt-4 flex min-h-[168px] flex-col gap-2.5">
      <AnimatePresence mode="wait">
        <motion.div
          key={`user-${index}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
          className="self-end rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[12.5px] leading-5 text-ivory"
        >
          {dialogue.user}
          <span className="mt-1 block text-[9px] font-semibold uppercase tracking-wider text-ivory/50">
            {dialogue.lang}
          </span>
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {step === "reply" && (
          <motion.div
            key={`reply-${index}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="flex items-start gap-2 self-start"
          >
            <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-saffron text-white">
              <AudioLines className="size-3.5" />
            </span>
            <div className="rounded-2xl rounded-bl-md border border-ink/10 bg-white px-3.5 py-2.5 text-[12.5px] leading-5 text-ink-soft">
              {dialogue.reply}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LanguageMarquee() {
  const items = [...LANGUAGES, ...LANGUAGES];
  return (
    <section className="border-y border-ink/10 bg-white/60 py-5">
      <div className="relative overflow-hidden">
        <div className="flex w-max gap-3 animate-bv-marquee">
          {items.map((lang, i) => (
            <span
              key={`${lang.code}-${i}`}
              className="flex items-center gap-2 whitespace-nowrap rounded-full border border-ink/10 bg-ivory px-4 py-1.5 text-xs font-medium text-ink-soft"
            >
              <span className="font-[Noto_Sans_Devanagari] text-sm text-saffron">
                {lang.nativeName}
              </span>
              {lang.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className="mx-auto max-w-2xl text-center"
    >
      <span className="text-xs font-bold uppercase tracking-[0.2em] text-saffron">
        {eyebrow}
      </span>
      <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {sub && (
        <p className="mt-3 text-base leading-7 text-ink-soft">{sub}</p>
      )}
    </motion.div>
  );
}

function PipelineSection() {
  return (
    <section id="pipeline" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="The pipeline"
          title="Six stages. One seamless conversation."
          sub="Speech-to-text, language detection, LLM planning, tool execution, grounded answers and text-to-speech — timed, logged and self-evaluated on every turn."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.06 }}
              className="group relative rounded-2xl border border-ink/10 bg-white p-5 transition-all hover:-translate-y-1 hover:border-saffron/40"
            >
              <span className="absolute right-4 top-4 font-display text-3xl font-bold text-ink/5 transition-colors group-hover:text-saffron/15">
                0{i + 1}
              </span>
              <span className="flex size-10 items-center justify-center rounded-xl bg-saffron/12 text-saffron">
                <step.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-base font-bold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-soft">
                {step.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 border-y border-ink/10 bg-white/50 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Why BharatVoice"
          title="Built like a production agent, not a demo"
          sub="Provider abstraction, retries, observability and human oversight — the things that separate a notebook from a deployable system."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.05 }}
              className="rounded-2xl border border-ink/10 bg-ivory p-5"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-ink text-ivory">
                <feature.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-base font-bold tracking-tight">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-ink-soft">
                {feature.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ExamplesSection() {
  return (
    <section id="examples" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Real conversations"
          title="Code-mixed Hinglish? Marathi? Tamil? No problem."
          sub="The same pipeline, the same tools — the answer always comes back in the caller's language."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {EXAMPLES.map((example, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="flex flex-col rounded-2xl border border-ink/10 bg-white p-5"
            >
              <span className="self-end rounded-full bg-saffron/10 px-2.5 py-1 text-[10px] font-semibold text-saffron">
                {example.lang}
              </span>
              <p className="mt-3 text-sm font-medium leading-6 text-ink">
                “{example.script}”
              </p>
              <div className="mt-4 rounded-xl bg-ivory px-3.5 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-leaf">
                  <CheckCircle2 className="size-4 shrink-0" />
                  {example.answer}
                </p>
                <p className="mt-1.5 font-mono text-[10.5px] text-ink-soft">
                  {example.detail}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  const items = [
    "Abstraction layer over STT · LLM · TTS",
    "Retries with exponential backoff",
    "Structured per-run logs & audit trail",
    "Self-evaluation score on every answer",
    "Sensitive actions require approval",
    "Raw audio deleted — text only stored",
  ];
  return (
    <section id="trust" className="scroll-mt-20 border-y border-ink/10 bg-ink py-16 text-ivory">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="grid items-center gap-10 lg:grid-cols-[1fr_1.2fr]"
        >
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-marigold">
              Under the hood
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Designed to be operated, not just demoed.
            </h2>
            <p className="mt-3 text-sm leading-7 text-ivory/60">
              Every module is replaceable, every call is timed, every failure
              is logged. The Insights dashboard surfaces it all.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((item) => (
              <li
                key={item}
                className="flex items-center gap-2.5 rounded-xl border border-ivory/10 bg-ivory/5 px-4 py-3 text-sm text-ivory/85"
              >
                <CheckCircle2 className="size-4 shrink-0 text-marigold" />
                {item}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  );
}

function CtaSection({ dashboardTarget }: { dashboardTarget: string }) {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-saffron to-saffron-bright px-6 py-14 text-center text-white sm:px-12"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-8 -right-4 select-none text-[10rem] font-bold leading-none text-white/10"
          >
            नमस्ते
          </span>
          <div className="relative mx-auto max-w-xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Namaste. Let&apos;s talk.
            </h2>
            <p className="mt-3 text-sm leading-7 text-white/85 sm:text-base">
              Sign in and say <em>“कल मुंबई से पुणे जाना है, मौसम कैसा रहेगा?”</em>{" "}
              — the agent will fetch live weather and answer you in Hindi.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                className="h-12 gap-2 rounded-full bg-white px-6 font-semibold text-black shadow-[inset_0_-3px_0_rgba(0,0,0,0.08)] hover:bg-ivory"
                onClick={() => (window.location.href = dashboardTarget)}
              >
                <Mic className="size-4" />
                Start talking — it&apos;s free
                <ArrowRight className="size-4" />
              </Button>
            </div>
            <p className="mt-4 text-xs text-white/70">
              Guest access available · no credit card · raw audio never stored
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-white/60 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6">
        <BharatVoiceMark />
        <p className="text-center text-xs leading-5 text-ink-soft">
          A production-oriented multilingual voice agent for India&apos;s
          languages.
          <br />
          Convex · Sarvam AI · Open-Meteo · VLY gateway
        </p>
        <div className="flex items-center gap-4">
          <Link
            to="/auth"
            className="text-xs font-semibold text-ink-soft transition-colors hover:text-saffron"
          >
            Sign in
          </Link>
          <Link
            to="/dashboard"
            className="text-xs font-semibold text-ink-soft transition-colors hover:text-saffron"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </footer>
  );
}
