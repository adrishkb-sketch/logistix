import os
import requests
import re
import difflib
from typing import Dict, Any, List

# ── Cloud OCR Configuration (OCR.space - Completely Free Tier) ──────────────
OCR_API_KEY = os.getenv("OCR_API_KEY", "K87405238188957") # Default public key
OCR_API_URL = "https://api.ocr.space/parse/image"

def normalize(s: str) -> str:
    """Strip everything except alphanumeric chars and uppercase."""
    s = re.sub(r'[^A-Z0-9]', '', s.upper())
    # Handle common OCR confusions
    replacements = {'O': '0', 'I': '1', 'L': '1', 'Z': '2', 'S': '5', 'B': '8', 'G': '6'}
    for old, new in replacements.items():
        s = s.replace(old, new)
    return s

def fuzzy_score(a: str, b: str) -> float:
    if not a or not b: return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()

def process_number_plate_image(image_path: str, expected_plate: str) -> Dict[str, Any]:
    """
    Calls the OCR.space API to process the image. 
    This replaces the 5GB EasyOCR dependency with a lightweight 0.1MB API call.
    """
    try:
        if not os.path.exists(image_path):
            return {"verified": False, "message": "Image not found.", "detected_text": "", "confidence": 0.0}

        # Prepare for API call
        with open(image_path, 'rb') as f:
            payload = {
                'apikey': OCR_API_KEY,
                'language': 'eng',
                'isOverlayRequired': False,
                'OCREngine': 2, # Engine 2 is better for license plates
                'scale': True
            }
            files = {'file': f}
            try:
                response = requests.post(OCR_API_URL, data=payload, files=files, timeout=25)
                response.raise_for_status()
                result = response.json()
            except Exception as req_err:
                print(f"[OCR Cloud] Network/API Error: {req_err}")
                return {"verified": False, "message": f"Cloud OCR Connection failed: {str(req_err)}", "detected_text": "NETWORK_ERROR", "confidence": 0.0}

        if result.get("OCRExitCode") != 1:
            error = result.get("ErrorMessage", "Unknown API error")
            print(f"[OCR Cloud] Error: {error}")
            return {"verified": False, "message": f"Cloud OCR failed: {error}", "detected_text": "ERROR", "confidence": 0.0}

        # Extract parsed text
        parsed_results = result.get("ParsedResults", [])
        if not parsed_results:
            return {"verified": False, "message": "No text detected in image.", "detected_text": "", "confidence": 0.0}

        detected_text = parsed_results[0].get("ParsedText", "").strip().replace("\n", " ").upper()
        detected_norm = normalize(detected_text)
        expected_norm = normalize(expected_plate)
        
        score = fuzzy_score(detected_norm, expected_norm)
        
        # Hard check: If the normalized expected plate exists anywhere in the normalized detected text
        is_match = (expected_norm in detected_norm) or (score >= 0.65)

        print(f"[OCR Cloud] Expected: '{expected_plate}' | Detected: '{detected_text}' | Score: {score:.2f}")

        if is_match:
            return {
                "verified": True,
                "detected_text": detected_text,
                "detected_norm": detected_norm,
                "confidence": round(score, 2),
                "message": f"Verified via Cloud OCR: {detected_text}"
            }
        else:
            return {
                "verified": False,
                "detected_text": detected_text,
                "detected_norm": detected_norm,
                "confidence": round(score, 2),
                "message": f"Match failed. Expected {expected_plate}, but found {detected_text}."
            }

    except Exception as e:
        print(f"[OCR Cloud] Critical Error: {e}")
        return {
            "verified": False,
            "detected_text": "API_ERROR",
            "confidence": 0.0,
            "message": f"Cloud OCR Service error. Please verify manually."
        }
