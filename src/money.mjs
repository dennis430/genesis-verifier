/**
 * Deterministic money parse. Returns integer cents, or null when the text is
 * not an exact, unambiguous amount.
 *
 * This deliberately does not call lib/numeric/amountString.ts. That module
 * resolves a lone three-digit group (`1.234` / `1,234`) to a US reading.
 * A verifier that guesses would certify a number it did not establish.
 * Ambiguous text is unreadable here.
 */

const EXACT = /^\$(?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*|0)(?:\.\d{2})?$|^(?:0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*|0)(?:\.\d{2})?$/

export function parseMoneyToCents(text) {
  if (typeof text !== 'string' || !EXACT.test(text)) return null
  const body = text.startsWith('$') ? text.slice(1) : text
  const [whole, frac = ''] = body.split('.')
  const digits = whole.replaceAll(',', '')
  if (!/^\d+$/.test(digits)) return null
  if (frac !== '' && !/^\d{2}$/.test(frac)) return null
  const cents = BigInt(digits) * 100n + BigInt(frac === '' ? '0' : frac)
  return cents
}

export function formatDollars(cents) {
  const negative = cents < 0n
  const abs = negative ? -cents : cents
  const whole = abs / 100n
  const frac = (abs % 100n).toString().padStart(2, '0')
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}$${grouped}.${frac}`
}
