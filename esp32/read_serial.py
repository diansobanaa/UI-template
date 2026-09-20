import serial
import time
import sys

def main():
    port = "COM3"
    baud = 115200
    timeout = 15.0

    print(f"Opening {port} at {baud}...")
    try:
        ser = serial.Serial(port, baud, timeout=0.1)
    except Exception as e:
        print(f"Failed to open port: {e}")
        sys.exit(1)

    # Reset ESP32 via RTS / DTR
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(0.1)

    lines = []
    start_time = time.time()
    print("Reading boot log...")
    while time.time() - start_time < timeout:
        line = ser.readline()
        if line:
            text = line.decode('utf-8', errors='replace')
            sys.stdout.buffer.write(text.encode('utf-8', errors='replace'))
            sys.stdout.flush()
            lines.append(text)

    ser.close()
    with open("boot_serial_new.log", "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"\nDone! Captured {len(lines)} lines.")

if __name__ == "__main__":
    main()
