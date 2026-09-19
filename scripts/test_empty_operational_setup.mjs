import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const hydrator = read("src/components/OperationalHydrator.tsx");
const setupState = read("src/components/OperationalSetupState.tsx");
const complexPage = read("src/app/complex/page.tsx");
const header = read("src/components/layout/AppHeader.tsx");

const checks = [
  ["onboarding route bypasses empty-state guard", /const isSetupRoute = location\.pathname === "\/complex" \|\| location\.pathname === "\/onboarding\/complex";/],
  ["empty-state CTA goes directly to onboarding", /to="\/onboarding\/complex"/],
  ["hardcoded 2310 L mock removed", !/2,310|2310/.test(complexPage)],
  ["empty Complex overview does not claim measured water", /complexes\.length === 0 \? "—"/.test(complexPage)],
  ["empty system does not claim realtime LIVE", /complexes\.length === 0 \? \(\s*<span[\s\S]*Setup Required/.test(header)],
];

let failed = 0;
for (const [name, test] of checks) {
  const source = name.includes("CTA") ? setupState : name.includes("route") ? hydrator : name.includes("2310") || name.includes("water") ? complexPage : header;
  const ok = test instanceof RegExp ? test.test(source) : Boolean(test);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}

if (failed) process.exit(1);
console.log(`\nEmpty operational setup gate: ${checks.length}/${checks.length} PASS`);
