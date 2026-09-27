# AgroTech TFT Screen Architecture (Dual Operational Views)

**Document Version:** 2.0.0  
**Target Hardware:** ESP32-S3 + Sitronix ST7735 1.8" TFT (128x160 portrait, SPI2_HOST)  
**Authority:** ESP32 Physical / Runtime Authority  

---

## 1. Overview & Operational Role

The TFT ST7735 display serves as the direct physical glance interface on the AgroTech Greenhouse Controller cabinet. It answers all fundamental operational questions within 1 second across dedicated screens:

- **Layar Utama / Screen 0 (Gambar 1): Overview & Environment**
  1. **Header:** Green leaf icon + `AGRO`, Complex/GH code (`C-01 | GH-01`), WiFi icon + green LED + `STA`, Date (`DD Mon`), Live RTC Clock (`HH:MM:SS` in white/cyan, 1s tick).
  2. **Active Process Card:** Prominent card with green border, play icon, `FERTIGASI`, recipe name (e.g. `Resep Vegetatif-1`), elapsed/duration (`12/30 menit`), green `RUN` pill, and blue progress bar (or `FERTIGASI: IDLE`).
  3. **4 Environmental Sensor Cards (4 columns side-by-side):**
     - Col 1: Air Temp (Red thermo + `XX.X °C` + green sprout icon + green mini wave)
     - Col 2: Humidity (Blue droplet + `XX.X %` + cyan mini wave)
     - Col 3: Ambient Light (Yellow sun + `XXXX lx` + yellow mini wave)
     - Col 4: Water Temp (Cyan wave + `XX.X °C` + blue mini wave, live Dallas DS18B20 probe)
  4. **Greenhouse Temperature Trend (`Suhu GH Hari Ini`):**
     - Red thermo icon + title
     - Left statistics: `MIN XX.X°` (Cyan) and `MAX XX.X°` (Orange)
     - Right chart: Y-axis milestone labels (`34°`, `28°`, `22°`), dotted grid lines, X-axis milestone labels (`06:00`, `12:00`, `18:00`), live temperature curve with dark crimson shaded fill down to the chart floor, and white dot on the latest sample.

- **Layar Kedua / Screen 1 (Gambar 2): Operations, Actuators & 24h Schedule**
  1. **Fertigation Today & Target Cards (Top 2 Cards):**
     - Left: Cyan flask icon + `Fertigasi Hari Ini` + `X kali` + `XXX liter`
     - Right: Cyan droplet + `Target Hari Ini` + `600 liter` + 40% blue progress bar
  2. **Actuator State Matrix (2 rows x 3 columns = 6 tiles):**
     - Tile 1 (Well Pump): Faucet icon + `Well` + `[ON]` / `[OF]` pill + flow rate (`12.4 L/m`) + signal bars
     - Tile 2 (Fertigasi): Pump icon + `Fert` + `[ON]` / `[OF]` pill + flow rate (`12.4 L/m`) + signal bars
     - Tile 3 (Dosing A): Bottle A icon + `DosA` + `[ON]` / `[OF]` pill + flow rate (`2.1 ml/m`) + signal bars
     - Tile 4 (Dosing B): Bottle B icon + `DosB` + `[ON]` / `[OF]` pill + flow rate (`0.0 ml/m`) + signal bars
     - Tile 5 (Fan): Fan icon + `Fan` + `[ON]` / `[OF]` pill + status (`RUN` / `AUTO`)
     - Tile 6 (Lamp): Bulb icon + `Lamp` + `[ON]` / `[OF]` pill + status (`ALRM` / `SAFE`)
  3. **Next Fertigasi Card:**
     - Orange clock icon + `Next Fertigasi` + countdown minutes (`46 menit` or `RUN`)
     - Right side: Cyan droplet + scheduled time (`16:00`) + `Fertigasi >`
  4. **24-Hour Schedule Timeline (`Jadwal Hari Ini`):**
     - Calendar icon + `Jadwal Hari Ini` + next event banner (`Next: 16:00 Fertigasi`)
     - Colored 24h timeline bar with color-coded operational events
     - Red current time marker pin (`HH:MM` + pointer `▼` + vertical line)
     - Milestone ticks (`06:00`, `09:00`, `12:00`, `15:00`, `18:00`, `21:00`)

