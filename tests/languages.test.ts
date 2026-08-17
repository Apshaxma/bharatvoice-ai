/**
 * Language registry tests — the single source of truth for the 23 supported
 * languages must stay consistent, or the UI, provider layer, mocks and
 * evaluation suite silently disagree.
 */

import { describe, expect, test } from "bun:test";
import {
  LANGUAGES,
  MODES,
  getLanguageInfo,
  getLanguageLabel,
} from "../src/convex/ai/languages";

describe("language registry", () => {
  test("covers 23 Indian language codes (22 Indic + Indian English)", () => {
    expect(LANGUAGES.length).toBe(23);
    expect(LANGUAGES.every((l) => l.code.endsWith("-IN"))).toBe(true);
  });

  test("codes are unique", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("every entry is fully labelled and speech-supported", () => {
    for (const lang of LANGUAGES) {
      expect(lang.speechSupported).toBe(true);
      expect(lang.name.length).toBeGreaterThan(0);
      expect(lang.nativeName.length).toBeGreaterThan(0);
      expect(lang.script.length).toBeGreaterThan(0);
    }
  });

  test("getLanguageInfo resolves known codes and rejects unknown ones", () => {
    expect(getLanguageInfo("hi-IN")?.name).toBe("Hindi");
    expect(getLanguageInfo("mr-IN")?.name).toBe("Marathi");
    expect(getLanguageInfo("ta-IN")?.name).toBe("Tamil");
    expect(getLanguageInfo("te-IN")?.name).toBe("Telugu");
    expect(getLanguageInfo("bn-IN")?.name).toBe("Bengali");
    expect(getLanguageInfo("xx-XX")).toBeNull();
    expect(getLanguageInfo("")).toBeNull();
  });

  test("getLanguageLabel degrades gracefully", () => {
    expect(getLanguageLabel("hi-IN")).toBe("Hindi");
    expect(getLanguageLabel("xx-XX")).toBe("xx-XX");
    expect(getLanguageLabel(null)).toBe("Unknown");
    expect(getLanguageLabel(undefined)).toBe("Unknown");
  });
});

describe("transcription modes", () => {
  test("all five modes are present and unique", () => {
    const codes = MODES.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.sort()).toEqual([
      "codemix",
      "transcribe",
      "translate",
      "translit",
      "verbatim",
    ]);
  });

  test("every mode has a label and description", () => {
    for (const mode of MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.description.length).toBeGreaterThan(0);
    }
  });
});
