from fastapi import HTTPException, Header, status
from typing import Optional

def verify_context(context_id: str, x_logistix_context: Optional[str] = Header(None)):
    """
    Verifies that the incoming request has a context header matching the resource ID.
    In a real app, this would verify a JWT token and its claims.
    """
    if not x_logistix_context:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing security context header (X-Logistix-Context)"
        )
    
    # For this simulation, the context header must match the expected ID (e.g., company_id or driver_id)
    if x_logistix_context != context_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Security context mismatch. Access denied."
        )
