import { sha256Hex } from './hash.mjs'
import { formatDollars, parseMoneyToCents } from './money.mjs'
import { add, div, formatScale, fromCents, mul, parseDecimal, ROUNDING_MODES, sub } from './decimal.mjs'
import { pageAt, PDF_TEXT_PROFILE } from './pdfText.mjs'
import { PROFILE_RUNNERS, EXTRACTION_PROFILES } from './profiles.mjs'

/** Receipts this verifier knows how to recompute. Anything else is UNVERIFIABLE. */
export const RECEIPT_VERSION = 'genesis.receipt.v1'

/**
 * Kinds that cannot corroborate a claim. A matching span inside one of these is not corroboration.
 */
export const NEVER_A_ROOT = new Set(['derivative', 'model_output', 'engine_derived'])

/** Kinds a receipt may declare. Declaration is not proof of origin. */
export const DECLARED_SOURCE_KINDS = new Set([
  'counterparty_supplied',
  'independent_record',
  'public_assertion',
])

export const RULES = {
  quotation: { id: 'quotation.exact', version: '1' },
  sum: { id: 'sum.exact', version: '1' },
  calculate: { id: 'calculate.exact', version: '1' },
  reconcile: { id: 'reconcile.exact', version: '1' },
}


/**
 * A passing receipt must carry these. Omitting one is a failure, not an unknown:
 * the receipt would otherwise read as stronger than the check.
 */
export const REQUIRED_LIMITATIONS = [
  'GENUINENESS_NOT_ESTABLISHED',
  'SOURCE_KIND_IS_DECLARED_NOT_PROVEN',
  'SUBJECT_CONTROL_NOT_ESTABLISHED',
  'CLAIM_TEXT_IS_NOT_INTERPRETED_BEYOND_EXACT_MATCH',
]

const decoder = new TextDecoder('utf-8', { fatal: true })

function result(status, reasons, extra = {}) {
  return {
    result: status,
    reasons,
    checks: extra.checks ?? {
      evidenceHash: 'unchecked',
      spans: 'unchecked',
      arithmetic: 'not_applicable',
      sourceStanding: 'unchecked',
    },
    recomputed: extra.recomputed ?? null,
    limitations: extra.limitations ?? [],
  }
}

function readSpan(bytes, span) {
  if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end)) {
    return { ok: false, reason: 'SPAN_NOT_AN_INTEGER_RANGE' }
  }
  if (span.start < 0 || span.end < span.start || span.end > bytes.length) {
    return { ok: false, reason: 'SPAN_OUT_OF_RANGE' }
  }
  try {
    return { ok: true, text: decoder.decode(bytes.subarray(span.start, span.end)) }
  } catch {
    return { ok: false, reason: 'SPAN_NOT_UTF8' }
  }
}

function limitationsOf(receipt) {
  return Array.isArray(receipt?.limitations) ? receipt.limitations.filter((x) => typeof x === 'string') : []
}

/**
 * @param {Uint8Array} evidenceBytes the exact bytes the receipt claims to cite
 * @param {object} receipt genesis.receipt.v1
 * @returns {{ result: 'PASS'|'FAIL'|'UNVERIFIABLE', reasons: string[], checks: object, recomputed: object|null, limitations: string[] }}
 */
