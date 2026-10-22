/**
 * Exact rational arithmetic. No binary floating point.
 * A value is a reduced fraction n/d in decimal units (dollars, not cents).
 */

export function reduce(n, d) {
  if (d < 0n) return reduce(-n, -d)
  const g = gcd(n < 0n ? -n : n, d)
  return { n: n / g, d: d / g }
}

function gcd(a, b) {
  let x = a
  let y = b
  while (y !== 0n) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

export function fromCents(cents) {
  return reduce(cents, 100n)
}

export function parseDecimal(text) {
  if (typeof text !== 'string' || !/^-?\d+(\.\d+)?$/.test(text)) return null
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const [whole, frac = ''] = body.split('.')
  const scale = frac.length
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '')
  const n = BigInt(digits || '0')
  const d = 10n ** BigInt(scale)
  const value = reduce(negative ? -n : n, d)
  return { value, scale }
}

export function add(a, b) {
  return reduce(a.n * b.d + b.n * a.d, a.d * b.d)
}

export function sub(a, b) {
  return reduce(a.n * b.d - b.n * a.d, a.d * b.d)
}

export function mul(a, b) {
  return reduce(a.n * b.n, a.d * b.d)
}

export function div(a, b) {
  if (b.n === 0n) return null
  return reduce(a.n * b.d, a.d * b.n)
}

export function formatScale(value, scale) {
  const scaled = roundToScale(value, scale, 'exact')
  if (scaled == null) return null
  return formatScaled(scaled, scale)
}

export function roundToScale(value, scale, mode) {
  const factor = 10n ** BigInt(scale)
  return divRound(value.n * factor, value.d, mode)
}

function divRound(numer, denom, mode) {
  if (denom === 0n) return null
  const neg = (numer < 0n) !== (denom < 0n)
  const n = numer < 0n ? -numer : numer
  const d = denom < 0n ? -denom : denom
  const q = n / d
  const rem = n % d
  if (mode === 'exact') return rem === 0n ? (neg ? -q : q) : null
  let up = false
  if (rem !== 0n) {
    if (mode === 'down') up = false
    else if (mode === 'half_up') up = rem * 2n >= d
    else if (mode === 'half_even') {
      if (rem * 2n > d) up = true
      else if (rem * 2n < d) up = false
      else up = q % 2n === 1n
    } else return null
  }
  const mag = up ? q + 1n : q
  return neg ? -mag : mag
}

export function formatScaled(scaled, scale) {
  const neg = scaled < 0n
  const mag = (neg ? -scaled : scaled).toString().padStart(scale + 1, '0')
  if (scale === 0) return `${neg ? '-' : ''}${mag}`
  const whole = mag.slice(0, -scale)
  const frac = mag.slice(-scale)
  return `${neg ? '-' : ''}${whole}.${frac}`
}

export const ROUNDING_MODES = new Set(['half_up', 'half_even', 'down'])
