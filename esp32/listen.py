import serial
import time
import sys

def main():
    s = serial.Serial('COM3', 115200, timeout=0.2)
    s.dtr = False
    s.rts = False
    time.sleep(0.1)
    s.reset_input_buffer()
    print("=== LISTENING TO ESP32 RUNTIME (10s) ===")
    t0 = time.time()
    while time.time() - t0 < 10.0:
        chunk = s.read(s.in_waiting or 1)
        if chunk:
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
    s.close()
    print("\n=== FINISHED LISTENING ===")

if __name__ == '__main__':
    main()
