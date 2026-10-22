import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { sha256Hex } from '../src/hash.mjs'
import { extractPdfTextV1 } from '../src/pdfText.mjs'
import { verify, REQUIRED_LIMITATIONS } from '../src/verify.mjs'
import { textPdf } from '../examples/pdfFixture.mjs'
import { evidenceGate } from '../consumer/gate.mjs'

const lines = [
  'Invoice 001 $6,200.00',
  'Invoice 002 $7,750.00',
  'Invoice 003 $4,500.00',
  'Subtotal $18,450.00',
  'Tax $1,845.00',
  'Total $20,295.00',
  'Rate 0.10',
  'Piece 1.00',
  'Divisor 8.00',
]
const pdf = new Uint8Array(textPdf(lines))
const extracted = extractPdfTextV1(pdf)
const limits = [...REQUIRED_LIMITATIONS, 'SPANS_ADDRESS_EXTRACTED_TEXT_NOT_PDF_BYTES']

function spanOf(text) {
  const start = extracted.text.indexOf(text)
  assert.ok(start >= 0, text)
  return { start, end: start + Buffer.byteLength(text), page: 1 }
}

function leaf(text, extra = {}) {
  return { op: 'span', label: text, expectedText: text, span: spanOf(text), unit: 'USD', period: '2026-01', ...extra }
}

function base(derivation, rule, claim, standing = 'derived') {
  return {
    receiptVersion: 'genesis.receipt.v1',
    rule,
    evidence: { sha256: sha256Hex(pdf), mediaType: 'application/pdf' },
    extraction: { profile: 'genesis.pdf-text.v1', extractedSha256: sha256Hex(extracted.bytes) },
    source: { kind: 'counterparty_supplied' },
    claimStanding: standing,
    claim: { text: claim },
    derivation,
    limitations: limits,
  }
}

test('a flate PDF sum uses extracted text, not PDF byte offsets', () => {
  assert.equal(extracted.ok, true)
  const amount = '$6,200.00'
  const at = extracted.text.indexOf(amount)
  const pdfSlice = Buffer.from(pdf.subarray(at, at + amount.length)).toString('latin1')
  assert.notEqual(pdfSlice, amount)
  const receipt = base({
    type: 'sum',
    operands: [leaf('Invoice 001 $6,200.00'.includes('$6,200.00') ? '$6,200.00' : amount), leaf('$7,750.00'), leaf('$4,500.00')],
    expectedTotal: '$18,450.00',
  }, { id: 'sum.exact', version: '1' }, 'Total invoiced amount: $18,450.00')
  receipt.derivation.operands = [
    { label: 'Invoice 001', expectedText: '$6,200.00', span: spanOf('$6,200.00'), unit: 'USD', period: '2026-01' },
    { label: 'Invoice 002', expectedText: '$7,750.00', span: spanOf('$7,750.00'), unit: 'USD', period: '2026-01' },
    { label: 'Invoice 003', expectedText: '$4,500.00', span: spanOf('$4,500.00'), unit: 'USD', period: '2026-01' },
  ]
  const out = verify(pdf, receipt)
  assert.equal(out.result, 'PASS')
  assert.equal(out.recomputed.total, '$18,450.00')
  assert.equal(out.recomputed.origin.bytes, 'verified')
  assert.equal(out.recomputed.origin.sourceKindEstablished, false)
  assert.equal(out.recomputed.origin.cryptographic, 'not_checked')
})

test('a PDF without an extraction profile is unverifiable', () => {
  const receipt = base({ type: 'quotation', span: spanOf('$6,200.00'), expectedText: '$6,200.00' }, { id: 'quotation.exact', version: '1' }, '$6,200.00', 'observed')
  delete receipt.extraction
  const out = verify(pdf, receipt)
  assert.equal(out.result, 'UNVERIFIABLE')
  assert.equal(out.reasons[0], 'PDF_EXTRACTION_REQUIRED')
})

test('scanned-equivalent and ToUnicode PDFs are unverifiable', () => {
  const emptyPdf = new Uint8Array(textPdf([], { empty: true }))
  const emptyReceipt = base(
    { type: 'sum', operands: [{ label: 'A', expectedText: '$1.00', span: { start: 0, end: 4 } }, { label: 'B', expectedText: '$2.00', span: { start: 0, end: 4 } }], expectedTotal: '$3.00' },
    { id: 'sum.exact', version: '1' },
    'Total $3.00',
  )
  emptyReceipt.evidence.sha256 = sha256Hex(emptyPdf)
  const empty = verify(emptyPdf, emptyReceipt)
  assert.equal(empty.result, 'UNVERIFIABLE')
  assert.equal(empty.reasons[0], 'NO_EXTRACTABLE_TEXT')
  const mappedPdf = new Uint8Array(textPdf(lines, { toUnicode: true }))
  const mappedReceipt = base(
    { type: 'quotation', span: { start: 0, end: 1, page: 1 }, expectedText: 'X' },
    { id: 'quotation.exact', version: '1' },
    'X',
    'observed',
  )
  mappedReceipt.evidence.sha256 = sha256Hex(mappedPdf)
  const mapped = verify(mappedPdf, mappedReceipt)
  assert.equal(mapped.result, 'UNVERIFIABLE')
  assert.equal(mapped.reasons[0], 'TOUNICODE_UNSUPPORTED')
})

