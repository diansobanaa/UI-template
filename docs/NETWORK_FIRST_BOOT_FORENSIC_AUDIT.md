# NETWORK FIRST-BOOT & CONNECTIVITY FORENSIC AUDIT REPORT
**Target Hardware:** ESP32-S3-WROOM-1-N16R8  
**Audit Scope:** Firmware Network Architecture, First-Boot Provisioning, IP Discovery, LAN/W5500, UI/API Contracts, Operator Onboarding  
**Authority Hierarchy:** `docs/HARDWARE_WIRING_MAP.md` (Physical Pins SSOT) > `contracts/UI_ESP32_OPENAPI.yaml` (API SSOT) > Firmware C Implementation > Canonical Docs (`docs/`)  
**Audit Status:** COMPLETE  
**Audit Date:** 2026-09-20  

---

## 1. EXECUTIVE SUMMARY

An exhaustive, forensic source-code and documentation audit was conducted to answer the core operational question:

> **"How does a completely new ESP32-S3 behave the first time it is powered on, how does an operator connect to it, and how does it obtain Wi-Fi or LAN connectivity?"**

### Primary Audit Findings:
1. **First-Boot Scenario Status:** **NOT READY / PARTIAL (BLOCKED)**.
   - The ESP32 firmware initializes an unconfigured Wi-Fi subsystem into `WIFI_MODE_APSTA` and unconditionally broadcasts a SoftAP SSID (`AGROTECH-SETUP` / password `agrotech` at `192.168.4.1`).
   - However, **there is ZERO provisioning mechanism**:
     - No captive portal or HTML setup page is served by the ESP32.
     - No REST API endpoint exists for scanning Wi-Fi or setting Wi-Fi credentials (`sta_ssid` / `sta_pass`).
     - No function anywhere in the firmware or backend writes Wi-Fi credentials into NVS.
     - The only way to provision Wi-Fi credentials is via direct USB serial / NVS partition flashing.
2. **mDNS Resolution is Dead:**
   - Although `UI_ESP32_COMMUNICATION_SPEC.md` and `ESP32_BACKEND_SPEC.md` designate `esp32-<deviceId>.local` as the primary discovery mechanism, and `mdns` is included in `idf_component.yml` / `CMakeLists.txt`, **`mdns_init()` is NEVER called in firmware**. The hostname `esp32-*.local` will never resolve on the local network.
3. **IP Discovery is Broken:**
   - The local TFT ST7735 display has a network screen, but it only displays `CONNECTED (STA)` or `AP/OFFLINE`. It **never displays the IP address**.
   - The REST endpoint `GET /api/v1/status` returns hardcoded dummy values: `"ip": "127.0.0.1"` and `"mac": "00:00:00:00:00:00"`.
   - Once connected to a router, the operator has no built-in method to discover the ESP32's assigned DHCP IP other than checking the router's DHCP lease table or inspecting USB serial logs.
4. **LAN / W5500 is Blocked and Unimplemented:**
   - The authoritative pin map (`docs/HARDWARE_WIRING_MAP.md`) reallocated GPIO 10 to the Blower Fan Contactor Trigger; W5500 SPI Ethernet has NO assigned Chip Select pin.
   - `network_mgr.c` contains zero lines of Ethernet / W5500 driver code. LAN connectivity is 100% blocked and non-existent.
5. **Wi-Fi Disconnect Permanent Failure (No Periodic Auto-Reconnect):**
   - In `network_mgr.c`, connection retry is capped at `MAX_RETRY = 5`. After 5 failed attempts, the firmware logs a warning and permanently stops attempting reconnection. There is no periodic background retry task.
6. **Controller Pre-Binding Conflict Hazard:**
   - On first boot, `storage_mgr_init()` writes default values to NVS if unset: `dev_id = "esp32-controller-01"` and `cplx_id = "complex-01"`.
   - The frontend onboarding wizard (`src/app/onboarding-complex.tsx`) validates whether `identity.complexId === complex.id`. If an operator creates a new Complex that receives any ID other than `complex-01` (e.g. `complex-02`), the UI reports `controllerConflict` and **permanently blocks binding**. There is no API in firmware to reassign `complexId`.
7. **Frontend Onboarding Root Blocker ("Create & continue" inaction):**
   - The user noted: *"saat klik create and ... contiune tidak terjadi apa apa"*.
   - In `src/app/onboarding-complex.tsx`, Step 1 ("Create the Complex") invokes `complexService.create()`. This requires the Python backend (`http://127.0.0.1:8090`). If the backend process is offline, proxy errors are caught and the form remains stuck on Step 1.
   - Furthermore, the UI onboarding flow is strictly for **Complex binding in the software layer**, not network commissioning. It assumes the ESP32 already has an established IP address on the LAN.

---

## 2. AUTHORITY HIERARCHY & SSOT

```text
[docs/HARDWARE_WIRING_MAP.md]  <--- SINGLE SOURCE OF TRUTH (Physical Pin Mappings)
             │
             ├── W5500 has NO active pin mapping (GPIO 10 is Blower Contactor)
             └── W5500 SPI Ethernet is DEFERRED / BLOCKED
             
[contracts/UI_ESP32_OPENAPI.yaml] <--- SINGLE SOURCE OF TRUTH (API Contracts)
             │
             ├── Contains NO /api/v1/wifi or provisioning endpoints
             └── Contains NO network configuration mutation routes

[Firmware C Code (esp32/main/)] <--- RUNTIME & PHYSICAL AUTHORITY
             │
             ├── network_mgr.c: Wi-Fi SoftAP ("AGROTECH-SETUP") + STA mode only
             ├── storage_mgr.c: NVS keys "dev_id", "cplx_id", "sta_ssid", "sta_pass"
             └── http_server.c: REST server (port 80), NO captive portal, NO HTML
```

