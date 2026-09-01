import fs from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const decks = [
  { file: "../data/vocabulary-1000.json", deckId: "words1000", totalWords: 1085 },
  { file: "../data/vocabulary.json", deckId: "words2000", totalWords: 2078 },
];
const results = [];

for (const expected of decks) {
  const data = JSON.parse(await fs.readFile(new URL(expected.file, import.meta.url), "utf8"));
  const label = data.meta.title;
  assert(data.meta.deckId === expected.deckId, `${label}: unexpected deck ID`);
  assert(data.words.length === expected.totalWords, `${label}: expected ${expected.totalWords} cards, got ${data.words.length}`);
  assert(new Set(data.words.map((word) => word.id)).size === expected.totalWords, `${label}: word IDs are not unique`);
  assert(data.words.every((word) => word.word && word.meaning && word.root && word.part), `${label}: a required card field is blank`);
  assert(data.parts.length === 5, `${label}: expected five parts`);

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
  results.push({ deck: label, totalWords: data.words.length, rootGroups: data.rootGroups.length, partChecks });
}

console.log(JSON.stringify({ valid: true, decks: results }, null, 2));
