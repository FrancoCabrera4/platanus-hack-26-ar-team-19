import OpenAI from "openai";
import { log } from "@repo/logger";

const apiKey = process.env.OPENAI_API_KEY;
const modelName = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

if (!apiKey) {
  log("WARN: OPENAI_API_KEY is not set — LLM calls will fail.");
}

const client = new OpenAI({ apiKey: apiKey ?? "missing" });

export interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

interface GenerateOptions {
  system?: string;
  history: ChatTurn[];
  temperature?: number;
  jsonSchema?: object;
}

function buildMessages(opts: GenerateOptions): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  let systemContent = opts.system ?? "";
  if (opts.jsonSchema) {
    systemContent += `\n\nYou MUST respond with valid JSON matching this exact schema:\n${JSON.stringify(opts.jsonSchema, null, 2)}\n\nIMPORTANT: Put the "reply" field FIRST in your JSON response.\nRespond ONLY with the JSON object, no extra text.`;
  }

  if (systemContent) {
    messages.push({ role: "system", content: systemContent });
  }

  if (opts.history.length === 0) {
    messages.push({ role: "user", content: "Hola, empecemos." });
  } else {
    for (const turn of opts.history) {
      if (turn.role === "system") continue;
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  return messages;
}

function normalizeResult(parsed: Record<string, unknown>) {
  if (parsed.reply === undefined && parsed.response) parsed.reply = parsed.response;
  if (parsed.reply === undefined && parsed.message) parsed.reply = parsed.message;
  if (parsed.reply === undefined) parsed.reply = "¿Podrías darme más detalles?";
  if (parsed.state === undefined) parsed.state = {};
  if (parsed.done === undefined) parsed.done = false;
}

class ReplyExtractor {
  private phase: "searching" | "in_reply" | "done" = "searching";
  private buffer = "";
  private escaped = false;

  feed(chunk: string): string {
    let output = "";

    for (const char of chunk) {
      switch (this.phase) {
        case "searching":
          this.buffer += char;
          if (this.buffer.endsWith('"')) {
            const clean = this.buffer.replace(/\s/g, "");
            if (clean.includes('"reply":"')) {
              this.phase = "in_reply";
              this.buffer = "";
            }
          }
          break;

        case "in_reply":
          if (this.escaped) {
            output += char === "n" ? "\n" : char === "t" ? "\t" : char;
            this.escaped = false;
          } else if (char === "\\") {
            this.escaped = true;
          } else if (char === '"') {
            this.phase = "done";
          } else {
            output += char;
          }
          break;

        case "done":
          break;
      }
    }

    return output;
  }
}

export async function generate(opts: GenerateOptions): Promise<string> {
  const messages = buildMessages(opts);

  const params: OpenAI.ChatCompletionCreateParams = {
    model: modelName,
    messages,
    temperature: opts.temperature ?? 0.7,
  };

  if (opts.jsonSchema) {
    params.response_format = { type: "json_object" };
  }

  const result = await client.chat.completions.create(params);
  return result.choices[0]?.message?.content ?? "";
}

export async function generateJSON<T>(opts: GenerateOptions): Promise<T> {
  if (!opts.jsonSchema) {
    throw new Error("generateJSON requires a jsonSchema");
  }
  const text = await generate({ ...opts, temperature: opts.temperature ?? 0.4 });
  log("LLM raw response:", text);
  try {
    const parsed = JSON.parse(text);
    normalizeResult(parsed);
    return parsed as T;
  } catch (err) {
    log("OpenAI returned invalid JSON:", text);
    throw new Error(`Failed to parse OpenAI JSON response: ${(err as Error).message}`);
  }
}

export async function generateStreamJSON<T>(
  opts: GenerateOptions,
  onReplyChunk: (text: string) => void,
): Promise<T> {
  if (!opts.jsonSchema) {
    throw new Error("generateStreamJSON requires a jsonSchema");
  }

  const messages = buildMessages(opts);

  const stream = await client.chat.completions.create({
    model: modelName,
    messages,
    temperature: opts.temperature ?? 0.4,
    response_format: { type: "json_object" },
    stream: true,
  });

  let fullText = "";
  const extractor = new ReplyExtractor();

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (!delta) continue;
    fullText += delta;

    const replyChunk = extractor.feed(delta);
    if (replyChunk) {
      onReplyChunk(replyChunk);
    }
  }

  log("LLM raw streamed response:", fullText);
  try {
    const parsed = JSON.parse(fullText);
    normalizeResult(parsed);
    return parsed as T;
  } catch (err) {
    log("OpenAI returned invalid JSON (stream):", fullText);
    throw new Error(`Failed to parse streamed JSON: ${(err as Error).message}`);
  }
}
