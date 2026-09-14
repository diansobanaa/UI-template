# FIRST BUILD BLOCKER: http_server.c / literal newline corruption

## Safe Point ID
FIRST-BUILD-BLOCKER-http-server-literal-newline

## Objective
Lakukan ROOT-CAUSE-FIRST analysis terhadap literal `\n` corruption dan perbaiki (minimal fix) literal `\n` yang terbukti sebagai source corruption tanpa mengubah API atau behavior.

## Root Cause
Ditemukan bahwa pada komit sebelumnya (oleh AI agent sebelumnya saat implementasi otentikasi & keamanan atau handler APIs), terdapat output literal string `\n` (karakter backslash diikuti oleh karakter 'n') yang masuk secara mentah ke dalam file sumber C. Ini bukan newline character (`\x0A`), melainkan literal source token yang merusak sintaks file. Hal ini ditemukan di:
- `esp32/main/http/http_server.c`
- `esp32/main/http/api_cropcycle_handlers.c` (sebagian besar isi file)

## Inventory
Daftar INVALID_SOURCE_CORRUPTION yang ditemukan:
1. `esp32/main/http/http_server.c`:
   - Baris 46: `\nesp_err_t http_send_cors_headers(httpd_req_t *req)`
2. `esp32/main/http/api_cropcycle_handlers.c`:
   - Hampir seluruh fungsi memiliki baris panjang dengan literal `\n` sebagai pengganti line break yang valid. (Contohnya di baris 1, 7, 13, 19, 25, 31, 37, 43, 49, 55, 61).

*Catatan: File `http_server.h` telah diperbaiki sebelumnya di Safe Point `FIRST-BUILD-BLOCKER-http-server` sehingga tidak ada lagi error newline.*

## Changed Files
- `esp32/main/http/http_server.c`
- `esp32/main/http/api_cropcycle_handlers.c`

## Verification Performed
- Pencarian (scan) source code C & H untuk mengidentifikasi keberadaan karakter backslash diikuti oleh 'n' yang berada di luar string literal (quote).
- Global fix minimal yang hanya menggantikan literal `\n` dengan newline character `\x0A` pada file-file korup tersebut.
- Re-scan membuktikan tidak ada lagi literal `\n` (INVALID_SOURCE_CORRUPTION) di source code.
- Kompilasi (build) ulang dijalankan.

## Build Result
**ADVANCED.**
Kompilasi sukses melewati `http_server.c`, `api_device_handlers.c`, dan `api_config_handlers.c`. 
Kompilasi kemudian berhenti di komponen selanjutnya.

## Remaining Findings
Tidak ada sisa literal `\n` corruption pada source code (`http_server.c` dan `api_cropcycle_handlers.c` telah valid).

## Next Blocker
Kompilasi terhenti di `api_command_handlers.c` dengan pesan error:
```
D:/template/esp32/main/http/api_command_handlers.c:84:15: error: redefinition of 'err'
   84 |     esp_err_t err = command_mgr_submit(&cmd, NULL);
      |               ^~~
D:/template/esp32/main/http/api_command_handlers.c:48:15: note: previous definition of 'err' with type 'esp_err_t' {aka 'int'}
   48 |     esp_err_t err = http_parse_json_body(req, &body);
      |               ^~~
```

## Git Commit Hash
NOT YET COMMITTED
Status: PARTIAL/UNCOMMITTED
