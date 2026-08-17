/**
 * Scheduled jobs for BharatVoice AI.
 *
 * Every 30 minutes, score the most recent agent runs that have not yet been
 * judged with the LLM-as-judge layer (eval.ts). The judge runs asynchronously
 * so it never adds latency to a live conversation; the manual "Run LLM judge"
 * button on the Insights tab covers the immediate case.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "judge-agent-runs",
  { minutes: 30 },
  internal.eval.evaluatePendingCron,
  { limit: 20 },
);

export default crons;
