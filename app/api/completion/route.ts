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
The JSON schema should support:
- "type": "FRAME" | "TEXT" | "RECTANGLE"
- "name": string
- "width": number
- "height": number
- "x": number
- "y": number
- "backgroundColor": string (hex color like "#FFFFFF", "#007AFF", etc.)
- "cornerRadius": number (optional)
- "opacity": number (optional, 0 to 1, default 1)
- "stroke": { "color": string, "weight": number } (optional, hex color)
- "dropShadow": { "color": string, "opacity": number, "x": number, "y": number, "blur": number } (optional, hex color)
- "characters": string (only for TEXT)
- "fontSize": number (only for TEXT)
- "color": string (text color, default "#000000")
- "children": array of these objects (only for FRAME)

Design a high-fidelity mock-up based on the user's prompt. Provide vibrant and realistic colors. Utilize strokes and drop shadows to create depth and hierarchy when appropriate (e.g. subtle shadow for cards, light stroke for borders). The root element must be a FRAME. Make sure the elements are properly positioned and sized to form a complete UI screen.`,
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
    messages: [systemMessage, await buildUserMessage(req)],
  });

  // Convert the response into a friendly text-stream
  const stream = OpenAIStream(response);
  // Respond with the stream
  const result = new StreamingTextResponse(stream);

  return result;
}