---

## 3. ACTUAL FIRST-BOOT EXECUTION SEQUENCE (FIRMWARE TRACE)

The actual code path executed when a factory-new ESP32 receives power is traced below:

```text
POWER ON
   │
   ▼
[1] safe_boot_actuators() (esp32/main/main.c:44)
   │  - Configures 9 output pins: Well Pump, Dist Pump, Raw Subm, Dosing A/B,
   │    Cooling Fan, Blower Fan, Mixing Pump, Error Lamp.
   │  - Locks all pins immediately to ACTUATOR_LEVEL_OFF (1 = Active-Low Relay De-energized).
   │  - Output: Safe-off state guaranteed before storage or network initialization.
   │
   ▼
[2] init_nvs() (esp32/main/main.c:85)
   │  - Mounts default NVS partition. Auto-erases and recovers if corrupted.
   │
   ▼
[3] esp_netif_init() & esp_event_loop_create_default() (main.c:128-129)
   │  - Initializes TCP/IP stack (LwIP) and default system event loop.
   │
   ▼
[4] storage_mgr_init() (esp32/main/storage/storage_mgr.c:50)
   │  - Checks NVS namespace "agrotech" for "dev_id" and "cplx_id".
   │  - [FIRST-BOOT FINDING]: Neither exists in NVS.
   │  - storage_mgr.c:66 sets dev_id = "esp32-controller-01" and WRITES to NVS.
   │  - storage_mgr.c:72 sets cplx_id = "complex-01" and WRITES to NVS.
   │  - Mounts SPIFFS at /spiffs. Sets safe_boot_active = true.
   │
   ▼
[5] network_mgr_init() (esp32/main/network/network_mgr.c:84)
   │  - Creates FreeRTOS event group s_wifi_event_group.
   │  - Creates default STA netif: esp_netif_create_default_wifi_sta().
   │  - Registers event handlers for WIFI_EVENT and IP_EVENT (IP_EVENT_STA_GOT_IP).
   │  - Calls wifi_init_softap_fallback():
   │      - Creates default AP netif: esp_netif_create_default_wifi_ap().
   │      - Sets SoftAP config: SSID = "AGROTECH-SETUP", Pass = "agrotech", Channel 1, Auth = WPA2-PSK.
   │  - Reads NVS namespace "agrotech" for "sta_ssid" and "sta_pass":
   │      - [FIRST-BOOT FINDING]: Keys "sta_ssid" and "sta_pass" DO NOT EXIST.
   │      - Logs: "Wi-Fi STA unconfigured in NVS; operating in standalone SoftAP mode."
   │      - Sets s_sta_provisioned = false.
   │  - Sets Wi-Fi mode to WIFI_MODE_APSTA.
   │  - Calls esp_wifi_start().
   │  - SoftAP starts broadcasting "AGROTECH-SETUP" at IP 192.168.4.1.
   │  - STA netif starts but attempts NO outbound connection because s_sta_provisioned == false.
   │
   ▼
[6] HAL & Display Initialization (esp32/main/main.c:143-162)
   │  - hardware_hal_init_all(): Loads active configuration from NVS (empty on first boot).
   │  - rtc_ds3231_init(): Initializes external RTC over I2C (GPIO 4 / 5).
   │  - tft_hal_init(): Initializes ST7735 1.8" TFT SPI display.
   │  - Shows Diagnostic Screen: "DEV ID: esp32-controller-01", "FIRMWARE: v1.0.0".
   │
   ▼
[7] Core Services Initialization (esp32/main/main.c:164-212)
   │  - event_mgr_init(), command_mgr_init(), manual_actuator_mgr_init(),
   │    transfer_mgr_init(), calibration_mgr_init(), safety_monitor_init(),
   │    scheduler_init(), panel_button_mgr_init(), fertigation_mgr_init().
   │  - storage_mgr_set_safe_boot_active(false): Leaves safe-boot interlock.
   │  - crop_cycle_mgr_init(), telemetry_mgr_init(), offline_sync_mgr_init().
   │
   ▼
[8] http_server_start() (esp32/main/http/http_server.c:199)
   │  - Starts embedded HTTP server on port 80 (DEFAULT_HTTP_PORT).
   │  - Listens on all active netifs (SoftAP 192.168.4.1:80 and any future STA IP:80).
   │  - Registers REST API routes: /api/v1/health, /api/v1/status, /api/v1/inventory, etc.
   │  - [FIRST-BOOT FINDING]: No root route "/" or static HTML files registered.
   │
   ▼
[9] OPERATOR STANDSTILL (FIRST CONNECTION BLOCKED)
      - The ESP32 is broadcasting "AGROTECH-SETUP" at 192.168.4.1.
      - Operator connects laptop/phone to "AGROTECH-SETUP" (Pass: "agrotech").
      - Operator opens browser to http://192.168.4.1/ -> Returns HTTP 404 (No portal).
      - No endpoint exists to submit home/greenhouse Wi-Fi credentials.
      - Device cannot migrate to LAN without physical USB flashing.
```

---