export function verify(evidenceBytes, receipt) {
  if (!(evidenceBytes instanceof Uint8Array)) {
    return result('UNVERIFIABLE', ['EVIDENCE_IS_NOT_BYTES'])
  }
  if (!receipt || typeof receipt !== 'object') {
    return result('UNVERIFIABLE', ['RECEIPT_MISSING'])
  }
  if (receipt.receiptVersion !== RECEIPT_VERSION) {
    return result('UNVERIFIABLE', ['UNKNOWN_RECEIPT_VERSION'])
  }

  const limitations = limitationsOf(receipt)
  const missing = REQUIRED_LIMITATIONS.filter((id) => !limitations.includes(id))
  if (missing.length > 0) {
    return result('FAIL', missing.map((id) => `OMITTED_LIMITATION:${id}`), { limitations })
  }

  const declared = receipt.evidence?.sha256
  if (typeof declared !== 'string' || !/^[0-9a-f]{64}$/.test(declared)) {
    return result('UNVERIFIABLE', ['EVIDENCE_HASH_MALFORMED'], { limitations })
  }
  const actual = sha256Hex(evidenceBytes)
  if (actual !== declared) {
    return result('FAIL', ['EVIDENCE_HASH_MISMATCH'], {
      limitations,
      checks: {
        evidenceHash: 'mismatch',
        spans: 'unchecked',
        arithmetic: 'not_applicable',
        sourceStanding: 'unchecked',
      },
      recomputed: { evidenceSha256: actual, origin: originReport(false) },
    })
  }

  const overclaim = originOverclaim(receipt)
  if (overclaim === 'ORIGIN_ASSURANCE_UNKNOWN') {
    return result('UNVERIFIABLE', ['ORIGIN_ASSURANCE_UNKNOWN'], {
      limitations,
      checks: hashOk(),
      recomputed: { origin: originReport(true) },
    })
  }
  if (overclaim) {
    return result('FAIL', [overclaim], {
      limitations,
      checks: { ...hashOk(), sourceStanding: 'rejected' },
      recomputed: { origin: originReport(true) },
    })
  }

  const kind = receipt.source?.kind
  if (typeof kind !== 'string') {
    return result('UNVERIFIABLE', ['SOURCE_KIND_MISSING'], {
      limitations,
      checks: hashOk(),
    })
  }
  if (NEVER_A_ROOT.has(kind)) {
    return result('FAIL', ['SOURCE_CANNOT_CORROBORATE'], {
      limitations,
      checks: { ...hashOk(), sourceStanding: 'rejected' },
    })
  }
  if (!DECLARED_SOURCE_KINDS.has(kind)) {
    return result('UNVERIFIABLE', ['UNKNOWN_SOURCE_KIND'], {
      limitations,
      checks: hashOk(),
    })
  }

  const derivation = receipt.derivation
  if (!derivation || typeof derivation !== 'object') {
    return result('UNVERIFIABLE', ['DERIVATION_MISSING'], { limitations, checks: hashOk() })
  }
  if (derivation.type === 'inference') {
    return result('FAIL', ['INFERENCE_NOT_ADMITTED'], {
      limitations,
      checks: { ...hashOk(), sourceStanding: 'rejected' },
    })
  }
  if (derivation.type !== 'quotation' && derivation.type !== 'sum' && derivation.type !== 'calculate' && derivation.type !== 'reconcile') {
    return result('UNVERIFIABLE', ['UNSUPPORTED_DERIVATION'], { limitations, checks: hashOk() })
  }

  const rule = receipt.rule
  const expectedRule = RULES[derivation.type]
  if (!rule || rule.id !== expectedRule.id || rule.version !== expectedRule.version) {
    return result('FAIL', ['RULE_MISMATCH'], { limitations, checks: hashOk() })
  }

  const space = resolveCitation(evidenceBytes, receipt)
  if (!space.ok) {
    return result(space.status ?? 'UNVERIFIABLE', [space.reason], {
      limitations,
      checks: { ...hashOk(), spans: 'unchecked' },
      recomputed: space.recomputed ?? { origin: originReport(true) },
    })
  }

  if (derivation.type === 'quotation') return verifyQuotation(space.bytes, receipt, limitations)
  if (derivation.type === 'sum') return verifySum(space.bytes, receipt, limitations)
  if (derivation.type === 'calculate') return verifyCalculate(space.bytes, receipt, limitations)
  return verifyReconcile(space.bytes, receipt, limitations)
}

function hashOk() {
  return {
    evidenceHash: 'match',
    spans: 'unchecked',
    arithmetic: 'not_applicable',
    sourceStanding: 'unchecked',
  }
}

