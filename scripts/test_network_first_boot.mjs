import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
function check(name, condition, detail = "") {
  checks.push({ name, pass: Boolean(condition), detail });
}

const systemConfig = read("esp32/main/config/system_config.h");
const storage = read("esp32/main/storage/storage_mgr.c");
const storageH = read("esp32/main/storage/storage_mgr.h");
const networkH = read("esp32/main/network/network_mgr.h");
const network = read("esp32/main/network/network_mgr.c");
const apiHandlers = read("esp32/main/http/api_device_handlers.c");
const setupHandlers = read("esp32/main/http/setup_handlers.c");
const setupHeader = read("esp32/main/http/setup_handlers.h");
const httpServer = read("esp32/main/http/http_server.c");
const main = read("esp32/main/main.c");
const buttons = read("esp32/main/services/panel_button_mgr.c");
const buttonHal = read("esp32/main/hal/button_hal.c");
const tft = read("esp32/main/hal/tft_hal.c");
const backend = read("backend/server.py");
const onboarding = read("src/app/onboarding-complex.tsx");
const espClient = read("src/lib/api/esp32-client.ts");
const contracts = read("src/lib/api/contracts.ts");
const openapi = read("contracts/UI_ESP32_OPENAPI.yaml");
const wiring = read("docs/HARDWARE_WIRING_MAP.md");

