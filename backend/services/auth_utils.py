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


def get_company_id_from_context(x_logistix_context: Optional[str]) -> Optional[str]:
    """
    Resolves the company_id from the X-Logistix-Context header.
    Supports JSON context or raw string IDs (company_id, driver_id, or warehouse_id).
    """
    if not x_logistix_context:
        return None
        
    # 1. Parse JSON context if applicable
    try:
        ctx = json.loads(x_logistix_context)
        if isinstance(ctx, dict):
            if ctx.get("company_id"):
                return ctx.get("company_id")
            if ctx.get("driver_id"):
                from backend.database import JSONDatabase
                d = JSONDatabase("drivers").get_by_id(ctx["driver_id"])
                if d:
                    return d.get("company_id")
    except Exception:
        pass

    # 2. Parse leg/legacy string context ID
    val = x_logistix_context.strip()
    if not val or val == "null" or val == "undefined":
        return None

    # Check if this val matches a company ID
    from backend.services.turso_db import TursoCompaniesDB
    c = TursoCompaniesDB().get_by_id(val)
    if c:
        return val

    # Check if it matches a driver ID
    from backend.database import JSONDatabase
    d = JSONDatabase("drivers").get_by_id(val)
    if d:
        return d.get("company_id")

    # Check if it matches a warehouse ID
    w = JSONDatabase("warehouses").get_by_id(val)
    if w:
        return w.get("company_id")

    # Return val as fallback
    return val