function verifyQuotation(bytes, receipt, limitations) {
  const standing = receipt.claimStanding
  if (standing !== 'observed' && standing !== 'derived') {
    const status = standing === 'inferred' || standing === 'assumed' ? 'FAIL' : 'UNVERIFIABLE'
    const reason = status === 'FAIL' ? 'INFERENCE_NOT_ADMITTED' : 'CLAIM_STANDING_MISSING'
    return result(status, [reason], {
      limitations,
      checks: { ...hashOk(), sourceStanding: 'rejected' },
    })
  }
  const span = readCited(bytes, receipt.derivation.span)
  if (!span.ok) return failSpan(span, limitations)
  if (span.text !== receipt.derivation.expectedText) {
    return result('FAIL', ['SPAN_TEXT_MISMATCH'], {
      limitations,
      checks: { ...hashOk(), spans: 'mismatch', sourceStanding: 'unchecked' },
      recomputed: { spanText: span.text },
    })
  }
  if (typeof receipt.claim?.text !== 'string' || receipt.claim.text !== receipt.derivation.expectedText) {
    return result('FAIL', ['CLAIM_TEXT_DOES_NOT_EQUAL_SPAN'], {
      limitations,
      checks: { ...hashOk(), spans: 'match', sourceStanding: 'unchecked' },
    })
  }
  return result('PASS', [], {
    limitations,
    checks: {
      evidenceHash: 'match',
      spans: 'match',
      arithmetic: 'not_applicable',
      sourceStanding: 'admitted',
    },
    recomputed: { spanText: span.text, establishedStanding: standing === 'observed' ? 'observed' : 'derived' },
  })
}

function verifySum(bytes, receipt, limitations) {
  if (receipt.claimStanding === 'observed') {
    return result('FAIL', ['STANDING_PROMOTION'], {
      limitations,
      checks: { ...hashOk(), sourceStanding: 'rejected', arithmetic: 'unchecked' },
    })
  }
  if (receipt.claimStanding !== 'derived') {
    const status = receipt.claimStanding === 'inferred' || receipt.claimStanding === 'assumed' ? 'FAIL' : 'UNVERIFIABLE'
    return result(status, [status === 'FAIL' ? 'INFERENCE_NOT_ADMITTED' : 'CLAIM_STANDING_MISSING'], {
      limitations,
      checks: { ...hashOk(), sourceStanding: 'rejected', arithmetic: 'unchecked' },
    })
  }
  const operands = receipt.derivation.operands
  if (!Array.isArray(operands) || operands.length < 2) {
    return result('UNVERIFIABLE', ['SUM_NEEDS_TWO_OPERANDS'], {
      limitations,
      checks: { ...hashOk(), arithmetic: 'unchecked' },
    })
  }

  const readings = []
  for (const operand of operands) {
    const span = readCited(bytes, operand?.span)
    if (!span.ok) return failSpan(span, limitations)
    if (span.text !== operand.expectedText) {
      return result('FAIL', ['SPAN_TEXT_MISMATCH'], {
        limitations,
        checks: { ...hashOk(), spans: 'mismatch', arithmetic: 'unchecked' },
        recomputed: { spanText: span.text, label: operand.label ?? null },
      })
    }
    const cents = parseMoneyToCents(span.text)
    if (cents === null) {
      return result('UNVERIFIABLE', ['AMOUNT_NOT_DETERMINISTIC'], {
        limitations,
        checks: { ...hashOk(), spans: 'match', arithmetic: 'unchecked' },
        recomputed: { spanText: span.text, label: operand.label ?? null },
      })
    }
    readings.push({ label: operand.label ?? null, text: span.text, cents: cents.toString() })
  }

  let total = 0n
  for (const reading of readings) total += BigInt(reading.cents)
  const expected = parseMoneyToCents(receipt.derivation.expectedTotal)
  if (expected === null) {
    return result('UNVERIFIABLE', ['EXPECTED_TOTAL_NOT_DETERMINISTIC'], {
      limitations,
      checks: { ...hashOk(), spans: 'match', arithmetic: 'unchecked' },
      recomputed: { operands: readings, total: formatDollars(total) },
    })
  }
  if (total !== expected) {
    return result('FAIL', ['ARITHMETIC_DOES_NOT_REPRODUCE'], {
      limitations,
      checks: { ...hashOk(), spans: 'match', arithmetic: 'mismatch', sourceStanding: 'admitted' },
      recomputed: { operands: readings, total: formatDollars(total), expected: formatDollars(expected) },
    })
  }
  const claim = receipt.claim?.text
  if (typeof claim !== 'string' || !claim.includes(receipt.derivation.expectedTotal)) {
    return result('FAIL', ['CLAIM_TEXT_DOES_NOT_CITE_TOTAL'], {
      limitations,
      checks: { ...hashOk(), spans: 'match', arithmetic: 'reproduced', sourceStanding: 'unchecked' },
      recomputed: { operands: readings, total: formatDollars(total) },
    })
  }
  return result('PASS', [], {
    limitations,
    checks: {
      evidenceHash: 'match',
      spans: 'match',
      arithmetic: 'reproduced',
      sourceStanding: 'admitted',
    },
    recomputed: {
      operands: readings,
      total: formatDollars(total),
      establishedStanding: 'derived',
      genuineness: 'not_established',
      origin: originReport(true),
    },
  })
}

