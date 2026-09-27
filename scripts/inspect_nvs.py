import struct
import sys

def parse_nvs(file_path):
    with open(file_path, "rb") as f:
        data = f.read()

    print(f"Read {len(data)} bytes from {file_path}")

    # Search for specific strings in NVS
    targets = [b"dev_id", b"cplx_id", b"sta_ssid", b"sta_pass", b"prov_pop", b"hostname", b"boot_cnt", b"agrotech", b"nvs.net80211"]
    for t in targets:
        pos = 0
        while True:
            idx = data.find(t, pos)
            if idx == -1:
                break
            context = data[max(0, idx-16):min(len(data), idx+64)]
            # Clean printable representation
            clean = "".join(chr(b) if 32 <= b <= 126 else f"\\x{b:02x}" for b in context)
            print(f"Found '{t.decode()}' at 0x{idx:04x}: {clean}")
            pos = idx + len(t)

if __name__ == "__main__":
    parse_nvs("esp32/nvs_backup.bin")
