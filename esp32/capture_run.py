import serial
import time
import sys

def main():
    ser = serial.Serial('COM3', 115200, timeout=0.2)
    ser.reset_input_buffer()
    
    # Clean reset pulse
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.05)
    ser.setRTS(False)
    time.sleep(0.05)
    
    t0 = time.time()
    with open('log_run3.txt', 'wb') as f:
        while time.time() - t0 < 20.0:
            chunk = ser.read(ser.in_waiting or 1)
            if chunk:
                f.write(chunk)
                f.flush()
                # write ascii/escaped to stdout
                sys.stdout.write(chunk.decode('ascii', errors='replace'))
                sys.stdout.flush()
    ser.close()
    print("\n--- CAPTURE COMPLETE ---")

if __name__ == '__main__':
    main()
