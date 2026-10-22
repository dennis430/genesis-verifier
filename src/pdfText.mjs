import { inflateSync } from 'node:zlib'

/**
 * Profile `genesis.pdf-text.v1`.
 *
 * Re-reads literal PDF strings shown with Tj, TJ, or ' from uncompressed or
 * FlateDecode content streams. Spans produced from this profile address the
 * extracted UTF-8, never the PDF bytes.
 *
 * The profile does not normalize characters, does not apply ToUnicode, and
 * does not OCR. Those documents are UNVERIFIABLE rather than approximately read.
 */
export const PDF_TEXT_PROFILE = 'genesis.pdf-text.v1'

const STREAM = Buffer.from('stream')
const ENDSTREAM = Buffer.from('endstream')

export function extractPdfTextV1(bytes) {
  if (!(bytes instanceof Uint8Array)) return { ok: false, reason: 'EVIDENCE_IS_NOT_BYTES' }
  if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    return { ok: false, reason: 'NOT_A_PDF' }
  }
  const latin = Buffer.from(bytes).toString('latin1')
  if (latin.includes('/Encrypt')) return { ok: false, reason: 'ENCRYPTED_PDF' }
  if (latin.includes('/ToUnicode')) return { ok: false, reason: 'TOUNICODE_UNSUPPORTED' }
  if (latin.includes('/ObjStm') || latin.includes('/Type /ObjStm') || latin.includes('/Type/ObjStm')) {
    return { ok: false, reason: 'OBJECT_STREAM_UNSUPPORTED' }
  }

  const streams = collectStreams(Buffer.from(bytes), latin)
  if (!streams.ok) return streams

  const pages = []
  for (const stream of streams.streams) {
    if (isImage(stream.dict)) continue
    const decoded = decodeStream(stream)
    if (!decoded.ok) return decoded
    const text = extractShownText(decoded.text)
    if (!text.ok) return text
    if (text.value.length > 0) pages.push(text.value)
  }
  if (pages.length === 0) return { ok: false, reason: 'NO_EXTRACTABLE_TEXT' }
  const text = pages.join('\f')
  return { ok: true, text, bytes: new TextEncoder().encode(text), pages: pages.length }
}

function isImage(dict) {
  return /\/Subtype\s*\/Image\b/.test(dict) || /\/Subtype\/Image\b/.test(dict)
}

function collectStreams(buf, latin) {
  const streams = []
  let from = 0
  while (from < buf.length) {
    const at = buf.indexOf(STREAM, from)
    if (at < 0) break
    const prev = at === 0 ? 0x0a : buf[at - 1]
    const boundary = prev === 0x0a || prev === 0x0d || prev === 0x20 || prev === 0x09
    let dataAt = at + STREAM.length
    if (buf[dataAt] === 0x0d) dataAt += 1
    const newline = buf[dataAt] === 0x0a
    if (!boundary || !newline) {
      from = at + STREAM.length
      continue
    }
    dataAt += 1
    const dict = dictionaryBefore(latin, at)
    const length = resolveLength(dict, latin)
    if (length == null) return { ok: false, reason: 'STREAM_LENGTH_UNRESOLVED' }
    if (!Number.isInteger(length) || length < 0 || dataAt + length > buf.length) {
      return { ok: false, reason: 'STREAM_LENGTH_OUT_OF_RANGE' }
    }
    const after = buf.subarray(dataAt + length, dataAt + length + 20).toString('latin1')
    if (!/^\r?\n?endstream/.test(after) && buf.indexOf(ENDSTREAM, dataAt + length) !== dataAt + length && buf.indexOf(ENDSTREAM, dataAt + length + 1) < 0) {
      const endAt = buf.indexOf(ENDSTREAM, dataAt + length)
      if (endAt !== dataAt + length && endAt !== dataAt + length + 1 && endAt !== dataAt + length + 2) {
        return { ok: false, reason: 'STREAM_LENGTH_MISMATCH' }
      }
    }
    streams.push({ dict, data: buf.subarray(dataAt, dataAt + length) })
    from = dataAt + length
  }
  return { ok: true, streams }
}

function dictionaryBefore(latin, streamIndex) {
  const start = latin.lastIndexOf('<<', streamIndex)
  if (start < 0) return ''
  return latin.slice(start, streamIndex)
}

function resolveLength(dict, latin) {
  const indirect = dict.match(/\/Length\s+(\d+)\s+(\d+)\s+R/)
  if (indirect) {
    const re = new RegExp(`(?:^|\\n)${indirect[1]}\\s+${indirect[2]}\\s+obj\\s+(\\d+)\\b`)
    const found = latin.match(re)
    return found ? Number(found[1]) : null
  }
  const direct = dict.match(/\/Length\s+(\d+)\b/)
  return direct ? Number(direct[1]) : null
}

function decodeStream(stream) {
  const filter = stream.dict.match(/\/Filter\s*(\[[^\]]+\]|\/[A-Za-z0-9]+)/)
  if (!filter) return { ok: true, text: stream.data.toString('latin1') }
  const names = filter[1].startsWith('[')
    ? [...filter[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1])
    : [filter[1].slice(1)]
  if (names.length !== 1 || names[0] !== 'FlateDecode') {
    return { ok: false, reason: 'UNSUPPORTED_PDF_FILTER' }
  }
  try {
    return { ok: true, text: inflateSync(stream.data).toString('latin1') }
  } catch {
    return { ok: false, reason: 'STREAM_INFLATE_FAILED' }
  }
}

