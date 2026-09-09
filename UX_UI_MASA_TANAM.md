# Rencana UX & UI — Masa Tanam

## 1. Tujuan UX

Pengguna harus dapat memahami kondisi satu greenhouse dalam beberapa detik:

- apakah sedang ada siklus tanam
- kapan tanggal tanam
- kapan polinasi
- berapa HST
- berapa HSP
- apa tindakan yang tersedia sekarang

UI tidak membuat pengguna mengelola angka HST/HSP secara manual. Pengguna mengelola **kejadian/tanggal**, sedangkan sistem menghitung nilainya.

---

## 2. Halaman awal / keadaan kosong

Untuk GH yang belum memiliki siklus aktif:

**GH-01**  
**Belum ada tanaman**

`+ Mulai Menanam`

Di bawah aksi utama terdapat link kecil:

**Sudah ada tanaman yang sedang berjalan? Masukkan tanggal tanam →**

Link ini khusus untuk kasus ketika sistem baru dipasang atau client baru menggunakan sistem **di tengah masa tanam**.

### Tujuan link

Tidak memaksa pengguna membuat siklus baru dari hari ini.

Pengguna dapat memasukkan tanggal tanam yang sebenarnya, sehingga HST langsung mengikuti umur tanaman yang sudah berjalan.

---

## 3. Mulai Tanam Normal

Ketika memilih `+ Mulai Menanam`, tampil modal sederhana:

**Mulai Siklus Tanam**

`Tanggal Tanam [ date ]`

Helper text:

> HST akan dihitung otomatis berdasarkan tanggal tanam.

Aksi:

`Batal`  
`Simpan & Mulai Siklus`

Setelah berhasil, UI menampilkan siklus aktif.

---

## 4. Tanaman Sudah Berjalan

Ketika pengguna memilih link **“Sudah ada tanaman yang sedang berjalan?”**, gunakan modal yang berbeda agar maksudnya jelas:

**Masukkan Siklus yang Sedang Berjalan**

`Tanggal Tanam [ date ]`

Helper:

> Masukkan tanggal tanam sebenarnya. Sistem akan menghitung HST secara otomatis dari tanggal tersebut.

Setelah tanggal dipilih, tampil preview sebelum disimpan:

**Tanggal tanam:** 24 Jan 2026  
**HST sekarang:** 228 hari

Aksi:

`Batal`  
`Gunakan Tanggal Ini`

### Validasi

- tanggal tidak boleh di masa depan
- jika tanggal terlalu tidak masuk akal menurut aturan sistem, tampilkan peringatan yang membantu
- jangan menyuruh pengguna memasukkan HST secara manual
- simpan tanggal aktual ke ESP32

---

## 5. Tampilan Siklus Aktif

Setelah siklus dimulai:

**GH-01**

### Timeline

🌱 **TANAM**  
24 Jan 2026  
**HST 228**

🌼 **POLINASI**  
Belum dicatat  
`+ Catat Polinasi`

🌾 **HARI PANEN**  
`Panen`

HST menjadi informasi utama yang terlihat, bukan field input.

---

## 6. Setelah Polinasi

Setelah tanggal polinasi dicatat:

🌱 **TANAM**  
24 Jan 2026  
**HST 228**

🌼 **POLINASI**  
24 Feb 2026  
**HSP 197**

🌾 **HARI PANEN**  
`Panen`

HST/HSP ditampilkan sebagai nilai otomatis.

Pengguna tidak melihat input bernama `HST` atau `HSP`.

---

## 7. Mengelola Siklus

Gunakan satu pintu pengelolaan:

`Kelola Siklus`

Di dalamnya:

- `Ubah Tanggal Tanam`
- `Ubah Tanggal Polinasi`
- `Hapus Tanggal Polinasi`

Jangan gunakan:

- `Edit HST`
- `Edit HSP`

Karena angka tersebut bukan data yang diinput pengguna.

---

## 8. Perubahan Tanggal Tanam

Saat tanggal tanam diubah, tampilkan dampaknya sebelum konfirmasi:

**Ubah Tanggal Tanam**

Tanggal lama: **24 Jan 2026**  
Tanggal baru: **20 Jan 2026**

Preview:

**HST sekarang: 228 → 232**

Pesan:

> Mengubah tanggal tanam akan mengubah perhitungan HST siklus ini.

Aksi:

`Batal`  
`Simpan Perubahan`

