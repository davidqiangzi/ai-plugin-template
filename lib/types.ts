import { z } from "zod";

export const CompletionRequestBody = z.object({ prompt: z.string() });
