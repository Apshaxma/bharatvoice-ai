/**
 * Tool registry for BharatVoice AI.
 *
 * Every tool the agent may call is declared here with a schema + policy. The
 * `requiresApproval` flag is what powers the human-in-the-loop queue: tools
 * that have real-world side effects (bookings, payments) never execute
 * automatically — they surface as approval requests instead.
 */

import { getWeather } from "./weather";

export interface ToolDefinition {
  name: string;
  description: string;
  /** Whether execution requires explicit human approval. */
  requiresApproval: boolean;
  /** JSON schema-ish description of args, used in the LLM system prompt. */
  argsSchema: string;
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "getWeather",
    description: "Get the weather forecast for an Indian city (today or tomorrow).",
    requiresApproval: false,
    argsSchema: '{"city": "string (e.g. Mumbai, Pune, Delhi)", "date": "today | tomorrow"}',
    execute: async (args) => {
      const city = typeof args.city === "string" ? args.city : "Mumbai";
      const date = typeof args.date === "string" ? args.date : "today";
      const w = await getWeather(city, date);
      return {
        city: w.city,
        date: w.date,
        temperatureMax: w.temperatureMax,
        temperatureMin: w.temperatureMin,
        precipitationProbability: w.precipitationProbability,
        windSpeedMaxKmh: w.windSpeedMaxKmh,
        description: w.description,
        weatherCode: w.weatherCode,
        source: w.source,
      };
    },
  },
  {
    name: "bookCab",
    description:
      "Book a cab from one Indian city to another. This is a sensitive action and requires the user's explicit approval.",
    requiresApproval: true,
    argsSchema:
      '{"from": "pickup city", "to": "drop-off city", "when": "today | tomorrow"}',
    execute: async (args) => {
      // Demo booking — a real deployment would call an Ola/Uber/redBus API here.
      const from = typeof args.from === "string" ? args.from : "Mumbai";
      const to = typeof args.to === "string" ? args.to : "Pune";
      return {
        bookingId: `BV-CAB-${Date.now().toString(36).toUpperCase()}`,
        from,
        to,
        cabType: "AC Sedan",
        etaMinutes: 4,
        fareInr: 1240,
      };
    },
  },
];

export function getTool(name: string): ToolDefinition | null {
  return TOOLS.find((t) => t.name === name) ?? null;
}

/** Human-readable summary of a tool call, used in the approval queue. */
export function summarizeToolCall(
  name: string,
  args: Record<string, unknown>,
): string {
  if (name === "bookCab") {
    return `Book a cab from ${args.from ?? "Mumbai"} to ${args.to ?? "Pune"}${
      args.when === "tomorrow" ? " tomorrow" : " today"
    }`;
  }
  if (name === "getWeather") {
    return `Check weather for ${args.city ?? "Mumbai"}${
      args.date === "tomorrow" ? " tomorrow" : " today"
    }`;
  }
  return `${name}(${JSON.stringify(args)})`;
}
