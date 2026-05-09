import {
  GoogleGenerativeAI,
  type Content,
  type GenerateContentRequest,
  type ResponseSchema,
} from "@google/generative-ai";
import OpenAI from "openai";
import { log } from "@repo/logger";

type LlmProvider = "openai" | "gemini";

const openAiApiKey = process.env.OPENAI_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const provider = parseProvider(process.env.LLM_PROVIDER);
const openAiModelName = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const geminiModelName = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

if (provider === "openai" && !openAiApiKey) {
  log("WARN: OPENAI_API_KEY is not set — LLM calls will fail.");
}
if (provider === "gemini" && !geminiApiKey) {
  log("WARN: GEMINI_API_KEY is not set — LLM calls will fail.");
}

const openAiClient = new OpenAI({ apiKey: openAiApiKey ?? "missing" });
const geminiClient = new GoogleGenerativeAI(geminiApiKey ?? "missing");

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

function parseProvider(value: string | undefined): LlmProvider {
  const normalised = value?.toLowerCase();
  if (normalised === "gemini" || normalised === "openai") return normalised;
  if (value) {
    log(
      `WARN: Unsupported LLM_PROVIDER="${value}". Falling back to auto-detect.`,
    );
  }
  return openAiApiKey ? "openai" : "gemini";
}

function schemaHasProperty(
  schema: object | undefined,
  property: string,
): boolean {
  if (!schema || typeof schema !== "object") return false;
  const properties = (schema as { properties?: Record<string, unknown> })
    .properties;
  return (
    !!properties && Object.prototype.hasOwnProperty.call(properties, property)
  );
}

function buildSystemContent(opts: GenerateOptions): string {
  let systemContent = opts.system ?? "";
  if (opts.jsonSchema) {
    const replyInstruction = schemaHasProperty(opts.jsonSchema, "reply")
      ? '\n\nIMPORTANT: Put the "reply" field FIRST in your JSON response.'
      : "";
    systemContent += `\n\nYou MUST respond with valid JSON matching this exact schema:\n${JSON.stringify(opts.jsonSchema, null, 2)}${replyInstruction}\nRespond ONLY with the JSON object, no extra text.`;
  }
  return systemContent;
}

function buildOpenAiMessages(
  opts: GenerateOptions,
): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  const systemContent = buildSystemContent(opts);
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

function buildGeminiContents(opts: GenerateOptions): Content[] {
  if (opts.history.length === 0) {
    return [{ role: "user", parts: [{ text: "Hola, empecemos." }] }];
  }

  return opts.history
    .filter((turn) => turn.role !== "system")
    .map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    }));
}

function toGeminiSchema(schema: unknown): ResponseSchema {
  if (!schema || typeof schema !== "object") return schema as ResponseSchema;

  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (key === "additionalProperties") continue;
    if (key === "enum" && Array.isArray(value)) {
      output.enum = value;
      output.format = "enum";
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      output.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([prop, propSchema]) => [prop, toGeminiSchema(propSchema)],
        ),
      );
      continue;
    }
    if (key === "items") {
      output.items = toGeminiSchema(value);
      continue;
    }
    output[key] = value;
  }

  return output as unknown as ResponseSchema;
}

function normalizeResult(
  parsed: Record<string, unknown>,
  schema?: object,
): Record<string, unknown> {
  const schemaWantsReply = schemaHasProperty(schema, "reply");

  // Some models follow the generic "reply" hint too literally and wrap schemas
  // that do not have a reply field, e.g. { reply: { action, price, message } }.
  // Unwrap that shape for non-chat structured calls such as negotiators.
  if (
    !schemaWantsReply &&
    parsed.reply &&
    typeof parsed.reply === "object" &&
    !Array.isArray(parsed.reply)
  ) {
    return parsed.reply as Record<string, unknown>;
  }

  if (schemaWantsReply) {
    if (parsed.reply === undefined && parsed.response)
      parsed.reply = parsed.response;
    if (parsed.reply === undefined && parsed.message)
      parsed.reply = parsed.message;
    if (parsed.reply === undefined)
      parsed.reply = "¿Podrías darme más detalles?";
  }
  if (schemaHasProperty(schema, "state") && parsed.state === undefined)
    parsed.state = {};
  if (schemaHasProperty(schema, "done") && parsed.done === undefined)
    parsed.done = false;
  return parsed;
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
  if (provider === "gemini") {
    return generateWithGemini(opts);
  }

  return generateWithOpenAi(opts);
}

