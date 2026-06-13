"""
Water Body Detection Service
Prevents warehouse creation in oceans, lakes, rivers, and other water bodies.
Uses a multi-layered approach:
  1. Coordinate boundary checks for known open seas around India
  2. Bounding box checks for major still water bodies/lakes in India
  3. Dedicated water-detection API (is-on-water)
  4. Nominatim OSM geocoding with type and keyword analysis
"""

import urllib.request
import json
import logging

logger = logging.getLogger(__name__)

# Bounding boxes for major still water bodies (lakes/reservoirs/ponds) in India
STILL_WATER_BODIES = [
    # Format: (min_lat, max_lat, min_lon, max_lon, name)
    (34.07, 34.15, 74.80, 74.88, "Dal Lake"),
    (11.400, 11.415, 76.680, 76.698, "Ooty Lake"),
    (26.885, 26.895, 88.178, 88.188, "Mirik Lake"),
    (17.415, 17.435, 78.465, 78.485, "Hussain Sagar"),
    (22.508, 22.516, 88.350, 88.366, "Rabindra Sarobar"),
    (19.120, 19.140, 72.895, 72.915, "Powai Lake"),
    (19.400, 19.900, 85.000, 85.600, "Chilika Lake"),
    (9.500, 10.200, 76.300, 76.450, "Vembanad Lake"),
    (30.738, 30.752, 76.805, 76.825, "Sukhna Lake"),
    (12.975, 12.988, 77.615, 77.630, "Ulsoor Lake"),
    (12.925, 12.945, 77.650, 77.680, "Bellandur Lake"),
    (24.560, 24.585, 73.665, 73.685, "Pichola Lake"),
    (24.590, 24.615, 73.665, 73.685, "Fateh Sagar"),
    (26.485, 26.495, 74.545, 74.558, "Pushkar Lake"),
    (19.970, 19.980, 76.500, 76.520, "Lonar Lake"),
    (24.400, 24.650, 93.700, 93.900, "Loktak Lake"),
    (34.300, 34.450, 74.500, 74.650, "Wular Lake"),
    (29.385, 29.398, 79.450, 79.468, "Naini Lake"),
    (29.340, 29.355, 79.540, 79.560, "Bhimtal Lake"),
    (22.998, 23.008, 72.595, 72.608, "Kankaria Lake"),
    (24.590, 24.600, 72.700, 72.715, "Nakki Lake"),
    (26.960, 26.975, 75.835, 75.860, "Mansagar Lake"),
]


_WATER_CACHE = {}

def is_location_in_water(lat: float, lon: float, skip_network: bool = False) -> bool:
    key = (round(lat, 5), round(lon, 5))
    if key in _WATER_CACHE:
        return _WATER_CACHE[key]
    res = _is_location_in_water_impl(lat, lon, skip_network)
    _WATER_CACHE[key] = res
    return res

def _is_location_in_water_impl(lat: float, lon: float, skip_network: bool = False) -> bool:
    """
    Returns True if the given (lat, lon) is likely over a water body (sea, lake, river, reservoir).
    Uses boundary checks, still water bounding boxes, an external water API, and Nominatim.
    """

    # 1. Coordinate boundary checks for open seas surrounding India
    if lat < 6.0:
        return True  # South of Indian peninsula — open Indian Ocean
    if 6.0 <= lat <= 22.0:
        if 60.0 <= lon <= 71.0:  # Arabian Sea
            return True
        if 85.5 <= lon <= 92.0:  # Bay of Bengal
            return True

    # 2. Check hardcoded bounding boxes for major still water bodies/lakes in India
    for min_lat, max_lat, min_lon, max_lon, name in STILL_WATER_BODIES:
        if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
            logger.info(f"Location is inside known still water body: {name}")
            return True

    if skip_network:
        return False

    # 3. Query dedicated water detection API
    is_water_api = False
    try:
        url = f"https://is-on-water.balbona.me/api/v1/get/{lat}/{lon}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Logistix-Warehouse-Validator/1.0"},
        )
        with urllib.request.urlopen(req, timeout=3) as response:
            res = json.loads(response.read().decode())
            if res.get("isWater") is True:
                return True
    except Exception as e:
        logger.warning(f"Water API failed: {e}")

    # 4. Fallback to Nominatim OSM geocoding with type and keyword matching
    try:
        url = (
            f"https://nominatim.openstreetmap.org/reverse"
            f"?format=json&lat={lat}&lon={lon}"
        )
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Logistix-Warehouse-Validator/1.0"},
        )
        with urllib.request.urlopen(req, timeout=3) as response:
            res = json.loads(response.read().decode())
            if "error" in res:
                return True  # Open ocean — geocoder can't resolve
            
            address = res.get("address", {})
            if len(address) <= 2 and "country" in address:
                return True  # Sparse address = likely water
            
            type_val = res.get("type", "")
            water_types = {
                "water", "river", "lake", "canal", "sea",
                "ocean", "reservoir", "pond", "bay", "strait", "wetland", "waterway"
            }
            if type_val in water_types:
                return True
                
            # Check keywords in name and display name to catch houseboats, ghats, etc.
            display_name = res.get("display_name", "").lower()
            name_val = res.get("name", "").lower()
            water_keywords = {
                "lake", "pond", "sagar", "jheel", "tal", "reservoir", "dam", 
                "backwater", "river", "canal", "ghat", "houseboat", "boathouse", "wetland"
            }
            for keyword in water_keywords:
                if keyword in display_name or keyword in name_val:
                    logger.info(f"Water keyword '{keyword}' found in geocoding display name: {display_name}")
                    return True
    except Exception as e:
        logger.warning(f"Nominatim fallback failed: {e}")

    return False
