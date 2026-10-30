export * from './health.js';
export * from './problem.js';

export const CURRENCY = 'EUR' as const;
export type Currency = typeof CURRENCY;
