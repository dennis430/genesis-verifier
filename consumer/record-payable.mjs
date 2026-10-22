#!/usr/bin/env node
/**
 * Internal demonstration. It does not authorize a payable.
 * A PASS is reported as a reproduced assertion and nothing more.
 *
 *   node consumer/record-payable.mjs <evidence-file> <receipt.json>
 */
import { readFileSync } from 'node:fs'
import { evidenceGate } from './gate.mjs'

const [evidencePath, receiptPath] = process.argv.slice(2)
if (!evidencePath || !receiptPath) {
  console.error('usage: node consumer/record-payable.mjs <evidence-file> <receipt.json>')
  process.exit(64)
}

const decision = evidenceGate(
  new Uint8Array(readFileSync(evidencePath)),
  JSON.parse(readFileSync(receiptPath, 'utf8')),
)
const shown = decision.verdict.recomputed?.total ?? decision.verdict.recomputed?.value ?? decision.verdict.recomputed?.spanText ?? ''
if (decision.reproduced) {
  process.stdout.write(`assertion reproduced ${shown}\n`)
  process.stdout.write('payable not authorized\n')
  process.exit(0)
}
if (decision.rejected) {
  process.stdout.write(`assertion rejected ${decision.verdict.reasons.join(',')}\n`)
  process.stdout.write('payable not authorized\n')
  process.exit(1)
}
process.stdout.write(`assertion unsupported ${decision.verdict.reasons.join(',')}\n`)
process.stdout.write('payable not authorized\n')
process.exit(2)
