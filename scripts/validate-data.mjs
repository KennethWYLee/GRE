import fs from "node:fs/promises";
import { correctKnownTypos, primaryEntry, parseDetails } from './lib/vocabulary-details.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function taggedSections(value, label) {
  const tagPattern = new RegExp(
    `\\[${label}\\]\\s*([\\s\\S]*?)(?=\\s*(?:\\|\\s*)?\\[(?:義|類|反|記|例|英)\\]\\s*|$)`,
    "g",
  );
  return [...String(value ?? "").matchAll(tagPattern)].map((match) =>
    match[1].replace(/\s+/g, " ").trim(),
  );
}

const decks = [
  { file: "../data/vocabulary-1000.json", deckId: "words1000", totalWords: 1085 },
  { file: "../data/vocabulary.json", deckId: "words2000", totalWords: 2078 },
];
const results = [];

const withoutExample = parseDetails('[test] | [義] 稀釋 | [記] 先加水 | [英] v. make thinner')
assert(withoutExample.example === '', 'Missing example must stay empty')
assert(withoutExample.definition === 'v. make thinner', 'Definition must not become an example')
assert(withoutExample.memoryNotes === '先加水', 'Memory note must be separate')
assert(withoutExample.meaning === '稀釋', 'Notes must not leak into meaning')
const reordered = parseDetails('[test] | [英] adj. urgent | [義] 緊急的 [類] crititcal, acute | [例] An urgent call.')
assert(reordered.definition === 'adj. urgent' && reordered.example === 'An urgent call.', 'Fields must be identified by label, not position')
assert(reordered.meaning === '緊急的 [類] critical, acute', 'Correct known spelling errors in displayed data')

for (const expected of decks) {
  const data = JSON.parse(await fs.readFile(new URL(expected.file, import.meta.url), "utf8"));
  const label = data.meta.title;
  assert(data.meta.deckId === expected.deckId, `${label}: unexpected deck ID`);
  assert(data.words.length === expected.totalWords, `${label}: expected ${expected.totalWords} cards, got ${data.words.length}`);
  assert(new Set(data.words.map((word) => word.id)).size === expected.totalWords, `${label}: word IDs are not unique`);
  assert(data.words.every((word) => word.word && word.meaning && word.root && word.part), `${label}: a required card field is blank`);
  assert(data.parts.length === 5, `${label}: expected five parts`);
  const lax = data.words.find((word) => word.word === 'lax')
  assert(!lax.meaning.includes('花錢') && !lax.example.includes('wedding'), 'The following lay out entry must not be attributed to lax')
  assert(lax.raw.includes('lay out'), 'Keep unmodified source text for recovery')

  const synonymWords = data.words.filter((word) => taggedSections(word.raw, "類").length > 0);
  let synonymSectionCount = 0;
  for (const word of synonymWords) {
    const sourceSynonyms = taggedSections(primaryEntry(word.raw), "類");
    const exportedSynonyms = taggedSections(word.meaning, "類");
    synonymSectionCount += sourceSynonyms.length;
    assert(
      JSON.stringify(exportedSynonyms) === JSON.stringify(sourceSynonyms.map(correctKnownTypos)),
      `${label}: synonyms were not preserved for #${word.sourceNo} ${word.word}`,
    );
  }

  for (const word of data.words) {
    for (const [label, field] of [['例', 'example'], ['英', 'definition'], ['記', 'memoryNotes']]) {
      const expected = taggedSections(primaryEntry(word.raw), label).map(correctKnownTypos)
      const joiner = label === '記' ? '；' : ' | '
      assert(String(word[field] ?? '').replace(/\s+/g, ' ').trim() === expected.join(joiner), `${label}: misplaced or missing ${field} for ${word.word}`)
    }
    assert(!/\[(?:義|英|例|記)\]/.test(word.example + word.definition + word.memoryNotes), `Misplaced tag in ${word.word}`)
    assert(!/crititcal|ususal/.test(word.meaning + word.root), `Uncorrected typo in ${word.word}`)
  }

  const partChecks = data.parts.map((part) => {
    const words = data.words.filter((word) => word.part === part.id);
    const rootGroups = new Set(words.filter((word) => word.root !== "S").map((word) => word.root));
    const sWords = words.filter((word) => word.root === "S").length;
    assert(words.length === part.totalWordCount, `${label}: Part ${part.id} total does not match metadata`);
    assert(rootGroups.size === part.rootGroupCount, `${label}: Part ${part.id} root count does not match metadata`);
    assert(sWords === part.sWordCount, `${label}: Part ${part.id} S count does not match metadata`);

    for (const root of rootGroups) {
      const positions = words
        .filter((word) => word.root === root)
        .map((word) => word.deckPosition)
        .sort((a, b) => a - b);
      assert(
        positions.at(-1) - positions[0] + 1 === positions.length,
        `${label}: root ${root} is not consecutive in fixed order`,
      );
    }
    return { part: part.id, words: words.length, roots: rootGroups.size, sWords };
  });

  const splitRoots = data.rootGroups.filter((group) => {
    const parts = new Set(data.words.filter((word) => word.root === group.root).map((word) => word.part));
    return parts.size !== 1;
  });
  assert(splitRoots.length === 0, `${label}: ${splitRoots.length} root families were split`);
  const totals = partChecks.map((part) => part.words);
  assert(Math.max(...totals) - Math.min(...totals) <= 1, `${label}: part totals differ by more than one card`);
  results.push({
    deck: label,
    totalWords: data.words.length,
    rootGroups: data.rootGroups.length,
    synonymWords: synonymWords.length,
    synonymSections: synonymSectionCount,
    partChecks,
  });
}

console.log(JSON.stringify({ valid: true, decks: results }, null, 2));
