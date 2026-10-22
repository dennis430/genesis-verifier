import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { verify } from '../src/verify.mjs'
import { parseMoneyToCents } from '../src/money.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples')

function load(name) {
  return JSON.parse(readFileSync(join(root, 'receipts', name), 'utf8'))
}

const invoices = new Uint8Array(readFileSync(join(root, 'invoices.txt')))
const tampered = new Uint8Array(readFileSync(join(root, 'invoices-tampered.txt')))

test('sum of the three invoice spans passes', () => {
  const out = verify(invoices, load('sum-pass.json'))
  assert.equal(out.result, 'PASS')
  assert.equal(out.recomputed.total, '$18,450.00')
  assert.equal(out.recomputed.genuineness, 'not_established')
  assert.equal(out.checks.arithmetic, 'reproduced')
})

test('a changed evidence byte fails closed on the hash', () => {
  const out = verify(tampered, load('sum-pass.json'))
  assert.equal(out.result, 'FAIL')
  assert.deepEqual(out.reasons, ['EVIDENCE_HASH_MISMATCH'])
})

test('a shifted span fails', () => {
  const out = verify(invoices, load('bad-span.json'))
  assert.equal(out.result, 'FAIL')
  assert.ok(out.reasons.includes('SPAN_TEXT_MISMATCH'))
})

test('a declared total that is not the sum fails', () => {
  const out = verify(invoices, load('bad-arithmetic.json'))
  assert.equal(out.result, 'FAIL')
  assert.equal(out.reasons[0], 'ARITHMETIC_DOES_NOT_REPRODUCE')
  assert.equal(out.recomputed.total, '$18,450.00')
  assert.equal(out.recomputed.expected, '$19,000.00')
})

test('an inference derivation is not admitted', () => {
  const out = verify(invoices, load('inference.json'))
  assert.equal(out.result, 'FAIL')
  assert.ok(out.reasons.includes('INFERENCE_NOT_ADMITTED'))
})

test('model output cannot corroborate even when the spans match', () => {
  const out = verify(invoices, load('model-output.json'))
  assert.equal(out.result, 'FAIL')
  assert.deepEqual(out.reasons, ['SOURCE_CANNOT_CORROBORATE'])
})

test('exact quotation passes and does not claim the document is genuine', () => {
  const out = verify(invoices, load('quotation-pass.json'))
  assert.equal(out.result, 'PASS')
  assert.equal(out.recomputed.spanText, '$6,200.00')
  assert.ok(out.limitations.includes('GENUINENESS_NOT_ESTABLISHED'))
})

test('calling a sum observed is a standing promotion and fails', () => {
  const receipt = load('sum-pass.json')
  receipt.claimStanding = 'observed'
  const out = verify(invoices, receipt)
  assert.equal(out.result, 'FAIL')
  assert.deepEqual(out.reasons, ['STANDING_PROMOTION'])
})

test('dropping the genuineness limitation fails', () => {
  const receipt = load('sum-pass.json')
  receipt.limitations = receipt.limitations.filter((id) => id !== 'GENUINENESS_NOT_ESTABLISHED')
  const out = verify(invoices, receipt)
  assert.equal(out.result, 'FAIL')
  assert.ok(out.reasons.some((r) => r.includes('GENUINENESS_NOT_ESTABLISHED')))
})

test('ambiguous amounts are unverifiable rather than guessed', () => {
  assert.equal(parseMoneyToCents('1.234'), null)
  assert.equal(parseMoneyToCents('$1,234.56'), 123456n)
  assert.equal(parseMoneyToCents('$18,450'), 1845000n)
})

test('the external consumer refuses a failed receipt and allows a passing one', () => {
  const script = join(root, 'refuse-action.mjs')
  const evidence = join(root, 'invoices.txt')
  const pass = spawnSync(process.execPath, [script, evidence, join(root, 'receipts', 'sum-pass.json')], { encoding: 'utf8' })
  assert.equal(pass.status, 0)
  assert.match(pass.stdout, /^ALLOWED\n/)
  assert.match(pass.stdout, /not established/)
  const fail = spawnSync(process.execPath, [script, evidence, join(root, 'receipts', 'model-output.json')], { encoding: 'utf8' })
  assert.equal(fail.status, 2)
  assert.match(fail.stdout, /^REFUSED FAIL SOURCE_CANNOT_CORROBORATE\n/)
})
