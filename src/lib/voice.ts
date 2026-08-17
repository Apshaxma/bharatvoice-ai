/**
 * Browser voice helpers for BharatVoice AI:
 *  - MediaRecorder-based audio capture (WebM/Opus with graceful fallbacks)
 *  - speechSynthesis playback when the backend TTS (Sarvam) isn't configured
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
// Speech synthesis (browser fallback TTS)
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
