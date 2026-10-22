/**
 * Profile `genesis.csv.v1`.
 *
 * Reproduces a canonical cell listing from the original CSV bytes.
 * Spans address that listing, not the source file. The profile does not
 * drop a header, guess a separator, or rewrite CR, BOM, or quotes into
 * a nearby document.
 */
export const CSV_PROFILE_ID = 'genesis.csv.v1'

export const CSV_PROFILE = Object.freeze({
  id: CSV_PROFILE_ID,
  algorithm: 'csv-rfc4180-cells',
  version: '1',
  input: 'UTF-8 text/csv. Comma fields, LF records, no BOM, no CR, no tab, no blank record, no quoted newline, equal field counts.',
  output: 'UTF-8. One line per cell: {row}\\t{col}\\t{unescaped text}\\n. Rows and columns are 1-based. No header is inferred.',
  hashing: 'lowercase hex SHA-256 of the UTF-8 output bytes',
})

export const CSV_LIMITATION = 'SPANS_ADDRESS_CANONICAL_CELLS_NOT_SOURCE_BYTES'

const decoder = new TextDecoder('utf-8', { fatal: true })

export function extractCsvV1(bytes) {
  if (!(bytes instanceof Uint8Array)) return { ok: false, reason: 'EVIDENCE_IS_NOT_BYTES' }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { ok: false, reason: 'CSV_BOM_UNSUPPORTED' }
  }
  let text
  try {
    text = decoder.decode(bytes)
  } catch {
    return { ok: false, reason: 'CSV_NOT_UTF8' }
  }
  if (text.length === 0) return { ok: false, reason: 'CSV_EMPTY' }
  if (text.includes('\r')) return { ok: false, reason: 'CSV_CR_UNSUPPORTED' }
  if (text.includes('\t')) return { ok: false, reason: 'CSV_TAB_IN_FIELD' }
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  if (body.length === 0) return { ok: false, reason: 'CSV_EMPTY' }
  const lines = body.split('\n')
  const rows = []
  for (const line of lines) {
    if (line.length === 0) return { ok: false, reason: 'CSV_BLANK_RECORD' }
    const parsed = parseRecord(line)
    if (!parsed.ok) return parsed
    rows.push(parsed.fields)
  }
  const width = rows[0].length
  if (width < 1) return { ok: false, reason: 'CSV_BLANK_RECORD' }
  if (rows.some((row) => row.length !== width)) return { ok: false, reason: 'CSV_UNEVEN_ROW' }
  let out = ''
  rows.forEach((row, rowIndex) => {
    row.forEach((field, columnIndex) => {
      out += `${rowIndex + 1}\t${columnIndex + 1}\t${field}\n`
    })
  })
  return { ok: true, text: out, bytes: new TextEncoder().encode(out) }
}

function parseRecord(line) {
  const fields = []
  let i = 0
  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1
      let field = ''
      let closed = false
      while (j < line.length) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') {
            field += '"'
            j += 2
            continue
          }
          closed = true
          j += 1
          break
        }
        field += line[j]
        j += 1
      }
      if (!closed) return { ok: false, reason: 'CSV_UNTERMINATED_QUOTE' }
      if (j < line.length && line[j] !== ',') return { ok: false, reason: 'CSV_TRAILING_AFTER_QUOTE' }
      fields.push(field)
      if (j >= line.length) return { ok: true, fields }
      i = j + 1
      if (i === line.length) {
        fields.push('')
        return { ok: true, fields }
      }
      continue
    }
    const comma = line.indexOf(',', i)
    const end = comma === -1 ? line.length : comma
    const raw = line.slice(i, end)
    if (raw.includes('"')) return { ok: false, reason: 'CSV_UNQUOTED_QUOTE' }
    fields.push(raw)
    if (comma === -1) return { ok: true, fields }
    i = comma + 1
    if (i === line.length) {
      fields.push('')
      return { ok: true, fields }
    }
  }
  return { ok: false, reason: 'CSV_BLANK_RECORD' }
}
