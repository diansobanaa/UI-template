import serial
import time
import sys

def main():
    port = "COM3"
    baud = 115200
    duration = 150  # 2.5 minutes

    log_path = "scripts/monitor_3min.log"
    out_file = open(log_path, "w", encoding="utf-8", errors="replace")

    print(f"Starting serial monitor on {port} at {baud} for {duration} seconds...", flush=True)

    try:
        ser = serial.Serial()
        ser.port = port
        ser.baudrate = baud
        ser.timeout = 0.1
        ser.setDTR(False)
        ser.setRTS(False)
        ser.dtr = False
        ser.rts = False
        ser.open()
    except Exception as e:
        print(f"Failed to open {port}: {e}", flush=True)
        out_file.write(f"Failed to open {port}: {e}\n")
        out_file.close()
        sys.exit(1)

    start_time = time.time()
    last_report = start_time
    line_count = 0

    while (time.time() - start_time) < duration:
        try:
            raw_line = ser.readline()
            if raw_line:
                now_str = time.strftime("%H:%M:%S")
                decoded = raw_line.decode("utf-8", errors="replace").rstrip()
                formatted = f"[{now_str}] {decoded}"
                out_file.write(formatted + "\n")
                out_file.flush()
                # Print cleanly to stdout
                try:
                    print(formatted)
                except UnicodeEncodeError:
                    print(f"[{now_str}] {decoded.encode('ascii', errors='replace').decode('ascii')}")
                line_count += 1
            
            now = time.time()
            if now - last_report >= 30:
                elapsed = int(now - start_time)
                print(f"--- [CHECKPOINT] Elapsed: {elapsed}s / {duration}s | Lines read: {line_count} ---", flush=True)
                last_report = now
        except Exception as e:
            print(f"Read error: {e}", flush=True)
            out_file.write(f"Read error: {e}\n")
            break

    ser.close()
    out_file.close()
    print(f"Monitor completed. Total lines captured: {line_count}. Saved to {log_path}", flush=True)

if __name__ == "__main__":
    main()
