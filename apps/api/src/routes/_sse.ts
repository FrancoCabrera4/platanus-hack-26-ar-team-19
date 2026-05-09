import type { Request, Response, NextFunction, RequestHandler } from "express";

// Express 4 doesn't catch async errors automatically — without this wrapper,
// any rejected promise (e.g. Gemini 403 with a missing API key) crashes the
// process. Apply it to every async handler that talks to the LLM.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


export function sseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function sseSend(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function streamWords(res: Response, text: string, delayMs = 18): Promise<void> {
  const tokens = text.match(/\S+\s*/g) ?? [text];
  for (const t of tokens) {
    sseSend(res, { chunk: t });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
}
