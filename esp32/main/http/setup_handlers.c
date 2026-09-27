#include "http/setup_handlers.h"
#include "http/http_server.h"
#include "network/network_mgr.h"
#include "storage/storage_mgr.h"
#include "esp_wifi.h"
#include "esp_log.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

static const char *TAG = "SETUP_HTTP";

static const char *SETUP_HTML =
"<!doctype html><html lang='id'><head><meta charset='utf-8'>"
"<meta name='viewport' content='width=device-width,initial-scale=1'>"
"<meta name='theme-color' content='#07141b'><title>AgroTech Setup</title>"
"<style>body{margin:0;background:#07141b;color:#e5eef2;font:16px system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:520px;margin:auto;padding:24px}.card{background:#0d2029;border:1px solid #1d3a46;border-radius:18px;padding:20px;box-shadow:0 12px 40px #0005}h1{font-size:25px;margin:0 0 6px}h2{font-size:18px;margin:24px 0 10px}.muted{color:#93a9b3;font-size:13px}.row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #17323d}.row:last-child{border:0}label{display:block;margin:14px 0 7px;color:#b9cbd2;font-size:13px}input,select{box-sizing:border-box;width:100%;padding:12px;border-radius:11px;border:1px solid #2a4b58;background:#08171e;color:#eef7fa}button{width:100%;padding:13px 14px;border:0;border-radius:12px;background:#2dd4bf;color:#062019;font-weight:700;margin-top:16px}button.secondary{background:#18303a;color:#d6e6eb}.status{margin-top:14px;padding:12px;border-radius:11px;background:#0a171d;border:1px solid #19333e}.ok{border-color:#197b69;color:#8df0dd}.err{border-color:#7d3434;color:#ffb2b2}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#17303a;font-size:12px}.hidden{display:none}.small{font-size:12px}</style></head>"
"<body><div class='wrap'><div class='card'>"
"<h1 id='title'>AgroTech Controller</h1><div id='mode' class='muted'>Menyiapkan pengaturan...</div>"
"<div class='status'><div class='row'><span>Controller</span><strong id='device'>—</strong></div><div class='row'><span>Complex</span><strong id='complex'>—</strong></div><div class='row'><span>Koneksi saat ini</span><strong id='current'>—</strong></div><div class='row'><span>SoftAP</span><strong id='setup'>—</strong></div><div class='row'><span>MAC</span><strong id='mac'>—</strong></div><div class='row'><span>IP</span><strong id='ip'>—</strong></div></div>"
"<h2>Wi-Fi baru</h2><label for='ssid'>Jaringan Wi-Fi</label><select id='ssid'><option value=''>Mencari jaringan...</option></select>"
"<button class='secondary' onclick='scan()'>Muat ulang jaringan</button>"
"<label for='pass'>Kata sandi</label><input id='pass' type='password' autocomplete='off' placeholder='Masukkan kata sandi Wi-Fi'>"
"<button id='connect' onclick='connect()'>CONNECT</button>"
"<button id='exit' class='secondary hidden' onclick='exitMode()'>KELUAR MODE LOKAL</button>"
"<div id='status' class='status hidden'></div>"
"<p class='muted small'>Jaringan lama tidak dihapus sebelum Wi-Fi baru berhasil diuji. Konfigurasi Complex, GH, recipe, jadwal, kalibrasi, dan identitas controller tetap dipertahankan.</p>"
"</div></div>"
"<script>"
"let busy=false;"
"async function j(u,o){const r=await fetch(u,o);const x=await r.json();if(!r.ok)throw new Error(x.error?.message||'Permintaan gagal');return x.data||x}"
"function show(t,ok=false){const e=document.getElementById('status');e.className='status '+(ok?'ok':'err');e.textContent=t;e.classList.remove('hidden')}"
"async function exitMode(){try{await j('/setup/api/finish',{method:'POST'});show('Mode lokal ditutup. Controller kembali mencoba Wi-Fi tersimpan.',true);setTimeout(()=>location.reload(),1200)}catch(e){show(e.message)}}"
"async function status(){try{const x=await j('/setup/api/status');document.getElementById('device').textContent=x.deviceId||'—';document.getElementById('complex').textContent=x.complexId||'Belum terdaftar';document.getElementById('setup').textContent=x.setupSsid||'—';document.getElementById('current').textContent=x.currentSsid?(x.connected?'Terhubung: '+x.currentSsid:'Tersimpan: '+x.currentSsid):'Belum tersambung';document.getElementById('mac').textContent=x.mac||'—';document.getElementById('ip').textContent=x.ip||'—';const local=x.mode==='DIRECT_LOCAL_AP'||x.mode==='DIRECT_LOCAL_CONNECTED';document.getElementById('mode').textContent=x.mode==='NETWORK_CHANGE'?'CHANGE WI-FI — tanpa reset':local?'LOCAL DIRECT MODE — controller ini saja':'PENGATURAN WI-FI';document.getElementById('exit').classList.toggle('hidden',!local);if(x.candidateState==='CONNECTING'){show('Menghubungkan ke '+x.candidateSsid+'...');}else if(x.candidateState==='SUCCESS'){show('Wi-Fi berhasil terhubung. IP: '+(x.ip||'—')+' • MAC: '+(x.mac||'—')+'. Credential baru sudah disimpan dengan aman. Controller akan kembali ke jaringan normal.',true);}else if(x.candidateState==='FAILED'){show(x.candidateError||'Wi-Fi baru tidak dapat digunakan. Credential lama tetap dipertahankan.');}}catch(e){show(e.message)}}"
"async function scan(){try{const xs=await j('/setup/api/scan');const s=document.getElementById('ssid');s.innerHTML='<option value=\"\">Pilih jaringan Wi-Fi</option>';for(const x of xs){const o=document.createElement('option');o.value=x.ssid;o.textContent=x.ssid+'  '+x.rssi+' dBm';s.appendChild(o)}show('Daftar jaringan diperbarui.',true)}catch(e){show('Tidak dapat membaca jaringan Wi-Fi: '+e.message)}}"
"async function connect(){if(busy)return;const ssid=document.getElementById('ssid').value;const pass=document.getElementById('pass').value;if(!ssid){show('Pilih jaringan Wi-Fi terlebih dahulu.');return}busy=true;document.getElementById('connect').disabled=true;document.getElementById('connect').textContent='MENGHUBUNGKAN...';try{await j('/setup/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ssid,password:pass})});show('Pengujian Wi-Fi dimulai...');poll()}catch(e){show(e.message);busy=false;document.getElementById('connect').disabled=false;document.getElementById('connect').textContent='CONNECT'}}"
"async function poll(){for(let i=0;i<25;i++){await new Promise(r=>setTimeout(r,800));try{const x=await j('/setup/api/status');if(x.candidateState==='SUCCESS'){show('CONNECTED ✓  '+x.candidateSsid+'  •  IP: '+(x.ip||'—')+'  •  MAC: '+(x.mac||'—'),true);setTimeout(()=>location.reload(),8000);return}if(x.candidateState==='FAILED'){show(x.candidateError||'Wi-Fi baru gagal. Credential lama tetap dipertahankan.');break}}catch(e){show('Koneksi ke controller terputus. Jika Wi-Fi baru sudah aktif, sambungkan HP ke router baru dan buka AgroTech UI.');break}}busy=false;document.getElementById('connect').disabled=false;document.getElementById('connect').textContent='CONNECT';await status()}"
"status();scan();setInterval(()=>{if(!busy)status()},2500);"
"</script></body></html>";

