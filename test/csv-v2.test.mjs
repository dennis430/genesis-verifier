import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from '../src/hash.mjs'
import { extractCsvV1 } from '../src/csv.mjs'
import { extractCsvV2 } from '../src/csvV2.mjs'
import { verify, REQUIRED_LIMITATIONS } from '../src/verify.mjs'
import { CSV_PROFILE_ID, CSV_V2_PROFILE_ID, EXTRACTION_PROFILES } from '../index.mjs'

const logical = 'Invoice 001,"$6,200.00"\nInvoice 002,"$7,750.00"\nInvoice 003,"$4,500.00"\n'
const crlf = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(logical.replaceAll('\n', '\r\n'), 'utf8')])

function receipt(bytes, profileId, extracted, claim = 'Total invoiced amount: $18,450.00') {
  return {
    receiptVersion: 'genesis.receipt.v1',
    rule: { id: 'sum.exact', version: '1' },
    evidence: { sha256: sha256Hex(bytes), mediaType: 'text/csv' },
    extraction: { profile: profileId, extractedSha256: sha256Hex(extracted.bytes) },
    source: { kind: 'counterparty_supplied' },
    claimStanding: 'derived',
    claim: { text: claim },
    derivation: {
      type: 'sum',
      expectedTotal: '$18,450.00',
      operands: ['$6,200.00', '$7,750.00', '$4,500.00'].map((expectedText) => {
        const start = extracted.text.indexOf(expectedText)
        return { expectedText, span: { start, end: start + Buffer.byteLength(expectedText) } }
      }),
    },
    limitations: [...REQUIRED_LIMITATIONS, 'SPANS_ADDRESS_CANONICAL_CELLS_NOT_SOURCE_BYTES'],
  }
}

test('v1 still rejects a BOM and CRLF, and v2 reproduces that export', () => {
  assert.equal(extractCsvV1(crlf).reason, 'CSV_BOM_UNSUPPORTED')
  const v1 = verify(crlf, receipt(crlf, CSV_PROFILE_ID, { bytes: new Uint8Array(), text: '' }))
  assert.equal(v1.result, 'UNVERIFIABLE')
  assert.equal(v1.reasons[0], 'CSV_BOM_UNSUPPORTED')
  const extracted = extractCsvV2(crlf)
  assert.equal(extracted.ok, true)
  assert.equal(EXTRACTION_PROFILES[CSV_V2_PROFILE_ID].version, '2')
  assert.equal(EXTRACTION_PROFILES[CSV_PROFILE_ID].version, '1')
  const out = verify(crlf, receipt(crlf, CSV_V2_PROFILE_ID, extracted))
  assert.equal(out.result, 'PASS')
  assert.equal(out.recomputed.total, '$18,450.00')
  assert.equal(out.recomputed.origin.cryptographic, 'not_checked')
  const plain = extractCsvV2(Buffer.from(logical, 'utf8'))
  assert.equal(plain.text, extracted.text)
})

test('v2 does not skip a blank row or pad an uneven row', () => {
  const blank = Buffer.from('A,$1.00\r\n\r\nB,$2.00\r\n', 'utf8')
  const uneven = Buffer.from('A,$1.00\nB\n', 'utf8')
  assert.equal(extractCsvV2(blank).reason, 'CSV_UNEVEN_ROW')
  assert.equal(extractCsvV2(uneven).reason, 'CSV_UNEVEN_ROW')
  const oneColumn = Buffer.from('only\n\n', 'utf8')
  const kept = extractCsvV2(oneColumn)
  assert.equal(kept.ok, true)
  assert.match(kept.text, /^1\t1\tonly\n2\t1\t\n$/)
})

test('a quoted line break is escaped in the extract and a pasted extract is refused', () => {
  const file = Buffer.from('"Inv\\noice"\r\nnote,"$6,200.00"\r\nnext,"$1.00"\r\n', 'utf8')
  const extracted = extractCsvV2(Buffer.from('"Line one\nline two","$6,200.00"\r\nnext,"$1.00"\r\n', 'utf8'))
  assert.equal(extracted.ok, true, extracted.reason)
  assert.match(extracted.text, /1\t1\tLine one\\nline two\n/)
  assert.match(extracted.text, /1\t2\t\$6,200\.00\n/)
  const draft = {
    receiptVersion: 'genesis.receipt.v1',
    rule: { id: 'quotation.exact', version: '1' },
    evidence: { sha256: sha256Hex(Buffer.from('"Line one\nline two","$6,200.00"\r\nnext,"$1.00"\r\n', 'utf8')), mediaType: 'text/csv' },
    extraction: {
      profile: CSV_V2_PROFILE_ID,
      extractedSha256: sha256Hex(extracted.bytes),
      text: extracted.text,
    },
    source: { kind: 'counterparty_supplied' },
    claimStanding: 'observed',
    claim: { text: '$6,200.00' },
    derivation: {
      type: 'quotation',
      expectedText: '$6,200.00',
      span: { start: extracted.text.indexOf('$6,200.00'), end: extracted.text.indexOf('$6,200.00') + 9 },
    },
    limitations: [...REQUIRED_LIMITATIONS, 'SPANS_ADDRESS_CANONICAL_CELLS_NOT_SOURCE_BYTES'],
  }
  const refused = verify(Buffer.from('"Line one\nline two","$6,200.00"\r\nnext,"$1.00"\r\n', 'utf8'), draft)
  assert.equal(refused.result, 'FAIL')
  assert.equal(refused.reasons[0], 'CALLER_EXTRACT_NOT_ACCEPTED')
  delete draft.extraction.text
  const passed = verify(Buffer.from('"Line one\nline two","$6,200.00"\r\nnext,"$1.00"\r\n', 'utf8'), draft)
  assert.equal(passed.result, 'PASS')
  assert.equal(file.length > 0, true)
})

test('a bare CR is unverifiable', () => {
  assert.equal(extractCsvV2(Buffer.from('A,$1.00\rB,$2.00\n', 'utf8')).reason, 'CSV_BARE_CR')
})
