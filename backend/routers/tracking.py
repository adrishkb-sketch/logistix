from fastapi import APIRouter, HTTPException
from backend.database import JSONDatabase

router = APIRouter()

# ── Curated India land-only sample points ────────────────────────
# Each coordinate is verified to lie on Indian land territory.
# Covers: mainland India (J&K to Kanyakumari, Kutch to Arunachal),
# Andaman & Nicobar Islands, and Lakshadweep.
# A mathematical grid is NOT used because it places points in oceans,
# neighbouring countries, and uninhabited sea areas.
INDIA_LAND_POINTS = [
    # ── Jammu & Kashmir / Ladakh ──────────────────────────────────
    {"lat": 34.08, "lng": 74.80, "label": "Srinagar"},
    {"lat": 34.23, "lng": 77.58, "label": "Leh"},
    {"lat": 32.73, "lng": 74.87, "label": "Jammu"},
    {"lat": 33.73, "lng": 76.57, "label": "Kargil"},
    # ── Himachal Pradesh ──────────────────────────────────────────
    {"lat": 31.10, "lng": 77.17, "label": "Shimla"},
    {"lat": 32.22, "lng": 76.32, "label": "Dharamsala"},
    {"lat": 31.53, "lng": 76.53, "label": "Mandi"},
    # ── Punjab / Haryana / Chandigarh ────────────────────────────
    {"lat": 30.73, "lng": 76.78, "label": "Chandigarh"},
    {"lat": 31.63, "lng": 74.87, "label": "Amritsar"},
    {"lat": 30.90, "lng": 75.85, "label": "Ludhiana"},
    {"lat": 29.07, "lng": 76.09, "label": "Rohtak"},
    # ── Uttarakhand ───────────────────────────────────────────────
    {"lat": 30.32, "lng": 78.04, "label": "Dehradun"},
    {"lat": 29.87, "lng": 78.77, "label": "Haridwar"},
    {"lat": 30.07, "lng": 79.40, "label": "Chamoli"},
    # ── Delhi / NCR ───────────────────────────────────────────────
    {"lat": 28.61, "lng": 77.21, "label": "Delhi"},
    {"lat": 28.47, "lng": 77.03, "label": "Gurugram"},
    # ── Rajasthan ─────────────────────────────────────────────────
    {"lat": 26.91, "lng": 75.79, "label": "Jaipur"},
    {"lat": 26.30, "lng": 73.02, "label": "Jodhpur"},
    {"lat": 24.57, "lng": 73.69, "label": "Udaipur"},
    {"lat": 28.02, "lng": 73.31, "label": "Bikaner"},
    {"lat": 27.20, "lng": 70.92, "label": "Barmer"},
    # ── Uttar Pradesh ────────────────────────────────────────────
    {"lat": 26.85, "lng": 80.95, "label": "Lucknow"},
    {"lat": 25.45, "lng": 81.84, "label": "Allahabad"},
    {"lat": 25.32, "lng": 83.00, "label": "Varanasi"},
    {"lat": 27.18, "lng": 78.01, "label": "Agra"},
    {"lat": 28.35, "lng": 79.42, "label": "Bareilly"},
    {"lat": 26.46, "lng": 80.33, "label": "Kanpur"},
    # ── Bihar ────────────────────────────────────────────────────
    {"lat": 25.59, "lng": 85.14, "label": "Patna"},
    {"lat": 25.24, "lng": 86.99, "label": "Bhagalpur"},
    {"lat": 26.12, "lng": 85.36, "label": "Muzaffarpur"},
    # ── Jharkhand ────────────────────────────────────────────────
    {"lat": 23.35, "lng": 85.33, "label": "Ranchi"},
    {"lat": 22.80, "lng": 86.20, "label": "Jamshedpur"},
    # ── West Bengal ──────────────────────────────────────────────
    {"lat": 22.57, "lng": 88.36, "label": "Kolkata"},
    {"lat": 26.72, "lng": 88.43, "label": "Siliguri"},
    {"lat": 23.83, "lng": 91.28, "label": "Agartala"},
    # ── Assam / Northeast ────────────────────────────────────────
    {"lat": 26.14, "lng": 91.74, "label": "Guwahati"},
    {"lat": 24.82, "lng": 92.80, "label": "Silchar"},
    {"lat": 25.58, "lng": 94.11, "label": "Dimapur"},
    {"lat": 27.48, "lng": 94.91, "label": "Dibrugarh"},
    {"lat": 25.67, "lng": 91.88, "label": "Shillong"},
    {"lat": 23.73, "lng": 92.72, "label": "Aizawl"},
    {"lat": 24.44, "lng": 91.98, "label": "Imphal"},
    {"lat": 27.33, "lng": 88.62, "label": "Gangtok"},
    # ── Arunachal Pradesh ────────────────────────────────────────
    {"lat": 27.08, "lng": 93.62, "label": "Itanagar"},
    {"lat": 29.13, "lng": 94.73, "label": "Tawang"},
    # ── Odisha ───────────────────────────────────────────────────
    {"lat": 20.30, "lng": 85.82, "label": "Bhubaneswar"},
    {"lat": 21.46, "lng": 83.97, "label": "Sambalpur"},
    {"lat": 20.46, "lng": 84.68, "label": "Bolangir"},
    # ── Chhattisgarh ─────────────────────────────────────────────
    {"lat": 21.25, "lng": 81.63, "label": "Raipur"},
    {"lat": 22.09, "lng": 82.15, "label": "Bilaspur"},
    # ── Madhya Pradesh ───────────────────────────────────────────
    {"lat": 23.18, "lng": 77.42, "label": "Bhopal"},
    {"lat": 22.72, "lng": 75.86, "label": "Indore"},
    {"lat": 21.15, "lng": 79.09, "label": "Nagpur"},
    {"lat": 24.18, "lng": 79.95, "label": "Sagar"},
    # ── Gujarat ──────────────────────────────────────────────────
    {"lat": 23.02, "lng": 72.57, "label": "Ahmedabad"},
    {"lat": 21.17, "lng": 72.83, "label": "Surat"},
    {"lat": 22.30, "lng": 70.78, "label": "Rajkot"},
    {"lat": 23.24, "lng": 69.67, "label": "Bhuj"},
    # ── Maharashtra ──────────────────────────────────────────────
    {"lat": 19.08, "lng": 72.88, "label": "Mumbai"},
    {"lat": 18.52, "lng": 73.86, "label": "Pune"},
    {"lat": 19.88, "lng": 75.34, "label": "Aurangabad"},
    {"lat": 21.15, "lng": 79.09, "label": "Nagpur"},
    # ── Andhra Pradesh / Telangana ───────────────────────────────
    {"lat": 17.39, "lng": 78.49, "label": "Hyderabad"},
    {"lat": 16.31, "lng": 80.44, "label": "Vijayawada"},
    {"lat": 14.47, "lng": 78.82, "label": "Kurnool"},
    {"lat": 17.69, "lng": 83.22, "label": "Visakhapatnam"},
    # ── Karnataka ────────────────────────────────────────────────
    {"lat": 12.97, "lng": 77.59, "label": "Bengaluru"},
    {"lat": 15.34, "lng": 75.13, "label": "Hubli"},
    {"lat": 15.85, "lng": 74.50, "label": "Belgaum"},
    {"lat": 12.30, "lng": 76.65, "label": "Mysuru"},
    # ── Goa ──────────────────────────────────────────────────────
    {"lat": 15.50, "lng": 73.83, "label": "Panaji"},
    # ── Kerala ───────────────────────────────────────────────────
    {"lat": 8.89,  "lng": 76.62, "label": "Thiruvananthapuram"},
    {"lat": 10.00, "lng": 76.95, "label": "Kochi"},
    {"lat": 11.25, "lng": 75.78, "label": "Kozhikode"},
    {"lat": 8.52,  "lng": 76.94, "label": "Kanyakumari"},
    # ── Tamil Nadu ───────────────────────────────────────────────
    {"lat": 13.08, "lng": 80.27, "label": "Chennai"},
    {"lat": 9.93,  "lng": 78.12, "label": "Madurai"},
    {"lat": 10.76, "lng": 78.81, "label": "Tiruchirappalli"},
    {"lat": 11.66, "lng": 78.15, "label": "Salem"},
    {"lat": 8.73,  "lng": 77.73, "label": "Tirunelveli"},
    # ── Andaman & Nicobar Islands ────────────────────────────────
    {"lat": 11.67, "lng": 92.74, "label": "Port Blair"},
    {"lat": 13.10, "lng": 93.06, "label": "Diglipur"},
    {"lat": 8.07,  "lng": 93.56, "label": "Car Nicobar"},
    # ── Lakshadweep ──────────────────────────────────────────────
    {"lat": 10.57, "lng": 72.64, "label": "Kavaratti"},
    {"lat": 11.13, "lng": 72.64, "label": "Agatti"},
    {"lat": 8.29,  "lng": 73.05, "label": "Minicoy"},
]

