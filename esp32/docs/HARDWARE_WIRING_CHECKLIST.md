# HARDWARE WIRING PRE-FLIGHT CHECKLIST

**Document Role:** Automated Quality Assurance & Consistency Checklist  
**Usage:** Must be executed and checked off whenever any GPIO assignment, peripheral, power rail, or wiring route is modified.  
**Parent Contract:** [HARDWARE_WIRING_MAP.md](file:///d:/template/docs/HARDWARE_WIRING_MAP.md)

---

## 1. Electrical & Pin Conflict Checklist

- [x] **GPIO tidak duplicate:** Setiap GPIO hanya dialokasikan untuk satu fungsi unik. Tidak ada GPIO yang digunakan oleh dua modul secara simultan (kecuali shared SPI bus: SCK=11, MOSI=12).
- [x] **GPIO memory reserved tidak digunakan:** GPIO 26–37 tidak dialokasikan untuk peripheral eksternal. GPIO 35, 36, 37 pada pin header diberi label FATAL DO NOT TOUCH.
- [x] **USB/UART GPIO tidak conflict:** GPIO 43 dan 44 dicadangkan secara eksklusif untuk UART0 console (COM3). GPIO 19 dan 20 dicadangkan secara eksklusif untuk native USB port.
- [x] **TFT SPI tidak conflict:** SPI2_HOST menggunakan SCK=11, MOSI=12, MISO=13. Chip select TFT terisolasi pada GPIO 14, dan chip select SD terisolasi pada GPIO 48.
- [x] **RTC tidak conflict:** RTC DS3231 I2C menggunakan GPIO 8 (SDA) dan GPIO 9 (SCL). Pin 32K dan SQW berstatus NOT USED (NC).
- [x] **Tamper Loop tidak conflict:** Loop Pengaman Anti-Maling Pompa menggunakan GPIO 47 dengan internal pull-up ke 3.3V dan loop return ke DC Signal Ground (GND_LV). Terisolasi penuh dari AC PE/Neutral.
- [x] **DS18B20 tidak conflict:** Sensor 1-Wire menggunakan GPIO 17 secara eksklusif dengan resistor pull-up 4.7kΩ ke rail 3.3V (bukan resistor seri).
- [x] **Relay tidak conflict:** IN1 terhubung ke GPIO 4, IN2 terhubung ke GPIO 18. IN3 dan IN4 berstatus TBD / spare.
- [x] **MOSFET tidak conflict:** GPIO 5 (Dosing A), GPIO 6 (Dosing B), dan GPIO 7 (Cooling Fan) tidak bentrok dengan fungsi lain. Terminal fisik kontrol diverifikasi (`TRIG-PWM` dan `GND`).
- [x] **Power rail benar:** Modul 3.3V (RTC, TFT, DS18B20) disuplai dari 3.3V rail. Modul 5V (Relay, Flow Meters) disuplai dari 5V rail. Beban induktif besar (pompa, fan) disuplai dari 12V rail.
- [x] **GND topology benar:** Signal Ground (GND_LV) dan Power Ground (GND_12V) terhubung pada titik tunggal di LM2596. Common ground antara ESP32 dan modul relay 4-channel terpasang. AC Protective Earth (PE) terisolasi dari DC Ground.
- [x] **Active level diketahui:** Seluruh relay dan tombol operator berstatus Active-LOW (`0` = Aktif). Interlock safety lower float berstatus Active-LOW (`0` = DRY / Trip). Tamper Loop berstatus Active-HIGH (`0` = OK / Intact, `1` = Cut / Theft Trip).
- [x] **Driver/interface diketahui:** Jalur aktuator didokumentasikan secara berjenjang (GPIO $\to$ Driver/Optocoupler/MOSFET $\to$ Load Power). Tidak ada beban induktif yang digerakkan langsung oleh GPIO.
- [x] **Firmware mapping sama dengan documentation:** 26 dari 26 pin cocok 100% dengan `pin_config.h` (termasuk `PIN_IN_TAMPER_LOOP` pada GPIO 47 diselesaikan di SP-HW-008).
- [x] **Semua TBD diberi label:** Parameter yang belum memiliki peruntukan fisik (kanal relay IN3/IN4) diberi label TBD / Spare.
- [x] **Semua obsolete mapping dihapus dari active mapping:** DS1302 3-wire mapping, Upper Float switch, dan microSD CS lama (GPIO 26/27) telah dihapus dari mapping aktif dan ditandai OBSOLETE.
