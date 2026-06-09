from backend.services.gemini_service import call_gemini
import json

prompt = """You are a fuel price aggregator. Output ONLY a valid JSON string (without markdown backticks, notes, or other text) containing the current actual/approximate petrol and diesel prices in INR per liter for the following Indian states: Delhi, Haryana, Uttar Pradesh, Maharashtra, Karnataka, Tamil Nadu, West Bengal, Rajasthan, Gujarat.
Structure must be exactly:
{
  "Delhi": {"petrol": 94.72, "diesel": 87.62},
  "Maharashtra": {"petrol": 104.21, "diesel": 92.15},
  ...
}
"""

res = call_gemini(prompt)
print("Response text:")
print(res)
try:
    # clean JSON block if any markdown formatting exists
    clean_res = res.strip()
    if clean_res.startswith("```json"):
        clean_res = clean_res[7:]
    if clean_res.endswith("```"):
        clean_res = clean_res[:-3]
    clean_res = clean_res.strip()
    prices = json.loads(clean_res)
    print("Parsed JSON successfully:")
    print(prices)
except Exception as e:
    print("Error parsing:", e)
