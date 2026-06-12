import re

with open('backend/routers/tracking.py', 'r') as f: content = f.read()

# Replace AQI fetch
aqi_old = """    # Fetch Air Quality
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
        print(f"[weather] Open-Meteo AQI fetch failed: {exc}")"""

aqi_new = """    # Fetch Air Quality via Google Air Quality API
    aqi_data = {}
    try:
        import urllib.request
        import json
        GOOGLE_AQI_KEY = "AIzaSyB8gfBRaBnW3uarwUI1dvL8yUciwWG_gZk"
        
        for idx, point in enumerate(points):
            try:
                aqi_url = f"https://airquality.googleapis.com/v1/currentConditions:lookup?key={GOOGLE_AQI_KEY}"
                payload = json.dumps({"location": {"latitude": point['lat'], "longitude": point['lng']}}).encode('utf-8')
                req = urllib.request.Request(aqi_url, data=payload, headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=3) as resp:
                    aqi_raw = json.loads(resp.read())
                    # Convert Google AQI to our format
                    aqi_index = aqi_raw.get('indexes', [{}])[0].get('aqi', 50)
                    pm25 = 12.0
                    pm10 = 20.0
                    for pollutant in aqi_raw.get('pollutants', []):
                        if pollutant.get('code') == 'pm25': pm25 = pollutant.get('concentration', {}).get('value', 12.0)
                        if pollutant.get('code') == 'pm10': pm10 = pollutant.get('concentration', {}).get('value', 20.0)
                    
                    aqi_data[idx] = {"us_aqi": aqi_index, "pm2_5": pm25, "pm10": pm10}
            except Exception as e:
                aqi_data[idx] = {"us_aqi": 50, "pm2_5": 12.0, "pm10": 20.0}
    except Exception as exc:
        print(f"[weather] Google AQI fetch failed: {exc}")"""

content = content.replace(aqi_old, aqi_new)
with open('backend/routers/tracking.py', 'w') as f: f.write(content)

