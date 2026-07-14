import { ZodError } from 'zod';

export function validate(schema) {
  return (req, res, next) => {
    try {
      req.validated = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(422).json({
          error: 'Validation failed',
          details: error.errors.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        });
      }

      return next(error);
    }
  };
}

