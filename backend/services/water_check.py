"""
Water Body Detection Service
Prevents warehouse creation in oceans, lakes, rivers, and other water bodies.
Uses a multi-layered approach:
  1. Coordinate boundary checks for known open seas around India
  2. Dedicated water-detection API (is-on-water)
  3. Nominatim OSM geocoding fallback
"""

import urllib.request
import json
import logging

logger = logging.getLogger(__name__)


def is_location_in_water(lat: float, lon: float) -> bool:
    """
    Returns True if the given (lat, lon) is likely over a water body.
    Uses boundary checks, an external water API, and Nominatim fallback.
    """

    # 1. Coordinate boundary checks for open seas surrounding India
    if lat < 6.0:
        return True  # South of Indian peninsula — open Indian Ocean
    if 6.0 <= lat <= 22.0:
        if 60.0 <= lon <= 71.0:  # Arabian Sea
            return True
        if 85.5 <= lon <= 92.0:  # Bay of Bengal
            return True

    # 2. Query dedicated water detection API
    try:
        url = f"https://is-on-water.balbona.me/api/v1/get/{lat}/{lon}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Logistix-Warehouse-Validator/1.0"},
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            res = json.loads(response.read().decode())
            if res.get("isWater") is True:
                return True
    except Exception as e:
        logger.warning(f"Water API failed, falling back to Nominatim: {e}")

        # 3. Fallback to Nominatim OSM geocoding
        try:
            url = (
                f"https://nominatim.openstreetmap.org/reverse"
                f"?format=json&lat={lat}&lon={lon}"
            )
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Logistix-Warehouse-Validator/1.0"},
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                res = json.loads(response.read().decode())
                if "error" in res:
                    return True  # Open ocean — geocoder can't resolve
                address = res.get("address", {})
                if len(address) <= 2 and "country" in address:
                    return True  # Sparse address = likely water
                type_val = res.get("type", "")
                water_types = {
                    "water", "river", "lake", "canal", "sea",
                    "ocean", "reservoir", "pond", "bay", "strait",
                }
                if type_val in water_types:
                    return True
        except Exception:
            logger.warning("Nominatim fallback also failed; allowing location.")

    return False