## 4. WI-FI FIRST-BOOT AUDIT

### 4.1 SoftAP Mode
* **Does ESP32 create its own access point?** YES.
* **Under what condition?** Unconditionally at boot in `network_mgr_init()`.
* **SSID:** `AGROTECH-SETUP` (defined as `PROV_WIFI_SSID` in `network_mgr.c:13`).
* **Password:** `agrotech` (defined as `PROV_WIFI_PASS` in `network_mgr.c:14`).
* **Static or Generated?** Static hardcoded compile-time string.
* **Authentication Requirement:** WPA2-PSK (`WIFI_AUTH_WPA_WPA2_PSK`).
* **AP IP Address:** `192.168.4.1` (ESP-IDF default `esp_netif` SoftAP gateway).
* **DHCP Server:** Enabled automatically by `esp_netif_create_default_wifi_ap()`. Leases IPs in range `192.168.4.2` – `192.168.4.10`.
* **Captive Portal:** **MISSING / NONE**. No DNS redirect (port 53 DNS server) is implemented.
* **Provisioning Page Served?** **NO**. No web page or HTML asset is compiled or hosted.
* **Provisioning Endpoint:** **MISSING / NONE**. There is no `/api/v1/wifi`, `/setup`, or `/provision`.

### 4.2 STA Mode
* **Where are SSID/password stored?** In NVS namespace `"agrotech"`, keys `"sta_ssid"` (max 32 chars) and `"sta_pass"` (max 64 chars).
* **How are they initially provided?** **MISSING IN SOFTWARE**. There is no API handler, CLI command, or UI flow to write these keys. They can only be placed into NVS via direct serial flash programming.
* **Is there a provisioning API?** **NO**.
* **Is there a UI flow?** **NO**.
* **Does ESP32 automatically connect using saved credentials?** YES, if `"sta_ssid"` is present in NVS at boot.
* **How many retries?** `MAX_RETRY = 5` (`network_mgr.c:15`).
* **Retry timing:** Immediate upon receiving `WIFI_EVENT_STA_DISCONNECTED` (no exponential backoff or delay).
* **What happens after repeated failure?** After 5 retries, `network_mgr.c:47-48` sets `WIFI_FAIL_BIT` and logs `Failed to connect to AP after 5 retries. SoftAP remaining available.`.
* **Does it return to AP/provisioning mode?** The SoftAP was never turned off (`WIFI_MODE_APSTA` remains active). However, STA attempts permanently cease.

### 4.3 Persistence & Reset Behavior
* **Reboot / Power Loss:** NVS preserves `"sta_ssid"` and `"sta_pass"` across boots and brownouts.
* **Firmware Restart:** Credentials survive standard software restarts (`esp_restart()`).
* **Factory Reset:** There is **NO factory reset command or button sequence** implemented to erase NVS or wipe network credentials.
* **NVS Corruption:** If NVS is truncated or corrupted, `init_nvs()` erases the partition and reformats, permanently destroying credentials and returning the device to unprovisioned SoftAP mode.
* **Invalid Credentials:** If credentials become invalid (e.g. router password changed), the ESP32 fails 5 connection attempts and gives up. Because SoftAP has no provisioning API, the device becomes **permanently inaccessible via network** until reflashed over USB.

---

## 5. OPERATOR FIRST-CONNECTION WORKFLOW

Comparison of the intended industry workflow vs. the actual code capability:

| Step | Intended Human Workflow | Current Code Status | Exact Failure / Gap Point |
|---|---|---|---|
| 1 | Power ESP32 | **IMPLEMENTED** | Board powers on, runs `safe_boot_actuators()`, all relays OFF. |
| 2 | Find its network (`AGROTECH-SETUP`) | **IMPLEMENTED** | SoftAP broadcasts SSID `AGROTECH-SETUP`. |
| 3 | Connect laptop/phone to SoftAP | **IMPLEMENTED** | Connects with WPA2 passphrase `agrotech`. Client gets IP `192.168.4.2`. |
| 4 | Open browser / captive portal | **BLOCKED** | Browser opens `http://192.168.4.1/` -> HTTP 404. No HTML page served. |
| 5 | Configure router Wi-Fi credentials | **MISSING** | No form, no API endpoint, no NVS setter exists in firmware. |
| 6 | ESP32 joins router Wi-Fi | **BLOCKED** | Cannot proceed because Step 5 cannot be performed. |
| 7 | Device gets router IP via DHCP | **PARTIAL** | Logic exists in `IP_EVENT_STA_GOT_IP`, but cannot trigger without credentials. |
| 8 | Operator discovers assigned IP | **MISSING** | mDNS is dead; TFT does not display IP; `/status` returns `"127.0.0.1"`. |
| 9 | Browser reconnects to ESP32 on LAN | **BLOCKED** | Operator does not know IP, and device is not on LAN. |
| 10 | Device ready for Complex binding | **BLOCKED** | Flow is completely blocked at Step 4 & 5. |

---

## 6. IP DISCOVERY AUDIT

* **AP Static IP:** `192.168.4.1` (Deterministic, standard ESP-IDF default).
* **DHCP Lease / Hostname:** The ESP32 does not register a custom DHCP client hostname with the router (`esp_netif_set_hostname()` is not called). It registers with default Espressif LwIP hostname.
* **mDNS (`esp32-<deviceId>.local`):** **DEAD / NOT INITIALIZED**.
  - `sdkconfig.defaults` defines `CONFIG_MDNS_MAX_SERVICES=10`.
  - `idf_component.yml` includes `espressif/mdns: ^1.11.3`.
  - `CMakeLists.txt` links `mdns`.
  - **Evidence:** `grep -rn "mdns_" esp32/main/` yields **ZERO matches**. The initialization function `mdns_init()` is never called anywhere in C code.
