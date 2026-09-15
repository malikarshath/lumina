import type { Response } from "express";

// Open an SSE stream: these headers tell the browser "this is a long-lived
// event stream, don't buffer or cache it."
export function sseInit(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

// One SSE frame is: `event: <name>\n` then `data: <json>\n\n` (blank line ends it).
export function sseSend(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