test('page, reconciliation, difference, product, rounded quotient, and percent', () => {
  const quoted = base({
    type: 'quotation',
    span: spanOf('$6,200.00'),
    expectedText: '$6,200.00',
  }, { id: 'quotation.exact', version: '1' }, '$6,200.00', 'observed')
  assert.equal(verify(pdf, quoted).result, 'PASS')
  quoted.derivation.span = { ...quoted.derivation.span, page: 2 }
  assert.equal(verify(pdf, quoted).result, 'FAIL')
  assert.equal(verify(pdf, quoted).reasons[0], 'PAGE_MISMATCH')

  const reconcile = base({
    type: 'reconcile',
    components: [
      { label: 'Subtotal', expectedText: '$18,450.00', span: spanOf('$18,450.00'), unit: 'USD', period: '2026-01' },
      { label: 'Tax', expectedText: '$1,845.00', span: spanOf('$1,845.00'), unit: 'USD', period: '2026-01' },
    ],
    total: { label: 'Total', expectedText: '$20,295.00', span: spanOf('$20,295.00'), unit: 'USD', period: '2026-01' },
  }, { id: 'reconcile.exact', version: '1' }, 'Total $20,295.00')
  const reconciled = verify(pdf, reconcile)
  assert.equal(reconciled.result, 'PASS', JSON.stringify(reconciled))
  assert.equal(reconciled.recomputed.value, '20295.00')

  const rateSpan = spanOf('0.10')
  const calc = (expression, expected, claim, rounding) => base({
    type: 'calculate',
    expression,
    expectedTotal: expected,
    ...(rounding ? { rounding } : {}),
  }, { id: 'calculate.exact', version: '1' }, claim)
  const subtotal = leaf('$18,450.00')
  const tax = leaf('$1,845.00')
  assert.equal(verify(pdf, calc({ op: 'sub', args: [leaf('$20,295.00'), tax] }, '18450.00', 'Subtotal 18450.00')).result, 'PASS')
  const product = calc({
    op: 'mul',
    args: [subtotal, { op: 'span', label: 'Rate', expectedText: '0.10', span: rateSpan }],
  }, '1845.00', 'Tax 1845.00')
  assert.equal(verify(pdf, product).result, 'PASS')
  assert.equal(verify(pdf, product).recomputed.unit, 'USD')
  const percent = calc({ op: 'pct', args: [tax, subtotal] }, '10.00', 'Rate 10.00', { mode: 'half_even', scale: 2 })
  assert.equal(verify(pdf, percent).result, 'PASS')
  const quarter = calc({
    op: 'div',
    args: [
      { op: 'span', label: 'One', expectedText: '1.00', span: spanOf('1.00') },
      { op: 'span', label: 'Eight', expectedText: '8.00', span: spanOf('8.00') },
    ],
  }, '0.13', 'Quotient 0.13', { mode: 'half_up', scale: 2 })
  assert.equal(verify(pdf, quarter).reasons.join(','), '')
  assert.equal(verify(pdf, quarter).result, 'PASS')
  quarter.derivation.rounding = { mode: 'half_even', scale: 2 }
  quarter.derivation.expectedTotal = '0.12'
  quarter.claim.text = 'Quotient 0.12'
  assert.equal(verify(pdf, quarter).result, 'PASS')
  quarter.derivation.rounding = undefined
  const unrounded = verify(pdf, quarter)
  assert.equal(unrounded.result, 'UNVERIFIABLE')
  assert.equal(unrounded.reasons[0], 'ROUNDING_REQUIRED')
})

