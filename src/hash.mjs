import { createHash } from 'node:crypto'

/**
 * Same construction as `sha256` in lib/provenance/core/observation.ts:
 * SHA-256, lowercase hex. That function hashes a string. This hashes the
 * evidence bytes a receipt cites, which is the identity the verifier can recompute.
 */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