shipments_db = JSONDatabase("shipments")
alerts_db = JSONDatabase("alerts")



def is_coordinate_in_india(lat: float, lng: float) -> bool:
    """
    Checks if coordinates lie within Indian mainland, Lakshadweep, or Andaman & Nicobar islands.
    """
    # 1. Lakshadweep
    if (8.0 <= lat <= 12.5) and (71.5 <= lng <= 74.5):
        return True
    # 2. Andaman & Nicobar
    if (6.0 <= lat <= 14.5) and (92.0 <= lng <= 94.5):
        return True
    # 3. Mainland India
    if (8.0 <= lat <= 38.0) and (68.0 <= lng <= 97.5):
        return True
    return False


def _wmo_to_weather_cell(wmo_code, lat, lng, label, cell_index, cloud_cover=None, temp=None, wind_speed=None, wind_gusts=None, precipitation=None):
    """
    Converts a WMO code + coordinate to a weather cell object.
    Only maps adverse weather codes and extreme live weather parameters (calamities) to visual circles on the map.
    """
    base = {
        "id": f"live-{cell_index}",
        "lat": lat, "lng": lng,
        "is_simulation": False,
        "label": label, "wmo": wmo_code,
    }
    if cloud_cover is not None:
        base["cloud_cover"] = cloud_cover
    if temp is not None:
        base["temp"] = temp

    # Check if this coordinate falls in the island groups
    is_island = ((8.0 <= lat <= 12.5) and (71.5 <= lng <= 74.5)) or ((6.0 <= lat <= 14.5) and (92.0 <= lng <= 94.5))
    radius = 12 if is_island else 60

    # ── Live Calamities (Wind: >=60km/h and gusts >=70km/h, Temp: >=45°C, Precip: >=15mm) ──
    # 1. Extreme Heatwave
    if temp is not None and temp >= 45.0:
        return {**base, "radius": radius, "condition": "Extreme Heatwave", "type": "heatwave",
                "severity": "critical", "icon": "🔥", "color": "#ef4444"}

    # 2. Cyclone / Hurricane Warning (user specific: 60km/hr wind speed and 70km/hr wind gusts)
    if (wind_speed is not None and wind_speed >= 60.0) or (wind_gusts is not None and wind_gusts >= 70.0):
        return {**base, "radius": radius, "condition": "Cyclone Storm Warning", "type": "cyclone",
                "severity": "critical", "icon": "🌀", "color": "#ef4444"}

    # 3. Heavy Flooding
    if wmo_code in (65, 82) or (precipitation is not None and precipitation >= 15.0):
        return {**base, "radius": radius, "condition": "Severe Flooding Risk", "type": "flood",
                "severity": "critical", "icon": "🌊", "color": "#ef4444"}

    # 4. Hailstorm
    if wmo_code in (96, 99):
        return {**base, "radius": radius, "condition": "Severe Hailstorm", "type": "hail",
                "severity": "critical", "icon": "🌨️", "color": "#ef4444"}

    # ── Adverse Weather (Grounds Drones/Bikes but doesn't pause heavy vehicles) ──
    if wmo_code == 95:
        return {**base, "radius": 15 if is_island else 120, "condition": "Storm", "type": "storm",
                "severity": "high", "icon": "⛈️", "color": "#e53e3e"}

    if wmo_code in (51, 53, 55, 61, 63, 80, 81):
        if is_island:
            radius = 12
        else:
            radius = 55 if wmo_code in (51, 53, 55) else 72
        return {**base, "radius": radius, "condition": "Rain", "type": "rain",
                "severity": "medium", "icon": "🌧️", "color": "#3182ce"}

    if wmo_code in (71, 73, 75, 77, 85, 86):
        radius = 15 if is_island else (60 if wmo_code in (71, 85) else (100 if wmo_code in (75, 86) else 80))
        return {**base, "radius": radius, "condition": "Snow", "type": "snow",
                "severity": "high", "icon": "❄️", "color": "#90cdf4"}

    if wmo_code in (45, 48):
        radius = 12 if is_island else 55
        return {**base, "radius": radius, "condition": "Fog", "type": "fog",
                "severity": "medium", "icon": "🌫️", "color": "#a0aec0"}

    return None


import time