const ADMITTED_EXTRACTION_FIELDS = new Set(['profile', 'extractedSha256'])

function isPdfBytes(bytes) {
  return bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
}

function resolveCitation(evidenceBytes, receipt) {
  const extraction = receipt.extraction
  if (extraction != null && (typeof extraction !== 'object' || Array.isArray(extraction))) {
    return { ok: false, reason: 'EXTRACTION_MALFORMED' }
  }
  if (extraction) {
    const extra = Object.keys(extraction).filter((key) => !ADMITTED_EXTRACTION_FIELDS.has(key))
    if (extra.length > 0) return { ok: false, status: 'FAIL', reason: 'CALLER_EXTRACT_NOT_ACCEPTED' }
  }

  const mediaType = receipt.evidence?.mediaType
  const pdf = isPdfBytes(evidenceBytes) || mediaType === 'application/pdf'
  if (!extraction) {
    if (mediaType != null && pdf && mediaType !== 'application/pdf') {
      return { ok: false, reason: 'MEDIA_TYPE_MISMATCH' }
    }
    if (pdf && !isPdfBytes(evidenceBytes)) return { ok: false, reason: 'NOT_A_PDF' }
    if (pdf) return { ok: false, reason: 'PDF_EXTRACTION_REQUIRED' }
    return { ok: true, bytes: evidenceBytes }
  }

  const runner = PROFILE_RUNNERS[extraction.profile]
  if (!runner) {
    return { ok: false, reason: pdf ? 'PDF_EXTRACTION_REQUIRED' : 'UNKNOWN_EXTRACTION_PROFILE' }
  }
  if (extraction.profile === PDF_TEXT_PROFILE) {
    if (mediaType != null && mediaType !== 'application/pdf') return { ok: false, reason: 'MEDIA_TYPE_MISMATCH' }
    if (!isPdfBytes(evidenceBytes)) return { ok: false, reason: 'NOT_A_PDF' }
  } else if (pdf) {
    return { ok: false, reason: 'PROFILE_DOES_NOT_ACCEPT_INPUT' }
  } else if (runner.mediaType === 'text/csv' && mediaType !== 'text/csv') {
    return { ok: false, reason: 'CSV_MEDIA_TYPE_REQUIRED' }
  }

  if (!Array.isArray(receipt.limitations) || !receipt.limitations.includes(runner.requiredLimitation)) {
    return { ok: false, status: 'FAIL', reason: `OMITTED_LIMITATION:${runner.requiredLimitation}` }
  }
  const extracted = runner.reproduce(evidenceBytes)
  if (!extracted.ok) return { ok: false, reason: extracted.reason, recomputed: { origin: originReport(true) } }
  const extractedSha256 = sha256Hex(extracted.bytes)
  if (extractedSha256 !== extraction.extractedSha256) {
    return {
      ok: false,
      status: 'FAIL',
      reason: 'EXTRACTED_TEXT_HASH_MISMATCH',
      recomputed: { extractedSha256, profile: extraction.profile, origin: originReport(true) },
    }
  }
  return { ok: true, bytes: extracted.bytes, profile: EXTRACTION_PROFILES[extraction.profile] }
}

