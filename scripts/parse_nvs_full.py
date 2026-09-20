import struct
import sys

PAGE_SIZE = 4096
ENTRY_SIZE = 32
ENTRIES_PER_PAGE = 126

TYPE_NAMES = {
    0x01: "u8",
    0x02: "u16",
    0x04: "u32",
    0x08: "u64",
    0x11: "i8",
    0x12: "i16",
    0x14: "i32",
    0x18: "i64",
    0x21: "str",
    0x41: "blob",
    0x42: "blob_data",
    0x48: "blob_idx"
}

def parse_nvs_full(bin_path):
    with open(bin_path, "rb") as f:
        data = f.read()

    num_pages = len(data) // PAGE_SIZE
    print(f"Total pages: {num_pages} ({len(data)} bytes)")

    namespaces = {0: "nvs"} # index 0 is namespace table

    # First pass: find all namespace entries in namespace 0
    for p in range(num_pages):
        page = data[p*PAGE_SIZE : (p+1)*PAGE_SIZE]
        for e in range(ENTRIES_PER_PAGE):
            offset = 32 + e * 32
            entry = page[offset : offset + 32]
            ns_idx, entry_type, span, chunk_idx, crc = struct.unpack("<BBBBI", entry[:8])
            key = entry[8:24].rstrip(b"\x00").decode("latin1", errors="replace")
            if ns_idx == 0 and entry_type == 0x01: # u8 in ns 0 maps key -> ns_index
                val = entry[24]
                namespaces[val] = key

    print("Namespaces found:")
    for idx, name in namespaces.items():
        print(f"  [{idx}] {name}")

    # Second pass: read all entries
    # Keep track of latest valid entries (key + ns)
    records = {}
    
    for p in range(num_pages):
        page = data[p*PAGE_SIZE : (p+1)*PAGE_SIZE]
        e = 0
        while e < ENTRIES_PER_PAGE:
            offset = 32 + e * 32
            entry = page[offset : offset + 32]
            if entry == b"\xff" * 32:
                e += 1
                continue
            ns_idx, entry_type, span, chunk_idx, crc = struct.unpack("<BBBBI", entry[:8])
            if entry_type == 0xff or span == 0:
                e += 1
                continue
            key = entry[8:24].rstrip(b"\x00").decode("latin1", errors="replace")
            ns_name = namespaces.get(ns_idx, f"ns_{ns_idx}")
            
            val = None
            if entry_type == 0x01: # u8
                val = entry[24]
            elif entry_type == 0x02: # u16
                val = struct.unpack("<H", entry[24:26])[0]
            elif entry_type == 0x04: # u32
                val = struct.unpack("<I", entry[24:28])[0]
            elif entry_type == 0x08: # u64
                val = struct.unpack("<Q", entry[24:32])[0]
            elif entry_type == 0x21: # str
                data_size, crc_val = struct.unpack("<HH", entry[24:28])
                # string payload is in the subsequent (span-1) slots
                str_bytes = bytearray()
                for s in range(1, span):
                    slot_off = 32 + (e + s) * 32
                    str_bytes.extend(page[slot_off : slot_off + 32])
                val = str_bytes[:data_size].rstrip(b"\x00").decode("utf-8", errors="replace")
            elif entry_type == 0x41: # blob
                data_size, crc_val = struct.unpack("<HH", entry[24:28])
                val = f"<blob {data_size} bytes>"
            elif entry_type == 0x42: # blob_data
                val = "<blob_data>"
            elif entry_type == 0x48: # blob_idx
                val = "<blob_idx>"
            else:
                val = f"<unknown type 0x{entry_type:02x}>"

            records[(ns_name, key)] = (val, TYPE_NAMES.get(entry_type, f"0x{entry_type:02x}"))
            e += span

    print("\n--- Current NVS Records ---")
    for (ns, k), (val, typ) in sorted(records.items()):
        if ns in ["agrotech", "nvs", "misc", "nvs.net80211", "phy"]:
            # Ensure safe ASCII printing
            safe_k = "".join(c if c.isprintable() else f"\\x{ord(c):02x}" for c in k)
            safe_val = str(val)
            safe_val = "".join(c if c.isprintable() else f"\\x{ord(c):02x}" for c in safe_val)
            print(f"{ns:15} | {safe_k:20} | {typ:8} | {safe_val}")

if __name__ == "__main__":
    parse_nvs_full("esp32/nvs_backup.bin")
