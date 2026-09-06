export function correctKnownTypos(value) {
  return String(value ?? '').replace(/\bcrititcal\b/g, 'critical').replace(/\bususal\b/g, 'usual')
}

// Labels are optional and can occur in any order. Never infer a field from
// its position: a definition without an example still belongs in definition.
export function primaryEntry(rawDetails) {
  const raw = String(rawDetails ?? '').trim()
  if ((raw.match(/\[義\]/g) ?? []).length < 2) return raw
  // Verified extraction spillovers: the following entry was appended to the
  // previous card. The complete source remains in raw for audit/recovery.
  const nextEntry = /\s*(?:\|\s*)?[1-5]\s*(?:at odds|lay out|rail at|vindictive|burgeoning)\s*(?:\[[^\]]*\]\s*\|\s*)?(?=\[義\])/.exec(raw)
  return nextEntry ? raw.slice(0, nextEntry.index).trim() : raw
}

export function parseDetails(rawDetails) {
  const raw = String(rawDetails ?? '').trim()
  const entry = primaryEntry(raw)
  const tags = [...entry.matchAll(/\[(義|例|英|記|類|反)\]\s*/g)]
  const fields = { 義: [], 例: [], 英: [], 記: [], 類: [], 反: [] }
  const meaning = []
  tags.forEach((tag, index) => {
    const content = correctKnownTypos(entry.slice(tag.index + tag[0].length, tags[index + 1]?.index ?? entry.length))
      .replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim()
    if (!content) return
    fields[tag[1]].push(content)
    if (tag[1] === '義') meaning.push(content)
    if (tag[1] === '類' || tag[1] === '反') meaning.push(`[${tag[1]}] ${content}`)
  })
  const pronunciation = raw.slice(0, tags[0]?.index ?? raw.length)
    .replace(/\s*\|\s*$/, '').trim().replace(/^\[/, '').replace(/\]$/, '').trim()
  return {
    pronunciation,
    meaning: meaning.join(' '),
    example: fields.例.join(' | '),
    definition: fields.英.join(' | '),
    memoryNotes: fields.記.join('；'),
    raw,
  }
}
