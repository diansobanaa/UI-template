import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "src");
const forbidden = [
  { re: /localStorage|sessionStorage/, label: "browser storage" },
  { re: /(?:from\s+|import\s*\()?["'][^"']*\/store(?:["']|["']\)?)/, label: "legacy store import" },
  { re: /seedDb\s*\(|startRealtimeMock\s*\(/, label: "mock runtime entry point" },
  { re: /MOCK_NOW\b/, label: "mock clock" },
  { re: /Reset Demo Data|Live simulation/, label: "demo-only operational UI" },
  { re: /@\/lib\/data\/(complexes|greenhouses|events|wellpump|hardwareComponents)/, label: "seed dataset import" },
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const failures = [];

const removedOperationalSeedFiles = [
  "src/lib/store.ts",
  "src/lib/data/complexes.ts",
  "src/lib/data/greenhouses.ts",
  "src/lib/data/events.ts",
  "src/lib/data/wellpump.ts",
  "src/lib/data/hardwareComponents.ts",
  "src/lib/data/environment.ts",
];

for (const relative of removedOperationalSeedFiles) {
  if (fs.existsSync(path.resolve(process.cwd(), relative))) {
    failures.push(`${relative} -> legacy operational seed file still exists`);
  }
}
for (const file of walk(root)) {
  const text = fs.readFileSync(file, "utf8");
  for (const rule of forbidden) {
    if (rule.re.test(text)) {
      failures.push(`${path.relative(process.cwd(), file)} -> ${rule.label}`);
    }
  }
}

if (failures.length) {
  console.error("M16 legacy operational-path gate FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("M16 legacy operational-path gate PASS");
console.log("No browser storage, legacy store imports, mock runtime entry points, demo UI markers, or operational seed imports found in src/.");