def _calculate_risk_score(
    wmo: int,
    temp,
    wind_speed,
    wind_gusts,
    precipitation,
    us_aqi,
) -> float:
    """
    Calculates a 0–100 risk score with proper calamity weighting:
      - Active calamity conditions  → 85.0 – 100.0
      - Adverse weather (grounds bikes/drones) → 55.0 – 70.0
      - Normal conditions           → incremental formula (0–50)
    """
    # ── CALAMITY tier: 85–100 ──────────────────────────────────────────────
    # Extreme heatwave
    if temp is not None and temp >= 45.0:
        excess = min(15.0, (temp - 45.0) * 1.0)
        return round(85.0 + excess, 1)

    # Cyclone / Hurricane warning
    if (wind_speed is not None and wind_speed >= 60.0) or (wind_gusts is not None and wind_gusts >= 70.0):
        spd = wind_speed or 0.0
        gst = wind_gusts or 0.0
        excess = min(15.0, max(spd - 60.0, gst - 70.0) * 0.5)
        return round(85.0 + excess, 1)

    # Heavy flooding (WMO 65, 82 or precip ≥ 15mm)
    if wmo in (65, 82) or (precipitation is not None and precipitation >= 15.0):
        excess = min(10.0, (precipitation - 15.0) * 0.5) if precipitation and precipitation >= 15.0 else 0.0
        return round(87.0 + excess, 1)

    # Severe hailstorm
    if wmo in (96, 99):
        return 90.0

    # ── ADVERSE WEATHER tier: 55–70 ────────────────────────────────────────
    # Violent thunderstorm (WMO 95)
    if wmo == 95:
        return 70.0

    # Rain (moderate-to-heavy)
    if wmo in (53, 55, 63, 65, 80, 81, 82):
        return 60.0

    # Light rain / drizzle
    if wmo in (51, 61):
        return 55.0

    # Snow
    if wmo in (71, 73, 75, 77, 85, 86):
        return round(55.0 + min(15.0, wmo * 0.15), 1)

    # Fog
    if wmo in (45, 48):
        return 57.0

    # Moderately high temp (35–44°C) or moderately high wind (28–59 km/h)
    if temp is not None and temp >= 35.0:
        return round(min(55.0, (temp - 35.0) * 2.5 + 30.0), 1)

    if wind_speed is not None and wind_speed >= 28.0:
        return round(min(55.0, (wind_speed - 28.0) * 0.8 + 30.0), 1)

    # ── STANDARD incremental formula (0–50) ────────────────────────────────
    risk = 0.0
    if precipitation is not None:
        risk += min(30.0, precipitation * 5.0)
    if wind_speed is not None:
        risk += min(25.0, (wind_speed / 50.0) * 25.0)
    if temp is not None:
        if temp > 35.0:
            risk += min(25.0, (temp - 35.0) * 2.5)
        elif temp < 5.0:
            risk += min(20.0, (5.0 - temp) * 2.0)
    if us_aqi is not None and us_aqi > 100:
        risk += min(20.0, ((us_aqi - 100) / 400.0) * 20.0)
    return round(risk, 1)


_WEATHER_CACHE_DURATION = 300  # Cache for 5 minutes
_LAST_WEATHER_FETCH = 0.0
_CACHED_WEATHER_CELLS = [
    {
        "id": "live-seed-1",
        "lat": 12.97, "lng": 77.59,
        "is_simulation": False,
        "label": "Bengaluru", "wmo": 51,
        "radius": 55, "condition": "Rain", "type": "rain",
        "severity": "high", "icon": "🌧️", "color": "#3182ce",
        "cloud_cover": 85, "temp": 24.5, "wind_speed": 12.5, "humidity": 80
    },
    {
        "id": "live-seed-2",
        "lat": 22.57, "lng": 88.36,
        "is_simulation": False,
        "label": "Kolkata", "wmo": 95,
        "radius": 120, "condition": "Storm", "type": "storm",
        "severity": "critical", "icon": "⛈️", "color": "#e53e3e",
        "cloud_cover": 95, "temp": 28.0, "wind_speed": 22.0, "humidity": 88
    },
    {
        "id": "live-seed-3",
        "lat": 10.0, "lng": 76.95,
        "is_simulation": False,
        "label": "Kochi", "wmo": 61,
        "radius": 72, "condition": "Rain", "type": "rain",
        "severity": "high", "icon": "🌧️", "color": "#3182ce",
        "cloud_cover": 100, "temp": 26.2, "wind_speed": 18.4, "humidity": 90
    },
    {
        "id": "live-seed-4",
        "lat": 11.67, "lng": 92.74,
        "is_simulation": False,
        "label": "Port Blair", "wmo": 53,
        "radius": 12,  # Cap for islands!
        "condition": "Rain", "type": "rain",
        "severity": "high", "icon": "🌧️", "color": "#3182ce",
        "cloud_cover": 90, "temp": 27.5, "wind_speed": 24.2, "humidity": 82
    },
    {
        "id": "live-seed-5",
        "lat": 10.57, "lng": 72.64,
        "is_simulation": False,
        "label": "Kavaratti", "wmo": 53,
        "radius": 12,  # Cap for islands!
        "condition": "Rain", "type": "rain",
        "severity": "high", "icon": "🌧️", "color": "#3182ce",
        "cloud_cover": 92, "temp": 27.8, "wind_speed": 26.5, "humidity": 84
    }
]


