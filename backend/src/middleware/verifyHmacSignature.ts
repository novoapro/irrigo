import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { getConfig } from "../services/compAIService";

declare module "express-serve-static-core" {
  interface Request {
    rawBody?: Buffer;
  }
}

export const verifyHmacSignature = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getConfig();

    if (!config || !config.enabled) {
      return res.status(503).json({ message: "CompAI integration is not configured or disabled" });
    }

    if (!config.webhookSecret) {
      return next();
    }

    const signatureHeader = req.headers["x-signature-256"] as string | undefined;
    if (!signatureHeader) {
      return res.status(401).json({ message: "Missing X-Signature-256 header" });
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      return res.status(500).json({ message: "Raw body not available for signature verification" });
    }

    const expectedSig = "sha256=" + crypto
      .createHmac("sha256", config.webhookSecret)
      .update(rawBody)
      .digest("hex");

    const sigBuffer = Buffer.from(signatureHeader);
    const expectedBuffer = Buffer.from(expectedSig);

    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return res.status(403).json({ message: "Invalid signature" });
    }

    next();
  } catch (error) {
    console.error("HMAC verification error:", error);
    res.status(500).json({ message: "Signature verification failed" });
  }
};