* **TFT Display:** **DOES NOT DISPLAY IP**.
  - `tft_hal.c:391` (`tft_show_network_screen()`) prints only `"WIFI STATUS: CONNECTED (STA)"` or `"AP/OFFLINE"`. It contains no code to query `esp_netif_get_ip_info()` or render an IP address string.
* **HTTP API Discovery (`GET /api/v1/status`):** **DUMMY DATA**.
  - `api_device_handlers.c:53-54` hardcodes:
    ```c
    cJSON_AddStringToObject(network, "ip", "127.0.0.1");
    cJSON_AddStringToObject(network, "mac", "00:00:00:00:00:00");
    ```
  - The API does not reflect real network interface state.
* **Verdict:** `IP DISCOVERY = MISSING / UNUSABLE`.

---

## 7. LAN / W5500 SPI ETHERNET AUDIT

* **Driver Implementation:** **NONE**. `network_mgr.c` only references `esp_wifi.h` and has zero SPI Ethernet logic.
* **Hardware Pin Conflict (SSOT vs W5500):**
  - In `docs/HARDWARE_WIRING_MAP.md` (SSOT), **GPIO 10 is officially assigned to Relay IN3 (Blower Fan Contactor Trigger)**.
  - In `esp32/main/config/pin_config.h:26`:
    ```c
    /* - No W5500 CS is defined by the canonical hardware wiring contract. */
    #define PIN_OUT_BLOWER_FAN (10)
    ```
  - `docs/ESP32_ASSEMBLY_GUIDE.md:187`: *"W5500 Ethernet: BLOCKED / DO NOT WIRE — the canonical hardware pin map does not assign W5500 CS/INT/RESET."*
* **Verdict:** `LAN / W5500 = DEFERRED / BLOCKED / NOT IMPLEMENTED`.

---

## 8. WI-FI AND LAN INTERFACE PRIORITY

* Since W5500 is completely unmapped and unimplemented, there is **no dual-interface failover or priority mechanism**.
* Wi-Fi SoftAP and Wi-Fi STA are the only network interfaces.
* The embedded HTTP server binds to `INADDR_ANY` (`0.0.0.0`) on port 80, meaning it responds identically on SoftAP (`192.168.4.1`) and STA (if connected).

---

## 9. NETWORK FAILURE AND RECOVERY

* **Wi-Fi Link Loss During Operation:**
  - When connection is lost, `WIFI_EVENT_STA_DISCONNECTED` fires in `network_mgr.c:38`.
  - Sets `s_is_connected = false`.
  - Emits persistent event log: `COMMUNICATION_LOST` (*"Wi-Fi communication lost; ESP32 local authority continues independently."*).
  - Tries reconnecting up to 5 times.
  - **Fatal Defect:** If the router is rebooting and takes more than ~15 seconds to come back online, the ESP32 exhausts its 5 immediate retries and halts reconnection attempts indefinitely (`network_mgr.c:48`).
* **Local Autonomous Operation (PRD / Trinity Compliance):**
  - **VERIFIED PASS (SOFTWARE)**: Sensor sampling, safety interlocks, scheduled fertigation, and emergency-stop monitoring execute in separate FreeRTOS tasks (`safety_monitor`, `scheduler`, `telemetry_mgr`). Network loss does not block local physical execution.

---

## 10. CREDENTIAL & SECRET STORAGE AUDIT

| Item | Location | Storage Type | Encryption / Protection | Audit Finding |
|---|---|---|---|---|
| SoftAP SSID | `network_mgr.c:13` | Compile-time macro | Plain text | `PROV_WIFI_SSID` = `"AGROTECH-SETUP"` |
| SoftAP Password | `network_mgr.c:14` | Compile-time macro | Plain text | `PROV_WIFI_PASS` = `"agrotech"` |
| STA Wi-Fi SSID | NVS namespace `"agrotech"`, key `"sta_ssid"` | Flash NVS | Plain text (No NVS encryption) | **ABSENT at first boot**; No setter exists |
| STA Wi-Fi Password | NVS namespace `"agrotech"`, key `"sta_pass"` | Flash NVS | Plain text (No NVS encryption) | **ABSENT at first boot**; No setter exists |
| HTTP API Token | `http_server.c:35`, or NVS `"api_key"` | Compile-time default / NVS | Plain text | `"agrotech-secret-key"` |

---

## 11. NETWORK API & PROVISIONING API AUDIT

A complete audit of `esp32/main/http/` and `contracts/UI_ESP32_OPENAPI.yaml` for network endpoints:

| Endpoint | Method | Exists in Firmware? | Exists in OpenAPI? | Auth Required? | Purpose / Status |
|---|---|---|---|---|---|
| `/api/v1/wifi/scan` | GET | **NO** | **NO** | N/A | Missing |
| `/api/v1/wifi/config` | POST | **NO** | **NO** | N/A | Missing |
| `/api/v1/network` | GET | **NO** | **NO** | N/A | Missing |
| `/api/v1/health` | GET | **YES** | **YES** | None | Returns device health, uptime, `deviceId`, `complexId`. |
| `/api/v1/status` | GET | **YES** | **YES** | None | Returns system status. (`network.ip` is fake `"127.0.0.1"`). |
| `/api/v1/inventory` | GET | **YES** | **YES** | None | Returns installed hardware inventory. |
| `/api/v1/configuration/*` | ALL | **YES** | **YES** | Bearer Token | Hardware component config only; no network fields. |
| `/api/v1/reset` | POST | **NO** | **NO** | N/A | Missing |

