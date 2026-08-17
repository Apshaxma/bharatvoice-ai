/**
 * Tool registry tests — the approval policy is a safety invariant: the only
 * tool with real-world side effects must be flagged `requiresApproval`.
 */

import { describe, expect, test } from "bun:test";
import { TOOLS, getTool, summarizeToolCall } from "../src/convex/tools";

describe("tool registry", () => {
  test("registers exactly the demo vertical tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(["bookCab", "getWeather"]);
  });

  test("safety policy: weather is safe, cab booking requires approval", () => {
    expect(getTool("getWeather")?.requiresApproval).toBe(false);
    expect(getTool("bookCab")?.requiresApproval).toBe(true);
  });

  test("unknown tools are rejected", () => {
    expect(getTool("nope")).toBeNull();
    expect(getTool("")).toBeNull();
  });

  test("every tool declares a description and args schema", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.argsSchema.length).toBeGreaterThan(5);
    }
  });
});

describe("summarizeToolCall", () => {
  test("produces human-readable summaries for the UI queue", () => {
    expect(
      summarizeToolCall("getWeather", { city: "Mumbai", date: "today" }),
    ).toBe("Check weather for Mumbai today");
    expect(
      summarizeToolCall("getWeather", { city: "Pune", date: "tomorrow" }),
    ).toBe("Check weather for Pune tomorrow");
    expect(
      summarizeToolCall("bookCab", { from: "Mumbai", to: "Pune", when: "today" }),
    ).toBe("Book a cab from Mumbai to Pune today");
    expect(
      summarizeToolCall("bookCab", { from: "Mumbai", to: "Pune", when: "tomorrow" }),
    ).toBe("Book a cab from Mumbai to Pune tomorrow");
  });
});

describe("bookCab tool", () => {
  test("executes a booking with the expected shape", async () => {
    const tool = getTool("bookCab")!;
    const result = await tool.execute({
      from: "Mumbai",
      to: "Pune",
      when: "today",
    });
    expect(result.bookingId).toMatch(/^BV-CAB-/);
    expect(result.from).toBe("Mumbai");
    expect(result.to).toBe("Pune");
    expect(result.fareInr).toBe(1240);
    expect(result.etaMinutes).toBe(4);
    expect(result.cabType).toBe("AC Sedan");
  });

  test("missing args default safely", async () => {
    const tool = getTool("bookCab")!;
    const result = await tool.execute({});
    expect(result.from).toBe("Mumbai");
    expect(result.to).toBe("Pune");
  });
});

describe("getWeather tool", () => {
  test("returns numeric fields usable by the responder", async () => {
    const tool = getTool("getWeather")!;
    const result = await tool.execute({ city: "zzz-not-a-city-42", date: "today" });
    expect(typeof result.temperatureMax).toBe("number");
    expect(typeof result.precipitationProbability).toBe("number");
    expect(typeof result.description).toBe("string");
  });
});
