import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

export const validateSchema =
  <Schema extends ZodType>(schema: Schema) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }));

      return res.status(400).json({
        message: "Validation failed",
        errors
      });
    }

    Object.assign(req, { validatedBody: result.data });

    return next();
  };

declare module "express-serve-static-core" {
  interface Request {
    validatedBody?: unknown;
  }
}
