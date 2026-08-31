import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const workbookPath =
  process.env.GRE_SOURCE_XLSX ??
  path.resolve(
    projectDir,
    "..",
    "outputs",
    "kuo_vocab_20260831",
    "Mason_2000_2025_5Parts_Root_Complete.xlsx",
  );
const outputPath = path.resolve(projectDir, "public", "data", "vocabulary.json");

const expectedHeaders = [
  "No.",
  "Part",
  "Root",
  "Frequency",
  "Word",
  "Quizlet Flashcard Back (Details & Examples)",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanLabel(value, label) {
  return String(value ?? "")
    .replace(new RegExp(`^\\[${label}\\]\\s*`), "")
    .trim();
}

function parseDetails(rawDetails) {
  const details = String(rawDetails ?? "").trim();
  const segments = details.split(/\s*\|\s*/);
  const pronunciation = String(segments[0] ?? "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .trim();

  return {
    pronunciation,
    meaning: cleanLabel(segments[1], "義"),
    example: cleanLabel(segments[2], "例"),
    definition: cleanLabel(segments.slice(3).join(" | "), "英"),
    raw: details,
  };
}

const workbook = XLSX.readFile(workbookPath);
const sheet = workbook.Sheets["All Vocabulary"];
assert(sheet, "Workbook is missing the All Vocabulary sheet");
const values = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  raw: false,
  defval: "",
});
const headers = values[0].map((value) => String(value ?? ""));

assert(
  JSON.stringify(headers) === JSON.stringify(expectedHeaders),
  `Unexpected workbook headers: ${JSON.stringify(headers)}`,
);

const sourceRows = values.slice(1).map((row, index) => ({
  sourceNo: Number(row[0]),
  sourcePart: Number(String(row[1]).replace(/\D+/g, "")),
  root: String(row[2] ?? "").trim(),
  frequency: String(row[3] ?? "").trim(),
  word: String(row[4] ?? "").trim(),
  details: String(row[5] ?? "").trim(),
  sourceIndex: index,
}));

assert(sourceRows.length === 2078, `Expected 2,078 words, got ${sourceRows.length}`);
assert(
  new Set(sourceRows.map((row) => row.sourceNo)).size === sourceRows.length,
  "Duplicate source numbers detected",
);
assert(sourceRows.every((row) => row.root && row.word && row.details), "Blank required field detected");

const normalRows = sourceRows.filter((row) => row.root !== "S");
const sRows = sourceRows.filter((row) => row.root === "S");
const rootOrder = [...new Set(normalRows.map((row) => row.root))];
assert(rootOrder.length === 538, `Expected 538 root groups, got ${rootOrder.length}`);
assert(sRows.length === 464, `Expected 464 S words, got ${sRows.length}`);

const rootNoByName = new Map(rootOrder.map((root, index) => [root, index + 1]));
const rootGroups = rootOrder.map((root, index) => ({
  root,
  rootNo: index + 1,
  rows: normalRows.filter((row) => row.root === root),
}));

// Equal root-family quotas keep each study part structurally comparable.
const rootQuotas = [108, 108, 108, 107, 107];
const bins = rootQuotas.map((quota, index) => ({
  part: index + 1,
  quota,
  rootedWordCount: 0,
  groups: [],
  sRows: [],
}));

for (const group of [...rootGroups].sort(
  (a, b) => b.rows.length - a.rows.length || a.rootNo - b.rootNo,
)) {
  const target = bins
    .filter((bin) => bin.groups.length < bin.quota)
    .sort(
      (a, b) =>
        a.rootedWordCount - b.rootedWordCount ||
        a.groups.length - b.groups.length ||
        a.part - b.part,
    )[0];
  target.groups.push(group);
  target.rootedWordCount += group.rows.length;
}

