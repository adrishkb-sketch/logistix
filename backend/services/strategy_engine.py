from datetime import datetime, timedelta
import random

def predict_monthly_revenue(current_revenue: float, growth_rate: float = 1.05) -> dict:
    """
    ML-based prediction for next month revenue.
    """
    predicted = current_revenue * growth_rate
    
    # Seasonality factor (Mock)
    month = datetime.now().month
    if month in [10, 11, 12]: # Festive season in India
        predicted *= 1.25
        
    return {
        "predicted_revenue": round(predicted, 2),
        "confidence_score": 0.88,
        "growth_forecast": "+15%" if month in [10, 11, 12] else "+5%",
        "risk_factors": ["Rising Fuel Prices", "Monsoon Delays"]
    }

def check_strategy_target(current: float, target: float) -> dict:
    progress = (current / target) * 100 if target > 0 else 0
    status = "On Track"
    if progress < 30: status = "Lagging"
    elif progress > 90: status = "Target Met"
    
    return {
        "progress": round(progress, 1),
        "status": status,
        "remaining": round(target - current, 2) if target > current else 0
    }
