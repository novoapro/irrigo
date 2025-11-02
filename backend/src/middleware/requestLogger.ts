import { Request, Response, NextFunction } from "express";

const VERBOSE = (() => {
  const v = (process.env.VERBOSE_LOGGING ?? process.env.VERBOSE ?? "").toString();
  return v === "1" || v.toLowerCase() === "true";
})();

// Simple request logger middleware. Only active when VERBOSE is enabled.
export default function requestLogger(req: Request, _res: Response, next: NextFunction) {
  if (!VERBOSE) return next();

  try {
    const method = req.method;
    const originalUrl = req.originalUrl;
    const ip = req.ip;
    const headers = req.headers;
    const query = req.query;
    const params = req.params;
    const body: unknown = req.body;
    const startTs = Date.now();

    // Limit body logging length to avoid huge output
    let bodyOut: string | undefined;
    if (body && typeof body === "object") {
      try {
        const s = JSON.stringify(body as Record<string, unknown>);
        bodyOut = s.length > 1000 ? s.slice(0, 1000) + "...[truncated]" : s;
      } catch {
        bodyOut = "[unserializable]";
      }
    } else if (typeof body === "string") {
      bodyOut = body;
    }

    // Defer logging until the response finishes so we capture final status and timing
    const onFinish = () => {
      try {
        const duration = Date.now() - startTs;
        // Get final response status - should be set by the time 'finish' fires
        const statusCode = _res.statusCode ?? 0; // fallback if somehow not set

        const now = new Date().toISOString();

        console.info("[REQ]", {
          ts: now,
          method,
          url: originalUrl,
          ip,
          statusCode,
          durationMs: duration,
          headers: {
            host: headers.host,
            referer: (headers.referer ?? headers.referrer) as string | undefined,
            "user-agent": headers["user-agent"]
          },
          query: Object.keys(query ?? {}).length ? query : undefined,
          params: Object.keys(params ?? {}).length ? params : undefined,
          body: bodyOut
        });
      } catch (err) {
        console.warn("[REQ] requestLogger.finish failed", err);
      }
    };

    // Attach once-only finish listener
  _res.on("finish", onFinish);
  } catch (err) {
    console.warn("[REQ] requestLogger failed to stringify request", err);
  }

  return next();
}