// S words fill the currently lightest part so total card counts end at 415/416.
for (const row of sRows) {
  const target = [...bins].sort(
    (a, b) =>
      a.rootedWordCount + a.sRows.length - (b.rootedWordCount + b.sRows.length) ||
      a.sRows.length - b.sRows.length ||
      a.part - b.part,
  )[0];
  target.sRows.push(row);
}

const assignmentByRoot = new Map();
for (const bin of bins) {
  for (const group of bin.groups) assignmentByRoot.set(group.root, bin.part);
}

const words = [];
for (const bin of bins) {
  const orderedGroups = [...bin.groups].sort((a, b) => a.rootNo - b.rootNo);
  let sIndex = 0;
  let deckPosition = 0;

  for (let groupIndex = 0; groupIndex < orderedGroups.length; groupIndex += 1) {
    const group = orderedGroups[groupIndex];
    for (const row of group.rows) {
      deckPosition += 1;
      words.push({
        id: `word-${row.sourceNo}`,
        sourceNo: row.sourceNo,
        part: bin.part,
        deckPosition,
        rootNo: rootNoByName.get(row.root),
        root: row.root,
        frequency: row.frequency,
        word: row.word,
        ...parseDetails(row.details),
      });
    }

    const targetSCount = Math.floor(
      ((groupIndex + 1) * bin.sRows.length) / orderedGroups.length,
    );
    while (sIndex < targetSCount) {
      const row = bin.sRows[sIndex];
      deckPosition += 1;
      words.push({
        id: `word-${row.sourceNo}`,
        sourceNo: row.sourceNo,
        part: bin.part,
        deckPosition,
        rootNo: null,
        root: "S",
        frequency: row.frequency,
        word: row.word,
        ...parseDetails(row.details),
      });
      sIndex += 1;
    }
  }

  assert(sIndex === bin.sRows.length, `Part ${bin.part} has unplaced S words`);
}

const parts = bins.map((bin) => ({
  id: bin.part,
  rootGroupCount: bin.groups.length,
  rootedWordCount: bin.rootedWordCount,
  sWordCount: bin.sRows.length,
  totalWordCount: bin.rootedWordCount + bin.sRows.length,
}));

const splitRoots = rootGroups.filter((group) => {
  const partsForRoot = new Set(
    words.filter((word) => word.root === group.root).map((word) => word.part),
  );
  return partsForRoot.size !== 1;
});

assert(words.length === 2078, `Expected 2,078 exported cards, got ${words.length}`);
assert(splitRoots.length === 0, `Split root families detected: ${splitRoots.length}`);
assert(
  bins.every((bin, index) => bin.groups.length === rootQuotas[index]),
  "Root family quotas were not met",
);
assert(
  Math.max(...parts.map((part) => part.totalWordCount)) -
      Math.min(...parts.map((part) => part.totalWordCount)) <=
    1,
  "Part totals differ by more than one word",
);

const payload = {
  meta: {
    title: "Mason GRE 2000 Root Deck",
    sourceWorkbook: "Mason_2000_2025_5Parts_Root_Complete.xlsx",
    totalWords: words.length,
    totalRootGroups: rootGroups.length,
    totalSWords: sRows.length,
    classificationVersion: 2,
    classificationMethod:
      "Keep each root family intact; balance root-family quotas and rooted card counts; use S words to equalize totals; interleave S words between root families.",
  },
  parts,
  rootGroups: rootGroups.map((group) => ({
    rootNo: group.rootNo,
    root: group.root,
    part: assignmentByRoot.get(group.root),
    wordCount: group.rows.length,
  })),
  words: words.sort(
    (a, b) => a.part - b.part || a.deckPosition - b.deckPosition,
  ),
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      workbook: workbookPath,
      output: outputPath,
      exportedWords: payload.words.length,
      rootGroups: payload.rootGroups.length,
      sWords: payload.meta.totalSWords,
      parts,
      splitRoots: splitRoots.length,
    },
    null,
    2,
  ),
);
