import { createHash } from 'node:crypto';
export * from './contract-schema.js';

export function snapshotHash(input) {
  return createHash('sha256').update(JSON.stringify({ worksheet: input.worksheet, address: input.address, values: input.values, formulas: input.formulas ?? null })).digest('hex');
}
