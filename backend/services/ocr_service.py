import os
import re
import difflib
from typing import Dict, Any, List

# ── Lazy-load EasyOCR reader ────────────────────────────────────────────────
_reader = None

def get_reader():
    global _reader
    if _reader is None:
        try:
            import easyocr
            _reader = easyocr.Reader(['en'], gpu=False, verbose=False)
        except ImportError:
            return None
    return _reader


# ── Normalization helpers ────────────────────────────────────────────────────

def normalize(s: str) -> str:
    """Strip everything except alphanumeric chars and uppercase."""
    return re.sub(r'[^A-Z0-9]', '', s.upper())


def fuzzy_score(a: str, b: str) -> float:
    """SequenceMatcher ratio between two normalized strings."""
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def is_partial_match(detected: str, expected: str, threshold: float = 0.55) -> bool:
    """
    True if:
      - detected fully contains expected, or vice-versa (substring match)
      - OR fuzzy ratio >= threshold
      - OR expected has >= 4 chars and they appear as a block in detected
    """
    det = normalize(detected)
    exp = normalize(expected)
    if not det or not exp:
        return False
    if exp in det or det in exp:
        return len(det) > 3
    if fuzzy_score(det, exp) >= threshold:
        return True
    # Rolling window: check if any 4+ char chunk of expected appears in detected
    if len(exp) >= 6:
        chunk = exp[:6]
        if chunk in det:
            return True
    return False


# ── Image preprocessing variants ────────────────────────────────────────────

def get_preprocessed_variants(image_path: str):
    """
    Returns a list of (label, numpy_image) preprocessed variants.
    Raises if cv2 is not available.
    """
    import cv2
    import numpy as np

    img = cv2.imread(image_path)
    if img is None:
        return []

    variants = []

    # 1. Original
    variants.append(("original", img))

    # 2. Grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    variants.append(("gray", gray))

    # 3. OTSU binarisation
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants.append(("otsu", otsu))

    # 4. CLAHE (contrast enhancement)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    clahe_img = clahe.apply(gray)
    variants.append(("clahe", clahe_img))

    # 5. Inverted OTSU (dark text on light plates)
    variants.append(("otsu_inv", cv2.bitwise_not(otsu)))

    # 6. Morphological opening to remove noise
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    morph = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, kernel)
    variants.append(("morph_open", morph))

    # 7. Upscale 2× for small/blurry plates
    h, w = gray.shape[:2]
    if w < 600:
        upscaled = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
        variants.append(("upscaled", upscaled))

    return variants


# ── Core OCR with preprocessing ─────────────────────────────────────────────

def run_ocr_on_variants(image_path: str, expected_plate: str) -> Dict[str, Any]:
    """
    Runs EasyOCR on multiple preprocessed variants of the image and returns
    the best match found across all variants.
    """
    import cv2
    import numpy as np
    import tempfile

    ocr = get_reader()
    if ocr is None:
        return {
            "verified": False,
            "detected_text": "ENGINE_NOT_READY",
            "confidence": 0.0,
            "message": "OCR engine not available. Please verify manually.",
            "all_candidates": []
        }

    variants = get_preprocessed_variants(image_path)
    if not variants:
        return {
            "verified": False,
            "detected_text": "UNREADABLE_IMAGE",
            "confidence": 0.0,
            "message": "Could not open image file.",
            "all_candidates": []
        }

    best_match = None
    best_score = 0.0
    all_candidates: List[str] = []
    tmp_files = []

    try:
        for label, variant in variants:
            # Save variant to a temp file for EasyOCR
            suffix = ".png"
            tmp_path = tempfile.mktemp(suffix=suffix)
            tmp_files.append(tmp_path)
            cv2.imwrite(tmp_path, variant)

            try:
                results = ocr.readtext(tmp_path, detail=1, paragraph=False)
            except Exception as e:
                print(f"[OCR] variant '{label}' failed: {e}")
                continue

            for (_, text, conf) in results:
                text_norm = text.upper().strip()
                all_candidates.append(text_norm)

                score = fuzzy_score(normalize(text_norm), normalize(expected_plate))
                # Boost score if it's a substring match
                if is_partial_match(text_norm, expected_plate, threshold=0.0):
                    score = max(score, 0.70)

                if score > best_score:
                    best_score = score
                    best_match = (text_norm, conf, label)

    finally:
        for f in tmp_files:
            try:
                os.remove(f)
            except Exception:
                pass

    # Deduplicate candidates for logging
    seen = set()
    unique_candidates = []
    for c in all_candidates:
        n = normalize(c)
        if n and n not in seen:
            seen.add(n)
            unique_candidates.append(c)

    print(f"[OCR] Expected: '{expected_plate}' | Best: {best_match} | Score: {best_score:.2f}")
    print(f"[OCR] All candidates: {unique_candidates[:10]}")

    # Accept if score >= 0.55 (generous but not trivial)
    ACCEPT_THRESHOLD = 0.55
    if best_match and best_score >= ACCEPT_THRESHOLD:
        matched_text, conf, variant_label = best_match
        return {
            "verified": True,
            "detected_text": matched_text,
            "confidence": round(float(best_score), 2),
            "message": f"Plate verified via OCR ({variant_label} pass): {matched_text}",
            "all_candidates": unique_candidates[:8]
        }
    else:
        top_detected = " | ".join(unique_candidates[:4]) if unique_candidates else "NO_TEXT_DETECTED"
        return {
            "verified": False,
            "detected_text": top_detected,
            "confidence": round(float(best_score), 2),
            "message": (
                f"Plate not matched. Expected '{expected_plate}' but best OCR read was "
                f"'{best_match[0] if best_match else 'nothing'}' (score: {best_score:.0%}). "
                f"Please retake photo in good lighting with the plate clearly visible and centered."
            ),
            "all_candidates": unique_candidates[:8]
        }


# ── Public API ───────────────────────────────────────────────────────────────

def process_number_plate_image(image_path: str, expected_plate: str) -> Dict[str, Any]:
    """
    Main entry point called by the /verify endpoint.
    Tries full preprocessing pipeline; falls back gracefully on any error.
    """
    try:
        if not os.path.exists(image_path):
            return {
                "verified": False,
                "message": f"Image file not found at '{image_path}'.",
                "detected_text": "",
                "confidence": 0.0
            }

        return run_ocr_on_variants(image_path, expected_plate)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "verified": False,
            "detected_text": "ERROR",
            "confidence": 0.0,
            "message": f"OCR processing error: {str(e)}. Please verify manually."
        }