Perubahan harus dikirim ke ESP32 dan UI membaca kembali state hasilnya sebelum menampilkan kondisi final.

---

## 9. Hapus Tanggal Polinasi

Karena tindakan ini menghilangkan HSP aktif, gunakan konfirmasi eksplisit:

**Hapus Tanggal Polinasi?**

> HSP akan kembali menjadi belum tersedia. Riwayat/event yang sudah tercatat tidak dihapus.

Aksi:

`Batal`  
`Hapus Tanggal Polinasi`

---

## 10. Hari Panen

Gunakan CTA yang jelas tetapi tidak agresif:

`🌾 Hari Panen`

Sebelum eksekusi, tampilkan ringkasan:

**Selesaikan Siklus Ini**

Tanggal Tanam: 24 Jan 2026  
Tanggal Polinasi: 24 Feb 2026  
HST: 228  
HSP: 197

Pesan:

> Siklus aktif akan diakhiri. Data tanggal aktif akan dibersihkan dari runtime greenhouse, tetapi riwayat panen dan log tidak dihapus.

Aksi:

`Batal`  
`Ya, Tandai Hari Panen`

---

## 11. Setelah Panen

Keadaan berikutnya:

🌾 **Siklus Selesai**

Panen: 9 Sep 2026

Ringkasan siklus terakhir tetap dapat dilihat.

Aksi utama:

`+ Mulai Siklus Baru`

Aksi sekunder:

`Lihat Riwayat`

ESP32 sudah siap menerima siklus berikutnya tanpa harus menunggu Python.

---

## 12. Progressive Disclosure

UI hanya menampilkan tindakan yang relevan terhadap keadaan saat ini.

| State | Aksi utama |
|---|---|
| Belum ada siklus | `+ Mulai Menanam` |
| Sudah ada tanaman | link `Masukkan Siklus yang Sedang Berjalan` |
| Sudah tanam | `+ Catat Polinasi` + `Hari Panen` |
| Sudah polinasi | `Kelola Siklus` + `Hari Panen` |
| Siklus selesai | `+ Mulai Siklus Baru` + `Lihat Riwayat` |

Tujuannya agar pengguna tidak melihat banyak tombol yang belum relevan.

---

## 13. Prinsip Visual

Tampilan harus terasa seperti aplikasi operasional modern, bukan form administrasi.

Prioritas visual:

1. status greenhouse
2. HST/HSP
3. timeline siklus
4. aksi utama yang relevan
5. pengaturan/aksi berisiko di tempat sekunder

Gunakan helper text pendek pada saat pengguna membutuhkan konteks, bukan paragraf panjang di halaman utama.

Tanggal adalah input.  
HST/HSP adalah hasil.  
Hari Panen adalah event.

---

## 14. Prinsip Integrasi

Semua aksi penting memiliki pola:

**UI → request ke ESP32 → ESP32 validasi & ubah state → ESP32 mengembalikan state/event → UI memperbarui tampilan**

UI tidak menganggap aksi berhasil hanya karena request HTTP diterima.

Untuk tahap Python:

**ESP32 → UI → Python**

Riwayat siklus, event panen, dan log akhirnya dapat dikirim ke Python tanpa mengubah pola UX di atas.

---

## 15. Inti UX

> Pengguna tidak mengelola “HST” dan “HSP”.  
> Pengguna mengelola **siklus tanaman**.

UI kemudian membuat umur tanaman terlihat jelas, mudah dipahami, dan selalu konsisten dengan data runtime ESP32.

---

# CHECKLIST IMPLEMENTASI — MASA TANAM

Bagian ini menjadi daftar kerja implementasi. Urutan pengerjaan mengikuti ketergantungan sistem: **UI ↔ ESP32 harus selesai terlebih dahulu** karena ESP32 merupakan runtime anchor. Integrasi **UI ↔ Python** disiapkan secara arsitektural, tetapi **belum dikerjakan sampai ada perintah khusus**.

## A. UI ↔ ESP32 — KERJAKAN TERLEBIH DAHULU

### A1. State & Data Siklus

- [ ] Definisikan state siklus aktif per GH.
- [ ] ESP32 menyimpan `tanggal_tanam`.
- [ ] ESP32 menyimpan `tanggal_polinasi` atau kondisi belum ada.
- [ ] ESP32 mengembalikan state siklus kepada UI.
- [ ] UI menghitung HST dari `tanggal_tanam`.
- [ ] UI menghitung HSP dari `tanggal_polinasi`.
- [ ] UI menangani kondisi HSP belum tersedia.
- [ ] UI tidak menyimpan HST/HSP sebagai input manual.