async function generateWithOpenAi(opts: GenerateOptions): Promise<string> {
  const messages = buildOpenAiMessages(opts);

  const params: OpenAI.ChatCompletionCreateParams = {
    model: openAiModelName,
    messages,
    temperature: opts.temperature ?? 0.7,
  };

  if (opts.jsonSchema) {
    params.response_format = { type: "json_object" };
  }

  const result = await openAiClient.chat.completions.create(params);
  return result.choices[0]?.message?.content ?? "";
}

async function generateWithGemini(opts: GenerateOptions): Promise<string> {
  const model = geminiClient.getGenerativeModel({
    model: geminiModelName,
    systemInstruction: buildSystemContent(opts),
  });

  const request: GenerateContentRequest = {
    contents: buildGeminiContents(opts),
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      ...(opts.jsonSchema
        ? {
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(opts.jsonSchema),
          }
        : {}),
    },
  };

  const result = await model.generateContent(request);
  return result.response.text();
}

export async function generateJSON<T>(opts: GenerateOptions): Promise<T> {
  if (!opts.jsonSchema) {
    throw new Error("generateJSON requires a jsonSchema");
  }
  const text = await generate({
    ...opts,
    temperature: opts.temperature ?? 0.4,
  });
  log("LLM raw response:", text);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return normalizeResult(parsed, opts.jsonSchema) as T;
  } catch (err) {
    log(`${provider} returned invalid JSON:`, text);
    throw new Error(
      `Failed to parse ${provider} JSON response: ${(err as Error).message}`,
    );
  }
}

export async function generateStreamJSON<T>(
  opts: GenerateOptions,
  onReplyChunk: (text: string) => void,
): Promise<T> {
  if (!opts.jsonSchema) {
    throw new Error("generateStreamJSON requires a jsonSchema");
  }

  if (provider === "gemini") {
    return generateGeminiStreamJSON<T>(opts, onReplyChunk);
  }

  return generateOpenAiStreamJSON<T>(opts, onReplyChunk);
}

async function generateOpenAiStreamJSON<T>(
  opts: GenerateOptions,
  onReplyChunk: (text: string) => void,
): Promise<T> {
  const messages = buildOpenAiMessages(opts);

  const stream = await openAiClient.chat.completions.create({
    model: openAiModelName,
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
    const parsed = JSON.parse(fullText) as Record<string, unknown>;
    return normalizeResult(parsed, opts.jsonSchema) as T;
  } catch (err) {
    log("openai returned invalid JSON (stream):", fullText);
    throw new Error(`Failed to parse streamed JSON: ${(err as Error).message}`);
  }
}

async function generateGeminiStreamJSON<T>(
  opts: GenerateOptions,
  onReplyChunk: (text: string) => void,
): Promise<T> {
  const model = geminiClient.getGenerativeModel({
    model: geminiModelName,
    systemInstruction: buildSystemContent(opts),
  });

  const stream = await model.generateContentStream({
    contents: buildGeminiContents(opts),
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(opts.jsonSchema),
    },
  });

  let fullText = "";
  const extractor = new ReplyExtractor();

  for await (const chunk of stream.stream) {
    const delta = chunk.text();
    if (!delta) continue;
    fullText += delta;

    const replyChunk = extractor.feed(delta);
    if (replyChunk) {
      onReplyChunk(replyChunk);
    }
  }

  log("LLM raw streamed response:", fullText);
  try {
    const parsed = JSON.parse(fullText) as Record<string, unknown>;
    return normalizeResult(parsed, opts.jsonSchema) as T;
  } catch (err) {
    log("gemini returned invalid JSON (stream):", fullText);
    throw new Error(`Failed to parse streamed JSON: ${(err as Error).message}`);
  }
}