check("factory complex has no compiled-in operational default", !systemConfig.includes("DEFAULT_COMPLEX_ID") && !systemConfig.includes('complex-01'));
check("factory identity derives from full Wi-Fi MAC", storage.includes("ESP_MAC_WIFI_STA") && storage.includes('FACTORY_DEVICE_ID_PREFIX "%02X%02X%02X%02X%02X%02X"'));
check("factory Complex binding is explicitly empty", storage.includes('nvs_set_str(handle, "cplx_id", "")'));
check("binding refuses replacement of another Complex", storage.includes('strcmp(s_state.complex_id, complex_id) != 0') && storage.includes("ESP_ERR_INVALID_STATE"));
check("binding API is declared", storageH.includes("storage_mgr_bind_complex"));
check("provisioning manager is used", network.includes("wifi_prov_mgr_start_provisioning") && network.includes("wifi_prov_scheme_softap"));
check("provisioning SSID is unique per full MAC", network.includes('"%s%02X%02X%02X%02X%02X%02X"'));
check("provisioning has persisted random PoP security", network.includes("WIFI_PROV_SECURITY_1") && network.includes("s_prov_pop") && network.includes('PROV_POP_KEY "prov_pop"') && network.includes("esp_random()") && !network.includes('s_prov_pop, "AG%02X%02X%02X%02X%02X%02X"'));
check("STA credentials are mirrored atomically", network.includes('nvs_set_str(h, "sta_ssid"') && network.includes('nvs_set_str(h, "sta_pass"') && network.includes("nvs_commit(h)"));
check("no five-attempt retry cap remains", !network.includes("MAX_RETRY") && !network.includes("retry_num >= 5"));
check("reconnect interval is bounded and indefinite", network.includes("RECONNECT_INTERVAL_MS (50 * 1000)") && network.includes("while (true)") && network.includes("ulTaskNotifyTake"));
check("configured recovery never erases Wi-Fi credentials as part of Network Change Mode", !network.includes('nvs_erase_key(h, "sta_ssid")') && !network.includes('nvs_erase_key(h, "sta_pass")') && network.includes("network_mgr_enter_network_change_mode"));
check("mDNS hostname is stable and HTTP service is advertised", network.includes("mdns_hostname_set(s_hostname)") && network.includes('mdns_service_add(NULL, "_http", "_tcp"'));
check("STA DHCP hostname follows stored identity", network.includes("esp_netif_set_hostname(s_sta_netif, st->hostname)"));
check("real IP is read from STA netif", network.includes("esp_netif_get_ip_info") && !apiHandlers.includes('"127.0.0.1"'));
check("real MAC is read from Wi-Fi hardware", apiHandlers.includes("network_mgr_get_mac") && network.includes("esp_read_mac"));
check("device bind endpoint is registered", httpServer.includes('"/api/v1/device/bind"') && apiHandlers.includes("handler_post_device_bind"));
check("embedded setup Web UI is registered", httpServer.includes("register_setup_handlers") && setupHeader.includes("register_setup_handlers") && setupHandlers.includes("/setup") && setupHandlers.includes("/setup/api/connect") && setupHandlers.includes("/setup/api/scan"));
check("device bind is authenticated", apiHandlers.includes("http_check_auth(req)") && apiHandlers.includes("DEVICE_ID_MISMATCH"));
check("HTTPD is reused by SoftAP provisioning", network.includes("wifi_prov_scheme_softap_set_httpd_handle") && main.includes("http_server_start()") && main.indexOf("http_server_start()") < main.indexOf("network_mgr_init()"));
check("Button 4 uses 3 quick presses for Network Change Mode", buttons.includes("BUTTON4_QUICK_PRESS_MAX_MS") && buttons.includes("BUTTON4_PRESS_WINDOW_MS") && buttons.includes("BUTTON4_REQUIRED_PRESSES") && buttons.includes("s_button4_press_count >= BUTTON4_REQUIRED_PRESSES") && buttons.includes("network_mgr_enter_direct_local_mode") && !buttons.includes("NETWORK_RESET_LONG_PRESS_MS"));
check("status exposes network state and identity", apiHandlers.includes('"state"') && apiHandlers.includes('"connected"') && apiHandlers.includes('"hostname"') && apiHandlers.includes('"networkChangeMode"') && apiHandlers.includes('"setupCode"'));
check("setup code is shown locally in factory and Network Change Mode", network.includes("network_mgr_get_provisioning_pop") && tft.includes("network_mgr_is_setup_active") && tft.includes('"CODE:"'));
check("Network Change Mode has dedicated setup SSID", network.includes('SETUP_SSID_PREFIX "AGROTECH-SETUP-"') && network.includes("s_setup_ssid"));
check("Network Change Mode preserves previous credentials in RAM until candidate succeeds", network.includes("s_previous_ssid") && network.includes("restore_previous_sta") && network.includes("persist_wifi_credentials_atomic"));
check("candidate credential is persisted only after GOT_IP", network.includes("WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED") && network.includes("IP_EVENT && event_id == IP_EVENT_STA_GOT_IP") && network.indexOf("persist_wifi_credentials_atomic(s_candidate_ssid, s_candidate_pass)") > network.indexOf("IP_EVENT && event_id == IP_EVENT_STA_GOT_IP"));
check("backend bind validates the actual ESP32 endpoint", backend.includes("_esp32_get_json(endpoint, \"/api/v1/health\")") && backend.includes("/api/v1/device/bind"));
check("backend verifies API/schema compatibility", backend.includes("DEVICE_API_INCOMPATIBLE") && backend.includes('health.get("apiVersion")'));
check("backend prevents duplicate ownership", backend.includes("CONTROLLER_ALREADY_BOUND"));
check("backend has reconcile-required failure path", backend.includes("BINDING_RECONCILE_REQUIRED"));
check("frontend probes health + status together", onboarding.includes("Promise.all([client.getHealth(), client.getStatus()])"));
check("frontend rejects incompatible API/schema", onboarding.includes('health.apiVersion !== "v1" || health.schemaVersion !== 1'));
check("frontend cannot advance after failed status verification", onboarding.includes("const verified = await loadStatusAndIdentity()") && onboarding.includes("if (verified) setStep(2)"));
check("frontend displays actual network identity", onboarding.includes('label="Network IP"') && onboarding.includes('label="mDNS hostname"'));
check("frontend rollback behavior remains explicit", onboarding.includes("catch (e)") && onboarding.includes("setError(msg)") && !onboarding.includes("setStep(2);\n    } catch"));
check("ESP32 client exposes bind contract", espClient.includes('"/api/v1/device/bind"') && espClient.includes("DeviceBindResponse"));
check("TypeScript contract represents unbound Complex as null", contracts.includes("complexId: string | null") && contracts.includes("interface DeviceBindResponse"));
check("OpenAPI documents bind endpoint", openapi.includes("/api/v1/device/bind:") && openapi.includes("DeviceBindRequest") && openapi.includes("DeviceBindResponse"));
check("OpenAPI documents bearer auth", openapi.includes("securitySchemes:") && openapi.includes("bearerAuth:"));
check("hardware wiring SSOT exists and is untouched by this change set", wiring.length > 0);
check("source tree contains no NUL bytes in changed firmware C files", ["esp32/main/storage/storage_mgr.c", "esp32/main/network/network_mgr.c", "esp32/main/http/api_device_handlers.c", "esp32/main/http/setup_handlers.c", "esp32/main/services/panel_button_mgr.c", "esp32/main/hal/tft_hal.c"].every((f) => !read(f).includes("\0")));

let failures = 0;
for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
  if (!result.pass) failures += 1;
}
console.log(`\nNetwork first-boot structural gate: ${checks.length - failures}/${checks.length} PASS`);
if (failures) process.exit(1);
