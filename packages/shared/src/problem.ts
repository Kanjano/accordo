import { z } from 'zod';

/** RFC 9457 Problem Details with a stable application `code`. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** STEP_UP_REQUIRED: the factors the client must provide. */
  requires: z.array(z.enum(['password', 'email_code'])).optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  IMPERSONATION_READ_ONLY: 'IMPERSONATION_READ_ONLY',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  RATE_LIMITED: 'RATE_LIMITED',
  OPEN_ORDERS: 'OPEN_ORDERS',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
