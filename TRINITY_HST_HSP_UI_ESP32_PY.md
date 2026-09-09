# Hubungan UI, ESP32, dan Python — HST/HSP Masa Tanam

## Tujuan

Menangani data masa tanam tanpa membuat UI bergantung pada Python. ESP32 tetap menjadi runtime anchor, sedangkan UI menjadi pengelola interaksi pengguna dan Python menjadi penyimpan/analisis permanen untuk tahap berikutnya.

## Data yang disimpan

ESP32 menyimpan **snapshot aktif siklus tanam** per greenhouse:

```json
{
  "gh1": {
    "tanggal_tanam": "2026-01-24",
    "tanggal_polinasi": "2026-02-24"
  }
}
```

UI menghitung:

- **HST (Hari Setelah Tanam)** = tanggal sekarang − tanggal tanam
- **HSP (Hari Setelah Polinasi)** = tanggal sekarang − tanggal polinasi
- Jika tanggal polinasi belum ada, HSP ditampilkan sebagai belum tersedia.

HST/HSP bukan angka yang disimpan sebagai nilai manual karena keduanya berubah otomatis terhadap waktu.

## Alur UI ↔ ESP32

**UI → ESP32**
- tambah tanggal tanam
- ubah tanggal tanam
- hapus/reset data siklus sesuai mekanisme yang disediakan
- tambah tanggal polinasi
- ubah tanggal polinasi
- hapus tanggal polinasi
- tandai **Hari Panen**

**ESP32 → UI**
- status siklus aktif
- tanggal tanam
- tanggal polinasi
- status greenhouse
- event/hasil aksi
- log operasional yang relevan

UI selalu menampilkan HST/HSP berdasarkan data tanggal yang diterima dari ESP32.

## Saat Hari Panen

Saat pengguna mengonfirmasi **Hari Panen**:

1. UI meminta ESP32 mengakhiri siklus aktif.
2. ESP32 mencatat event panen/log secara lokal.
3. Data aktif `tanggal_tanam` dan `tanggal_polinasi` dibersihkan dari snapshot runtime.
4. Riwayat tidak dihapus.
5. GH kembali ke keadaan siap memulai siklus baru.
6. Jika Python tersedia, UI nantinya meneruskan event/log tersebut ke Python.
7. Jika Python tidak tersedia, ESP32 tetap menyimpan data sampai dapat disinkronkan.

## Peran Python — untuk tahap berikutnya

Python menjadi **master history dan analysis**, bukan prasyarat runtime.

Nantinya:

**ESP32 → UI → Python**

UI mengambil data/log dari ESP32 dan mengirimkannya ke Python untuk penyimpanan permanen, histori siklus, analisis, dan riset.

Python tidak menjadi ketergantungan untuk menghitung atau menjalankan HST/HSP pada runtime.

## Prinsip

> **ESP32 menyimpan fakta runtime. UI mengelola pengalaman pengguna dan menghitung HST/HSP. Python menyimpan sejarah dan menganalisisnya.**
