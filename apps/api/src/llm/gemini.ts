import {
  GoogleGenerativeAI,
  type Content,
  type GenerationConfig,
  type Schema,
} from "@google/generative-ai";
import { log } from "@repo/logger";

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

if (!apiKey) {
  log("WARN: GEMINI_API_KEY is not set — LLM calls will fail.");
}

const client = new GoogleGenerativeAI(apiKey ?? "missing");

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

function toGeminiHistory(history: ChatTurn[]): Content[] {
  return history
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
}

export async function generate(opts: GenerateOptions): Promise<string> {
  const generationConfig: GenerationConfig = {
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = opts.jsonSchema as unknown as Schema;
  }

  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: opts.system,
    generationConfig,
  });

  const contents = toGeminiHistory(opts.history);
  const result = await model.generateContent({ contents });
  return result.response.text();
}

export async function generateJSON<T>(opts: GenerateOptions): Promise<T> {
  if (!opts.jsonSchema) {
    throw new Error("generateJSON requires a jsonSchema");
  }
  const text = await generate({ ...opts, temperature: opts.temperature ?? 0.4 });
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    log("Gemini returned invalid JSON:", text);
    throw new Error(`Failed to parse Gemini JSON response: ${(err as Error).message}`);
  }
}