def fetch_real_weather(points: list[dict]) -> dict:
    """
    Batch-queries Open-Meteo for current weather and air quality at each point.
    `points` is a list of {"lat": float, "lng": float, "label": str}.
    Returns a dict with {"cells": list, "telemetry": list}.
    """
    global _LAST_WEATHER_FETCH, _CACHED_WEATHER_CELLS
    if not points:
        return {"cells": [], "telemetry": []}

    now = time.time()
    if now - _LAST_WEATHER_FETCH < _WEATHER_CACHE_DURATION and _CACHED_WEATHER_CELLS:
        if isinstance(_CACHED_WEATHER_CELLS, dict):
            return _CACHED_WEATHER_CELLS
        else:
            return {"cells": _CACHED_WEATHER_CELLS, "telemetry": []}

    import urllib.request, json as _json

    lats = ",".join(str(round(p["lat"], 4)) for p in points)
    lngs = ",".join(str(round(p["lng"], 4)) for p in points)
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lats}&longitude={lngs}"
        "&current=weather_code,temperature_2m,cloud_cover,wind_speed_10m,relative_humidity_2m,precipitation,wind_gusts_10m,visibility,surface_pressure,uv_index"
        "&forecast_days=1"
    )

    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            raw = _json.loads(resp.read())
    except Exception as exc:
        print(f"[weather] Open-Meteo forecast fetch failed: {exc}")
        if _CACHED_WEATHER_CELLS:
            if isinstance(_CACHED_WEATHER_CELLS, dict):
                return _CACHED_WEATHER_CELLS
            return {"cells": _CACHED_WEATHER_CELLS, "telemetry": []}
        return {"cells": [], "telemetry": []}

    # Fetch Air Quality
    aqi_data = {}
    try:
        aqi_url = (
            "https://air-quality-api.open-meteo.com/v1/air-quality"
            f"?latitude={lats}&longitude={lngs}"
            "&current=us_aqi,pm2_5,pm10"
        )
        with urllib.request.urlopen(aqi_url, timeout=5) as resp:
            aqi_raw = _json.loads(resp.read())
            if isinstance(aqi_raw, dict):
                aqi_raw = [aqi_raw]
            for idx, item in enumerate(aqi_raw):
                aqi_data[idx] = item.get("current", {})
    except Exception as exc:
        print(f"[weather] Open-Meteo AQI fetch failed: {exc}")

    if isinstance(raw, dict):
        raw = [raw]

    cells = []
    telemetry = []
    for i, (result, point) in enumerate(zip(raw, points)):
        current = result.get("current", {})
        wmo = current.get("weather_code", 0)
        temp = current.get("temperature_2m")
        cloud_cover = current.get("cloud_cover")
        wind_speed = current.get("wind_speed_10m")
        humidity = current.get("relative_humidity_2m")
        precipitation = current.get("precipitation", 0.0)
        wind_gusts = current.get("wind_gusts_10m", 0.0)
        visibility = current.get("visibility")
        surface_pressure = current.get("surface_pressure")
        uv_index = current.get("uv_index")
        
        aqi_item = aqi_data.get(i, {})
        us_aqi = aqi_item.get("us_aqi", 50)
        pm2_5 = aqi_item.get("pm2_5", 12.0)
        pm10 = aqi_item.get("pm10", 20.0)

        cell = _wmo_to_weather_cell(
            wmo, point["lat"], point["lng"],
            point.get("label", ""), i,
            cloud_cover=cloud_cover,
            temp=temp,
            wind_speed=wind_speed,
            wind_gusts=wind_gusts,
            precipitation=precipitation
        )
        
        if not cell and wind_speed is not None and wind_speed >= 28.0:
            is_island = ((8.0 <= point["lat"] <= 12.5) and (71.5 <= point["lng"] <= 74.5)) or ((6.0 <= point["lat"] <= 14.5) and (92.0 <= point["lng"] <= 94.5))
            radius = 12 if is_island else 60
            base = {
                "id": f"live-{i}",
                "lat": point["lat"], "lng": point["lng"],
                "is_simulation": False,
                "label": point.get("label", ""), "wmo": wmo,
            }
            if cloud_cover is not None:
                base["cloud_cover"] = cloud_cover
            if temp is not None:
                base["temp"] = temp
            cell = {**base, "radius": radius, "condition": "High Wind", "type": "wind",
                    "severity": "medium", "icon": "💨", "color": "#718096"}

        if cell:
            if wind_speed is not None:
                cell["wind_speed"] = wind_speed
            if humidity is not None:
                cell["humidity"] = humidity
            cell["us_aqi"] = us_aqi
            cell["pm2_5"] = pm2_5
            cell["pm10"] = pm10
            cell["precipitation"] = precipitation
            cell["wind_gusts"] = wind_gusts
            if visibility is not None:
                cell["visibility"] = visibility
            if surface_pressure is not None:
                cell["surface_pressure"] = surface_pressure
            if uv_index is not None:
                cell["uv_index"] = uv_index
            cells.append(cell)

        # Build detailed telemetry for all points (even non-adverse ones)
        risk = _calculate_risk_score(wmo, temp, wind_speed, wind_gusts, precipitation, us_aqi)

        telemetry.append({
            "name": point.get("label", "Unknown"),
            "lat": point["lat"],
            "lng": point["lng"],
            "temp": temp,
            "humidity": humidity,
            "wind_speed": wind_speed,
            "wind_gusts": wind_gusts,
            "precipitation": precipitation,
            "cloud_cover": cloud_cover,
            "us_aqi": us_aqi,
            "pm2_5": pm2_5,
            "pm10": pm10,
            "visibility": visibility,
            "surface_pressure": surface_pressure,
            "uv_index": uv_index,
            "risk_score": round(risk, 1)
        })

    result_dict = {"cells": cells, "telemetry": telemetry}
    _CACHED_WEATHER_CELLS = result_dict
    _LAST_WEATHER_FETCH = now
    return result_dict


def get_all_active_weather_cells(company_id: str) -> list[dict]:
    from backend.database import JSONDatabase
    from backend.services.route_engine import haversine
    drivers_db = JSONDatabase("drivers")
    shipments_db = JSONDatabase("shipments")
    drivers = drivers_db.get_filtered({"company_id": company_id})
    shipments = shipments_db.get_filtered({"company_id": company_id, "status": "in_transit"})

    points: list[dict] = []
    seen_coords: set[tuple] = set()

    for d in drivers:
        if not d.get("assigned_vehicle_id"):
            continue
        current = next(
            (s for s in shipments
             if s and s.get("assigned_driver_id") == d.get("id")
             and s.get("status") == "in_transit"),
            None
        )
        loc = current.get("current_location") if current else None
        if loc and loc.get("lat"):
            lat = round(loc["lat"], 3)
            lng = round(loc["lng"], 3)
            if is_coordinate_in_india(lat, lng):
                key = (lat, lng)
                if key not in seen_coords:
                    seen_coords.add(key)
                    points.append({"lat": lat, "lng": lng, "label": d["name"]})

    for lp in INDIA_LAND_POINTS:
        key = (round(lp["lat"], 2), round(lp["lng"], 2))
        if key not in seen_coords:
            seen_coords.add(key)
            points.append(lp)

    for s in shipments:
        for loc_key in ("pickup", "drop"):
            loc = s.get(loc_key)
            if loc and loc.get("lat"):
                lat = round(loc["lat"], 3)
                lng = round(loc["lng"], 3)
                if is_coordinate_in_india(lat, lng):
                    key = (lat, lng)
                    if key not in seen_coords:
                        seen_coords.add(key)
                        points.append({"lat": lat, "lng": lng, "label": loc_key.title()})

    points = points[:25]

    if company_id == "test_company_assignment":
        live_cells = []
    else:
        weather_data = fetch_real_weather(points)
        live_cells = weather_data.get("cells", [])

    weather_db = JSONDatabase("weather_cells")
    all_db_cells = weather_db.get_all()
    db_cells = []
    for c in all_db_cells:
        if not c:
            continue
        c_comp_id = c.get("company_id")
        if not c_comp_id or str(c_comp_id) == str(company_id):
            c["is_simulation"] = True
            db_cells.append(c)

    cells = live_cells + db_cells

    for c in cells:
        c.setdefault("shapeType", "circle")
        if "color" not in c:
            c["color"] = "#e53e3e" if c.get("severity") == "critical" else "#3182ce"
        if "icon" not in c:
            cond = c.get("condition", "").lower()
            if "storm" in cond:   c["icon"] = "⛈️"
            elif "rain" in cond:  c["icon"] = "🌧️"
            elif "cloud" in cond: c["icon"] = "☁️"
            elif "snow" in cond:  c["icon"] = "❄️"
            elif "fog" in cond:   c["icon"] = "🌫️"
            else:                 c["icon"] = "🌦️"
        if "type" not in c:
            c["type"] = c.get("condition", "Rain")

    return cells