static esp_err_t send_json(httpd_req_t *req, int status_code, cJSON *root)
{
    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (!body) return ESP_ERR_NO_MEM;
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_status(req, status_code == 200 ? "200 OK" : status_code == 202 ? "202 Accepted" : "400 Bad Request");
    httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
    free(body);
    return ESP_OK;
}

static esp_err_t setup_redirect(httpd_req_t *req)
{
    if (!network_mgr_is_setup_active()) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_send(req, "Not found", HTTPD_RESP_USE_STRLEN);
    }
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/setup");
    return httpd_resp_send(req, NULL, 0);
}

static esp_err_t setup_page(httpd_req_t *req)
{
    if (!network_mgr_is_setup_active()) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_send(req, "Setup mode is not active.", HTTPD_RESP_USE_STRLEN);
    }
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, SETUP_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t setup_status(httpd_req_t *req)
{
    if (!network_mgr_is_setup_active()) return http_send_error(req, 404, "SETUP_NOT_ACTIVE", "Setup mode is not active.", NULL);
    const system_storage_state_t *st = storage_mgr_get_state();
    char ip[20] = {0}, mac[20] = {0}, ssid[33] = {0};
    (void)network_mgr_get_ip(ip, sizeof(ip));
    (void)network_mgr_get_mac(mac, sizeof(mac));
    bool has_ssid = network_mgr_get_sta_ssid(ssid, sizeof(ssid)) == ESP_OK;
    cJSON *data = cJSON_CreateObject();
    cJSON_AddStringToObject(data, "mode", network_mgr_get_state_string());
    cJSON_AddStringToObject(data, "deviceId", st && st->device_id[0] ? st->device_id : "unknown");
    if (st && st->complex_id[0]) cJSON_AddStringToObject(data, "complexId", st->complex_id); else cJSON_AddNullToObject(data, "complexId");
    cJSON_AddBoolToObject(data, "connected", network_mgr_is_connected());
    cJSON_AddStringToObject(data, "currentSsid", has_ssid ? ssid : "");
    cJSON_AddStringToObject(data, "ip", ip);
    cJSON_AddStringToObject(data, "mac", mac);
    cJSON_AddStringToObject(data, "setupSsid", network_mgr_get_setup_ssid());
    cJSON_AddStringToObject(data, "setupCode", network_mgr_get_setup_pop());
    const char *cs = "IDLE";
    switch (network_mgr_get_candidate_state()) { case NETWORK_CANDIDATE_CONNECTING: cs="CONNECTING"; break; case NETWORK_CANDIDATE_SUCCESS: cs="SUCCESS"; break; case NETWORK_CANDIDATE_FAILED: cs="FAILED"; break; default: break; }
    cJSON_AddStringToObject(data, "candidateState", cs);
    cJSON_AddStringToObject(data, "candidateSsid", network_mgr_get_candidate_ssid());
    cJSON_AddStringToObject(data, "candidateError", network_mgr_get_candidate_error());
    cJSON_AddBoolToObject(data, "networkChange", network_mgr_is_network_change_mode());
    cJSON_AddBoolToObject(data, "directLocal", network_mgr_is_direct_local_mode());
    cJSON_AddNumberToObject(data, "apClientCount", network_mgr_get_ap_client_count());
    cJSON_AddNumberToObject(data, "apTimeoutSec", network_mgr_get_ap_timeout_remaining_sec());
    return send_json(req, 200, data);
}