function readCited(bytes, span) {
  const read = readSpan(bytes, span)
  if (!read.ok) return read
  if (span.page == null) return read
  if (!Number.isInteger(span.page) || span.page < 1) return { ok: false, reason: 'PAGE_NOT_AN_INTEGER' }
  const startPage = pageAt(bytes, span.start)
  const endPage = pageAt(bytes, span.end === span.start ? span.start : span.end - 1)
  if (startPage !== span.page || endPage !== span.page) {
    return { ok: false, status: 'FAIL', reason: 'PAGE_MISMATCH' }
  }
  return read
}

function originOverclaim(receipt) {
  const assurance = receipt.origin?.assurance
  if (assurance === 'cryptographically_authenticated' || assurance === 'independently_corroborated') {
    return 'ORIGIN_OVERCLAIM'
  }
  if (assurance != null && assurance !== 'declared' && assurance !== 'bytes_verified') {
    return 'ORIGIN_ASSURANCE_UNKNOWN'
  }
  if (receipt.origin?.authenticated === true || receipt.origin?.corroborated === true) return 'ORIGIN_OVERCLAIM'
  if (receipt.source?.authenticated === true || receipt.source?.kindProven === true) return 'ORIGIN_OVERCLAIM'
  return null
}

function originReport(bytesVerified) {
  return {
    bytes: bytesVerified ? 'verified' : 'mismatch',
    sourceKindEstablished: false,
    cryptographic: 'not_checked',
    corroboration: 'not_checked',
    authenticity: 'not_established',
  }
}

function failSpan(span, limitations, extra = {}) {
  if (span.status === 'FAIL') {
    return result('FAIL', [span.reason], {
      limitations,
      checks: { ...hashOk(), spans: 'mismatch', arithmetic: 'unchecked' },
      recomputed: extra.recomputed ?? null,
    })
  }
  return result('UNVERIFIABLE', [span.reason], {
    limitations,
    checks: { ...hashOk(), spans: 'unchecked', arithmetic: 'unchecked' },
    recomputed: extra.recomputed ?? null,
  })
}

function readAmount(bytes, leaf) {
  const span = readCited(bytes, leaf?.span)
  if (!span.ok) return { ok: false, span }
  if (span.text !== leaf.expectedText) {
    return { ok: false, fail: 'SPAN_TEXT_MISMATCH', recomputed: { spanText: span.text, label: leaf.label ?? null } }
  }
  const money = parseMoneyToCents(span.text)
  const decimal = money == null ? parseDecimal(span.text) : { value: fromCents(money), scale: 2 }
  if (decimal == null) return { ok: false, unverifiable: 'AMOUNT_NOT_DETERMINISTIC', recomputed: { spanText: span.text } }
  return { ok: true, text: span.text, value: decimal.value, label: leaf.label ?? null, unit: leaf.unit ?? null, period: leaf.period ?? null }
}

