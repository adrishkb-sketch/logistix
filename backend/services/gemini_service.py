import os
import requests
import json
import random
from typing import Optional, List, Dict

# INTEGRATED GEMINI API KEYS:
INTEGRATED_GEMINI_KEYS = []

def call_gemini(prompt: str, system_instruction: Optional[str] = None, api_key: Optional[str] = None) -> str:
    """
    Calls the Gemini 2.0 Flash API directly using the requests library.
    Automatically rotates through all keys in the pool on rate limit or error.
    Requires api_key to be provided dynamically from settings database.
    """
    all_keys = []
    
    # Parse passed keys (comma-separated rotation pool)
    if api_key:
        all_keys.extend([k.strip() for k in api_key.split(",") if k.strip()])
            
    # Filter out empty placeholder/template strings
    keys_list = [k for k in all_keys if k and not k.startswith("YOUR_") and len(k) > 10]
    
    if not keys_list:
        raise ValueError("Google Gemini API Key is not configured. Please add your API Key in System Settings.")
    
    # Shuffle so we spread load evenly across keys
    shuffled_keys = keys_list.copy()
    random.shuffle(shuffled_keys)
    
    headers = {"Content-Type": "application/json"}
    
    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }]
    }
    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [{"text": system_instruction}]
        }
    
    last_error = None
    
    # Try every key in the pool before giving up
    for key in shuffled_keys:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}"
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            
            if response.status_code == 200:
                res_data = response.json()
                candidates = res_data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        return parts[0].get("text", "")
                raise ValueError(f"Failed to parse Gemini API response candidates: {response.text}")
            
            elif response.status_code == 429:
                # Rate limited — try next key
                last_error = f"Key ending ...{key[-6:]} hit rate limit (429). Trying next key."
                continue
            
            elif response.status_code in (401, 403):
                # Invalid key — try next key
                last_error = f"Key ending ...{key[-6:]} is invalid or unauthorized ({response.status_code})."
                continue
            
            else:
                last_error = f"Gemini API returned error {response.status_code}: {response.text}"
                continue
                
        except Exception as e:
            last_error = f"Connection error with key ...{key[-6:]}: {str(e)}"
            continue
    
    # All keys exhausted
    raise ValueError(
        f"All Gemini API keys failed. Last error: {last_error or 'Unknown error'}. "
        "Please check your API keys in System Settings or add more keys to the pool."
    )
