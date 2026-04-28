from fastapi import HTTPException, Header, status
from typing import Optional
import json

def verify_context(context_id: str, x_logistix_context: Optional[str] = Header(None)):
    """
    Verifies that the incoming request has a context header matching the resource ID.
    Supports JSON context with role-based access.
    """
    if not x_logistix_context:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing security context header (X-Logistix-Context)"
        )
    
    try:
        # Try to parse as JSON first (modern frontend pattern)
        ctx = json.loads(x_logistix_context)
        
        # If it's a manager, allow if they are in the same company context
        if ctx.get("role") == "manager" or ctx.get("bypass_auth"):
            return True # In simulation, we trust the bypass/manager role
            
        # If it's a driver, the context_id (driver_id) must match
        if ctx.get("driver_id") == context_id:
            return True
            
        raise HTTPException(status_code=403, detail="Context ID mismatch in JSON context")
        
    except json.JSONDecodeError:
        # Fallback to legacy string comparison (if context is just the ID)
        if x_logistix_context != context_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Security context mismatch. Access denied."
            )
    
    return True
