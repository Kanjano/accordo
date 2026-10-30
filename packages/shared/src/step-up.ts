import { z } from 'zod';

export type StepUpRequirement = 'password' | 'email_code';

export interface StepUpStatus {
  satisfied: boolean;
  requires: StepUpRequirement[];
  /** Whether the user has a password (otherwise the email code is used instead). */
  hasPassword: boolean;
}

export const stepUpSchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
    emailCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .refine((v) => v.password || v.emailCode, 'STEP_UP_FACTOR_REQUIRED');
export type StepUpInput = z.infer<typeof stepUpSchema>;
