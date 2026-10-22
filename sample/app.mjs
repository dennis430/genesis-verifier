import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { REQUIRED_LIMITATIONS, RULES, verify } from '@dws/genesis-verifier'
import { authorizePayable } from './policy.mjs'

const bytes = new Uint8Array(readFileSync(new URL('./invoice.txt', import.meta.url)))
const text = Buffer.from(bytes).toString('utf8')

function span(label) {
  const start = text.indexOf(label)
  return { start, end: start + Buffer.byteLength(label) }
}

const receipt = {
  receiptVersion: 'genesis.receipt.v1',
  rule: RULES.sum,
  evidence: { sha256: createHash('sha256').update(bytes).digest('hex') },
  source: { kind: 'counterparty_supplied' },
  claimStanding: 'derived',
  claim: { text: 'Total invoiced amount: $13,950.00' },
  derivation: {
    type: 'sum',
    expectedTotal: '$13,950.00',
    operands: [
      { label: 'Invoice 001', expectedText: '$6,200.00', span: span('$6,200.00') },
      { label: 'Invoice 002', expectedText: '$7,750.00', span: span('$7,750.00') },
    ],
  },
  limitations: [...REQUIRED_LIMITATIONS],
}

const verdict = verify(bytes, receipt)
const payable = authorizePayable({
  verdict,
  humanApproval: true,
  originAuthenticated: verdict.recomputed?.origin?.cryptographic === 'checked',
})
process.stdout.write(`${verdict.result}\n`)
process.stdout.write(`authorizePayable ${payable}\n`)
process.exit(verdict.result === 'PASS' && payable === false ? 0 : 1)
