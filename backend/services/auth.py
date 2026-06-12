import os
import jwt
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
