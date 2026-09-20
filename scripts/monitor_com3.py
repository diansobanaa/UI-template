import serial
import time
import sys

def monitor(port='COM3', baud=115200, duration=4):
    try:
        ser = serial.Serial(port, baud, timeout=0.1)
    except Exception as e:
        print(f"Error opening {port}: {e}")
        return

    # Reset chip into normal execution
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(0.1)

    print(f"--- Monitoring {port} at {baud} baud for {duration} seconds ---")
    start = time.time()
    lines = []
    while time.time() - start < duration:
        line = ser.readline()
        if line:
            text = line.decode('utf-8', errors='replace').rstrip()
            print(text)
            lines.append(text)
    ser.close()
    return lines

if __name__ == '__main__':
    monitor()
