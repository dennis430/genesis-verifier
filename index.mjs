/**
 * Supported import surface. Application code should import `@dws/genesis-verifier`
 * and not files under `src/`.
 *
 * `verify` returns PASS, FAIL, or UNVERIFIABLE. None of those results authorizes
 * a payment, an identity, a signature, or corroboration.
 */
export {
  verify,
  RECEIPT_VERSION,
  REQUIRED_LIMITATIONS,
  RULES,
  NEVER_A_ROOT,
  DECLARED_SOURCE_KINDS,
} from './src/verify.mjs'

export { PDF_TEXT_PROFILE } from './src/pdfText.mjs'
export { CSV_PROFILE_ID } from './src/csv.mjs'
export { CSV_V2_PROFILE_ID } from './src/csvV2.mjs'
export { EXTRACTION_PROFILES } from './src/profiles.mjs'