### A2. Mulai Siklus Normal

- [ ] Empty state GH dibuat.
- [ ] Tombol `+ Mulai Menanam` dibuat.
- [ ] Modal input tanggal tanam dibuat.
- [ ] Helper text HST dibuat.
- [ ] Validasi tanggal tanam dibuat.
- [ ] UI mengirim tanggal tanam ke ESP32.
- [ ] ESP32 memvalidasi dan menyimpan tanggal.
- [ ] ESP32 mengembalikan state terbaru.
- [ ] UI memperbarui tampilan berdasarkan response ESP32.

### A3. Client Masuk di Tengah Masa Tanam

- [ ] Link kecil `Sudah ada tanaman yang sedang berjalan?` dibuat.
- [ ] Modal khusus `Masukkan Siklus yang Sedang Berjalan` dibuat.
- [ ] Input tanggal tanam aktual dibuat.
- [ ] Preview HST saat ini dibuat.
- [ ] Validasi tanggal dibuat.
- [ ] UI mengirim tanggal aktual ke ESP32.
- [ ] ESP32 menyimpan tanggal sebagai siklus aktif.
- [ ] UI membaca kembali state ESP32.
- [ ] HST langsung tampil sesuai umur tanaman sebenarnya.

### A4. Polinasi

- [ ] CTA `+ Catat Polinasi` dibuat.
- [ ] Modal tanggal polinasi dibuat.
- [ ] Validasi tanggal polinasi terhadap tanggal tanam dibuat.
- [ ] UI mengirim tanggal polinasi ke ESP32.
- [ ] ESP32 menyimpan tanggal polinasi.
- [ ] UI menghitung HSP.
- [ ] UI menampilkan HST + HSP.
- [ ] Ubah tanggal polinasi tersedia.
- [ ] Hapus tanggal polinasi tersedia.
- [ ] Konfirmasi penghapusan dibuat.
- [ ] State setelah penghapusan dibaca kembali dari ESP32.

### A5. Kelola Siklus

- [ ] `Kelola Siklus` dibuat sebagai satu pintu pengelolaan.
- [ ] `Ubah Tanggal Tanam` dibuat.
- [ ] Preview dampak perubahan HST dibuat.
- [ ] Konfirmasi perubahan tanggal tanam dibuat.
- [ ] `Ubah Tanggal Polinasi` dibuat.
- [ ] Mekanisme hapus tanggal polinasi dibuat.
- [ ] UI selalu mengambil state final dari ESP32 setelah perubahan.

### A6. Hari Panen

- [ ] CTA `🌾 Hari Panen` dibuat.
- [ ] Modal konfirmasi panen dibuat.
- [ ] Ringkasan tanggal tanam ditampilkan.
- [ ] Ringkasan tanggal polinasi ditampilkan jika ada.
- [ ] HST/HSP pada saat panen ditampilkan.
- [ ] UI mengirim perintah panen ke ESP32.
- [ ] ESP32 mencatat event/log panen.
- [ ] ESP32 membersihkan data siklus aktif.
- [ ] Riwayat/log tidak dihapus.
- [ ] UI membaca state baru dari ESP32.
- [ ] GH berubah ke state `Siklus Selesai`.
- [ ] `+ Mulai Siklus Baru` tersedia.
- [ ] `Lihat Riwayat` tersedia sesuai kemampuan UI saat ini.

### A7. Command & Feedback

- [ ] Semua aksi UI mempunyai request yang jelas ke ESP32.
- [ ] UI tidak menganggap HTTP success sebagai bukti aksi fisik/state sudah selesai.
- [ ] UI menampilkan loading/progress saat diperlukan.
- [ ] UI menangani `ACCEPTED`, `FAILED`, `REJECTED`, atau error komunikasi.
- [ ] Setelah aksi sukses, UI mengambil state terbaru dari ESP32.
- [ ] Error ESP32 ditampilkan dengan bahasa yang dapat dipahami pengguna.
- [ ] Retry tidak menyebabkan aksi ganda yang tidak diinginkan.

### A8. Offline / Koneksi

