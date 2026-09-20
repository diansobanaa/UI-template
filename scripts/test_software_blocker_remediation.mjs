import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const mustNotContain = (rel, patterns) => {
  const text = read(rel);
  for (const pattern of patterns) assert.equal(text.includes(pattern), false, `${rel} contains forbidden operational pattern: ${pattern}`);
};

const types = read("src/lib/types.ts");
assert.match(types, /status: "Active" \| "Inactive"/);
const fert = read("src/app/fertigation/page.tsx");
assert.equal(fert.includes("find(() => true)"), false);
assert.match(fert, /const selectedGhId = params\.get\("gh"\) \?\? ""/);
assert.match(fert, /fertigationService\.startManual\(manualGh\.id, manualRecipe/);
for (const rel of ["src/app/page.tsx","src/app/greenhouse/[ghId]/page.tsx","src/app/schedule/page.tsx","src/app/calibration/page.tsx","src/app/research/page.tsx","src/app/events/page.tsx","src/components/layout/AppSidebar.tsx","src/components/layout/AppShell.tsx","src/app/complex/page.tsx","src/components/ui/equipment/ComponentEditorModal.tsx","src/lib/services.ts"]) mustNotContain(rel,["find(() => true)","greenhouses[0]","ghs[0]","complexes[0]"]);

const services = read("src/lib/services.ts");
assert.equal(services.includes("systemStatus() { return null; }"), false);
assert.match(services, /systemStatus\(complexId: string, ghId\?: string\)/);
assert.match(types, /FertigationSystemStatus/);
assert.match(fert, /systemStatus\(complex\.id, selectedGhId \|\| undefined\)/);
for (const rel of ["src/app/page.tsx","src/app/greenhouse/[ghId]/page.tsx"]) mustNotContain(rel,["currentMetricValue(","obsDeleteTarget.id","o.at"]);
assert.equal(services.includes("complexService.list()[0]"), false);
const dashboard = read("src/app/dashboard/page.tsx");
assert.match(dashboard, /allGreenhouses\.length === 1/); // view-only single-card presentation guard, not a physical target authority
assert.match(read("src/lib/telemetry-presentation.ts"), /currentForMetric/);
assert.match(types, /observationId: Id;[\s\S]*observedAt: string;/);
assert.match(services, /observationId: o\.observationId/);
assert.match(services, /observedAt: o\.observedAt/);

const conn = read("src/components/ConnectionMonitor.tsx");
assert.equal(conn.includes("eventService.syncLogsFromEsp32();"), false);
assert.match(conn, /status\.device\?\.complexId/);
assert.match(conn, /status\.sensors\?\.temperatureC/);
assert.equal(conn.includes("status.configuration?.complexId"), false);
assert.equal(conn.includes('status.sensors?.["waterTemperatureC"]'), false);
const contracts = read("src/lib/api/contracts.ts");
assert.match(contracts, /complexId\?: string/);
assert.match(contracts, /temperatureC\?: number \| null/);

const cFiles=[]; const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(c|h)$/.test(e.name))cFiles.push(p);}};
walk(path.join(root,"esp32"));
const esp32Text=cFiles.map((p)=>fs.readFileSync(p,"utf8")).join("\n");
assert.equal(/esp_task_wdt_init|esp_task_wdt_add|esp_task_wdt_status/i.test(esp32Text),false);

console.log("Software blocker remediation gate: PASS");