function finishArithmetic(receipt, limitations, value, readings, identity) {
  const rounding = receipt.derivation.rounding ?? null
  let rendered
  if (rounding) {
    if (!ROUNDING_MODES.has(rounding.mode) || !Number.isInteger(rounding.scale) || rounding.scale < 0 || rounding.scale > 12) {
      return result('UNVERIFIABLE', ['ROUNDING_MALFORMED'], {
        limitations,
        checks: { ...hashOk(), spans: 'match', arithmetic: 'unchecked' },
      })
    }
    rendered = requireRound(value, rounding.scale, rounding.mode)
    if (rendered == null) {
      return result('UNVERIFIABLE', ['ROUNDING_MALFORMED'], {
        limitations,
        checks: { ...hashOk(), spans: 'match', arithmetic: 'unchecked' },
      })
    }
  } else {
    const parsed = parseDecimal(receipt.derivation.expectedTotal)
    if (!parsed) {
      return result('UNVERIFIABLE', ['EXPECTED_TOTAL_NOT_DETERMINISTIC'], {
        limitations,
        checks: { ...hashOk(), spans: 'match', arithmetic: 'unchecked' },
      })
    }
    rendered = formatScale(value, parsed.scale)
    if (rendered == null) {
      return result('FAIL', ['ARITHMETIC_DOES_NOT_REPRODUCE'], {
        limitations,
        checks: { ...hashOk(), spans: 'match', arithmetic: 'mismatch', sourceStanding: 'admitted' },
        recomputed: { value: 'non_terminating', operands: readings },
      })
    }
  }
  if (rendered !== receipt.derivation.expectedTotal) {
    return result('FAIL', ['ARITHMETIC_DOES_NOT_REPRODUCE'], {
      limitations,
      checks: { ...hashOk(), spans: 'match', arithmetic: 'mismatch', sourceStanding: 'admitted' },
      recomputed: { value: rendered, expected: receipt.derivation.expectedTotal, operands: readings, ...identity },
    })
  }
  const cite = receipt.derivation.claimCite ?? receipt.derivation.expectedTotal
  if (typeof receipt.claim?.text !== 'string' || !receipt.claim.text.includes(cite)) {
    return result('FAIL', ['CLAIM_TEXT_DOES_NOT_CITE_TOTAL'], {
      limitations,
      checks: { ...hashOk(), spans: 'match', arithmetic: 'reproduced' },
      recomputed: { value: rendered, operands: readings },
    })
  }
  return result('PASS', [], {
    limitations,
    checks: { evidenceHash: 'match', spans: 'match', arithmetic: 'reproduced', sourceStanding: 'admitted' },
    recomputed: {
      value: rendered,
      operands: readings,
      establishedStanding: 'derived',
      genuineness: 'not_established',
      origin: originReport(true),
      unit: identity.unit,
      period: identity.period,
      unitEstablished: false,
    },
  })
}

function requireRound(value, scale, mode) {
  const factor = 10n ** BigInt(scale)
  const scaled = divRoundLocal(value.n * factor, value.d, mode)
  if (scaled == null) return null
  const neg = scaled < 0n
  const mag = (neg ? -scaled : scaled).toString().padStart(scale + 1, '0')
  if (scale === 0) return `${neg ? '-' : ''}${mag}`
  return `${neg ? '-' : ''}${mag.slice(0, -scale)}.${mag.slice(-scale)}`
}

function divRoundLocal(numer, denom, mode) {
  if (denom === 0n) return null
  const neg = (numer < 0n) !== (denom < 0n)
  const n = numer < 0n ? -numer : numer
  const d = denom < 0n ? -denom : denom
  const q = n / d
  const rem = n % d
  let up = false
  if (rem !== 0n) {
    if (mode === 'down') up = false
    else if (mode === 'half_up') up = rem * 2n >= d
    else if (mode === 'half_even') up = rem * 2n > d || (rem * 2n === d && q % 2n === 1n)
    else return null
  }
  const mag = up ? q + 1n : q
  return neg ? -mag : mag
}

function needsRounding(node) {
  if (!node || typeof node !== 'object') return false
  if (node.op === 'div' || node.op === 'pct') return true
  if (Array.isArray(node.args)) return node.args.some(needsRounding)
  return false
}

function verifyCalculate(bytes, receipt, limitations) {
  const standing = derivedStanding(receipt, limitations)
  if (standing) return standing
  if (needsRounding(receipt.derivation.expression) && !receipt.derivation.rounding) {
    return result('UNVERIFIABLE', ['ROUNDING_REQUIRED'], { limitations, checks: { ...hashOk(), arithmetic: 'unchecked' } })
  }
  const leaves = []
  const evaluated = evalNode(bytes, receipt.derivation.expression, leaves)
  if (!evaluated.ok) return arithmeticFailure(limitations, evaluated)
  return finishArithmetic(receipt, limitations, evaluated.value, leaves.map(publicLeaf), {
    unit: evaluated.unit,
    period: evaluated.period,
  })
}

