import { deflateSync } from 'node:zlib'

function escapePdf(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

/**
 * One-page PDF using Helvetica and a FlateDecode content stream.
 * Literal strings are the characters. There is no ToUnicode map.
 */
export function textPdf(lines, { toUnicode = false, empty = false } = {}) {
  const commands = empty
    ? 'BT ET\n'
    : `BT\n/F1 12 Tf\n72 700 Td\n${lines.map((line, index) => `${index === 0 ? '' : '0 -16 Td\n'}(${escapePdf(line)}) Tj\n`).join('')}ET\n`
  const compressed = deflateSync(Buffer.from(commands, 'latin1'))
  const font = toUnicode
    ? '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 9 0 R >>'
    : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n${compressed.toString('latin1')}\nendstream`,
    font,
  ]
  let body = Buffer.from('%PDF-1.4\n')
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(body.length)
    const wrapper = object.includes('\nstream\n')
      ? `${index + 1} 0 obj\n${object}\nendobj\n`
      : `${index + 1} 0 obj\n${object}\nendobj\n`
    body = Buffer.concat([body, Buffer.from(wrapper, 'latin1')])
  })
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i += 1) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF\n`
  return Buffer.concat([body, Buffer.from(xref + trailer, 'latin1')])
}
