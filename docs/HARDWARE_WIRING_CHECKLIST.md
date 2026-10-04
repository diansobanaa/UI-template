# HARDWARE WIRING PRE-FLIGHT CHECKLIST

**Document Role:** Automated Quality Assurance & Consistency Checklist  
**Usage:** Must be executed and checked off whenever any GPIO assignment, peripheral, power rail, or wiring route is modified.  
**Parent Contract:** [HARDWARE_WIRING_MAP.md](file:///d:/template/docs/HARDWARE_WIRING_MAP.md)

---

## 1. Electrical & Pin Conflict Checklist

- [x] **GPIO tidak duplicate:** Setiap GPIO hanya dialokasikan untuk satu fungsi unik. Tidak ada GPIO yang digunakan oleh dua modul secara simultan (kecuali shared SPI bus: SCK=11, MOSI=12).
- [x] **GPIO memory reserved tidak digunakan:** GPIO 26–37 tidak dialokasikan untuk peripheral eksternal. GPIO 35, 36, 37 pada pin header diberi label FATAL DO NOT TOUCH.
- [x] **USB/UART GPIO tidak conflict:** GPIO 43 dan 44 dicadangkan secara eksklusif untuk UART0 console (COM3). GPIO 19 dan 20 dicadangkan secara eksklusif untuk native USB port.
- [x] **TFT & MicroSD SPI tidak conflict:** SPI2_HOST menggunakan SCK=11, MOSI=12, MISO=13. Chip select TFT terisolasi pada GPIO 14, dan chip select MicroSD Adapter (EasyWare EP000094) terisolasi pada GPIO 48.
- [x] **RTC tidak conflict:** RTC DS3231 I2C menggunakan GPIO 8 (SDA) dan GPIO 9 (SCL). Pin 32K dan SQW berstatus NOT USED (NC).
- [x] **Tamper Loop tidak conflict:** Loop Pengaman Anti-Maling Pompa menggunakan GPIO 47 dengan internal pull-up ke 3.3V dan loop return ke DC Signal Ground (GND_LV). Terisolasi penuh dari AC PE/Neutral.
- [x] **DS18B20 tidak conflict:** Sensor 1-Wire menggunakan GPIO 17 secara eksklusif dengan resistor pull-up 4.7kΩ ke rail 3.3V (bukan resistor seri).
- [x] **Relay tidak conflict:** 4-Channel Relay Board: IN1 terhubung ke GPIO 1 (Well Pump AC 220V), IN2 terhubung ke GPIO 2 (Distribution Pump AC 220V), IN3 terhubung ke GPIO 10 (Greenhouse Blower Fans triggering contactor), IN4 terhubung ke GPIO 40 (Mixing Pond Pumps 220V). Seluruh kanal Active-LOW (0=ON, 1=Safe OFF). Button 3 yang lama pada GPIO 40 wajib RETIRED/disconnected.
- [x] **DHT22 & Buzzer tidak conflict:** Sensor DHT22/AM2302 dialokasikan pada GPIO 41 (single-wire digital bus) menggantikan Button 4 spare. Buzzer aktif dialokasikan pada GPIO 18 via modul N-channel MOSFET gate driver #5 (mengisolasi beban arus ~30mA dari pin ESP32).
- [x] **MOSFET tidak conflict:** 5 Modul N-Channel MOSFET: GPIO 4 (Raw Submersible Pump 1 12V), GPIO 5 (Dosing A 12V), GPIO 6 (Dosing B 12V), GPIO 7 (Cooling Fan 12V), dan GPIO 18 (Buzzer Gate 5V) tidak bentrok dengan fungsi lain. Terminal fisik kontrol diverifikasi (`TRIG-PWM` dan `GND`).
- [x] **Power rail benar:** Modul 3.3V (RTC, TFT, DS18B20) disuplai dari 3.3V rail. Modul 5V (Relay, Flow Meters, Buzzer, MicroSD Adapter EasyWare EP000094 dengan onboard 3.3V LDO) disuplai dari 5V rail. Beban induktif besar (pompa, fan) disuplai dari 12V rail.
- [x] **GND topology benar:** Signal Ground (GND_LV) dan Power Ground (GND_12V) terhubung pada titik tunggal di LM2596. Common ground antara ESP32 dan modul relay 4-channel terpasang. AC Protective Earth (PE) terisolasi dari DC Ground.
- [x] **Active level diketahui:** Seluruh modul relay 4-channel (Well, Dist, Blower, Mix) dan tombol operator berstatus Active-LOW (`0` = Aktif/ON, `1` = Inactive/OFF). Seluruh modul N-channel MOSFET (GPIO 4 Raw Submersible Pump 1, GPIO 5 Dosing A, GPIO 6 Dosing B, GPIO 7 Cooling Fan, GPIO 18 Alarm Buzzer) berstatus Active-HIGH (`1` = Aktif/ON, `0` = Inactive/OFF, Safe-off Boot Default = `0`/LOW dengan pulldown). Interlock safety lower float berstatus Active-LOW (`0` = DRY / Trip). Tamper Loop berstatus Active-HIGH (`0` = OK / Intact, `1` = Cut / Theft Trip).
- [x] **Driver/interface diketahui:** Jalur aktuator didokumentasikan secara berjenjang (GPIO $\to$ Driver/Optocoupler/MOSFET $\to$ Load Power). Tidak ada beban induktif yang digerakkan langsung oleh GPIO.
- [x] **Firmware mapping sama dengan canonical `docs/HARDWARE_WIRING_MAP.md`:** 26 dari 26 GPIO assignments di canonical pin map cocok pada `pin_config.h` (termasuk `PIN_OUT_WELL_PUMP` pada GPIO 1, `PIN_OUT_DIST_PUMP` pada GPIO 2, `PIN_OUT_RAW_SUBMERSIBLE` pada GPIO 4, `PIN_OUT_BLOWER_FAN` pada GPIO 10, `PIN_OUT_MIXING_PUMP` pada GPIO 40, `PIN_OUT_BUZZER` pada GPIO 18, dan `PIN_IN_DHT22` pada GPIO 41).
- [x] **Panel buttons terverifikasi:** Button 1 (GPIO 0) switch layar TFT, Button 2 (GPIO 39) manual toggle Well Pump dengan auto-off timer 5 menit dan safety float interlock, Button 3 GPIO 40 RETIRED karena dipakai Mixing Pump Relay IN4, dan terminal Button 4 (GPIO 41) dialihkan menjadi jalur data sensor DHT22.
- [x] **Semua aktuator terpetakan:** 4 Relay terpetakan penuh ke beban AC/kontaktor utama (IN1 Well, IN2 Dist, IN3 Blower, IN4 Mix). Beban DC submersible dipindahkan ke MOSFET #1 (GPIO 4).
- [x] **Semua obsolete mapping dihapus dari active mapping:** DS1302 3-wire mapping, Upper Float switch, dan microSD CS lama (GPIO 26/27) telah dihapus dari mapping aktif dan ditandai OBSOLETE.
