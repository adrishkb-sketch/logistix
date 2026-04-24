import random
from typing import Dict, Any
import os

# Lazy load EasyOCR to avoid overhead if not needed immediately
_reader = None

def get_reader():
    global _reader
    if _reader is None:
        try:
            import easyocr
            # We initialize without GPU for generic compatibility, set gpu=True if CUDA is available
            _reader = easyocr.Reader(['en'], gpu=False)
        except ImportError:
            return None
    return _reader

def process_number_plate_image(image_path: str, expected_plate: str) -> Dict[str, Any]:
    """
    Real OCR Service using EasyOCR. 
    Analyzes the image for the expected plate number.
    """
    try:
        if not os.path.exists(image_path):
             return {"verified": False, "message": "Image file not found.", "detected_text": ""}

        ocr = get_reader()
        if ocr is None:
             # Fallback if installation is still in progress or failed
             return {
                 "verified": False,
                 "detected_text": "ENGINE_NOT_READY",
                 "confidence": 0.0,
                 "message": "AI OCR Engine is currently initializing. Please verify manually or try again in a moment."
             }

        results = ocr.readtext(image_path)
        
        # results is a list of [ [bbox], text, confidence ]
        detected_texts = [res[1].upper().strip() for res in results]
        
        # Normalize both for comparison (remove special chars)
        def normalize(s):
            return "".join(c for c in s if c.isalnum())
        
        clean_expected = normalize(expected_plate)
        
        found = False
        match_text = ""
        max_conf = 0.0
        
        for res in results:
            text = res[1].upper()
            conf = res[2]
            clean_text = normalize(text)
            
            if clean_expected in clean_text or clean_text in clean_expected:
                if len(clean_text) > 3: # Avoid matching tiny fragments
                    found = True
                    match_text = text
                    max_conf = conf
                    break
        
        if found and max_conf > 0.4:
            return {
                "verified": True,
                "detected_text": match_text,
                "confidence": round(float(max_conf), 2),
                "message": f"Successfully matched plate: {match_text}"
            }
        else:
            all_detected = " | ".join(detected_texts[:3])
            return {
                "verified": False,
                "detected_text": all_detected if all_detected else "NO_TEXT_DETECTED",
                "confidence": 0.0,
                "message": "Plate mismatch or unreadable. Manual review required."
            }

    except Exception as e:
        print(f"OCR Error: {e}")
        return {
            "verified": False,
            "detected_text": "ERROR",
            "confidence": 0.0,
            "message": f"AI Processing Error: {str(e)}. Please perform manual verification."
        }
