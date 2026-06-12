import os
import jwt
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional

JWT_SECRET = os.environ.get("JWT_SECRET", "super-secret-logistix-key-2026-gsc-first-prize")
JWT_ALGORITHM = "HS256"

def create_jwt_token(payload: Dict[str, Any], expires_in_hours: float = 24.0) -> str:
    """
    Creates a JWT token with the given payload and expiration time.
    """
    to_encode = payload.copy()
    expire = datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)
    to_encode.update({"exp": int(expire.timestamp())})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

def decode_jwt_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decodes and validates a JWT token. Returns the payload if valid, else None.
    """
    if not token:
        return None
        
    # Remove Bearer prefix if present
    if token.startswith("Bearer "):
        token = token[7:]
        
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        print("[JWT] Token has expired.")
        return None
    except jwt.InvalidTokenError as e:
        print(f"[JWT] Token is invalid: {e}")
        return None

def hash_password(password: str) -> str:
    """
    Hashes a password with a fixed salt for verification.
    """
    if not password:
        return ""
    salt = "logistix_salt_2026_gsc"
    return hashlib.sha256((password + salt).encode("utf-8")).hexdigest()

def verify_password(stored: str, entered: str) -> bool:
    """
    Verifies entered password against stored password.
    Supports backward compatibility: checks against raw entered password
    for seed data (plaintext) or the hashed value.
    """
    if not stored or not entered:
        return False
    return stored == hash_password(entered) or stored == entered

