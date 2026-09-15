export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let quoted = false
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      cell += ch
      i += 1
      continue
    }
    if (ch === '"') {
      quoted = true
      i += 1
      continue
    }
    if (ch === delimiter) {
      row.push(cell)
      cell = ''
      i += 1
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
      i += 1
      continue
    }
    cell += ch
    i += 1
  }
  row.push(cell)
  if (row.length > 1 || row[0] !== '' || rows.length === 0) rows.push(row)
  const width = rows.reduce((max, item) => Math.max(max, item.length), 1)
  return rows.map((item) => {
    const next = [...item]
    while (next.length < width) next.push('')
    return next
  })
}

export function serializeCsv(rows: string[][], delimiter = ','): string {
  const lines = rows.map((row) =>
    row
      .map((cell) => {
        if (/[",\n\r]/.test(cell) || (delimiter !== ',' && cell.includes(delimiter))) {
          return `"${cell.replaceAll('"', '""')}"`
        }
        return cell
      })
      .join(delimiter),
  )
  return lines.length ? `${lines.join('\n')}\n` : ''
}

export function delimiterFor(name: string): string {
  return name.toLowerCase().endsWith('.tsv') ? '\t' : ','
}
