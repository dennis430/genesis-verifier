import { verify } from '../src/verify.mjs'

/**
 * Internal demonstration wrapper. `reproduced` means the receipt checked out.
 * `authorizePayable` is always false: this function is not an authorization policy.
 */
export function evidenceGate(evidenceBytes, receipt) {
  const verdict = verify(evidenceBytes, receipt)
  return {
    reproduced: verdict.result === 'PASS',
    rejected: verdict.result === 'FAIL',
    unsupported: verdict.result === 'UNVERIFIABLE',
    authorizePayable: false,
    verdict,
  }
}
