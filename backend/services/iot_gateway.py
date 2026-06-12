import random
from typing import Dict, Any

class IoTGateway:
    @staticmethod
    def generate_telemetry() -> Dict[str, Any]:
        """
        Generates realistic telemetry for all 6 IoT hardware sensor nodes.
        """
        # 1. Cold Chain DHT22
        cold_chain_temp = round(random.uniform(-5.0, 15.0), 1)
        
        # 2. fatigue MAX30102
        fatigue_hr = random.randint(45, 85)
        fatigue_eye = random.randint(40, 100)
        
        # 3. Weighbridge Load Cell
        weighbridge_wt = random.randint(2000, 22000)
        weighbridge_plate = random.choice(['MH-12-TX-8899', 'KA-01-AB-1234', 'DL-4C-AW-9090', 'TN-09-CQ-4545'])
        
        # 4. Drone companion computer alt/gps/battery
        drone_lat = round(19.0 + random.random() * 0.2, 4)
        drone_lng = round(72.8 + random.random() * 0.2, 4)
        drone_alt = random.randint(10, 300)
        drone_batt = random.randint(5, 100)
        
        # 5. RFID scanner Scan Rate
        rfid_rate = random.randint(10, 300)
        hex_chars = "0123456789ABCDEF"
        rfid_uid = ":".join("".join(random.choice(hex_chars) for _ in range(2)) for _ in range(4))
        
        # 6. Shock accelerometer
        shock_g = round(random.uniform(2.0, 17.0), 1)
        shock_axis = random.choice(['X', 'Y', 'Z'])
        
        return {
            "cold_chain": {
                "temp": cold_chain_temp
            },
            "fatigue": {
                "heart_rate": fatigue_hr,
                "eye_closure_rate": fatigue_eye
            },
            "weighbridge": {
                "weight": weighbridge_wt,
                "plate": weighbridge_plate
            },
            "drone": {
                "lat": drone_lat,
                "lng": drone_lng,
                "alt": drone_alt,
                "battery": drone_batt
            },
            "rfid": {
                "scan_rate": rfid_rate,
                "uid": rfid_uid
            },
            "shock": {
                "g_force": shock_g,
                "axis": shock_axis
            }
        }