function verifyReconcile(bytes, receipt, limitations) {
  const standing = derivedStanding(receipt, limitations)
  if (standing) return standing
  const components = receipt.derivation.components
  const totalLeaf = receipt.derivation.total
  if (!Array.isArray(components) || components.length < 2 || !totalLeaf) {
    return result('UNVERIFIABLE', ['RECONCILE_SHAPE'], { limitations, checks: { ...hashOk(), arithmetic: 'unchecked' } })
  }
  const leaves = []
  const parts = []
  for (const component of components) {
    const read = readAmount(bytes, component)
    if (!read.ok) return arithmeticFailure(limitations, read)
    parts.push(read.value)
    leaves.push(read)
  }
  const total = readAmount(bytes, totalLeaf)
  if (!total.ok) return arithmeticFailure(limitations, total)
  leaves.push(total)
  const identity = strictIdentity(leaves)
  if (!identity.ok) {
    return result('FAIL', [identity.reason], { limitations, checks: { ...hashOk(), spans: 'match', arithmetic: 'unchecked' } })
  }
  let sum = parts[0]
  for (const part of parts.slice(1)) sum = add(sum, part)
  const receiptForFinish = {
    ...receipt,
    derivation: {
      ...receipt.derivation,
      expectedTotal: canonicalFromLeaf(total),
      claimCite: total.text,
    },
  }
  if (receiptForFinish.derivation.expectedTotal == null) {
    return result('UNVERIFIABLE', ['EXPECTED_TOTAL_NOT_DETERMINISTIC'], { limitations, checks: { ...hashOk(), spans: 'match' } })
  }
  if (typeof receipt.claim?.text !== 'string' || !receipt.claim.text.includes(total.text)) {
    return result('FAIL', ['CLAIM_TEXT_DOES_NOT_CITE_TOTAL'], { limitations, checks: { ...hashOk(), spans: 'match' } })
  }
  const finished = finishArithmetic(receiptForFinish, limitations, sum, leaves.map(publicLeaf), identity)
  if (finished.result === 'PASS') {
    finished.recomputed.reconciledText = total.text
  }
  return finished
}

function canonicalFromLeaf(leaf) {
  const money = parseMoneyToCents(leaf.text)
  if (money != null) return formatScale(fromCents(money), 2)
  const parsed = parseDecimal(leaf.text)
  return parsed ? formatScale(parsed.value, parsed.scale) : null
}

function publicLeaf(leaf) {
  return { label: leaf.label, text: leaf.text, unit: leaf.unit, period: leaf.period }
}

function strictIdentity(leaves) {
  return combineMeta('add', leaves.map((leaf) => ({ unit: leaf.unit, period: leaf.period })))
}

function derivedStanding(receipt, limitations) {
  if (receipt.claimStanding === 'observed') {
    return result('FAIL', ['STANDING_PROMOTION'], {
      limitations,
      checks: { ...hashOk(), sourceStanding: 'rejected', arithmetic: 'unchecked' },
    })
  }
  if (receipt.claimStanding !== 'derived') {
    const status = receipt.claimStanding === 'inferred' || receipt.claimStanding === 'assumed' ? 'FAIL' : 'UNVERIFIABLE'
    return result(status, [status === 'FAIL' ? 'INFERENCE_NOT_ADMITTED' : 'CLAIM_STANDING_MISSING'], {
      limitations,
      checks: { ...hashOk(), sourceStanding: 'rejected', arithmetic: 'unchecked' },
    })
  }
  return null
}

