import OpenAI, { toFile } from "openai";

const openAiApiKey = process.env.OPENAI_API_KEY;
const transcriptionModel = process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1";

const openAiClient = new OpenAI({ apiKey: openAiApiKey ?? "missing" });

export async function transcribeAudio(input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<string> {
  if (!openAiApiKey) {
    throw new Error("missing_openai_api_key");
  }

  const file = await toFile(input.buffer, input.filename, {
    type: input.mimeType,
  });
  const result = await openAiClient.audio.transcriptions.create({
    file,
    model: transcriptionModel,
    language: "es",
  });

  return result.text;
}
