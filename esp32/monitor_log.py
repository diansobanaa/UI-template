import serial
import time
import sys

def main():
    try:
        ser = serial.Serial('COM3', 115200, timeout=0.1)
    except Exception as e:
        print(f"Failed to open COM3: {e}")
        return

    # Clear buffers
    ser.reset_input_buffer()
    ser.reset_output_buffer()

    # Hardware reset
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(0.1)

    start = time.time()
    out = bytearray()
    print("--- STARTING SERIAL CAPTURE ---")
    while time.time() - start < 30.0:
        n = ser.in_waiting
        if n > 0:
            chunk = ser.read(n)
            out.extend(chunk)
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
        else:
            time.sleep(0.01)
    ser.close()
    print("\n--- SERIAL CAPTURE FINISHED ---")
    with open('boot_clean.log', 'wb') as f:
        f.write(out)

if __name__ == '__main__':
    main()
