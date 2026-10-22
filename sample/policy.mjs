/** Caller policy. The verifier does not import this file. */
export function authorizePayable({ verdict, humanApproval = false, originAuthenticated = false }) {
  if (!verdict || verdict.result !== 'PASS') return false
  if (humanApproval !== true) return false
  if (originAuthenticated !== true) return false
  return true
}