---

## 12. FRONTEND PROVISIONING AUDIT

* **Audited Component:** `src/app/onboarding-complex.tsx`.
* **Purpose:** This wizard manages **Complex Software Entity Registration & Controller Binding**, NOT network commissioning.
  - Step 1: Create Complex entity in Python backend (`POST /api/complexes`).
  - Step 2: Discover/Probe ESP32 (`GET /api/v1/health` at user-typed IP/hostname).
  - Step 3: Verify controller identity (`deviceId`, `apiVersion`).
  - Step 4: Bind controller to Complex (`POST /api/complexes/{id}/controller/bind`).
  - Step 5: Read inventory (`GET /api/v1/inventory`).
* **Why clicking "Create & continue" did nothing ("tidak terjadi apa-apa"):**
  1. If `complexName` or `location` is blank, `canAdvance` is `false`, and the button is strictly `disabled` (clicks produce no DOM event).
  2. When enabled, clicking executes `complexService.create()`. This calls `POST /api/complexes` via Vite proxy (`http://127.0.0.1:8090`). If the Python backend process is stopped, the Vite proxy fails with `500 ECONNREFUSED`, catching an exception and aborting navigation to Step 2.
* **Network Setup in UI:** **100% ABSENT**. There is no Wi-Fi selection, no password prompt, and no SoftAP bridge in the web UI.

---

## 13. LOCAL DISPLAY & PANEL BUTTON INTERACTION

* **ST7735 1.8" SPI TFT:**
  - Cycles through 4 screens via Button 1 (GPIO 0).
  - Screen 4 (`TFT_SCREEN_NETWORK`) displays `"AP/OFFLINE"` or `"CONNECTED (STA)"`, system time, and E-Stop state.
  - **Does NOT show:** SoftAP SSID, SoftAP password, device IP address, subnet mask, gateway, or error codes.
* **Hardware Buttons:**
  - Button 1 (GPIO 0): Cycle display screens (`tft_show_next_screen()`).
  - Button 2 (GPIO 39): 5-minute manual Well Pump override.
  - Button 4 (GPIO 41): Unassigned (`BUTTON_RESERVED`).
  - **No network reset, WPS, or provisioning mode trigger exists.**

---

## 14. SERIAL / USB FIRST-BOOT DEPENDENCY

* Because there is no web captive portal, no mobile provisioning app, and no HTTP network configuration endpoint, **initial Wi-Fi commissioning is 100% DEPENDENT ON USB SERIAL / HARDWARE FLASHING TOOLS**.
* An operator must:
  1. Connect ESP32-S3 to PC via USB-C.
  2. Generate an NVS binary or use an ESP-IDF serial script to write keys `"sta_ssid"` and `"sta_pass"` into NVS namespace `"agrotech"`.
  3. Reboot the ESP32.

---

## 15. FACTORY RESET & LOST CREDENTIAL RISKS

* **Scenario:** Operator changes the greenhouse Wi-Fi router password.
* **Firmware Reaction:**
  1. ESP32 fails to connect to the router.
  2. It retries 5 times and halts STA connection attempts.
  3. SoftAP remains active (`AGROTECH-SETUP` at `192.168.4.1`).
  4. Operator connects to `AGROTECH-SETUP` via laptop.
  5. Operator has **NO way to submit the new router password**, because no HTTP endpoint or web portal exists.
* **Severity:** **CRITICAL OPERATIONAL RISK**. A field device with changed Wi-Fi credentials cannot be recovered without opening the enclosure and connecting a USB programming cable.

---

## 16. DEVICE IDENTITY VS. COMPLEX IDENTITY AUDIT

* **PRD / Trinity Invariant:** `Device Identity != Greenhouse Identity != Complex Identity`.
* **Firmware Default Initialization (`storage_mgr.c:64-74`):**
  - `dev_id` defaults to `"esp32-controller-01"`.
  - `cplx_id` defaults to `"complex-01"`.
* **The Conflict Trap:**
  - When a brand-new board boots, it writes `complexId = "complex-01"` to NVS.
  - In `src/app/onboarding-complex.tsx:101`:
    ```typescript
    const controllerConflict = Boolean(identity?.complexId && complex && identity.complexId !== complex.id);
    ```
  - If the operator creates a new Complex in the UI named "South Facility", the backend assigns ID `"complex-02"`.
  - When the operator probes the ESP32, the ESP32 returns `complexId = "complex-01"`.
  - The UI detects `controllerConflict` (`"complex-01" !== "complex-02"`) and **blocks binding permanently**.
  - Because there is no firmware API to clear or update `complexId`, the board is locked to `"complex-01"`.

---

## 17. BACKEND DEPENDENCY MATRIX

