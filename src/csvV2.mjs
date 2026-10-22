/**
 * Profile `genesis.csv.v2`.
 *
 * `genesis.csv.v1` is unchanged. This profile adds a defined reading for a
 * leading UTF-8 BOM, CRLF record separators, blank rows, uneven rows, and
 * quoted line breaks. It does not skip rows or invent missing cells.
 */
export const CSV_V2_PROFILE_ID = 'genesis.csv.v2'

export const CSV_V2_PROFILE = Object.freeze({
  id: CSV_V2_PROFILE_ID,
  algorithm: 'csv-rfc4180-cells',
  version: '2',
  input: 'UTF-8 text/csv. Optional leading EF BB BF. Records end on LF or CRLF. Comma fields. A quoted field may contain a comma or a line break. A bare CR is rejected.',
  output: 'UTF-8. One line per cell: {row}\\t{col}\\t{escaped cell}\\n, 1-based. Quoted CRLF becomes LF. Then \\\\ \\n and \\t are escaped. A blank record is one empty field. Uneven rows are not padded.',
  hashing: 'lowercase hex SHA-256 of the UTF-8 output bytes',
})

export const CSV_V2_LIMITATION = 'SPANS_ADDRESS_CANONICAL_CELLS_NOT_SOURCE_BYTES'

const decoder = new TextDecoder('utf-8', { fatal: true })

export function extractCsvV2(bytes) {
  if (!(bytes instanceof Uint8Array)) return { ok: false, reason: 'EVIDENCE_IS_NOT_BYTES' }
  let body = bytes
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) body = bytes.subarray(3)
  let text
  try {
    text = decoder.decode(body)
  } catch {
    return { ok: false, reason: 'CSV_NOT_UTF8' }
  }
  if (text.length === 0) return { ok: false, reason: 'CSV_EMPTY' }
  const parsed = parseRows(text)
  if (!parsed.ok) return parsed
  const width = parsed.rows[0].length
  if (parsed.rows.some((row) => row.length !== width)) return { ok: false, reason: 'CSV_UNEVEN_ROW' }
  let out = ''
  parsed.rows.forEach((row, rowIndex) => {
    row.forEach((field, columnIndex) => {
      out += `${rowIndex + 1}\t${columnIndex + 1}\t${escapeCell(field)}\n`
    })
  })
  return { ok: true, text: out, bytes: new TextEncoder().encode(out) }
}

function escapeCell(field) {
  return field.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\t', '\\t')
}

function parseRows(text) {
  const rows = []
  let i = 0
  while (i < text.length) {
    const record = parseRecord(text, i)
    if (!record.ok) return record
    rows.push(record.fields)
    i = record.next
  }
  if (rows.length === 0) return { ok: false, reason: 'CSV_EMPTY' }
  return { ok: true, rows }
}

function parseRecord(text, start) {
  const fields = []
  let i = start
  while (i <= text.length) {
    const part = text[i] === '"' ? parseQuoted(text, i) : parseRaw(text, i)
    if (!part.ok) return part
    fields.push(part.field)
    i = part.next
    if (i >= text.length) return { ok: true, fields, next: i }
    if (text[i] === ',') {
      i += 1
      if (i === text.length) {
        fields.push('')
        return { ok: true, fields, next: i }
      }
      continue
    }
    if (text[i] === '\n') return { ok: true, fields, next: i + 1 }
    if (text[i] === '\r') {
      if (text[i + 1] !== '\n') return { ok: false, reason: 'CSV_BARE_CR' }
      return { ok: true, fields, next: i + 2 }
    }
    return { ok: false, reason: 'CSV_TRAILING_AFTER_QUOTE' }
  }
  return { ok: false, reason: 'CSV_BLANK_RECORD' }
}

function parseRaw(text, start) {
  let i = start
  while (i < text.length) {
    const c = text[i]
    if (c === ',' || c === '\n') break
    if (c === '\r') {
      if (text[i + 1] !== '\n') return { ok: false, reason: 'CSV_BARE_CR' }
      break
    }
    if (c === '"') return { ok: false, reason: 'CSV_UNQUOTED_QUOTE' }
    i += 1
  }
  return { ok: true, field: text.slice(start, i), next: i }
}

function parseQuoted(text, start) {
  let i = start + 1
  let field = ''
  while (i < text.length) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        field += '"'
        i += 2
        continue
      }
      return { ok: true, field, next: i + 1 }
    }
    if (text[i] === '\r') {
      if (text[i + 1] !== '\n') return { ok: false, reason: 'CSV_BARE_CR' }
      field += '\n'
      i += 2
      continue
    }
    field += text[i]
    i += 1
  }
  return { ok: false, reason: 'CSV_UNTERMINATED_QUOTE' }
}
