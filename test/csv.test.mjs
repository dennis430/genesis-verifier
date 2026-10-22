import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from '../src/hash.mjs'
import { extractCsvV1 } from '../src/csv.mjs'
import { verify, REQUIRED_LIMITATIONS } from '../src/verify.mjs'
import { CSV_PROFILE_ID, EXTRACTION_PROFILES } from '../index.mjs'

const csv = new TextEncoder().encode([
  'Invoice 001,"$6,200.00"',
  'Invoice 002,"$7,750.00"',
  'Invoice 003,"$4,500.00"',
  '',
].join('\n'))

function receiptFor(bytes, mutate) {
  const extracted = extractCsvV1(bytes)
  assert.equal(extracted.ok, true)
  const receipt = {
    receiptVersion: 'genesis.receipt.v1',
    rule: { id: 'sum.exact', version: '1' },
    evidence: { sha256: sha256Hex(bytes), mediaType: 'text/csv' },
    extraction: { profile: CSV_PROFILE_ID, extractedSha256: sha256Hex(extracted.bytes) },
    source: { kind: 'counterparty_supplied' },
    claimStanding: 'derived',
    claim: { text: 'Total invoiced amount: $18,450.00' },
    derivation: {
      type: 'sum',
      operands: ['$6,200.00', '$7,750.00', '$4,500.00'].map((expectedText, index) => {
        const start = extracted.text.indexOf(expectedText)
        return {
          label: `Invoice ${index + 1}`,
          expectedText,
          span: { start, end: start + Buffer.byteLength(expectedText) },
        }
      }),
      expectedTotal: '$18,450.00',
    },
    limitations: [...REQUIRED_LIMITATIONS, 'SPANS_ADDRESS_CANONICAL_CELLS_NOT_SOURCE_BYTES'],
  }
  return mutate ? mutate(receipt, extracted) : receipt
}

test('a quoted CSV cell is reproduced from the source bytes, not from a caller extract', () => {
  const extracted = extractCsvV1(csv)
  const cell = '$6,200.00'
  const canonicalAt = extracted.text.indexOf(cell)
  const sourceAt = Buffer.from(csv).toString('utf8').indexOf(cell)
  assert.notEqual(canonicalAt, sourceAt)
  const profile = EXTRACTION_PROFILES[CSV_PROFILE_ID]
  assert.equal(profile.algorithm, 'csv-rfc4180-cells')
  assert.equal(profile.version, '1')
  assert.match(profile.hashing, /SHA-256/)
  const out = verify(csv, receiptFor(csv))
  assert.equal(out.result, 'PASS')
  assert.equal(out.recomputed.total, '$18,450.00')
  assert.equal(out.recomputed.origin.sourceKindEstablished, false)
  assert.equal(out.recomputed.origin.cryptographic, 'not_checked')
})

test('a caller-supplied extract is not accepted even when its hash would match', () => {
  const receipt = receiptFor(csv, (draft, extracted) => {
    draft.extraction.text = extracted.text
    return draft
  })
  const out = verify(csv, receipt)
  assert.equal(out.result, 'FAIL')
  assert.equal(out.reasons[0], 'CALLER_EXTRACT_NOT_ACCEPTED')
})

test('a changed source byte fails the original hash before the profile runs', () => {
  const tampered = new Uint8Array(csv)
  tampered[0] = 0x5a
  const out = verify(tampered, receiptFor(csv))
  assert.equal(out.result, 'FAIL')
  assert.equal(out.reasons[0], 'EVIDENCE_HASH_MISMATCH')
})

test('CRLF, a BOM, and an uneven row are unverifiable rather than normalized', () => {
  const crlf = new TextEncoder().encode('A,"$1.00"\r\nB,"$2.00"\n')
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('A,$1.00\n')])
  const uneven = new TextEncoder().encode('A,$1.00\nB\n')
  for (const [bytes, reason] of [[crlf, 'CSV_CR_UNSUPPORTED'], [bom, 'CSV_BOM_UNSUPPORTED'], [uneven, 'CSV_UNEVEN_ROW']]) {
    const draft = receiptFor(csv)
    draft.evidence.sha256 = sha256Hex(bytes)
    const out = verify(bytes, draft)
    assert.equal(out.result, 'UNVERIFIABLE')
    assert.equal(out.reasons[0], reason)
  }
})
