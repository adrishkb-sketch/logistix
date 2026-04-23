import random
from typing import Dict, Any

def process_number_plate_image(image_path: str, expected_plate: str) -> Dict[str, Any]:
    """
    Mock OCR Service. 
    In a real environment, this would use EasyOCR or PyTesseract:
    import pytesseract
    from PIL import Image
    text = pytesseract.image_to_string(Image.open(image_path))
    """
    
    # We will simulate a failure rate to demonstrate manual manager verification.
    # 70% chance it succeeds automatically, 30% chance it fails and requires manual review.
    
    success = random.random() < 0.7
    
    if success:
        return {
            "verified": True,
            "detected_text": expected_plate,
            "confidence": round(random.uniform(0.85, 0.99), 2),
            "message": "Automatically verified via AI."
        }
    else:
        return {
            "verified": False,
            "detected_text": "UNREADABLE",
            "confidence": round(random.uniform(0.10, 0.50), 2),
            "message": "AI could not read the plate confidently. Manual review required."
        }
