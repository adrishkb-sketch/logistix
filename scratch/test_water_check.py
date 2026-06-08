import urllib.request
import json

def is_location_in_water(lat: float, lon: float) -> bool:
    # 1. Coordinate boundary checks for open seas surrounding India
    if lat < 6.0:
        return True
    if 6.0 <= lat <= 22.0:
        if 60.0 <= lon <= 71.0: # Arabian Sea
            return True
        if 85.5 <= lon <= 92.0: # Bay of Bengal
            return True

    # 2. Query dedicated water detection API
    try:
        url = f"https://is-on-water.balbona.me/api/v1/get/{lat}/{lon}"
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Logistix-Warehouse-Validator/1.0'}
        )
        with urllib.request.urlopen(req, timeout=3) as response:
            res = json.loads(response.read().decode())
            if res.get("isWater") is True:
                return True
    except Exception as e:
        print(f"Water API failed: {e}")
        # 3. Fallback to Nominatim OSM geocoding
        try:
            url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}"
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'Logistix-Warehouse-Validator/1.0'}
            )
            with urllib.request.urlopen(req, timeout=3) as response:
                res = json.loads(response.read().decode())
                if "error" in res:
                    return True # Open ocean geocoding failure
                address = res.get("address", {})
                if len(address) <= 2 and "country" in address:
                    return True
                type_val = res.get("type", "")
                if type_val in ["water", "river", "lake", "canal", "sea", "ocean", "reservoir", "pond", "bay", "strait"]:
                    return True
        except:
            pass
            
    return False

# Test cases
test_coords = [
    (22.5726, 88.3639, "Kolkata Land", False),
    (15.0, 88.0, "Bay of Bengal", True),
    (19.72, 85.38, "Chilika Lake", True),
    (17.423, 78.475, "Hussain Sagar Hyderabad", True),
    (18.9, 72.75, "Mumbai Ocean", True),
    (18.939, 72.825, "Gateway of India Land", False)
]

for lat, lon, desc, expected in test_coords:
    result = is_location_in_water(lat, lon)
    status = "PASS" if result == expected else "FAIL"
    print(f"{desc} ({lat}, {lon}) -> Result: {result}, Expected: {expected} -> {status}")