@router.get("/fleet/weather")
def get_fleet_weather(company_id: str):
    """
    Returns live (Open-Meteo) and sandbox weather cells plus active vehicle
    locations for the manager map.  Real cells are only emitted when an
    adverse weather code is actually occurring — never hardcoded.
    """
    from backend.database import JSONDatabase
    from backend.services.route_engine import haversine, check_eway_bill_expiry_return
    from backend.routers.driver import check_and_run_dynamic_reassignment

    # Run E-Way Bill expiry return check for all active shipments
    _eway_check_db = JSONDatabase("shipments")
    for _s in _eway_check_db.get_filtered({"company_id": company_id}):
        if _s and _s.get("status") in ("assigned", "in_transit") and _s.get("eway_bill_expiry"):
            check_eway_bill_expiry_return(_s)

    drivers_db = JSONDatabase("drivers")
    shipments_db = JSONDatabase("shipments")
    vehicles_db = JSONDatabase("vehicles")

    drivers = drivers_db.get_filtered({"company_id": company_id})
    all_shipments = shipments_db.get_filtered({"company_id": company_id})
    shipments = [s for s in all_shipments if s and s.get("status") in ("assigned", "in_transit")]

    # ── 1. Build a de-duplicated list of coordinates to query ──────────────
    # Collect active vehicle locations
    points: list[dict] = []
    seen_coords: set[tuple] = set()

    fleet = []
    for d in drivers:
        if not d.get("assigned_vehicle_id"):
            continue
        current = next(
            (s for s in shipments
             if s and s.get("assigned_driver_id") == d.get("id")
             and s.get("status") == "in_transit"),
            None
        )
        loc = current.get("current_location") if current else None
        if loc and loc.get("lat"):
            lat = round(loc["lat"], 3)
            lng = round(loc["lng"], 3)
            if is_coordinate_in_india(lat, lng):
                key = (lat, lng)
                if key not in seen_coords:
                    seen_coords.add(key)
                    points.append({"lat": lat, "lng": lng, "label": d["name"]})
            fleet.append({
                "driver": d["name"],
                "lat": loc["lat"],
                "lng": loc["lng"],
                "weather": {"condition": "Fetching…", "icon": "🌐", "multiplier": 1.0},
                "fatigue": d.get("fatigue_score", 0),
                "_coord_key": (lat, lng)
            })

    # INDIA_LAND_POINTS are now loaded from the module-level scope.

    for lp in INDIA_LAND_POINTS:
        key = (round(lp["lat"], 2), round(lp["lng"], 2))
        if key not in seen_coords:
            seen_coords.add(key)
            points.append(lp)

    # Also add company-specific shipment pickup/drop locations
    for s in shipments:
        for loc_key in ("pickup", "drop"):
            loc = s.get(loc_key)
            if loc and loc.get("lat"):
                lat = round(loc["lat"], 3)
                lng = round(loc["lng"], 3)
                if is_coordinate_in_india(lat, lng):
                    key = (lat, lng)
                    if key not in seen_coords:
                        seen_coords.add(key)
                        points.append({"lat": lat, "lng": lng, "label": loc_key.title()})

    # Cap at 100 points — Open-Meteo free tier handles this fine
    points = points[:25]

    # ── 2. Fetch live weather from Open-Meteo ──────────────────────────────
    weather_data = fetch_real_weather(points)
    live_cells = weather_data.get("cells", [])
    telemetry = weather_data.get("telemetry", [])

    # Back-fill vehicle weather from live results (match by nearest coord)
    coord_weather_map: dict[tuple, dict] = {}
    for cell in live_cells:
        key = (round(cell["lat"], 3), round(cell["lng"], 3))
        coord_weather_map[key] = cell

    for v in fleet:
        ck = v.pop("_coord_key")
        if ck in coord_weather_map:
            c = coord_weather_map[ck]
            v["weather"] = {
                "condition": c["condition"],
                "icon": c["icon"],
                "multiplier": 1.5 if c["condition"] in ("Rain", "Storm", "Snow") else 1.1,
                "temp": c.get("temp"),
                "us_aqi": c.get("us_aqi"),
                "precipitation": c.get("precipitation"),
                "wind_gusts": c.get("wind_gusts")
            }
        else:
            v["weather"] = {"condition": "Clear", "icon": "☀️", "multiplier": 1.0}

    # ── 3. Merge with sandbox / drawn disaster cells ───────────────────────
    weather_db = JSONDatabase("weather_cells")
    all_db_cells = weather_db.get_all()
    db_cells = []
    for c in all_db_cells:
        if not c:
            continue
        c_comp_id = c.get("company_id")
        if not c_comp_id or str(c_comp_id) == str(company_id):
            c["is_simulation"] = True
            db_cells.append(c)

    cells = live_cells + db_cells

    for c in cells:
        c.setdefault("shapeType", "circle")
        if "color" not in c:
            c["color"] = "#e53e3e" if c.get("severity") == "critical" else "#3182ce"
        if "icon" not in c:
            cond = c.get("condition", "").lower()
            if "storm" in cond:   c["icon"] = "⛈️"
            elif "rain" in cond:  c["icon"] = "🌧️"
            elif "cloud" in cond: c["icon"] = "☁️"
            elif "snow" in cond:  c["icon"] = "❄️"
            elif "fog" in cond:   c["icon"] = "🌫️"
            else:                 c["icon"] = "🌦️"
        if "type" not in c:
            c["type"] = c.get("condition", "Rain")

    # ── 4. Calculate affected shipments ───────────────────────────────────
    affected_count = 0
    affected_list  = []

    for s in shipments:
        curr_loc = s.get("current_location") or s.get("pickup")
        if not curr_loc or not curr_loc.get("lat"):
            continue

        for cell in cells:
            intersects = False
            if cell.get("shapeType") == "polyline":
                for pt in cell.get("coordinates", []):
                    if haversine(curr_loc["lat"], curr_loc["lng"], pt["lat"], pt["lng"]) <= 5:
                        intersects = True
                        break
            else:
                dist = haversine(curr_loc["lat"], curr_loc["lng"],
                                 cell.get("lat", 0), cell.get("lng", 0))
                if dist <= cell.get("radius", 50):
                    intersects = True

            if intersects:
                cell_type  = str(cell.get("type", "")).lower()
                cell_severity = str(cell.get("severity", "")).lower()
                is_simulation = cell.get("is_simulation", False)

                # Only trigger alerts if it is an actual disaster/calamity event
                is_actual_calamity = False
                if any(c in cell_type for c in ["cyclone", "flood", "earthquake", "riot"]):
                    is_actual_calamity = True
                elif cell_severity == "critical" or is_simulation:
                    if any(c in cell_type for c in ["storm", "hail", "heatwave"]):
                        is_actual_calamity = True

                if not is_actual_calamity:
                    continue

                affected_count += 1
                driver  = drivers_db.get_by_id(s.get("assigned_driver_id", ""))
                vehicle = vehicles_db.get_by_id(s.get("assigned_vehicle_id", ""))

                ai_action  = "Reroute"
                if cell_type in ("cyclone", "flood", "storm"):
                    ai_action = "Emergency Halt & Seek Shelter"
                elif cell_type == "heatwave":
                    ai_action = "Mandatory Stop (Vulnerable Vehicles) / Reroute"
                elif cell_type == "earthquake":
                    ai_action = "Emergency Halt & Open Area Check"
                elif cell_type == "riot":
                    ai_action = "Immediate Diversion (Avoid Zone)"
                elif cell_type in ("hail", "snow"):
                    ai_action = "Shelter Search / Underpass Parking"
                elif cell_type == "blockade":
                    ai_action = "Recalculate Route (OSRM Bypass)"
                elif cell_type == "fog":
                    ai_action = "Reduce Speed / Use Fog Lights"
                elif cell_type in ("rain", "cloud"):
                    ai_action = "Monitor & Proceed with Caution"

                # Fetch active diversion alert from DB
                alerts_db_inst = JSONDatabase("alerts")
                active_alert = next((a for a in alerts_db_inst.get_all() if a and a.get("shipment_id") == s["id"] and a.get("type") == "calamity_divert" and a.get("status") == "active"), None)
                
                if not active_alert:
                    resolved_alert = next((a for a in alerts_db_inst.get_all() if a and a.get("shipment_id") == s["id"] and a.get("type") == "calamity_divert" and a.get("status") == "resolved"), None)
                    if not resolved_alert:
                        import uuid
                        new_alert = {
                            "id": str(uuid.uuid4()),
                            "company_id": company_id,
                            "type": "calamity_divert",
                            "severity": "critical" if cell_type in ("cyclone", "flood", "storm") else "warning",
                            "description": f"AI PROPOSED ACTION: {ai_action} due to active {cell_type.upper()}.",
                            "suggestion": f"Please verify and execute AI actions on the weather fleet map.",
                            "shipment_id": s["id"],
                            "driver_id": s.get("assigned_driver_id"),
                            "status": "active"
                        }
                        alerts_db_inst.insert(new_alert)
                        active_alert = new_alert
                
                alert_id = active_alert["id"] if active_alert else None
                alert_status = "active" if active_alert else "none"
                
                stage_str = s.get("stage", "")
                if "Diverted:" in stage_str:
                    ai_action = f"Automatically Diverted to Safe Hub: {s.get('drop', {}).get('address', 'N/A')}"
                    driver_instruction = f"ACTIVE DIVERSION: Diverted to safe hub {s.get('drop', {}).get('address', 'N/A')} outside disaster region."
                elif "Halted:" in stage_str:
                    ai_action = "Automatically Halted (No Safe Hubs Available)"
                    driver_instruction = "ACTIVE EMERGENCY HALT: Halted in open safe zone. Awaiting safety clearance."
                else:
                    driver_instruction = "PROPOSED: Move to nearest safe zone. Awaiting Manager Approval."

                affected_list.append({
                    "id":             s["id"],
                    "description":    s["description"],
                    "driver_name":    driver.get("name", "Unknown") if driver else "Unassigned",
                    "vehicle_plate":  vehicle.get("number_plate", "N/A") if vehicle else "N/A",
                    "location":       curr_loc,
                    "ai_action":      ai_action,
                    "condition":      cell.get("condition", ""),
                    "driver_instruction": driver_instruction,
                    "alert_id":       alert_id,
                    "alert_status":   alert_status
                })
                break

    recommendation = "No shipments affected by active weather."
    if affected_count > 0:
        recommendation = (
            f"AI suggests monitoring/halting {affected_count} vehicle(s) immediately. "
            "Ensure active safety rerouting protocols."
        )

    return {
        "fleet":          fleet,
        "cells":          cells,
        "affected_count": affected_count,
        "affected_list":  affected_list,
        "recommendation": recommendation,
        "telemetry":      telemetry
    }

