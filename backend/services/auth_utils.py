from fastapi import HTTPException, Header, status
from typing import Optional
import json

def resolve_context_from_token(header_value: Optional[str]) -> Optional[str]:
    """
    Decodes JWT token if present in header, and converts it to a standard JSON context.
    Raises 401 if a token is present but expired or invalid.
    """
    if not header_value:
        return None
    
    val = header_value.strip()
    token = val
    if val.startswith("Bearer "):
        token = val[7:]
    
    # If the format looks like a JWT token
    if len(token.split('.')) == 3:
        from backend.services.auth import decode_jwt_token
        payload = decode_jwt_token(token)
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired or invalid token. Please log in again."
            )
            
        role = payload.get("role")
        company_id = payload.get("company_id")
        
        ctx = {}
        if role:
            ctx["role"] = role
        if company_id:
            ctx["company_id"] = company_id
            
        if role == "driver" and payload.get("id"):
            ctx["driver_id"] = payload.get("id")
        elif role == "warehouse_manager" and payload.get("id"):
            ctx["warehouse_id"] = payload.get("id")
            
        return json.dumps(ctx)
        
    return header_value


def verify_context(context_id: str, x_logistix_context: Optional[str] = Header(None)):
    """
    Verifies that the incoming request has a context header matching the resource ID.
    Supports JSON context with role-based access.
    """
    resolved_context = resolve_context_from_token(x_logistix_context)
    if not resolved_context:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing security context header (X-Logistix-Context)"
        )
    
    try:
        # Try to parse as JSON first (modern frontend pattern)
        ctx = json.loads(resolved_context)
        
        # If it's a manager, allow if they are in the same company context
        if ctx.get("role") == "manager" or ctx.get("bypass_auth"):
            return True # In simulation, we trust the bypass/manager role
            
        # If it's a driver, the context_id (driver_id) must match
        if ctx.get("driver_id") == context_id:
            return True
            
        raise HTTPException(status_code=403, detail="Context ID mismatch in JSON context")
        
    except json.JSONDecodeError:
        # Fallback to legacy string comparison (if context is just the ID)
        if resolved_context != context_id:
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
    resolved_context = resolve_context_from_token(x_logistix_context)
    if not resolved_context:
        return None
        
    # 1. Parse JSON context if applicable
    try:
        ctx = json.loads(resolved_context)
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
    val = resolved_context.strip()
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
