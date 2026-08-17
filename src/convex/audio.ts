import { mutation } from "./_generated/server";

/** Returns a short-lived URL the client can PUT audio to before transcribing. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});