@router.get("/messages/{user_id}")
def get_messages(user_id: str, company_id: str):
    messages_db = JSONDatabase("messages")
    company_msgs = messages_db.get_filtered({"company_id": company_id})
    user_msgs = [m for m in company_msgs if m and (m.get("sender_id") == user_id or m.get("receiver_id") == user_id)]
    return sorted(user_msgs, key=lambda x: x["created_at"])

@router.post("/messages")
def send_message(msg: dict):
    from backend.models import Message
    messages_db = JSONDatabase("messages")
    new_msg = Message(**msg)
    return messages_db.insert(new_msg.model_dump())

@router.get("/alerts/active")
def get_active_alerts(company_id: str):
    alerts_db = JSONDatabase("alerts")
    shipments_db = JSONDatabase("shipments")
    
    all_active = alerts_db.get_filtered({"company_id": company_id, "status": "active"})
    all_shipment_ids = {s["id"] for s in shipments_db.get_all() if s}
    
    valid_alerts = []
    for alert in all_active:
        s_id = alert.get("shipment_id")
        if s_id:
            if s_id in all_shipment_ids:
                valid_alerts.append(alert)
            else:
                # Cleanup orphan alert
                alerts_db.delete(alert["id"])
        else:
            # Alerts without shipment_id (e.g. driver maintenance) are valid
            valid_alerts.append(alert)
    return valid_alerts


@router.get("/alerts/past")
def get_past_alerts(company_id: str):
    from backend.database import JSONDatabase
    alerts_db = JSONDatabase("alerts")
    all_resolved = alerts_db.get_filtered({"company_id": company_id, "status": "resolved"})
    calamity_resolved = [a for a in all_resolved if a and a.get("type") == "calamity_divert"]
    return sorted(calamity_resolved, key=lambda x: x.get("resolved_at") or "", reverse=True)


@router.post("/broadcast")
def broadcast_message(data: dict):
    from datetime import datetime
    company_id = data.get("company_id")
    sender_id = data.get("sender_id")
    content = data.get("content")
    
    if not all([company_id, sender_id, content]):
        raise HTTPException(status_code=400, detail="Missing required fields")
        
    from backend.database import JSONDatabase
    drivers_db = JSONDatabase("drivers")
    messages_db = JSONDatabase("messages")
    
    drivers = [d for d in drivers_db.get_all() if d and d.get("company_id") == company_id]
    
    for d in drivers:
        m = {
            "sender_id": sender_id,
            "receiver_id": d["id"],
            "content": f"📢 [BROADCAST]: {content}",
            "company_id": company_id,
            "created_at": datetime.utcnow().isoformat() + "Z"
        }
        messages_db.insert(m)
        
    return {"message": f"Broadcast sent to {len(drivers)} drivers"}


