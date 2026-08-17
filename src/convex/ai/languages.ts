/**
 * Language registry for BharatVoice AI.
 *
 * Single source of truth for supported languages. Codes follow the BCP-47
 * conventions used by the Sarvam speech-to-text API (Saaras v3 / v4), which
 * covers the 22 scheduled Indian languages plus Indian English.
 *
 * Keeping this in one place means the UI, the provider layer, the mock layer
 * and the evaluation suite all agree on what "supported" means, and adding a
 * language later is a one-line change instead of a code-wide edit.
 */

export interface LanguageInfo {
  /** BCP-47 code, e.g. "hi-IN" */
  code: string;
  /** English name, e.g. "Hindi" */
  name: string;
  /** Name in the language's own script, e.g. "हिन्दी" */
  nativeName: string;
  /** Writing system, e.g. "Devanagari" */
  script: string;
  /** Whether the provider supports speech for this language */
  speechSupported: boolean;
}

export const LANGUAGES: LanguageInfo[] = [
  { code: "hi-IN", name: "Hindi", nativeName: "हिन्दी", script: "Devanagari", speechSupported: true },
  { code: "bn-IN", name: "Bengali", nativeName: "বাংলা", script: "Bengali", speechSupported: true },
  { code: "kn-IN", name: "Kannada", nativeName: "ಕನ್ನಡ", script: "Kannada", speechSupported: true },
  { code: "ml-IN", name: "Malayalam", nativeName: "മലയാളം", script: "Malayalam", speechSupported: true },
  { code: "mr-IN", name: "Marathi", nativeName: "मराठी", script: "Devanagari", speechSupported: true },
  { code: "od-IN", name: "Odia", nativeName: "ଓଡ଼ିଆ", script: "Odia", speechSupported: true },
  { code: "pa-IN", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", script: "Gurmukhi", speechSupported: true },
  { code: "ta-IN", name: "Tamil", nativeName: "தமிழ்", script: "Tamil", speechSupported: true },
  { code: "te-IN", name: "Telugu", nativeName: "తెలుగు", script: "Telugu", speechSupported: true },
  { code: "en-IN", name: "English", nativeName: "English", script: "Latin", speechSupported: true },
  { code: "gu-IN", name: "Gujarati", nativeName: "ગુજરાતી", script: "Gujarati", speechSupported: true },
  { code: "as-IN", name: "Assamese", nativeName: "অসমীয়া", script: "Bengali", speechSupported: true },
  { code: "ur-IN", name: "Urdu", nativeName: "اردو", script: "Arabic", speechSupported: true },
  { code: "ne-IN", name: "Nepali", nativeName: "नेपाली", script: "Devanagari", speechSupported: true },
  { code: "kok-IN", name: "Konkani", nativeName: "कोंकणी", script: "Devanagari", speechSupported: true },
  { code: "ks-IN", name: "Kashmiri", nativeName: "कॉशुर", script: "Arabic", speechSupported: true },
  { code: "sd-IN", name: "Sindhi", nativeName: "سنڌي", script: "Arabic", speechSupported: true },
  { code: "sa-IN", name: "Sanskrit", nativeName: "संस्कृतम्", script: "Devanagari", speechSupported: true },
  { code: "sat-IN", name: "Santali", nativeName: "ᱥᱟᱱᱛᱟᱲᱤ", script: "Ol Chiki", speechSupported: true },
  { code: "mni-IN", name: "Manipuri", nativeName: "ꯃꯤꯇꯩꯂꯣꯟ", script: "Meitei Mayek", speechSupported: true },
  { code: "brx-IN", name: "Bodo", nativeName: "बर'", script: "Devanagari", speechSupported: true },
  { code: "mai-IN", name: "Maithili", nativeName: "मैथिली", script: "Devanagari", speechSupported: true },
  { code: "doi-IN", name: "Dogri", nativeName: "डोगरी", script: "Devanagari", speechSupported: true },
];

/** O(1) lookup by BCP-47 code. Never throws — returns null for unknown codes. */
export function getLanguageInfo(code: string): LanguageInfo | null {
  if (!code) return null;
  return LANGUAGES.find((l) => l.code === code) ?? null;
}

/** Human label for a code with a graceful fallback for codes we don't know. */
export function getLanguageLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  const info = getLanguageInfo(code);
  if (info) return info.name;
  // The provider may return a language outside our registry (e.g. a future
  // code). Show the raw code rather than dropping the information.
  return code;
}

/**
 * Transcription output modes supported by the speech-to-text layer.
 * `code` maps directly to the provider's `mode` parameter.
 */
export interface TranscriptionMode {
  code: "transcribe" | "codemix" | "translit" | "verbatim" | "translate";
  label: string;
  description: string;
}

export const MODES: TranscriptionMode[] = [
  {
    code: "transcribe",
    label: "Standard",
    description: "Normalized transcription in the original language, numbers formatted.",
  },
  {
    code: "codemix",
    label: "Code-mixed",
    description: "English words in Latin script, Indic words in native script.",
  },
  {
    code: "translit",
    label: "Transliterated",
    description: "Romanized output — useful for Hinglish and Latin-script readers.",
  },
  {
    code: "verbatim",
    label: "Verbatim",
    description: "Exact words, preserving fillers and numbers as spoken.",
  },
  {
    code: "translate",
    label: "To English",
    description: "Transcription translated to English.",
  },
];
