#!/usr/bin/env node
/**
 * Test consumer. PASS prints ALLOWED and does not authorize a payment.
 * FAIL and UNVERIFIABLE both refuse.
 *
 *   node examples/refuse-action.mjs <evidence-file> <receipt.json>
 */
import { readFileSync } from 'node:fs'
import { verify } from '../src/verify.mjs'

const [evidencePath, receiptPath] = process.argv.slice(2)
if (!evidencePath || !receiptPath) {
  console.error('usage: node examples/refuse-action.mjs <evidence-file> <receipt.json>')
  process.exit(64)
}

const out = verify(new Uint8Array(readFileSync(evidencePath)), JSON.parse(readFileSync(receiptPath, 'utf8')))
if (out.result !== 'PASS') {
  process.stdout.write(`REFUSED ${out.result} ${out.reasons.join(',')}\n`)
  process.exit(2)
}
process.stdout.write('ALLOWED\n')
process.stdout.write('The cited spans match and the declared arithmetic reproduces.\n')
process.stdout.write('Genuineness of the document is not established.\n')
process.exit(0)
