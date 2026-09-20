import serial
import time

def read_boot():
    ser = serial.Serial('COM3', 115200, timeout=0.1)
    ser.setDTR(False)
    ser.setRTS(True)
    time.sleep(0.1)
    ser.setRTS(False)
    time.sleep(0.1)

    start = time.time()
    while time.time() - start < 8:
        line = ser.readline()
        if line:
            s = line.decode('utf-8', errors='replace').rstrip()
            if any(k in s for k in ['IP', 'wifi:', 'NETWORK_MGR', 'AGROTECH_MAIN', 'SoftAP', 'DHCP']):
                print(s)
    ser.close()

if __name__ == '__main__':
    read_boot()