- **Layar Ketiga / Screen 2: Antrean Dosing Batch Complex & Serial Execution (Section 10.3 & 20)**
  1. **Header:** `DOSING QUEUE` (White on green/cyan bar) + `[SERIAL]` badge (Amber).
  2. **Active Batch Card:** Target greenhouse (`GH: GH-A`), State badge (`[DOSING]`, `[RAW_WATER]`, `[READY]`, `[IDLE]`), Raw water meter bar with configurable threshold marker (e.g. 20% notch), and active channel status (`DOSE: Channel B (ON)`).
  3. **Complex Waiting Queue Card:** List of batches waiting for shared central dosing pumps (`1. BATCH-GH-B [QUEUED]` / `Antrean: KOSONG (0)`).
  4. **Footer:** `[BTN1] SCREEN 3/4`.

- **Layar Keempat / Screen 3: System Diagnostics & Network**
  1. Device identity, IP address, WiFi mode and RSSI, DS3231 RTC sync health, Emergency Stop latch status, and free heap RAM.
  2. **Footer:** `[BTN1] SCREEN 4/4`.

---

## 2. Vertical Pixel Budget & Layout Coordinates

### Screen 0: Overview & Environment (Gambar 1, 1/4)
| Y-Range (px) | Height | Section | Description & Coordinates |
|:---:|:---:|:---|:---|
| **0 – 22** | 23 px | **Header** | Green leaf icon (X:2, Y:3); `AGRO` (X:13, Y:3, Green); `C-01 \| GH-01` (X:13, Y:13, Gray); WiFi icon (X:56, Y:3); LED dot (X:67, Y:5, Green); `STA` (X:56, Y:13); Date `DD Mon` (X:85, Y:3); Live Clock `HH:MM:SS` (X:85, Y:13, White). |
| **24 – 57** | 34 px | **Process Banner** | Green border box (X:1, Y:24, W:126, H:32); Play icon (X:5, Y:28); `FERTIGASI` (X:16, Y:28, White); Recipe name `Resep Vegetatif-1` (X:16, Y:38, Gray); Duration/Elapsed `12 / 30 menit` (X:76, Y:26, Green); `RUN` pill (X:105, Y:26, Green); Blue progress bar (X:76, Y:45, W:46, H:5). |
| **59 – 102** | 44 px | **4 Sensor Cards** | 4 columns (X: 1, 33, 65, 97, W:30, H:42, Card BG: `#1082`):<br>• Col 1: Red thermo, Air Temp `XX.X °C`, green sprout icon + green wave.<br>• Col 2: Blue drop, Humidity `XX.X %`, cyan mini wave.<br>• Col 3: Yellow sun, Light `XXXX lx`, yellow mini wave.<br>• Col 4: Cyan wave, Water Temp `XX.X °C` (DS18B20), blue mini wave. |
| **104 – 159** | 56 px | **GH Temp Trend** | Red thermo icon + `Suhu GH Hari Ini` (Y:105); Left stats: `MIN` (Y:126), Min temp (Y:116, Cyan), `MAX` (Y:147), Max temp (Y:137, Orange); Right chart (X:54, Y:116, W:71, H:32): Y-axis `34`, `28`, `22`, dotted grid, X-axis `06:00`, `12:00`, `18:00`, vector curve with dark crimson shaded fill. |

### Screen 1: Operations, Actuators & 24h Schedule - Adaptif (2/4)
| Y-Range (px) | Height | Section | Description & Coordinates |
|:---:|:---:|:---|:---|
| **1 – 37** | 37 px | **Fert Stats & Target** | 2 cards side-by-side (Card 1: X:1, W:62; Card 2: X:65, W:62):<br>• Card 1: Cyan flask, `Fertigasi`, `X kali`, `XXX L`.<br>• Card 2: Cyan drop, `Target`, `600 L`, 40% blue progress bar. |
| **39 – 97** | 59 px | **Actuator Matrix** | 2 rows x 3 columns (Cols: X=1, 43, 85, W:41; Rows: Y=39, 68, H:27):<br>• Row 1: `Well` (Faucet) \| `Fert` (Pump) \| `DosA` (Bottle A)<br>• Row 2: `DosB` (Bottle B) \| `Fan` (Fan) \| `Lamp` (Bulb)<br>Adaptif: Memantau live dosing channel [ON]/[OF] dan label DOSE secara real-time. |
| **99 – 123** | 25 px | **Next Fert Card** | Card (X:1, Y:99, W:126, H:23): Adaptif menampilkan live phase (`RAW WATER`, `DOSE: Ch A/B`, `READY`, atau countdown `XX menit`). |
| **124 – 159** | 36 px | **24h Schedule** | Calendar icon + `Jadwal Hari Ini` + `Next: 16:00 Fertigasi`; 118px timeline bar (X:4, Y:141, W:118, H:5); Milestones (`[BTN1] 2/4`, `12:00`, `18:00`); Red time marker pin. |

