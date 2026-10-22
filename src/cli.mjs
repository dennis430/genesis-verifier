#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { verify } from './verify.mjs'

const [evidencePath, receiptPath] = process.argv.slice(2)
if (!evidencePath || !receiptPath) {
  console.error('usage: genesis-verify <evidence-file> <receipt.json>')
  process.exit(64)
}

const evidence = new Uint8Array(readFileSync(evidencePath))
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
const out = verify(evidence, receipt)
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
process.exit(out.result === 'PASS' ? 0 : out.result === 'FAIL' ? 1 : 2)
