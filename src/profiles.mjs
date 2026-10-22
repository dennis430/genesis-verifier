import { extractPdfTextV1, PDF_TEXT_PROFILE } from './pdfText.mjs'
import { CSV_LIMITATION, CSV_PROFILE, CSV_PROFILE_ID, extractCsvV1 } from './csv.mjs'
import { CSV_V2_LIMITATION, CSV_V2_PROFILE, CSV_V2_PROFILE_ID, extractCsvV2 } from './csvV2.mjs'

export const PDF_LIMITATION = 'SPANS_ADDRESS_EXTRACTED_TEXT_NOT_PDF_BYTES'

export const PDF_PROFILE = Object.freeze({
  id: PDF_TEXT_PROFILE,
  algorithm: 'pdf-literal-show-text',
  version: '1',
  input: 'application/pdf starting with %PDF-. Uncompressed streams or a single FlateDecode. No ToUnicode, encryption, object streams, non-ASCII shown strings, or other filters.',
  output: 'UTF-8. Each shown string copied unchanged and followed by \\n. Pages that contain shown text are joined with U+000C. No normalization.',
  hashing: 'lowercase hex SHA-256 of the UTF-8 output bytes',
})

/** Data a caller can read. Functions that reproduce an extract are not on this object. */
export const EXTRACTION_PROFILES = Object.freeze({
  [PDF_TEXT_PROFILE]: PDF_PROFILE,
  [CSV_PROFILE_ID]: CSV_PROFILE,
  [CSV_V2_PROFILE_ID]: CSV_V2_PROFILE,
})

export const PROFILE_RUNNERS = Object.freeze({
  [PDF_TEXT_PROFILE]: Object.freeze({
    requiredLimitation: PDF_LIMITATION,
    reproduce: extractPdfTextV1,
  }),
  [CSV_PROFILE_ID]: Object.freeze({
    mediaType: 'text/csv',
    requiredLimitation: CSV_LIMITATION,
    reproduce: extractCsvV1,
  }),
  [CSV_V2_PROFILE_ID]: Object.freeze({
    mediaType: 'text/csv',
    requiredLimitation: CSV_V2_LIMITATION,
    reproduce: extractCsvV2,
  }),
})
