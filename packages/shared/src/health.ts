import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['up', 'down']);

export const healthReportSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(
    z.string(),
    z.object({ status: dependencyStatusSchema, error: z.string().optional() }),
  ),
});

export type HealthReport = z.infer<typeof healthReportSchema>;