| Function | Requires ESP32 Standalone | Requires Python Backend | Requires Internet |
|---|---|---|---|
| Hardware Safe Boot & Fail-Safe OFF | **YES** | NO | NO |
| SoftAP Broadcast (`AGROTECH-SETUP`) | **YES** | NO | NO |
| Autonomous Sensor Sampling & Safety | **YES** | NO | NO |
| Local Actuator Scheduling | **YES** | NO | NO |
| Web UI Complex Onboarding (Step 1) | NO | **YES** (`POST /api/complexes`) | NO |
| Web UI Controller Binding (Step 4) | NO | **YES** (`POST /.../bind`) | NO |
| Multi-Greenhouse Recipe Master & Ingestion | NO | **YES** | NO |
| First-Boot Network Provisioning | **MISSING IN BOTH** | **MISSING IN BOTH** | NO |

---

## 18. SECURITY AUDIT (ONBOARDING SPECIFIC)

1. **Static Hardcoded SoftAP Password:**
   - SSID: `AGROTECH-SETUP`, Pass: `agrotech`.
   - All AgroTech controllers worldwide share this identical password. In a multi-greenhouse facility or commercial installation, any visitor or neighboring greenhouse can connect to the controller's SoftAP.
2. **Unauthenticated Read Endpoints:**
   - `/api/v1/health`, `/api/v1/status`, and `/api/v1/inventory` require zero authentication. Any device connecting to the SoftAP can inspect system health, device IDs, and sensor telemetry.
3. **Hardcoded API Token:**
   - Default token `"agrotech-secret-key"` is compiled into firmware (`http_server.c:35`).
4. **Unencrypted HTTP:**
   - Plaintext HTTP (port 80). Passwords and tokens sent over Wi-Fi are vulnerable to local packet sniffing.
5. **CORS Wildcard:**
   - `Access-Control-Allow-Origin: *` is returned on all endpoints.

---

## 19. SAFE BOOT & ACTUATOR INTERLOCK INTEGRITY

* **Audit Question:** Can network initialization or connection failure cause spurious actuator pulses or accidental dosing pump activation?
* **Evidence:**
  - `main.c:121` executes `safe_boot_actuators()` before NVS, storage, or network tasks are created.
  - Output pins are explicitly initialized to `ACTUATOR_LEVEL_OFF` (High for active-low relay board).
  - Actuator commands flow through `command_mgr`, which validates against `safety_monitor`.
  - Wi-Fi connection, disconnection, and retry events do not trigger actuator state changes.
* **Verdict:** **SAFE BOOT INTEGRITY = PASS**.

---

## 20. ACTUAL BOOT ORDER AUDIT

```text
1. safe_boot_actuators()          (Hardware outputs locked OFF immediately)
2. print_system_diagnostics()      (Console banner)
3. init_nvs()                      (Flash storage)
4. esp_netif_init()                (LwIP network stack)
5. esp_event_loop_create_default() (Event broker)
6. storage_mgr_init()              (NVS metadata, dev_id, cplx_id, SPIFFS)
7. network_mgr_init()              (SoftAP start, check STA credentials)
8. hardware_hal_init_all()         (Hardware registry)
9. sdcard_hal_init()               (MicroSD SPI)
10. rtc_ds3231_init()              (I2C RTC)
11. tft_hal_init()                 (SPI Display)
12. event_mgr_init()               (Event logging)
13. command_mgr_init()             (Command processor)
14. manual_actuator_mgr_init()     (Manual controls)
15. transfer_mgr_init()            (Resource transfers)
16. calibration_mgr_init()         (Sensor calibration)
17. safety_monitor_init()          (Interlocks & floats)
18. scheduler_init()               (Task schedules)
19. panel_button_mgr_init()        (Buttons)
20. fertigation_mgr_init()         (Dosing engine)
21. storage_mgr_set_safe_boot_active(false) (Exit safe boot gate)
22. crop_cycle_mgr_init()          (Crop cycle engine)
23. telemetry_mgr_init()           (Telemetry spool)
24. offline_sync_mgr_init()        (Sync engine)
25. http_server_start()            (REST server port 80)
```
* **Order Assessment:** The order is robust and safe. Network and HTTP services start only after outputs are secured.

---

## 21. CONNECTIVITY STATE MACHINE

* There is **no formal enum or state machine** for connectivity in `network_mgr.c`.
* Connectivity is represented by two independent static variables and an event group:
  - `s_is_connected` (boolean)
  - `s_sta_provisioned` (boolean)
  - `s_retry_num` (integer 0–5)
  - `s_wifi_event_group` (`WIFI_CONNECTED_BIT`, `WIFI_FAIL_BIT`)
* The states `UNCONFIGURED`, `PROVISIONING`, `RECONNECTING`, and `ERROR` exist only as informal log messages.

---

## 22. DOCUMENTATION CONTRADICTIONS TABLE

