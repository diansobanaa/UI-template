import serial
import time
import sys

def main():
    port = "COM3"
    baud = 115200
    duration = 150  # 2.5 minutes

    log_path = "scripts/monitor_post_fix.log"
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
                line_count += 1
            
            if time.time() - last_report >= 15:
                elapsed = int(time.time() - start_time)
                print(f"[{elapsed}s / {duration}s] Captured {line_count} lines...", flush=True)
                last_report = time.time()
        except Exception as e:
            print(f"Error reading serial: {e}", flush=True)
            time.sleep(0.5)

    ser.close()
    out_file.close()
    print(f"Completed monitoring for {duration} seconds. Total lines captured: {line_count}.", flush=True)

if __name__ == "__main__":
    main()