function arithmeticFailure(limitations, read) {
  if (read.fail) {
    return result('FAIL', [read.fail], {
      limitations,
      checks: { ...hashOk(), spans: 'mismatch', arithmetic: 'unchecked' },
      recomputed: read.recomputed ?? null,
    })
  }
  if (read.span) return failSpan(read.span, limitations, read)
  return result('UNVERIFIABLE', [read.unverifiable ?? read.reason ?? 'AMOUNT_NOT_DETERMINISTIC'], {
    limitations,
    checks: { ...hashOk(), spans: read.unverifiable === 'AMOUNT_NOT_DETERMINISTIC' ? 'match' : 'unchecked', arithmetic: 'unchecked' },
    recomputed: read.recomputed ?? null,
  })
}

function evalNode(bytes, node, leaves) {
  if (!node || typeof node !== 'object') return { ok: false, unverifiable: 'EXPRESSION_MALFORMED' }
  if (node.op === 'span' || node.span) {
    const read = readAmount(bytes, node)
    if (!read.ok) return read
    leaves.push(read)
    return { ok: true, value: read.value, unit: read.unit, period: read.period }
  }
  if (!Array.isArray(node.args) || node.args.length < 2) return { ok: false, unverifiable: 'EXPRESSION_MALFORMED' }
  const items = []
  for (const arg of node.args) {
    const evaluated = evalNode(bytes, arg, leaves)
    if (!evaluated.ok) return evaluated
    items.push(evaluated)
  }
  if ((node.op === 'sub' || node.op === 'div' || node.op === 'pct') && items.length !== 2) {
    return { ok: false, unverifiable: 'EXPRESSION_MALFORMED' }
  }
  const meta = combineMeta(node.op, items)
  if (!meta.ok) return { ok: false, fail: meta.reason }
  if (node.op === 'add') {
    return { ok: true, value: items.slice(1).reduce((acc, item) => add(acc, item.value), items[0].value), unit: meta.unit, period: meta.period }
  }
  if (node.op === 'mul') {
    return { ok: true, value: items.slice(1).reduce((acc, item) => mul(acc, item.value), items[0].value), unit: meta.unit, period: meta.period }
  }
  if (node.op === 'sub') {
    return { ok: true, value: sub(items[0].value, items[1].value), unit: meta.unit, period: meta.period }
  }
  if (node.op === 'div' || node.op === 'pct') {
    const quotient = div(items[0].value, items[1].value)
    if (quotient == null) return { ok: false, fail: 'DIVISION_BY_ZERO' }
    const value = node.op === 'pct' ? mul(quotient, { n: 100n, d: 1n }) : quotient
    return { ok: true, value, unit: meta.unit, period: meta.period }
  }
  return { ok: false, unverifiable: 'UNSUPPORTED_OPERATION' }
}

function combineMeta(op, items) {
  const units = items.map((item) => item.unit ?? null)
  const periods = items.map((item) => item.period ?? null)
  const declaredUnits = [...new Set(units.filter((unit) => unit != null))]
  const declaredPeriods = [...new Set(periods.filter((period) => period != null))]
  if (declaredUnits.length > 1) return { ok: false, reason: 'UNIT_MISMATCH' }
  if (declaredPeriods.length > 1) return { ok: false, reason: 'PERIOD_MISMATCH' }
  const strict = op === 'add' || op === 'sub' || op === 'pct'
  if (strict && declaredUnits.length === 1 && units.some((unit) => unit == null)) {
    return { ok: false, reason: 'UNIT_NOT_UNIFORM' }
  }
  if (strict && declaredPeriods.length === 1 && periods.some((period) => period == null)) {
    return { ok: false, reason: 'PERIOD_NOT_UNIFORM' }
  }
  if ((op === 'mul') && declaredUnits.length > 1) return { ok: false, reason: 'UNIT_MISMATCH' }
  if (op === 'div' && declaredUnits.length === 1 && units[0] != null && units[1] != null && units[0] !== units[1]) {
    return { ok: false, reason: 'UNIT_MISMATCH' }
  }
  let unit = declaredUnits[0] ?? null
  if (op === 'pct') unit = null
  if (op === 'div' && units[0] != null && units[0] === units[1]) unit = null
  const period = declaredPeriods[0] ?? null
  return { ok: true, unit, period }
}