static esp_err_t setup_scan(httpd_req_t *req)
{
    if (!network_mgr_is_setup_active()) return http_send_error(req, 404, "SETUP_NOT_ACTIVE", "Setup mode is not active.", NULL);
    wifi_scan_config_t cfg = {0};
    cfg.show_hidden = true;
    cfg.scan_type = WIFI_SCAN_TYPE_ACTIVE;
    cfg.scan_time.active.min = 80;
    cfg.scan_time.active.max = 180;
    esp_err_t err = esp_wifi_scan_start(&cfg, true);
    if (err != ESP_OK) return http_send_error(req, 503, "WIFI_SCAN_FAILED", "Tidak dapat membaca jaringan Wi-Fi sekarang.", NULL);
    uint16_t count = 24;
    wifi_ap_record_t records[24] = {0};
    err = esp_wifi_scan_get_ap_records(&count, records);
    if (err != ESP_OK) return http_send_error(req, 503, "WIFI_SCAN_READ_FAILED", "Hasil pemindaian Wi-Fi tidak tersedia.", NULL);
    cJSON *data = cJSON_CreateArray();
    for (uint16_t i=0;i<count;i++) {
        if (!records[i].ssid[0]) continue;
        cJSON *item=cJSON_CreateObject();
        cJSON_AddStringToObject(item,"ssid",(const char*)records[i].ssid);
        cJSON_AddNumberToObject(item,"rssi",records[i].rssi);
        cJSON_AddItemToArray(data,item);
    }
    return send_json(req, 200, data);
}

