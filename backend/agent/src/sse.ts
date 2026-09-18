import type { Response } from "express";

/**
 * Express buffers Server-Sent Events by default, and so do most proxies. Get
 * these headers and the flush right or the tokens all arrive at once at the
 * end, which reads as "the model is slow" and fails the TTFT SLA for a reason
 * no profiler will show you.
 *
 * Also: do NOT put compression() in front of the ask route.
 */
export function sseInit(res: Response) {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // nginx / Render's proxy will otherwise hold the stream until it has a bufferful.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

/**
 * Write one SSE frame and flush it. The blank line terminates the frame.
 *
 * `data` is the event payload ONLY -- the event name lives in the `event:`
 * line and must not be duplicated inside the JSON. The contract's schemas
 * (and the grader's parser, which does `out.sources = parsed`) expect the
 * payload itself, so a `sources` frame carries a bare array.
 */
export function sseSend(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // @ts-expect-error `flush` exists when a compression middleware is present; harmless otherwise.
  if (typeof res.flush === "function") res.flush();
}
