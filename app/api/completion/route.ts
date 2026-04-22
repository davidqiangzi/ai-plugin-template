import {
  ChatCompletionRequestMessage,
  Configuration,
  OpenAIApi,
} from "openai-edge";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { CompletionRequestBody } from "@/lib/types";

// Create an OpenAI API client
const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
  basePath: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});
const openai = new OpenAIApi(config);

export const runtime = "edge";

// This is the instructions that GPT-4 will use to know how to respond. For more information on
// the difference between a system message and a user message, see:
// https://platform.openai.com/docs/guides/gpt/chat-completions-api
const systemMessage = {
  role: "system",
  content: `You are an expert UI designer. You will receive a prompt to design a user interface.
You must respond with ONLY valid JSON representing the UI hierarchy. Do not include any explanation or markdown formatting.
The JSON schema MUST match this structure:
{
  "pages": [
    {
      "name": "string (Page name)",
      "frames": [
        { "type": "FRAME", "name": "Screen Name", "width": 375, "height": 812, "layoutMode": "VERTICAL", ... }
      ]
    }
  ]
}

Element schema properties:
- "type": "FRAME" | "TEXT" | "RECTANGLE"
- "name": string (descriptive name)
- "width": number (REQUIRED for root screen frames, typically 375)
- "height": number (REQUIRED for root screen frames, typically 812)
- "backgroundColor": string (hex color like "#FFFFFF")
- "cornerRadius": number (optional)
- "opacity": number (optional, 0 to 1)
- "stroke": { "color": string, "weight": number } (optional)
- "dropShadow": { "color": string, "opacity": number, "x": number, "y": number, "blur": number } (optional)
- "characters": string (only for TEXT)
- "fontSize": number (only for TEXT)
- "fontWeight": "Regular" | "Medium" | "Bold" (optional, for TEXT)
- "color": string (text color hex, default "#000000")
- "children": array of elements (only for FRAME)

AutoLayout properties (ONLY for FRAME):
- "layoutMode": "VERTICAL" | "HORIZONTAL" (REQUIRED for ALL frames with children)
- "itemSpacing": number (gap between children, default 0)
- "padding": number (inner padding, default 0)
- "primaryAlign": "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN"
- "crossAlign": "MIN" | "MAX" | "CENTER"
- "layoutSizingHorizontal": "FIXED" | "HUG" | "FILL"
- "layoutSizingVertical": "FIXED" | "HUG" | "FILL"

CRITICAL LAYOUT RULES:
1. Root screen frames MUST have explicit "width" and "height" and "layoutMode".
   - For mobile app screens: "width": 375, "height": 812
   - For desktop/web dashboards: "width": 1440, "height": 900
   - Choose the appropriate size based on the user's prompt context.
2. ALL frames with children MUST have "layoutMode" set to "VERTICAL" or "HORIZONTAL".
3. Children inside a VERTICAL parent should use "layoutSizingHorizontal": "FILL" to stretch full width.
4. Children inside a HORIZONTAL parent should use "layoutSizingVertical": "FILL" to stretch full height.
   For sidebars or fixed-width panels in HORIZONTAL layouts, use "layoutSizingHorizontal": "FIXED" with an explicit "width".
   For main content areas, use "layoutSizingHorizontal": "FILL" to take remaining space.
5. Use "HUG" only for containers that should shrink-wrap their content (like buttons, tags, badges).
6. RECTANGLE elements are used for images, icons, chart bars, or decorative blocks. Give them explicit width and height.
7. Use vibrant, realistic colors. Use strokes and drop shadows for depth and visual hierarchy.`,
} as const;

// This is used to format the message that the user sends to the API. Note we should
// never have the client create the prompt directly as this could mean that the client
// could use your api for any general purpose completion and leak the "secret sauce" of
// your prompt.
async function buildUserMessage(
  req: Request,
): Promise<ChatCompletionRequestMessage> {
  const body = await req.json();

  // We use zod to validate the request body. To change the data that is sent to the API,
  // change the CompletionRequestBody type in lib/types.ts
  const { prompt } = CompletionRequestBody.parse(body);

  return {
    role: "user",
    content: prompt,
  };
}

export async function POST(req: Request) {
  // Ask OpenAI for a streaming completion given the prompt
  const response = await openai.createChatCompletion({
    model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
    stream: true,
    temperature: 0,
    max_tokens: 16384,
    messages: [systemMessage, await buildUserMessage(req)],
  });

  // Convert the response into a friendly text-stream
  const stream = OpenAIStream(response);
  // Respond with the stream
  const result = new StreamingTextResponse(stream);

  return result;
}