| Document | Document Claim | Actual Source Evidence | Contradiction / Conflict | Status |
|---|---|---|---|---|
| `UI_ESP32_COMMUNICATION_SPEC.md:214` | "Primary: Use stable mDNS hostname `esp32-<device-id>.local`" | `esp32/main/` has zero calls to `mdns_init()`. | Document claims mDNS works; code never starts mDNS. | **CONTRADICTORY** |
| `ESP32_BACKEND_SPEC.md:238-243` | "Network layer: `network/wifi/`, `network/ethernet/`, `network/mdns/`, `network/state/`" | `esp32/main/network/` contains only `network_mgr.c` and `network_mgr.h`. | Architecture spec does not match actual flat driver file. | **CONTRADICTORY** |
| `ESP32_BACKEND_SPEC.md:855-856` | "Acceptance: WiFi/LAN works; mDNS works;" | LAN (W5500) has no pin; mDNS is not started in code. | Acceptance claims features that do not exist in firmware. | **CONTRADICTORY** |
| `docs/COMPLEX_ESP32_ONBOARDING.md:25` | "Discovery uses stable hostname or manual IP; health handshake" | Firmware does not broadcast mDNS; onboarding assumes controller already has IP. | Omits how the device ever gets onto the network. | **PARTIAL / GAP** |
| `api_device_handlers.c:53` | `GET /api/v1/status` returns network IP | Code has `cJSON_AddStringToObject(network, "ip", "127.0.0.1")` | API reports hardcoded loopback IP instead of real netif IP. | **CONTRADICTORY** |
| `docs/HARDWARE_WIRING_MAP.md` | GPIO 10 = Blower Fan Contactor Trigger | `pin_config.h:26` aligned; old docs referenced W5500 CS | W5500 was eliminated from physical pin map; LAN is blocked. | **RESOLVED IN SSOT** |

---

## 23. CONCRETE FIRST-BOOT SCENARIO (SCENARIO A)

### Trace: Factory-New ESP32 Physical Unboxing to Operator Reachability

```text
[Step 1] Physical board is unboxed and powered via 5V terminal / USB-C.
         Relays click safe-off. Green power LED turns on.
         TFT Display shows: "DEV ID: esp32-controller-01".
         Status: OK.

[Step 2] ESP32 boots and starts SoftAP "AGROTECH-SETUP" (Pass: "agrotech").
         Status: OK.

[Step 3] Operator sees "AGROTECH-SETUP" on smartphone/laptop Wi-Fi scan and connects.
         Laptop receives IP 192.168.4.2 via DHCP.
         Status: OK.

[Step 4] Operator opens browser to http://192.168.4.1/
         Result: HTTP 404 NOT FOUND (No web page exists).
         Status: [BLOCKED]

[Step 5] Operator attempts to find Wi-Fi setup in the web UI.
         The web UI is running on the laptop (localhost:5179) and is disconnected from 192.168.4.1.
         Web UI has no Wi-Fi provisioning page.
         Status: [BLOCKED]

[Step 6] Operator attempts to use REST API to configure Wi-Fi.
         Firmware has no POST /api/v1/wifi endpoint.
         Status: [BLOCKED]

[Step 7] ESP32 cannot receive local greenhouse router credentials.
         ESP32 cannot join local network.
         ESP32 remains isolated on SoftAP 192.168.4.1.
         Status: [BLOCKED]
```

**Verdict:** **FIRST-BOOT ONBOARDING = NOT READY**.

---

## 24. SCENARIO MATRIX

| Scenario | Description | Audit Status | Evidence |
|---|---|---|---|
| **Scenario A** | Factory-new ESP32 SoftAP -> Wi-Fi router onboarding | **NOT READY / BLOCKED** | No captive portal, no provisioning API, no HTML form. |
| **Scenario B** | Wi-Fi pre-configured -> Reboot -> Auto-reconnect | **IMPLEMENTED** | Works IF credentials are pre-written to NVS via USB serial. |
| **Scenario C** | Wi-Fi credentials invalid -> Fallback recovery | **BLOCKED** | Retries 5 times and halts; no over-the-air recovery mechanism. |
| **Scenario D** | LAN cable connected -> DHCP -> Device reachable | **BLOCKED** | W5500 driver not implemented; GPIO 10 reassigned to blower. |
| **Scenario E** | Wi-Fi lost during operation -> Local runtime -> Reconnect | **PARTIAL** | Local runtime continues safely; but reconnect gives up after 5 immediate retries. |
| **Scenario F** | LAN lost during operation -> Recovery | **BLOCKED** | LAN does not exist. |
| **Scenario G** | Network completely unavailable -> Autonomous local operation | **IMPLEMENTED** | Sensors, safety interlocks, scheduled fertigation operate autonomously. |

---

## 25. BLIND SPOTS IDENTIFIED

Beyond the basic checklist, the forensic audit identified the following critical operational blind spots:

1. **SSID Collision Hazard Across Multiple Units:**
   Every controller broadcasts the exact same SSID: `AGROTECH-SETUP`. If 5 controllers are unboxed in the same facility, 5 identical SSIDs will collide, making it impossible for operators to know which physical controller they are connecting to. (Should be `AGROTECH-SETUP-<MAC_SUFFIX>`).
2. **SoftAP Fixed Radio Channel Congestion:**
   `network_mgr.c:70` hardcodes `channel = 1`. If Channel 1 is saturated by industrial 2.4 GHz interference in the facility, the SoftAP connection will experience packet drops.
3. **No NTP Fallback / Real Time Clock Cold Boot:**
   The PRD specifies that Internet access is not required. At first boot, the DS3231 RTC may have an uninitialized or dead battery. Without internet for NTP and without an automatic clock push during first connection, timestamps will default to `1970-01-01`.
4. **Permanent Reconnection Abandonment:**
   `network_mgr.c` has no periodic timer to attempt reconnection if Wi-Fi drops for more than a few seconds. If the router reboots at night, the ESP32 permanently drops offline until physically power-cycled.
5. **No Visual IP Display on Local Hardware:**
   The hardware includes a 1.8" color TFT display, yet an operator standing in front of the machine cannot see what IP the router gave the device.
