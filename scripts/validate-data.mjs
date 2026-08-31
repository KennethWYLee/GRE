import fs from "node:fs/promises";

const data = JSON.parse(
  await fs.readFile(new URL("../data/vocabulary.json", import.meta.url), "utf8"),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(data.words.length === 2078, `Expected 2,078 words, got ${data.words.length}`);
assert(new Set(data.words.map((word) => word.id)).size === 2078, "Word IDs are not unique");
assert(data.rootGroups.length === 538, `Expected 538 root groups, got ${data.rootGroups.length}`);
assert(data.words.filter((word) => word.root === "S").length === 464, "Expected 464 S words");
assert(
  data.words.every((word) => word.word && word.meaning && word.root && word.part),
  "A required card field is blank",
);

const partChecks = data.parts.map((part) => {
  const words = data.words.filter((word) => word.part === part.id);
  const rootGroups = new Set(words.filter((word) => word.root !== "S").map((word) => word.root));
  const sWords = words.filter((word) => word.root === "S").length;
  assert(words.length === part.totalWordCount, `Part ${part.id} total does not match metadata`);
  assert(rootGroups.size === part.rootGroupCount, `Part ${part.id} root count does not match metadata`);
  assert(sWords === part.sWordCount, `Part ${part.id} S count does not match metadata`);
  return { part: part.id, words: words.length, roots: rootGroups.size, sWords };
});

const splitRoots = data.rootGroups.filter((group) => {
  const parts = new Set(
    data.words.filter((word) => word.root === group.root).map((word) => word.part),
  );
  return parts.size !== 1;
});
assert(splitRoots.length === 0, `${splitRoots.length} root families were split`);

const totals = partChecks.map((part) => part.words);
assert(Math.max(...totals) - Math.min(...totals) <= 1, "Part totals differ by more than one card");

console.log(JSON.stringify({ valid: true, totalWords: data.words.length, partChecks }, null, 2));