function extractShownText(content) {
  let out = ''
  let i = 0
  while (i < content.length) {
    const c = content[i]
    if (c === '(') {
      const parsed = parseLiteral(content, i)
      if (!parsed.ok) return parsed
      const shown = operatorAfter(content, parsed.next)
      if (shown === 'Tj' || shown === "'") out += `${parsed.text}\n`
      else if (shown === '"') return { ok: false, reason: 'UNSUPPORTED_TEXT_OPERATOR' }
      i = parsed.next
      continue
    }
    if (c === '<' && content[i + 1] !== '<') {
      const parsed = parseHex(content, i)
      if (!parsed.ok) return parsed
      const shown = operatorAfter(content, parsed.next)
      if (shown === 'Tj' || shown === "'") out += `${parsed.text}\n`
      else if (shown === '"') return { ok: false, reason: 'UNSUPPORTED_TEXT_OPERATOR' }
      i = parsed.next
      continue
    }
    if (c === '[') {
      const array = parseTextArray(content, i)
      if (!array.ok) return array
      const shown = operatorAfter(content, array.next)
      if (shown === 'TJ') out += `${array.text}\n`
      i = array.next
      continue
    }
    i += 1
  }
  return { ok: true, value: out }
}

function operatorAfter(content, index) {
  let i = index
  while (i < content.length && /[ \t\r\n]/.test(content[i])) i += 1
  if (content.startsWith('Tj', i) && !/[A-Za-z0-9]/.test(content[i + 2] ?? '')) return 'Tj'
  if (content.startsWith('TJ', i) && !/[A-Za-z0-9]/.test(content[i + 2] ?? '')) return 'TJ'
  if (content[i] === "'") return "'"
  if (content[i] === '"') return '"'
  return null
}

function parseTextArray(content, start) {
  let i = start + 1
  let text = ''
  while (i < content.length) {
    while (i < content.length && /\s/.test(content[i])) i += 1
    if (content[i] === ']') return { ok: true, text, next: i + 1 }
    if (content[i] === '(') {
      const parsed = parseLiteral(content, i)
      if (!parsed.ok) return parsed
      text += parsed.text
      i = parsed.next
      continue
    }
    if (content[i] === '<' && content[i + 1] !== '<') {
      const parsed = parseHex(content, i)
      if (!parsed.ok) return parsed
      text += parsed.text
      i = parsed.next
      continue
    }
    const num = content.slice(i).match(/^[+-]?\d+(?:\.\d+)?/)
    if (num) {
      i += num[0].length
      continue
    }
    return { ok: false, reason: 'UNSUPPORTED_TEXT_ARRAY' }
  }
  return { ok: false, reason: 'UNTERMINATED_TEXT_ARRAY' }
}

function parseLiteral(content, start) {
  let i = start + 1
  let depth = 1
  let out = ''
  while (i < content.length && depth > 0) {
    const c = content[i]
    if (c === '\\') {
      const n = content[i + 1]
      if (n == null) return { ok: false, reason: 'UNTERMINATED_PDF_STRING' }
      if (n === 'n') { out += '\n'; i += 2; continue }
      if (n === 'r') { out += '\r'; i += 2; continue }
      if (n === 't') { out += '\t'; i += 2; continue }
      if (n === 'b') { out += '\b'; i += 2; continue }
      if (n === 'f') { out += '\f'; i += 2; continue }
      if (n === '\n') { i += 2; continue }
      if (n === '\r') { i += 2; if (content[i] === '\n') i += 1; continue }
      if (n >= '0' && n <= '7') {
        let oct = n
        let j = i + 2
        for (let k = 0; k < 2 && content[j] >= '0' && content[j] <= '7'; k += 1, j += 1) oct += content[j]
        const code = Number.parseInt(oct, 8)
        if (code > 127) return { ok: false, reason: 'NON_ASCII_PDF_STRING' }
        out += String.fromCharCode(code)
        i = j
        continue
      }
      out += n
      i += 2
      continue
    }
    if (c === '(') { depth += 1; out += '('; i += 1; continue }
    if (c === ')') {
      depth -= 1
      if (depth === 0) return { ok: true, text: out, next: i + 1 }
      out += ')'
      i += 1
      continue
    }
    if (c.charCodeAt(0) > 127) return { ok: false, reason: 'NON_ASCII_PDF_STRING' }
    out += c
    i += 1
  }
  return { ok: false, reason: 'UNTERMINATED_PDF_STRING' }
}

function parseHex(content, start) {
  let i = start + 1
  let hex = ''
  while (i < content.length && content[i] !== '>') {
    if (!/\s/.test(content[i])) hex += content[i]
    i += 1
  }
  if (content[i] !== '>') return { ok: false, reason: 'UNTERMINATED_PDF_STRING' }
  if (!/^[0-9A-Fa-f]*$/.test(hex)) return { ok: false, reason: 'MALFORMED_HEX_STRING' }
  if (hex.length % 2 === 1) hex += '0'
  let out = ''
  for (let p = 0; p < hex.length; p += 2) {
    const code = Number.parseInt(hex.slice(p, p + 2), 16)
    if (code > 127) return { ok: false, reason: 'NON_ASCII_PDF_STRING' }
    out += String.fromCharCode(code)
  }
  return { ok: true, text: out, next: i + 1 }
}

/** 1-based page of a byte offset in the canonical extract. Pages are separated by U+000C. */
export function pageAt(extractedBytes, offset) {
  let page = 1
  const end = Math.min(offset, extractedBytes.length)
  for (let i = 0; i < end; i += 1) if (extractedBytes[i] === 0x0c) page += 1
  return page
}
