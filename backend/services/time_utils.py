from datetime import datetime, timedelta, timezone

def snap_eta_to_business_hours(eta: datetime) -> datetime:
    """
    Snap any ETA to 8:00 AM – 10:00 PM IST delivery window.
    This ensures deliveries are made during professional hours and not at midnight.
    """
    # IST is UTC+5:30
    IST = timezone(timedelta(hours=5, minutes=30))
    
    # Ensure eta is aware or localize it to UTC if naive
    if eta.tzinfo is None:
        eta = eta.replace(tzinfo=timezone.utc)
    
    eta_ist = eta.astimezone(IST)
    
    if eta_ist.hour < 8:
        eta_ist = eta_ist.replace(hour=8, minute=0, second=0, microsecond=0)
    elif eta_ist.hour >= 22:
        eta_ist = (eta_ist + timedelta(days=1)).replace(hour=8, minute=0, second=0, microsecond=0)
    
    # Return as UTC naive for internal DB storage (common pattern in this app)
    return eta_ist.astimezone(timezone.utc).replace(tzinfo=None)