static esp_err_t setup_connect(httpd_req_t *req)
{
    if (!network_mgr_is_setup_active()) return http_send_error(req, 404, "SETUP_NOT_ACTIVE", "Setup mode is not active.", NULL);
    cJSON *body = NULL;
    if (http_parse_json_body(req, &body) != ESP_OK) return http_send_error(req, 400, "INVALID_JSON", "Data Wi-Fi tidak valid.", NULL);
    cJSON *ssid = cJSON_GetObjectItem(body, "ssid");
    cJSON *password = cJSON_GetObjectItem(body, "password");
    const char *ssid_s = cJSON_IsString(ssid) ? ssid->valuestring : "";
    const char *pass_s = cJSON_IsString(password) ? password->valuestring : "";
    if (!ssid_s[0] || strlen(ssid_s) >= 33 || strlen(pass_s) >= 65) { cJSON_Delete(body); return http_send_error(req, 400, "INVALID_WIFI_CREDENTIALS", "SSID atau kata sandi Wi-Fi tidak valid.", NULL); }
    esp_err_t err = network_mgr_submit_candidate_credentials(ssid_s, pass_s);
    cJSON_Delete(body);
    if (err != ESP_OK) return http_send_error(req, 409, "WIFI_CHANGE_UNAVAILABLE", "Controller belum siap menerima perubahan Wi-Fi.", NULL);
    cJSON *data = cJSON_CreateObject();
    cJSON_AddStringToObject(data, "state", "CONNECTING");
    cJSON_AddStringToObject(data, "ssid", ssid_s);
    return send_json(req, 202, data);
}

static esp_err_t setup_finish(httpd_req_t *req)
{
    if (!network_mgr_is_direct_local_mode() && !network_mgr_is_network_change_mode()) return http_send_error(req, 409, "LOCAL_SETUP_NOT_ACTIVE", "Mode lokal tidak aktif.", NULL);
    esp_err_t err = network_mgr_exit_direct_local_mode();
    if (err != ESP_OK) return http_send_error(req, 409, "NETWORK_CHANGE_NOT_READY", "Perubahan Wi-Fi belum berhasil.", NULL);
    cJSON *data=cJSON_CreateObject(); cJSON_AddBoolToObject(data,"success",true); return send_json(req,200,data);
}

esp_err_t register_setup_handlers(httpd_handle_t server)
{
    if (!server) return ESP_ERR_INVALID_ARG;
    httpd_uri_t root = {.uri="/", .method=HTTP_GET, .handler=setup_redirect, .user_ctx=NULL};
    httpd_uri_t captive1 = {.uri="/generate_204", .method=HTTP_GET, .handler=setup_redirect, .user_ctx=NULL};
    httpd_uri_t captive2 = {.uri="/hotspot-detect.html", .method=HTTP_GET, .handler=setup_redirect, .user_ctx=NULL};
    httpd_uri_t captive3 = {.uri="/connecttest.txt", .method=HTTP_GET, .handler=setup_redirect, .user_ctx=NULL};
    httpd_uri_t page = {.uri="/setup", .method=HTTP_GET, .handler=setup_page, .user_ctx=NULL};
    httpd_uri_t status = {.uri="/setup/api/status", .method=HTTP_GET, .handler=setup_status, .user_ctx=NULL};
    httpd_uri_t scan = {.uri="/setup/api/scan", .method=HTTP_GET, .handler=setup_scan, .user_ctx=NULL};
    httpd_uri_t connect = {.uri="/setup/api/connect", .method=HTTP_POST, .handler=setup_connect, .user_ctx=NULL};
    httpd_uri_t finish = {.uri="/setup/api/finish", .method=HTTP_POST, .handler=setup_finish, .user_ctx=NULL};
    esp_err_t err;
    if ((err=httpd_register_uri_handler(server,&root))!=ESP_OK) return err;
    if ((err=httpd_register_uri_handler(server,&captive1))!=ESP_OK) return err;
    if ((err=httpd_register_uri_handler(server,&captive2))!=ESP_OK) return err;
    if ((err=httpd_register_uri_handler(server,&captive3))!=ESP_OK) return err;
    if ((err=httpd_register_uri_handler(server,&page))!=ESP_OK) return err;
    if ((err=httpd_register_uri_handler(server,&status))!=ESP_OK) return err;
    if ((err=httpd_register_uri_handler(server,&scan))!=ESP_OK) return err;
    if ((err=httpd_register_uri_handler(server,&connect))!=ESP_OK) return err;
    return httpd_register_uri_handler(server,&finish);
}
