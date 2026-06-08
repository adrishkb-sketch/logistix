import os
import requests
import json
from typing import Optional, List, Dict

# INTEGRATED GEMINI API KEYS:
INTEGRATED_GEMINI_KEYS = []

def call_gemini(prompt: str, system_instruction: Optional[str] = None, api_key: Optional[str] = None) -> str:
    """
    Calls the Gemini 1.5 Flash API directly using the requests library.
    Requires api_key to be provided dynamically from settings database.
    """
    all_keys = []
    
    # 1. Parse passed keys (comma-separated rotation pool)
    if api_key:
        all_keys.extend([k.strip() for k in api_key.split(",") if k.strip()])
            
    # Filter out empty placeholder/template strings
    keys_list = [k for k in all_keys if k and not k.startswith("YOUR_") and len(k) > 10]
    
    if not keys_list:
        raise ValueError("Google Gemini API Key is not configured. Please add your API Key in System Settings.")
    
    import random
    selected_key = random.choice(keys_list)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={selected_key}"
    headers = {
        "Content-Type": "application/json"
    }
    
    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }]
    }
    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [{"text": system_instruction}]
        }
        
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=15)
        if response.status_code == 200:
            res_data = response.json()
            candidates = res_data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "")
            raise ValueError(f"Failed to parse Gemini API response candidates: {response.text}")
        else:
            raise ValueError(f"Gemini API returned error {response.status_code}: {response.text}")
    except Exception as e:
        if isinstance(e, ValueError):
            raise e
        raise ValueError(f"Failed to connect to Gemini API: {str(e)}")