6. **Hardcoded Controller Complex ID Lockout:**
   A new board initializes with `complexId = "complex-01"`. Any operator who sets up a Complex with a name that generates `complex-02` will be permanently locked out from binding the controller in the UI.

---

## 26. EXACT MISSING FUNCTIONALITY (ACTIONABLE SPECIFICATION)

To make network onboarding fully production-capable, the following components must be implemented:

1. **Firmware Provisioning Endpoint:**
   - Implement `POST /api/v1/network/wifi` accepting `{"ssid": "...", "password": "..."}`.
   - Implement `GET /api/v1/network/scan` returning available 2.4 GHz SSIDs and RSSI.
   - Write credentials to NVS keys `"sta_ssid"` and `"sta_pass"` in namespace `"agrotech"`.
2. **Minimal Embedded Web Portal (Captive Portal / HTTP 200 on `/`):**
   - In `http_server.c`, register a handler for `GET /` that serves a small, self-contained HTML/CSS/JS page (under 4 KB) allowing smartphone users connected to `AGROTECH-SETUP` to select their router and enter the password directly.
3. **Dynamic SoftAP SSID:**
   - Append the last 4 characters of the ESP32 MAC address to the SoftAP SSID: e.g. `AGROTECH-SETUP-A4B2`.
4. **mDNS Activation:**
   - Call `mdns_init()` and `mdns_hostname_set(st->device_id)` in `network_mgr_init()` or after `IP_EVENT_STA_GOT_IP`.
5. **TFT IP Display:**
   - Update `tft_hal.c:391` to read real IP from `esp_netif_get_ip_info()` and display `IP: 192.168.1.xxx` on Screen 4.
6. **Periodic Wi-Fi Reconnect Task:**
   - Replace the immediate 5-retry limit with a FreeRTOS timer or task that retries every 30–60 seconds indefinitely if disconnected.
7. **Firmware Complex Assignment Endpoint:**
   - Allow `complexId` to be initialized or adopted during initial onboarding binding.
8. **Fix `GET /api/v1/status` IP/MAC Reporting:**
   - Query real IP and MAC from `esp_netif` and `esp_wifi_get_mac()` instead of returning `"127.0.0.1"`.

---

## 27. FINAL QUESTIONS & VERDICT

```text
Apakah first-boot provisioning sudah ada?
TIDAK (Firmware memancarkan SoftAP tetapi tidak menyediakan portal/API untuk input Wi-Fi).

Apakah Wi-Fi AP provisioning sudah ada?
SEBAGIAN (SoftAP aktif di 192.168.4.1, namun tidak ada halaman web / captive portal / API).

Apakah Wi-Fi STA auto-reconnect sudah ada?
SEBAGIAN (Auto-reconnect ada saat boot jika NVS sudah diisi, tetapi hanya coba 5x lalu mati permanen jika putus).

Apakah LAN/W5500 DHCP sudah ada?
TIDAK (W5500 tidak memiliki driver dan pin CS tidak ada di SSOT; GPIO 10 dialokasikan untuk Blower).

Apakah Wi-Fi/LAN failover sudah ada?
TIDAK (Tidak ada LAN, hanya Wi-Fi tunggal).

Apakah operator punya cara jelas mengetahui IP ESP32?
TIDAK (mDNS tidak aktif di C code, layar TFT tidak menampilkan IP, API /status memberi IP palsu 127.0.0.1).

Apakah device identity provisioning sudah ada?
TIDAK (dev_id dan cplx_id di-hardcode ke "esp32-controller-01" dan "complex-01" pada boot pertama).

Apakah factory reset/reprovisioning sudah ada?
TIDAK (Tidak ada tombol reset network atau API penghapus kredensial).

Apakah backend Python dibutuhkan untuk first boot?
TIDAK JELAS / TERGANTUNG LAYER:
- Firmware ESP32 & SoftAP: TIDAK BUTUH (ESP32 hidup mandiri).
- Frontend UI Onboarding: YA BUTUH (Tombol "Create & continue" UI memanggil POST /api/complexes ke backend Python).

Apakah ada scenario penting lain yang belum kita pikirkan?
YA:
1. SSID SoftAP bertabrakan jika lebih dari 1 ESP32 dinyalakan di lokasi yang sama.
2. ESP32 putus koneksi permanen jika router restart lebih dari 15 detik (max 5 retry tanpa background reconnect).
3. Benturan cplx_id: Board mengunci diri ke "complex-01", menolak binding jika Complex baru diberi ID "complex-02".
4. Operator di lapangan tidak bisa melihat IP di layar TFT 1.8" yang sudah terpasang.
```

---

## 28. FINAL VERDICT

```text
============================================================
NETWORK FIRST-BOOT:
NOT READY

HARDWARE INSTALLATION NETWORK READINESS:
NOT READY
============================================================
```

> **Direct Answer for Operator / Hardware Installation Team:**  
> *"When you receive the physical ESP32 today and turn it on for the first time, you **CANNOT** connect it to your Wi-Fi or LAN through the browser or app. The ESP32 will broadcast a Wi-Fi network called `AGROTECH-SETUP`, but browsing to `192.168.4.1` returns a 404 error, and there is no page or API to give it your greenhouse Wi-Fi credentials. W5500 Ethernet cable is also not supported because the pin is assigned to the Blower Fan. Until provisioning firmware and an IP display/portal are implemented, the only way to get the ESP32 onto your Wi-Fi network is by connecting a USB cable to a computer and writing the SSID and password directly into the chip's flash storage via serial programming."*
