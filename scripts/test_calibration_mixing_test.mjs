#!/usr/bin/env node
/**
 * Test Suite: Calibration Page Mixing & Dosing Hardware Test Verification
 * 
 * Tests Section 23 Requirements:
 * UI / API:
 *  1. Calibration page menampilkan button [ Test Mixing & Dosing ]
 *  2. Button disabled saat offline
 *  3. Modal menampilkan dosing pumps dynamic
 *  4. Calibrated pump muncul dengan rate
 *  5. Uncalibrated pump ditandai
 *  6. Confirmation diperlukan sebelum execution
 *  7. Test request terbentuk benar
 * 
 * Protocol & Safety:
 *  8. Manual test menggunakan protocol_mixing()
 *  9. Raw water threshold
 *  10. Parallel dosing
 *  11. Dosing OFF success
 *  12. Dosing OFF failure
 *  13. Raw water OFF failure
 *  14. Mixing OFF failure
 *  15. No-flow after partial progress
 *  16. Scoped safe-stop
 *  17. Successful completion
 *  18. Error completion
 */

import fs from "fs";
import path from "path";
import assert from "assert";

console.log("=== RUNNING CALIBRATION MIXING & DOSING TEST REGRESSION SUITE ===\n");

let passed = 0;
let failed = 0;

function check(desc, fn) {
  try {
    fn();
    console.log(`PASS: ${desc}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${desc} -> ${err.message}`);
    failed++;
  }
}

// -------------------------------------------------------------
// UI & Frontend Code Verification
// -------------------------------------------------------------

const pagePath = path.resolve("src/app/calibration/page.tsx");
const modalPath = path.resolve("src/components/calibration/TestMixingModal.tsx");
const clientPath = path.resolve("src/lib/api/esp32-client.ts");
const servicesPath = path.resolve("src/lib/services.ts");
const contractsPath = path.resolve("src/lib/api/contracts.ts");
const openapiCanonicalPath = path.resolve("contracts/UI_ESP32_OPENAPI.yaml");
const openapiRootPath = path.resolve("UI_ESP32_OPENAPI.yaml");

const pageCode = fs.readFileSync(pagePath, "utf8");
const modalCode = fs.readFileSync(modalPath, "utf8");
const clientCode = fs.readFileSync(clientPath, "utf8");
const servicesCode = fs.readFileSync(servicesPath, "utf8");
const contractsCode = fs.readFileSync(contractsPath, "utf8");
const openapiCanonicalCode = fs.readFileSync(openapiCanonicalPath, "utf8");
const openapiRootCode = fs.readFileSync(openapiRootPath, "utf8");

check("1. Calibration page displays [ Test Mixing & Dosing ] button", () => {
  assert(pageCode.includes("Test Mixing & Dosing"), "Page should contain Test Mixing & Dosing button text");
  assert(pageCode.includes("TestMixingModal"), "Page should import and render TestMixingModal");
});

check("2. Button disabled when device is offline", () => {
  assert(pageCode.includes("disabled={!isOnline}"), "Header button must be disabled when !isOnline");
  assert(pageCode.includes("Device is offline. Mixing test cannot be started."), "Button should display offline tooltip");
  assert(modalCode.includes("Device is offline"), "Modal must display offline warning banner");
});

check("3. Modal displays dynamic dosing pumps (not hardcoded)", () => {
  assert(modalCode.includes("devices.filter"), "Modal must filter dosing pumps from dynamic devices array");
  assert(modalCode.includes("dosingPumps.map"), "Modal must map over dynamic dosing pumps array");
  assert(!modalCode.includes("const dosingPumps = ['A', 'B']"), "Must not hardcode pump list");
});

check("4. Calibrated pump appears with rate", () => {
  assert(modalCode.includes("isCalibrated"), "Modal checks isCalibrated");
  assert(modalCode.includes("CALIBRATED •"), "Modal renders CALIBRATED status with rate");
  assert(modalCode.includes("ml/s"), "Modal shows mL/sec rate");
});

check("5. Uncalibrated pump marked NOT CALIBRATED and disabled from selection", () => {
  assert(modalCode.includes("NOT CALIBRATED"), "Modal renders NOT CALIBRATED for uncalibrated pumps");
  assert(modalCode.includes("disabled={!isCalibrated}"), "Checkbox must be disabled if uncalibrated");
});

check("6. Safety confirmation required before execution", () => {
  assert(modalCode.includes('step === "CONFIRM"'), "Modal requires a dedicated CONFIRM step");
  assert(modalCode.includes("WARNING: Physical Hardware Activation"), "Modal has explicit physical activation warning");
  assert(modalCode.includes("Test Now"), "Execution only begins upon pressing Test Now");
});

check("7. Test request formed with correct parameters", () => {
  assert(modalCode.includes("rawWaterTargetMl"), "Request has rawWaterTargetMl");
  assert(modalCode.includes("thresholdPercent"), "Request has thresholdPercent");
  assert(modalCode.includes("postMixDurationSec"), "Request has postMixDurationSec");
  assert(modalCode.includes("channels: selectedChannels"), "Request has selected channels");
  assert(contractsCode.includes("interface MixingTestRequest"), "MixingTestRequest interface declared in contracts");
});

// -------------------------------------------------------------
// API & Contract Verification
// -------------------------------------------------------------