- [ ] UI dapat mendeteksi ESP32 tidak terhubung.
- [ ] State UI tidak mengarang data ketika ESP32 tidak tersedia.
- [ ] Pesan koneksi dibuat jelas.
- [ ] Setelah koneksi kembali, UI dapat membaca state terbaru ESP32.
- [ ] Siklus tetap dapat berjalan pada ESP32 tanpa UI.
- [ ] HST/HSP tetap dapat dihitung ketika UI kembali terhubung berdasarkan tanggal yang tersimpan di ESP32.

### A9. Quality Gate UI ↔ ESP32

Pekerjaan UI ↔ ESP32 dianggap selesai setelah:

- [ ] Mulai tanam normal bekerja end-to-end.
- [ ] Client masuk di tengah masa tanam bekerja end-to-end.
- [ ] HST tampil benar.
- [ ] Polinasi bekerja end-to-end.
- [ ] HSP tampil benar.
- [ ] Perubahan tanggal bekerja end-to-end.
- [ ] Penghapusan polinasi bekerja end-to-end.
- [ ] Hari panen bekerja end-to-end.
- [ ] State setelah panen benar.
- [ ] Error dan reconnect dasar tertangani.
- [ ] UI tidak bergantung pada Python untuk operasi masa tanam.

> **STATUS PRIORITAS: UI ↔ ESP32 harus dikerjakan dan diselesaikan terlebih dahulu.**

---

## B. UI ↔ Python — DITUNDA SAMPAI DIPERINTAH

Bagian ini **belum menjadi pekerjaan implementasi sekarang**. Arsitektur dan titik integrasinya cukup dipersiapkan agar nantinya tidak perlu merombak UX/UI maupun kontrak UI ↔ ESP32.

### B1. Integrasi Data Historis

- [ ] Tentukan endpoint/kontrak UI → Python.
- [ ] Tentukan format data siklus historis.
- [ ] Tentukan format event panen historis.
- [ ] Tentukan format log yang akan diteruskan.
- [ ] Tentukan mekanisme acknowledgment Python.
- [ ] Tentukan mekanisme sync/resume.
- [ ] Tentukan penyimpanan permanen di Python.

### B2. Sinkronisasi

- [ ] UI mengambil data/log yang belum tersinkron dari ESP32.
- [ ] UI meneruskan batch ke Python.
- [ ] Python memberikan acknowledgment.
- [ ] UI/ESP32 mempertahankan data sampai acknowledgment durable tersedia.
- [ ] Sinkronisasi dapat dilanjutkan setelah koneksi putus.
- [ ] Duplikasi tidak menghasilkan record historis ganda.

### B3. History & Analysis

- [ ] Riwayat siklus dapat ditampilkan dari Python.
- [ ] Riwayat panen dapat ditampilkan dari Python.
- [ ] Data masa tanam dapat digunakan untuk analisis.
- [ ] Analisis lanjutan dapat ditambahkan tanpa mengubah runtime ESP32.

### B4. UI Python

- [ ] Halaman analisis/history Python dibuat.
- [ ] State koneksi Python ditampilkan secara jelas.
- [ ] UI membedakan data runtime ESP32 dan data historis Python.
- [ ] Kegagalan Python tidak menghentikan runtime greenhouse.

> **STATUS: UI ↔ Python belum dikerjakan. Kerjakan hanya ketika diperintah.**

---

## C. Urutan Implementasi

Urutan kerja yang direkomendasikan:

**1. UI ↔ ESP32**  
→ state siklus  
→ mulai tanam  
→ tanaman sudah berjalan  
→ polinasi  
→ kelola siklus  
→ hari panen  
→ error/reconnect  
→ quality gate

**2. Setelah UI ↔ ESP32 selesai**  
→ berhenti pada boundary yang sudah ditentukan.

**3. UI ↔ Python**  
→ dikerjakan nanti hanya berdasarkan perintah baru.

## D. Aturan Penting

- [ ] Jangan membuat UI Python menjadi prasyarat untuk masa tanam.
- [ ] Jangan memindahkan source-of-truth runtime dari ESP32 ke Python.
- [ ] Jangan membuat HST/HSP sebagai input manual.
- [ ] Jangan menghapus historical event hanya karena active cycle dibersihkan.
- [ ] Jangan membangun integrasi Python lebih awal hanya karena endpoint-nya sudah diketahui.
- [ ] Semua fitur UI ↔ ESP32 harus dapat diuji tanpa Python.

> **Prinsip implementasi: selesaikan jalur operasional nyata terlebih dahulu — `UI ↔ ESP32`. Setelah stabil dan dicentang selesai, barulah jalur `UI ↔ Python` dikerjakan ketika diperintah.**
