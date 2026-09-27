import fs from "node:fs";
const read = f => fs.readFileSync(f, "utf8");
const network = read("esp32/main/network/network_mgr.c");
const header = read("esp32/main/network/network_mgr.h");
const buttons = read("esp32/main/services/panel_button_mgr.c");
const setup = read("esp32/main/http/setup_handlers.c");
const http = read("esp32/main/http/http_server.c");
const backend = read("backend/server.py");
const docs = read("docs/NETWORK_CHANGE_MODE_IMPLEMENTATION.md");
const onboarding = read("docs/COMPLEX_ESP32_ONBOARDING.md");
const prd = read("PRODUCT_REQUIREMENTS_DOCUMENT.md");
const openapi = read("contracts/UI_ESP32_OPENAPI.yaml");

const tests = [
  ["Button 4 quick-click constants", buttons.includes("BUTTON4_QUICK_PRESS_MAX_MS") && buttons.includes("BUTTON4_PRESS_WINDOW_MS")],
  ["2-click force router connect", buttons.includes("BUTTON4_FORCE_CONNECT_PRESSES") && buttons.includes("network_mgr_force_router_connect()")],
  ["3-click Direct Local toggle", buttons.includes("BUTTON4_REQUIRED_PRESSES") && buttons.includes("toggle_direct_local_mode()")],
  ["No long-press network reset remains", !buttons.includes("NETWORK_RESET_LONG_PRESS_MS") && !buttons.includes(">= 5000")],
  ["Non-blocking multi-click timer", buttons.includes("s_button4_action_timer") && buttons.includes("xTimerCreate")],
  ["Explicit Direct Local states", header.includes("NETWORK_STATE_DIRECT_LOCAL_AP") && header.includes("NETWORK_STATE_DIRECT_LOCAL_CONNECTED")],
  ["Direct Local Mode API", header.includes("network_mgr_enter_direct_local_mode") && header.includes("network_mgr_exit_direct_local_mode")],
  ["Force router connect API", header.includes("network_mgr_force_router_connect")],
  ["Temporary AP mode is APSTA", network.includes("esp_wifi_set_mode(WIFI_MODE_APSTA)") && network.includes("s_direct_local_active")],
  ["Normal configured state keeps AP off", network.includes("esp_wifi_set_mode(WIFI_MODE_STA)") && network.includes("if (s_sta_provisioned)")],
  ["AP timeout 3 minutes without client", network.includes("DIRECT_LOCAL_NO_CLIENT_TIMEOUT_MS (3 * 60 * 1000)") && network.includes("arm_ap_timeout_ms(DIRECT_LOCAL_NO_CLIENT_TIMEOUT_MS)")],
  ["AP timeout 1 minute after disconnect", network.includes("DIRECT_LOCAL_DISCONNECT_TIMEOUT_MS (60 * 1000)") && network.includes("arm_ap_timeout_ms(DIRECT_LOCAL_DISCONNECT_TIMEOUT_MS)")],
  ["Connected AP client cancels timeout", network.includes("WIFI_EVENT_AP_STACONNECTED") && network.includes("clear_ap_timeout()")],
  ["Disconnected AP client arms timeout", network.includes("WIFI_EVENT_AP_STADISCONNECTED") && network.includes("s_ap_client_count == 0")],
  ["AP remains operator-triggered on router outage", network.includes("!s_network_change_active && !s_sta_provisioned && !s_provisioning_active")],
  ["No reboot in network mode", !network.includes("esp_restart")],
  ["Old credentials preserved until candidate success", network.includes("s_previous_ssid") && network.includes("s_previous_pass") && network.includes("persist_wifi_credentials_atomic(s_candidate_ssid, s_candidate_pass)")],
  ["Candidate persistence tied to GOT_IP", network.indexOf("persist_wifi_credentials_atomic(s_candidate_ssid, s_candidate_pass)") > network.indexOf("IP_EVENT && event_id == IP_EVENT_STA_GOT_IP")],
  ["Failed candidate restores previous STA", network.includes("restore_previous_sta()") && network.includes("NETWORK_CANDIDATE_FAILED")],
  ["Embedded setup UI", setup.includes("/setup") && setup.includes("/setup/api/status") && setup.includes("/setup/api/scan") && setup.includes("/setup/api/connect") && setup.includes("/setup/api/finish")],
  ["50-second indefinite reconnect target", network.includes("RECONNECT_INTERVAL_MS (50 * 1000)") && prd.includes("50 seconds")],
  ["Local setup endpoints documented in OpenAPI", openapi.includes("/setup/api/status:") && openapi.includes("/setup/api/scan:") && openapi.includes("/setup/api/connect:") && openapi.includes("/setup/api/finish:")],
  ["Setup UI identifies direct local mode", setup.includes("LOCAL DIRECT MODE") && setup.includes("KELUAR MODE LOKAL")],
  ["Setup status reports explicit Direct Local state", setup.includes("network_mgr_get_state_string()") && setup.includes("DIRECT_LOCAL_CONNECTED")],
  ["Setup finish exits Direct Local Mode", setup.includes("network_mgr_is_direct_local_mode()") && setup.includes("network_mgr_exit_direct_local_mode()")],
  ["Setup UI exposes AP timeout/client telemetry", setup.includes("apClientCount") && setup.includes("apTimeoutSec")],
  ["Setup UI does not provide actuator commands", !setup.includes("/api/v1/commands") && !setup.includes("actuator")],
  ["HTTP server registers setup handlers", http.includes("register_setup_handlers(s_server)")],
  ["Backend preserves device identity on reconnect", backend.includes("registered_device_id == device_id") && backend.includes('"online": True')],
  ["Canonical network-change docs cover direct-local model", docs.includes("2× Button 4") && docs.includes("3× Button 4") && docs.includes("DIRECT_LOCAL_AP")],
  ["Canonical onboarding docs no longer prescribe long-press reset", !onboarding.includes("long press (>=5 seconds)") && onboarding.includes("Network Change Mode")],
  ["PRD contains factory onboarding", prd.includes("PRD-NET-001") && prd.includes("FACTORY_UNCONFIGURED")],
  ["PRD contains Network Change Mode", prd.includes("PRD-NET-010") && prd.includes("3× Button 4")],
  ["PRD contains Complex onboarding", prd.includes("PRD-ONB-001") && prd.includes("device_id")],
];
let fail=0;
for (const [name, ok] of tests) { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) fail++; }
console.log(`\nNetwork Change + Direct Local structural gate: ${tests.length-fail}/${tests.length} PASS`);
process.exit(fail ? 1 : 0);