### Screen 2: Antrean Dosing Batch Complex (3/4)
| Y-Range (px) | Height | Section | Description & Coordinates |
|:---:|:---:|:---|:---|
| **0 – 22** | 23 px | **Header** | Green/Cyan bar: `DOSING QUEUE` (White), `[SERIAL]` badge (Amber). |
| **24 – 90** | 67 px | **Active Batch Card** | Card (X:1, Y:24, W:126, H:66):<br>• Target GH & Runtime State (`DOSING`, `RAW_WATER`, `READY`, `IDLE`).<br>• Raw water volume: actual / target mL.<br>• Progress bar with 20% configurable threshold pin notch.<br>• Active channel status (`DOSE: Channel B (ON)`). |
| **92 – 142** | 51 px | **Complex Queue List** | Card (X:1, Y:95, W:126, H:47):<br>• List antrean batch pending (`Q1: GH-B [QUEUED]`).<br>• Status antrean kosong: `Antrean: KOSONG (0)`, `Serial: 1 Batch / Waktu`. |
| **144 – 160** | 17 px | **Footer** | Dark gray bar (X:0, Y:144, W:128, H:16): `[BTN1] SCREEN 3/4`. |

---

## 3. Screen Navigation Carousel

Physical **Button 1** (GPIO 0 / `PIN_BTN_MODE`) cycles sequentially through all 4 screens:

```text
[Screen 0: Home / Overview & Environment] (1/4)  <── (Default Boot Screen)
         │  (Press Button 1)
         ▼
[Screen 1: Operations, Actuators & 24h Schedule - Adaptif] (2/4)
         │  (Press Button 1)
         ▼
[Screen 2: Antrean Dosing Batch Complex] (3/4)
         │  (Press Button 1)
         ▼
[Screen 3: System Diagnostics & Network] (4/4)
         │  (Press Button 1)
         ▼
(Cycles back to Screen 0)
```

---

## 4. Performance & Refresh Guarantees

1. **Dedicated FreeRTOS Task (`tft_screen_task`):** Priority 2, Core 1, 8192-byte stack, 1s tick.
2. **Zero Dynamic Memory Allocation:** No `malloc` or `cJSON` in render loop.
3. **Differential Dynamic Update:** Only dynamic text and values are redrawn with foreground/background colors, eliminating screen flickering.
4. **Timeline Marker Erasure & Restoration:** Moving red pin tracks previous position and restores timeline bar segments without redrawing the whole screen.

---

## 5. Authoritative Data Paths for TFT Telemetry & Scheduling

### 5.1 Next Fertigasi Schedule (Screen 1, 2/4)
- **Authoritative Source:** Today's Operational Schedule in `scheduler.c` (`s_today_occurrences`).
- **Accessor:** Read-only snapshot accessor `scheduler_get_next_occurrence(today_occurrence_t *out_occ)`.
- **Selection Rules:**
  1. Occurrence date matches active controller date.
  2. Scheduled timestamp > 0.
  3. State is not `OCC_STATE_COMPLETED` and not `OCC_STATE_FAILED`.
  4. State is not `OCC_STATE_DISTRIBUTING` (already actively delivering).
  5. Selects the earliest valid future occurrence.
- **Render Output:**
  - Valid future occurrence: `NEXT <GH_TAG> <HH:MM>` with countdown minutes / status.
  - No future occurrence: `NEXT: NONE` with `--:--`.
  - Independent of `fertigation_mgr` state (IDLE does not hide next schedule).
  - Independent of Global Dosing Queue head.

### 5.2 Environmental Humidity (Screen 0, 1/4)
- **Authoritative Physical Source:** Physical DHT22 environment sensor connected to GPIO 41 (`PIN_IN_DHT22`).
- **Pipeline:** Physical DHT22 $\to$ `sensor_hal` driver $\to$ runtime snapshot $\to$ `tft_hal.c`.
- **Presentation:** Displayed in Col 2 of 4 Sensor Cards with unit `%`.
- **Fault Handling:** When disconnected, unread, or invalid, displays `--.- %` gracefully without stack overflow, watchdog tripping, or system freezing. No mock data is ever generated.