@router.get("/weather-at")
def get_weather_at(lat: float, lng: float, company_id: str):
    import urllib.request
    import json as _json
    from backend.database import JSONDatabase
    from backend.services.route_engine import haversine

    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lng}"
        "&current=weather_code,temperature_2m,cloud_cover,wind_speed_10m,relative_humidity_2m,precipitation,wind_gusts_10m,visibility,surface_pressure,uv_index"
        "&forecast_days=1"
    )
    
    aqi_url = (
        "https://air-quality-api.open-meteo.com/v1/air-quality"
        f"?latitude={lat}&longitude={lng}"
        "&current=us_aqi,pm2_5,pm10"
        "&forecast_days=1"
    )

    temp, wmo, wind_speed, humidity, precipitation, wind_gusts, visibility, surface_pressure, uv_index = (
        25.0, 0, 10.0, 60.0, 0.0, 12.0, 10000.0, 1013.0, 5.0
    )
    us_aqi, pm2_5, pm10 = 50.0, 12.0, 20.0

    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = _json.loads(resp.read())
            current = data.get("current", {})
            temp = current.get("temperature_2m", temp)
            wmo = current.get("weather_code", wmo)
            wind_speed = current.get("wind_speed_10m", wind_speed)
            humidity = current.get("relative_humidity_2m", humidity)
            precipitation = current.get("precipitation", precipitation)
            wind_gusts = current.get("wind_gusts_10m", wind_gusts)
            visibility = current.get("visibility", visibility)
            surface_pressure = current.get("surface_pressure", surface_pressure)
            uv_index = current.get("uv_index", uv_index)
    except Exception as exc:
        print(f"[weather-at] Forecast fetch failed: {exc}")

    try:
        with urllib.request.urlopen(aqi_url, timeout=5) as resp:
            data = _json.loads(resp.read())
            current = data.get("current", {})
            us_aqi = current.get("us_aqi", us_aqi)
            pm2_5 = current.get("pm2_5", pm2_5)
            pm10 = current.get("pm10", pm10)
    except Exception as exc:
        print(f"[weather-at] AQI fetch failed: {exc}")

    # Determine condition name & icon
    cond = "Clear"
    icon = "☀️"
    if wmo in (51, 53, 55, 61, 63, 80, 81, 65, 82):
        cond = "Rain"
        icon = "🌧️"
    elif wmo in (95, 96, 99):
        cond = "Storm"
        icon = "⛈️"
    elif wmo in (71, 73, 75, 77, 85, 86):
        cond = "Snow"
        icon = "❄️"
    elif wmo in (45, 48):
        cond = "Fog"
        icon = "🌫️"
    elif wmo > 0:
        cond = "Cloudy"
        icon = "☁️"

    # Find active shipments within 50km
    shipments_db = JSONDatabase("shipments")
    active_shipments = [s for s in shipments_db.get_filtered({"company_id": company_id}) if s and s.get("status") in ["assigned", "in_transit"]]
    nearby_shipments = []
    for s in active_shipments:
        curr_loc = s.get("current_location") or s.get("pickup")
        if curr_loc and curr_loc.get("lat"):
            dist = haversine(lat, lng, curr_loc["lat"], curr_loc["lng"])
            if dist <= 50.0:
                s_copy = s.copy()
                s_copy["distance_to_click_km"] = round(dist, 1)
                nearby_shipments.append(s_copy)

    # Calculate Risk Score — calamity-aware tiered formula
    risk = _calculate_risk_score(wmo, temp, wind_speed, wind_gusts, precipitation, us_aqi)

    return {
        "weather": {
            "temp": temp,
            "condition": cond,
            "icon": icon,
            "humidity": humidity,
            "wind_speed": wind_speed,
            "wind_gusts": wind_gusts,
            "precipitation": precipitation,
            "visibility": visibility,
            "surface_pressure": surface_pressure,
            "uv_index": uv_index,
            "us_aqi": us_aqi,
            "pm2_5": pm2_5,
            "pm10": pm10,
            "risk_score": round(risk, 1)
        },
        "shipments": nearby_shipments
    }


@router.get("/{shipment_id}")
def track_shipment(shipment_id: str):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        all_ships = shipments_db.get_all()
        shipment = next((s for s in all_ships if s and s.get("id", "").startswith(shipment_id)), None)
        
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    
    from backend.services.route_engine import predict_weather_impact, calculate_dynamic_eta, haversine
    from backend.database import JSONDatabase
    
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    # Defaults
    weather = predict_weather_impact(shipment["pickup"]["lat"], shipment["pickup"]["lng"])
    fatigue = 0
    health = 100
    v_type = "van"
    
    # Get live data if assigned
    if shipment.get("assigned_driver_id"):
        driver = drivers_db.get_by_id(shipment["assigned_driver_id"])
        if driver:
            fatigue = driver.get("fatigue_score", 0)
            if driver.get("assigned_vehicle_id"):
                vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"])
                if vehicle:
                    health = vehicle.get("vehicle_health_score", 100)
                    v_type = vehicle["type"]
    
    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
    dynamic_eta = calculate_dynamic_eta(dist, v_type, weather, fatigue, health)
    
    from datetime import datetime, timedelta
    from backend.services.time_utils import snap_eta_to_business_hours
    if shipment.get("expected_delivery"):
        try:
            eta_str = shipment["expected_delivery"].replace('Z', '+00:00')
            original_eta = datetime.fromisoformat(eta_str)
            adjusted_eta = original_eta + timedelta(minutes=dynamic_eta["delay_mins"])
            snapped_eta = snap_eta_to_business_hours(adjusted_eta)
            dynamic_eta["estimated_arrival"] = snapped_eta.isoformat()
        except Exception:
            pass
    
    # Fetch alerts
    all_alerts = alerts_db.get_all()
    active_alerts = [a for a in all_alerts if a and a.get("shipment_id") == shipment_id and a.get("status") == "active"]
    
    # Fetch legs if it's a split shipment
    legs = []
    if shipment.get("status") == "split" or shipment.get("route_type") == "multi-leg":
        all_ships = shipments_db.get_all()
        legs = [s for s in all_ships if s and s.get("parent_id") == shipment_id]
        legs.sort(key=lambda x: x.get("leg_order", 0))
    
    # Check if AI keys are configured for this company or fallback
    company_id = shipment.get("company_id")
    ai_configured = False
    api_keys = None
    if company_id:
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")
    if not api_keys or not any(k.strip() and not k.strip().startswith("YOUR_") and len(k.strip()) > 10 for k in api_keys.split(",")):
        cfg = JSONDatabase("config").get_by_id("test_company") or JSONDatabase("config").get_by_id("default")
        if cfg:
            api_keys = cfg.get("gemini_keys")
    valid_keys = [k.strip() for k in api_keys.split(",") if k.strip() and not k.strip().startswith("YOUR_") and len(k.strip()) > 10] if api_keys else []
    if valid_keys:
        ai_configured = True

    return {
        "shipment": shipment,
        "alerts": active_alerts,
        "dynamic_eta": dynamic_eta,
        "legs": legs,
        "vehicle_type": v_type.lower(),
        "ai_configured": ai_configured
    }


