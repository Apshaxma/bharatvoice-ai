/**
 * Browser voice helpers for BharatVoice AI — fully vendor-independent:
 *  - Web Speech API recognition (SpeechRecognition) for live, key-free
 *    transcription of any language the browser supports
 *  - MediaRecorder-based audio capture (WebM/Opus) as a fallback for
 *    browsers without SpeechRecognition
 *  - speechSynthesis for answering out loud (no TTS vendor or key needed)
 */

export function isMediaRecorderSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Pick the best supported audio MIME type for this browser. */
export function preferredAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "audio/webm";
}

export interface RecordingSession {
  /** Stop recording and resolve with the captured blob + duration. */
  stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
  /** Abort without producing audio. */
  cancel: () => void;
}

/** Ask for the mic and start recording. Rejects if permission is denied. */
export async function startRecordingSession(): Promise<RecordingSession> {
  if (!isMediaRecorderSupported()) {
    throw new Error("Audio recording is not supported in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const mimeType = preferredAudioMimeType();
  const recorder = new MediaRecorder(stream, {
    ...(MediaRecorder.isTypeSupported(mimeType) ? { mimeType } : {}),
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const startedAt = Date.now();
  recorder.start();

  return {
    stop: () =>
      new Promise<{ blob: Blob; mimeType: string; durationMs: number }>(
        (resolve, reject) => {
          recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            const durationMs = Date.now() - startedAt;
            const type = chunks[0]?.type || mimeType;
            resolve({
              blob: new Blob(chunks, { type }),
              mimeType: type,
              durationMs,
            });
          };
          recorder.onerror = () => {
            stream.getTracks().forEach((track) => track.stop());
            reject(new Error("Recording failed."));
          };
          try {
            recorder.stop();
          } catch (err) {
            reject(err instanceof Error ? err : new Error("Recording failed."));
          }
        },
      ),
    cancel: () => {
      stream.getTracks().forEach((track) => track.stop());
      try {
        recorder.stop();
      } catch {
        // already stopped
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Web Speech API recognition (live, key-free transcription)
// ---------------------------------------------------------------------------

/** Minimal shape of the browser SpeechRecognition API (prefixed in Chrome). */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}

export function browserSpeechRecognitionAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export interface ListeningSession {
  /** Stop listening. The best transcript so far is delivered via onFinal. */
  stop: () => void;
}

/**
 * Start live speech recognition. On the final transcript (or on manual stop)
 * `onFinal` fires with the best text so far; interim results stream to
 * `onInterim`. Fires `onError` for mic permission / no-speech failures.
 */
export function startListeningSession(options: {
  languageCode: string;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
}): ListeningSession {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const RecognitionCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!RecognitionCtor) {
    throw new Error("Speech recognition is not supported in this browser.");
  }

  const recognition = new RecognitionCtor();
  recognition.lang = options.languageCode;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  let interimText = "";
  let ended = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    interimText = interim;
    options.onInterim?.(`${finalText}${interim}`.trim());
  };

  recognition.onerror = (event) => {
    const map: Record<string, string> = {
      "not-allowed": "Microphone access denied. Allow the mic, or type instead.",
      "service-not-allowed": "Speech recognition is disabled in this browser.",
      "no-speech": "No speech detected. Try again.",
      "audio-capture": "No microphone was found.",
      network: "Speech recognition could not reach its service.",
    };
    options.onError?.(map[event.error ?? ""] ?? "Speech recognition failed.");
  };

  recognition.onend = () => {
    if (ended) return;
    ended = true;
    const transcript = finalText || interimText;
    options.onFinal?.(transcript.trim());
  };

  recognition.start();

  return {
    stop: () => {
      if (!ended) {
        // Deliver whatever we heard before stopping (no more final events).
        ended = true;
        const transcript = finalText || interimText;
        options.onFinal?.(transcript.trim());
        try {
          recognition.abort();
        } catch {
          // already stopped
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Speech synthesis (browser TTS — the only TTS in the app)
// ---------------------------------------------------------------------------

export function browserSpeechAvailable(): boolean {
  return (
    typeof window !== "undefined" && "speechSynthesis" in window
  );
}

/** Normalize a BCP-47 tag for matching against speechSynthesis voices. */
function normalizeLang(tag: string): string {
  return tag.toLowerCase().replace("_", "-");
}

export function speakText(text: string, languageCode: string | null): void {
  if (!browserSpeechAvailable() || !text) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const lang = normalizeLang(languageCode ?? "hi-IN");
    utterance.lang = lang;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => normalizeLang(v.lang) === lang,
    );
    if (preferred) utterance.voice = preferred;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // speech synthesis is best-effort; never break the app over it
  }
}

export function stopSpeaking(): void {
  if (browserSpeechAvailable()) window.speechSynthesis.cancel();
}