test('the extract does not contain 1.00; div fixture is on the ledger text', () => {
  const ledger = 'Piece 1.00\nDivisor 8.00\nA 0.30\nB 0.10\n'
  const bytes = new TextEncoder().encode(ledger)
  const at = (text) => {
    const start = ledger.indexOf(text)
    return { start, end: start + text.length }
  }
  const receipt = {
    receiptVersion: 'genesis.receipt.v1',
    rule: { id: 'calculate.exact', version: '1' },
    evidence: { sha256: sha256Hex(bytes) },
    source: { kind: 'counterparty_supplied' },
    claimStanding: 'derived',
    claim: { text: 'Remainder 0.00' },
    derivation: {
      type: 'calculate',
      expectedTotal: '0.00',
      expression: {
        op: 'sub',
        args: [
          { op: 'sub', args: [
            { op: 'sub', args: [
              { op: 'span', expectedText: '0.30', span: at('0.30'), unit: 'USD', period: '2026-01' },
              { op: 'span', expectedText: '0.10', span: at('0.10'), unit: 'USD', period: '2026-01' },
            ] },
            { op: 'span', expectedText: '0.10', span: at('0.10'), unit: 'USD', period: '2026-01' },
          ] },
          { op: 'span', expectedText: '0.10', span: at('0.10'), unit: 'USD', period: '2026-01' },
        ],
      },
    },
    limitations: [...REQUIRED_LIMITATIONS],
  }
  const out = verify(bytes, receipt)
  assert.equal(out.result, 'PASS', JSON.stringify(out))
  assert.equal(out.recomputed.value, '0.00')
  receipt.derivation.expression.args[0].args[0].args[0].unit = 'EUR'
  const mismatched = verify(bytes, receipt)
  assert.equal(mismatched.result, 'FAIL')
  assert.equal(mismatched.reasons[0], 'UNIT_MISMATCH')
})

test('a caller cannot promote a declared origin into authentication', () => {
  const receipt = base({
    type: 'quotation',
    span: spanOf('$6,200.00'),
    expectedText: '$6,200.00',
  }, { id: 'quotation.exact', version: '1' }, '$6,200.00', 'observed')
  receipt.origin = { assurance: 'cryptographically_authenticated' }
  const out = verify(pdf, receipt)
  assert.equal(out.result, 'FAIL')
  assert.equal(out.reasons[0], 'ORIGIN_OVERCLAIM')
  receipt.origin = { assurance: 'independently_corroborated' }
  assert.equal(verify(pdf, receipt).reasons[0], 'ORIGIN_OVERCLAIM')
  receipt.origin = { assurance: 'declared' }
  receipt.source.kindProven = true
  assert.equal(verify(pdf, receipt).reasons[0], 'ORIGIN_OVERCLAIM')
})

test('the internal wrapper reproduces a PDF sum and does not authorize a payable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'genesis-'))
  const evidencePath = join(dir, 'invoice.pdf')
  const passPath = join(dir, 'pass.json')
  const failPath = join(dir, 'fail.json')
  writeFileSync(evidencePath, pdf)
  const pass = base({
    type: 'sum',
    operands: [
      { label: 'Invoice 001', expectedText: '$6,200.00', span: spanOf('$6,200.00') },
      { label: 'Invoice 002', expectedText: '$7,750.00', span: spanOf('$7,750.00') },
      { label: 'Invoice 003', expectedText: '$4,500.00', span: spanOf('$4,500.00') },
    ],
    expectedTotal: '$18,450.00',
  }, { id: 'sum.exact', version: '1' }, 'Total invoiced amount: $18,450.00')
  writeFileSync(passPath, JSON.stringify(pass))
  const blocked = { ...pass, origin: { assurance: 'cryptographically_authenticated' } }
  writeFileSync(failPath, JSON.stringify(blocked))
  const root = fileURLToPath(new URL('..', import.meta.url))
  const script = join(root, 'consumer', 'record-payable.mjs')
  const allowed = spawnSync(process.execPath, [script, evidencePath, passPath], { encoding: 'utf8' })
  assert.equal(allowed.status, 0, allowed.stderr)
  assert.match(allowed.stdout, /^assertion reproduced \$18,450\.00\n/)
  assert.match(allowed.stdout, /payable not authorized/)
  const refused = spawnSync(process.execPath, [script, evidencePath, failPath], { encoding: 'utf8' })
  assert.equal(refused.status, 1)
  assert.match(refused.stdout, /^assertion rejected ORIGIN_OVERCLAIM\n/)
  assert.equal(evidenceGate(pdf, blocked).reproduced, false)
  assert.equal(evidenceGate(pdf, blocked).authorizePayable, false)
  rmSync(dir, { recursive: true, force: true })
  const exampleDir = fileURLToPath(new URL('../examples/', import.meta.url))
  writeFileSync(join(exampleDir, 'invoice.pdf'), pdf)
  writeFileSync(join(exampleDir, 'invoice-empty.pdf'), textPdf([], { empty: true }))
  writeFileSync(join(exampleDir, 'receipts', 'pdf-sum.json'), `${JSON.stringify(pass, null, 2)}\n`)
})