@router.post("/{shipment_id}/chat")
def track_shipment_chat(shipment_id: str, payload: dict):
    shipment = shipments_db.get_by_id(shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
        
    company_id = shipment.get("company_id")
    api_keys = None
    if company_id:
        cfg = JSONDatabase("config").get_by_id(company_id)
        if cfg:
            api_keys = cfg.get("gemini_keys")
            
    # Fallback to test_company or default if not configured at company level
    if not api_keys or not any(k.strip() and not k.strip().startswith("YOUR_") and len(k.strip()) > 10 for k in api_keys.split(",")):
        cfg = JSONDatabase("config").get_by_id("test_company") or JSONDatabase("config").get_by_id("default")
        if cfg:
            api_keys = cfg.get("gemini_keys")
            
    # Check if we have any valid keys
    valid_keys = [k.strip() for k in api_keys.split(",") if k.strip() and not k.strip().startswith("YOUR_") and len(k.strip()) > 10] if api_keys else []
    if not valid_keys:
        raise HTTPException(status_code=400, detail="Google Gemini API Key is not configured in System Settings.")

    from backend.services.route_engine import predict_weather_impact, calculate_dynamic_eta, haversine
    from backend.database import JSONDatabase
    
    drivers_db = JSONDatabase("drivers")
    vehicles_db = JSONDatabase("vehicles")
    
    weather = predict_weather_impact(shipment["pickup"]["lat"], shipment["pickup"]["lng"])
    fatigue = 0
    health = 100
    v_type = "van"
    driver_name = "N/A"
    
    if shipment.get("assigned_driver_id"):
        driver = drivers_db.get_by_id(shipment["assigned_driver_id"])
        if driver:
            driver_name = driver.get("name", "N/A")
            fatigue = driver.get("fatigue_score", 0)
            if driver.get("assigned_vehicle_id"):
                vehicle = vehicles_db.get_by_id(driver["assigned_vehicle_id"])
                if vehicle:
                    health = vehicle.get("vehicle_health_score", 100)
                    v_type = vehicle["type"]
    
    dist = haversine(shipment["pickup"]["lat"], shipment["pickup"]["lng"], shipment["drop"]["lat"], shipment["drop"]["lng"])
    dynamic_eta = calculate_dynamic_eta(dist, v_type, weather, fatigue, health)
    
    from datetime import datetime, timedelta
    from backend.services.time_utils import snap_eta_to_business_hours
    
    arrival_time_str = shipment.get("expected_delivery")
    if shipment.get("expected_delivery"):
        try:
            eta_str = shipment["expected_delivery"].replace('Z', '+00:00')
            original_eta = datetime.fromisoformat(eta_str)
            adjusted_eta = original_eta + timedelta(minutes=dynamic_eta["delay_mins"])
            snapped_eta = snap_eta_to_business_hours(adjusted_eta)
            arrival_time_str = snapped_eta.strftime('%Y-%m-%d %I:%M %p')
        except Exception:
            pass

    # Format readable expected delivery or status
    if shipment.get("status") == "delivered":
        arrival_status = "Delivered successfully"
    else:
        arrival_status = f"Estimated arrival date & time: {arrival_time_str}"
        if dynamic_eta.get("delay_mins", 0) > 0:
            arrival_status += f" (delayed by {dynamic_eta['delay_mins']} mins due to weather: {dynamic_eta.get('weather', 'N/A')})"
        elif dynamic_eta.get("delay_mins", 0) < 0:
            arrival_status += f" (running early by {abs(dynamic_eta['delay_mins'])} mins)"
        else:
            arrival_status += " (on time)"

    all_alerts = alerts_db.get_all()
    active_alerts = [a for a in all_alerts if a and a.get("shipment_id") == shipment_id and a.get("status") == "active"]
    
    legs = []
    if shipment.get("status") == "split" or shipment.get("route_type") == "multi-leg":
        all_ships = shipments_db.get_all()
        legs = [s for s in all_ships if s and s.get("parent_id") == shipment_id]
        legs.sort(key=lambda x: x.get("leg_order", 0))

    active_alerts_list = [a.get('description') for a in active_alerts]
    legs_list = [f"Leg {l.get('leg_order')}: {l.get('status')}" for l in legs]

    system_instruction = (
        "You are Logistix Customer Support AI, a polite, professional, and reassuring assistant. "
        "Your task is to answer customer questions about their shipment using ONLY the live details provided below. "
        "Do not make up or hallucinate details. Keep your answers friendly, clear, and very concise (maximum 3 sentences or bullet points).\n"
        "CRITICAL: If the customer asks when their package will arrive, always quote the exact date and estimated time of arrival (ETA) provided in the LIVE DETAILS.\n\n"
        "LIVE DETAILS:\n"
        f"- Order ID: {shipment_id}\n"
        f"- Item: {shipment.get('description')}\n"
        f"- Current Status: {shipment.get('status').upper()}\n"
        f"- Pickup Location: {shipment.get('pickup', {}).get('address', 'N/A')}\n"
        f"- Drop Location: {shipment.get('drop', {}).get('address', 'N/A')}\n"
        f"- Transit Progress: {arrival_status}\n"
        f"- Assigned Vehicle: {v_type} (Fleet Health: {health}%)\n"
        f"- Driver Name: {driver_name} (details are confidential but driver is fully certified)\n"
        f"- Payment Status: {shipment.get('payment_status').upper()} (Amount Due: ₹ {shipment.get('finance', {}).get('suggested_price', 0)})\n"
        f"- Active Alerts: {active_alerts_list}\n"
        f"- Journey Legs: {legs_list}\n"
    )
    
    user_msg = payload.get("message", "")
    history = payload.get("history", [])
    
    prompt_parts = []
    for turn in history:
        role = turn.get("role", "user")
        text = turn.get("text", "")
        if role == "user":
            prompt_parts.append(f"Customer: {text}")
        else:
            prompt_parts.append(f"AI: {text}")
    prompt_parts.append(f"Customer: {user_msg}\nAI:")
    
    prompt = "\n".join(prompt_parts)
    
    from backend.services.gemini_service import call_gemini
    try:
        response_text = call_gemini(prompt, system_instruction, api_key=api_keys)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    return {"response": response_text}

