import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const workbookPath = process.env.GRE_1000_SOURCE_XLSX
  ? path.resolve(process.env.GRE_1000_SOURCE_XLSX)
  : path.resolve(projectDir, "..", "Mason_1000_2025_5Parts_Complete.xlsx");
const referencePath = path.resolve(projectDir, "data", "vocabulary.json");
const outputPath = path.resolve(projectDir, "data", "vocabulary-1000.json");

const expectedHeaders = [
  "No.",
  "Part",
  "Frequency",
  "Word",
  "Quizlet Flashcard Back (Details & Examples)",
];

// These rows have two possible roots in the 2000-word source. Assigning them
// explicitly makes the classification deterministic and keeps duplicated cards
// useful by teaching a different valid component where appropriate.
const rootOverrides = new Map([
  [75, "equ 相等、公平"],
  [119, "S"],
  [248, "pli, plic 彎、折、重疊"],
  [315, "imper 命令"],
  [361, "voc, vok 叫喊、聲音"],
  [390, "alg 痛"],
  [433, "nost 家"],
  [474, "ver 真實"],
  [542, "ben, bene 好"],
  [559, "cosm 宇宙"],
  [568, "di, du 雙"],
  [570, "di, du 雙"],
  [586, "fec, fic, fict: to do 做"],
  [626, "mal 壞、邪惡"],
  [631, "S"],
  [667, "pol 市民"],
  [856, "art 技巧、藝術"],
  [905, "odor 氣味、聞"],
  [906, "fec, fic, fict: to do 做"],
  [930, "lud, lus 玩、遊戲、扮演"],
  [951, "mun 公共"],
  [1032, "vol, volunt 意志、意願"],
  [42, "alien 疏遠"],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanLabel(value, label) {
  return String(value ?? "")
    .replace(new RegExp(`^\\[${label}\\]\\s*`), "")
    .trim();
}

function cleanDetails(value) {
  return String(value ?? "")
    .replace(/\s+\.\s+[A-Za-z]+\s+(?:1000|2000)\b/g, "")
    .replace(/\s*\|\s*Mason\s+(?:1000|2000)\b/gi, "")
    .trim();
}

function parseDetails(rawDetails) {
  const details = String(rawDetails ?? "").trim();
  const segments = details.split(/\s*\|\s*(?=\[(?:義|例|英)\]\s*)/);
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

const reference = JSON.parse(await fs.readFile(referencePath, "utf8"));
const rootNoByName = new Map(
  reference.rootGroups.map((group) => [group.root, group.rootNo]),
);
rootNoByName.set("alien 疏遠", Math.max(...rootNoByName.values()) + 1);

const rootsByWord = new Map();
for (const card of reference.words) {
  const key = card.word.toLocaleLowerCase();
  const roots = rootsByWord.get(key) ?? new Set();
  roots.add(card.root);
  rootsByWord.set(key, roots);
}

const workbook = XLSX.readFile(workbookPath);
const sheet = workbook.Sheets["All Vocabulary (1085 Words)"];
assert(sheet, "Workbook is missing the All Vocabulary (1085 Words) sheet");
const values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
const headers = values[0].map((value) => String(value ?? ""));
assert(
  JSON.stringify(headers) === JSON.stringify(expectedHeaders),
  `Unexpected workbook headers: ${JSON.stringify(headers)}`,
);

const sourceRows = values.slice(1).map((row, index) => ({
  sourceNo: Number(row[0]),
  sourcePart: Number(String(row[1]).replace(/\D+/g, "")),
  frequency: String(row[2] ?? "").trim(),
  word: String(row[3] ?? "").trim(),
  details: cleanDetails(row[4]),
  sourceIndex: index,
}));

assert(sourceRows.length === 1085, `Expected 1,085 cards, got ${sourceRows.length}`);
assert(new Set(sourceRows.map((row) => row.sourceNo)).size === 1085, "Duplicate source numbers detected");
assert(sourceRows.every((row) => row.word && row.details), "Blank required field detected");

for (const row of sourceRows) {
  if (rootOverrides.has(row.sourceNo)) {
    row.root = rootOverrides.get(row.sourceNo);
    continue;
  }

  const matches = [...(rootsByWord.get(row.word.toLocaleLowerCase()) ?? [])];
  assert(matches.length === 1, `Root for #${row.sourceNo} ${row.word} is ambiguous or missing: ${matches.join(", ")}`);
  row.root = matches[0];
}

const normalRows = sourceRows.filter((row) => row.root !== "S");
const sRows = sourceRows.filter((row) => row.root === "S");
const rootsPresent = [...new Set(normalRows.map((row) => row.root))].sort(
  (a, b) => (rootNoByName.get(a) ?? Infinity) - (rootNoByName.get(b) ?? Infinity),
);
assert(rootsPresent.every((root) => rootNoByName.has(root)), "A 1000-word root lacks a master root number");

const rootGroups = rootsPresent.map((root) => ({
  root,
  rootNo: rootNoByName.get(root),
  rows: normalRows.filter((row) => row.root === root).sort((a, b) => a.sourceNo - b.sourceNo),
}));
const baseQuota = Math.floor(rootGroups.length / 5);
const remainder = rootGroups.length % 5;
const rootQuotas = Array.from({ length: 5 }, (_, index) => baseQuota + (index < remainder ? 1 : 0));
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
const words = [];
for (const bin of bins) {
  const orderedGroups = [...bin.groups].sort((a, b) => a.rootNo - b.rootNo);
  let sIndex = 0;
  let deckPosition = 0;

  for (let groupIndex = 0; groupIndex < orderedGroups.length; groupIndex += 1) {
    const group = orderedGroups[groupIndex];
    assignmentByRoot.set(group.root, bin.part);
    for (const row of group.rows) {
      deckPosition += 1;
      words.push({
        id: `word1000-${row.sourceNo}`,
        sourceNo: row.sourceNo,
        part: bin.part,
        deckPosition,
        rootNo: group.rootNo,
        root: row.root,
        frequency: row.frequency,
        word: row.word,
        ...parseDetails(row.details),
      });
    }

    const targetSCount = Math.floor(((groupIndex + 1) * bin.sRows.length) / orderedGroups.length);
    while (sIndex < targetSCount) {
      const row = bin.sRows[sIndex];
      deckPosition += 1;
      words.push({
        id: `word1000-${row.sourceNo}`,
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

assert(words.length === 1085, `Expected 1,085 exported cards, got ${words.length}`);
assert(Math.max(...parts.map((part) => part.totalWordCount)) - Math.min(...parts.map((part) => part.totalWordCount)) <= 1, "Part totals differ by more than one word");

const payload = {
  meta: {
    deckId: "words1000",
    title: "1000 字",
    sourceWorkbook: "GRE Roots 1000-word source workbook",
    totalWords: words.length,
    totalRootGroups: rootGroups.length,
    totalSWords: sRows.length,
    classificationVersion: 1,
    classificationMethod: "Keep each root family intact; balance rooted cards across five parts; use S words to equalize totals; interleave S words only between root families.",
  },
  parts,
  rootGroups: rootGroups.map((group) => ({
    rootNo: group.rootNo,
    root: group.root,
    part: assignmentByRoot.get(group.root),
    wordCount: group.rows.length,
  })),
  words: words.sort((a, b) => a.part - b.part || a.deckPosition - b.deckPosition),
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");

console.log(JSON.stringify({
  workbook: workbookPath,
  output: outputPath,
  exportedWords: payload.words.length,
  rootGroups: payload.rootGroups.length,
  sWords: payload.meta.totalSWords,
  parts,
}, null, 2));