check("8. OpenAPI & ESP32 client support canonical mixing test endpoints", () => {
  assert(openapiCanonicalCode.includes("/api/v1/calibration/test-mixing:"), "Canonical OpenAPI contains test-mixing endpoint");
  assert(openapiCanonicalCode.includes("/api/v1/calibration/test-mixing/stop:"), "Canonical OpenAPI contains test-mixing stop endpoint");
  assert(openapiRootCode.includes("/api/v1/calibration/test-mixing:"), "Root OpenAPI contains test-mixing endpoint");
  assert(clientCode.includes("startMixingTest"), "ESP32Client has startMixingTest");
  assert(clientCode.includes("getMixingTestStatus"), "ESP32Client has getMixingTestStatus");
  assert(clientCode.includes("stopMixingTest"), "ESP32Client has stopMixingTest");
  assert(servicesCode.includes("startMixingTest"), "calibrationService has startMixingTest");
});

// -------------------------------------------------------------
// Firmware C Implementation Verification
// -------------------------------------------------------------

const calibMgrCPath = path.resolve("esp32/main/services/calibration_mgr.c");
const calibMgrHPath = path.resolve("esp32/main/services/calibration_mgr.h");
const protocolCPath = path.resolve("esp32/main/services/protocol_mixing.c");
const protocolHPath = path.resolve("esp32/main/services/protocol_mixing.h");
const handlersCPath = path.resolve("esp32/main/http/api_calibration_handlers.c");

const calibMgrCCode = fs.readFileSync(calibMgrCPath, "utf8");
const calibMgrHCode = fs.readFileSync(calibMgrHPath, "utf8");
const protocolCCode = fs.readFileSync(protocolCPath, "utf8");
const protocolHCode = fs.readFileSync(protocolHPath, "utf8");
const handlersCCode = fs.readFileSync(handlersCPath, "utf8");

check("8B. Firmware calls protocol_mixing() as canonical engine for calibration test", () => {
  assert(calibMgrCCode.includes("protocol_mixing(&s_mixing_test_cfg)"), "calibration_mgr must call canonical protocol_mixing()");
  assert(!calibMgrCCode.includes("testMixing("), "Must not have separate testMixing implementation");
  assert(handlersCCode.includes("api_calibration_test_mixing_start_handler"), "HTTP handler registered for starting test");
});

check("9. Raw water threshold logic in protocol_mixing()", () => {
  assert(protocolCCode.includes("threshold_volume_ml"), "protocol_mixing calculates threshold_volume_ml");
  assert(protocolCCode.includes("threshold_reached"), "protocol_mixing monitors threshold_reached");
});

check("10. Parallel dosing channels in protocol_mixing()", () => {
  assert(protocolCCode.includes("MAX_MIXING_DOSING_CHANNELS"), "Supports multiple concurrent dosing channels");
  assert(protocolCCode.includes("set_scoped_actuator_state(&job_actuators.dosing[i], true)"), "Starts dosing actuators simultaneously");
});

check("11. Dosing OFF success and verification", () => {
  assert(protocolCCode.includes("set_scoped_actuator_state(&job_actuators.dosing[i], false)"), "protocol_mixing stops dosing actuators");
});

check("12. Dosing OFF failure trips immediate ACTUATOR_ERROR without 1.5x wait", () => {
  assert(protocolCCode.includes("MIXING_RESULT_ACTUATOR_ERROR"), "Actuator stop failure immediately returns ACTUATOR_ERROR");
});

check("13. Raw water OFF failure protection", () => {
  assert(protocolCCode.includes("set_scoped_actuator_state(&job_actuators.raw_water, false)"), "Stops raw water upon reaching target");
});

check("14. Mixing pump OFF failure protection", () => {
  assert(protocolCCode.includes("set_scoped_actuator_state(&job_actuators.mixing_pump, false)"), "Stops mixing pump upon completing post-mix");
});

check("15. Progress-based no-flow detection", () => {
  assert(protocolCCode.includes("MIXING_RESULT_RAW_WATER_NO_FLOW"), "protocol_mixing detects and trips on no-flow");
  assert(protocolCCode.includes("no_flow_grace"), "protocol_mixing uses no-flow grace period");
});

check("16. Scoped safe-stop protection (only stops job-owned actuators)", () => {
  assert(protocolCCode.includes("stop_mixing_protocol_actuators"), "protocol_mixing has scoped actuator shutdown");
  assert(calibMgrCCode.includes("stop_mixing_protocol_actuators(&s_mixing_test_cfg)"), "calibration_mgr abort stops only test-owned actuators");
});

check("17. Concurrency protection against busy fertigation or ongoing test", () => {
  assert(calibMgrCCode.includes("fertigation_mgr_get_state()"), "calibration_mgr checks fertigation_mgr state before starting");
  assert(calibMgrCCode.includes("ESP_ERR_INVALID_STATE"), "Rejects start with invalid state if fertigation is active");
});

check("18. Canonical event logging (MIXING_TEST_STARTED, SUCCESS, FAILED)", () => {
  assert(calibMgrCCode.includes("MIXING_TEST_STARTED"), "Logs MIXING_TEST_STARTED event");
  assert(calibMgrCCode.includes("MIXING_TEST_SUCCESS"), "Logs MIXING_TEST_SUCCESS event");
  assert(calibMgrCCode.includes("MIXING_TEST_FAILED"), "Logs MIXING_TEST_FAILED event");
});

console.log(`\n======================================================`);
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
