from fastapi import APIRouter
from backend.database import JSONDatabase
from backend.models import Alert
import uuid

router = APIRouter()
weather_db = JSONDatabase("weather_cells")
alerts_db = JSONDatabase("alerts")
shipments_db = JSONDatabase("shipments")

@router.post("/disaster")
def simulate_disaster(data: dict):
    # type: "cyclone", "blockade", "flood"
    # lat, lng, radius, severity
    
    # 1. Inject into weather cells
    new_cell = {
        "id": str(uuid.uuid4()),
        "type": data.get("type", "cyclone"),
        "lat": data.get("lat", 19.1),
        "lng": data.get("lng", 72.9),
        "radius": data.get("radius", 200), # Huge radius
        "condition": data.get("condition", "Storm"),
        "severity": "critical",
        "is_simulation": True
    }
    
    # Actually, we can just replace all cells for maximum dramatic effect
    weather_db.write([new_cell])
    
    # 2. Trigger alerts for all active shipments that intersect
    from backend.services.route_engine import haversine
    from backend.models import ShipmentEvent
    
    active_shipments = [s for s in shipments_db.get_all() if s.get("status") in ["assigned", "in_transit"]]
    affected_count = 0
    
    for s in active_shipments:
        curr_loc = s.get("current_location") or s.get("pickup")
        dist = haversine(curr_loc["lat"], curr_loc["lng"], new_cell["lat"], new_cell["lng"])
        if dist <= new_cell["radius"]:
            # Log event (SIMULATION ONLY - NO ALERT)
            log_event = ShipmentEvent(status="simulated_delay", message=f"SIMULATION: Affected by {new_cell['type']}.", reason=f"Disaster Simulation Sandbox")
            s["logs"] = s.get("logs", []) + [log_event.model_dump()]
            shipments_db.update(s["id"], s)
            affected_count += 1
            
    return {"message": f"Simulated {new_cell['type']}. {affected_count} shipments affected instantly."}

@router.post("/disaster/custom")
def custom_disaster(data: dict):
    from backend.services.route_engine import haversine
    from backend.models import ShipmentEvent
    
    # data: {type, shapeType, lat, lng, radius} OR {type, shapeType, coordinates: [{lat,lng}]}
    new_cell = {
        "id": str(uuid.uuid4()),
        "type": data.get("type"),
        "shapeType": data.get("shapeType"),
        "severity": "critical",
        "is_simulation": True
    }
    
    if data.get("shapeType") == "circle":
        new_cell["lat"] = data["lat"]
        new_cell["lng"] = data["lng"]
        new_cell["radius"] = data["radius"]
    else:
        new_cell["coordinates"] = data["coordinates"]
        
    # Append to existing cells
    cells = weather_db.get_all()
    cells.append(new_cell)
    weather_db.write(cells)
    
    # Check intersections
    active_shipments = [s for s in shipments_db.get_all() if s.get("status") in ["assigned", "in_transit"]]
    affected_count = 0
    affected_list = []
    
    for s in active_shipments:
        curr_loc = s.get("current_location") or s.get("pickup")
        intersects = False
        
        if new_cell["shapeType"] == "circle":
            dist = haversine(curr_loc["lat"], curr_loc["lng"], new_cell["lat"], new_cell["lng"])
            if dist <= new_cell["radius"]: intersects = True
        else:
            # Polyline proximity (within 5km of any point on line)
            for pt in new_cell["coordinates"]:
                if haversine(curr_loc["lat"], curr_loc["lng"], pt["lat"], pt["lng"]) <= 5:
                    intersects = True
                    break
                    
        if intersects:
            affected_count += 1
            
            # Fetch driver and vehicle details for the detailed report
            drivers_db = JSONDatabase("drivers")
            vehicles_db = JSONDatabase("vehicles")
            driver = drivers_db.get_by_id(s.get("assigned_driver_id", ""))
            vehicle = vehicles_db.get_by_id(s.get("assigned_vehicle_id", ""))
            
            ai_action = "Reroute"
            if new_cell['type'] in ['cyclone', 'flood']:
                ai_action = "Emergency Halt & Seek High Ground"
            elif new_cell['type'] == 'blockade':
                ai_action = "Recalculate Route (OSRM Bypass)"
                
            affected_list.append({
                "id": s["id"],
                "description": s["description"],
                "driver_name": driver.get("name", "Unknown") if driver else "Unassigned",
                "vehicle_plate": vehicle.get("number_plate", "N/A") if vehicle else "N/A",
                "location": curr_loc,
                "ai_action": ai_action,
                "driver_instruction": f"PROPOSED: Move to nearest safe zone. Awaiting Manager Approval."
            })
            
            # We still log it in the shipment history as a 'simulated' event, but NO ALERT in alerts_db
            log_event = ShipmentEvent(status="simulated_delay", message=f"SIMULATION: Affected by {new_cell['type']}.", reason=f"Disaster Simulation Sandbox")
            s["logs"] = s.get("logs", []) + [log_event.model_dump()]
            shipments_db.update(s["id"], s)

    # Generate AI Recommendation
    recommendation = "No shipments affected."
    if affected_count > 0:
        recommendation = f"AI suggests halting {affected_count} vehicles immediately. "
        if new_cell['type'] in ['cyclone', 'flood']:
            recommendation += "Reroute 2-wheelers immediately; standard delivery trucks should seek elevated parking."
        elif new_cell['type'] in ['landslide', 'blockade']:
            recommendation += "Calculate alternative paths bypassing the affected segment. Minor delays expected."

    return {
        "message": f"Custom {new_cell['type']} simulated. {affected_count} shipments affected.",
        "affected_count": affected_count,
        "affected_list": affected_list,
        "recommendation": recommendation
    }

@router.post("/disaster/clear")
def clear_disasters():
    weather_db.write([])
    # Revert all shipments
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        original_len = len(s.get("logs", []))
        s["logs"] = [l for l in s.get("logs", []) if l.get("status") != "simulated_delay"]
        if len(s["logs"]) != original_len:
            shipments_db.update(s["id"], s)
    return {"message": "All active disaster simulations cleared."}

@router.delete("/disaster/{sim_id}")
def stop_simulation(sim_id: str):
    cells = weather_db.get_all()
    new_cells = [c for c in cells if c.get("id") != sim_id]
    weather_db.write(new_cells)
    
    # Revert shipments affected by this specific simulation
    # For simplicity, we remove ALL simulated_delay logs. 
    # In a real app we might tag logs with the sim_id.
    all_shipments = shipments_db.get_all()
    for s in all_shipments:
        original_len = len(s.get("logs", []))
        s["logs"] = [l for l in s.get("logs", []) if l.get("status") != "simulated_delay"]
        if len(s["logs"]) != original_len:
            shipments_db.update(s["id"], s)
            
    return {"message": f"Simulation {sim_id} stopped. System reverted to normal."}

@router.post("/strategy-oracle")
def run_strategy_oracle(data: dict):
    # Inputs:
    # months: simulation duration
    # wh_expansion: number of new warehouses
    # wh_location: "tier1" or "tier2" (Tier 1 has higher demand but higher cost)
    # fleet_expansion: percentage increase in fleet size
    # green_policy: 0 to 100 (percentage of fleet converted to EV)
    # automation_level: 0 to 100 (warehouse automation investment)
    # driver_incentive: 0 to 100 (investment in driver retention)
    
    import random
    months = data.get("months", 6)
    wh_plus = data.get("wh_expansion", 0)
    wh_loc = data.get("wh_location", "tier2")
    fleet_plus = data.get("fleet_expansion", 0)
    green_val = data.get("green_policy", 0)
    auto_val = data.get("automation_level", 0)
    incentive = data.get("driver_incentive", 0)
    
    # Baseline stats
    avg_trips_per_month = 1200
    avg_revenue_per_trip = 450
    avg_cost_per_trip = 320
    
    # Tier modifiers
    demand_mult = 1.25 if wh_loc == "tier1" else 1.0
    rent_premium = 45 if wh_loc == "tier1" else 0
    
    # 1. Cost Impact Calculation
    # New warehouses reduce distance but increase rent premium in Tier 1
    # Automation reduces labor cost. Incentive reduces turnover/accident costs.
    cost_saving_per_trip = (wh_plus * 12.5) + (auto_val * 0.8) + (green_val * 0.4) + (incentive * 0.5)
    new_cost_per_trip = max(200, avg_cost_per_trip - cost_saving_per_trip + rent_premium)
    
    # 2. Efficiency Impact (ETA success rate)
    # Incentive = better drivers = faster delivery
    efficiency_gain = (wh_plus * 3.2) + (fleet_plus * 0.15) + (auto_val * 0.1) + (incentive * 0.12)
    new_eta_success = min(99.5, 82.0 + efficiency_gain)
    
    # 3. Environmental Impact (CO2)
    carbon_reduction = (green_val * 0.85) + (auto_val * 0.05)
    
    # 4. ROI Simulation
    total_revenue = 0
    total_cost = 0
    monthly_data = []
    
    for m in range(months):
        # Scale demand
        monthly_trips = int(avg_trips_per_month * (1 + (fleet_plus/200.0) + (wh_plus/50.0)) * demand_mult)
        monthly_trips = int(monthly_trips * (0.95 + random.random() * 0.1))
        
        m_rev = monthly_trips * avg_revenue_per_trip
        m_cost = monthly_trips * new_cost_per_trip
        
        total_revenue += m_rev
        total_cost += m_cost
        
        monthly_data.append({
            "month": m + 1,
            "revenue": m_rev,
            "cost": m_cost,
            "profit": m_rev - m_cost
        })
        
    net_profit = total_revenue - total_cost
    
    # Breakdown for UI tooltip
    breakdown = f"Revenue: {int(total_revenue/1000)}k (Trips: {int(avg_trips_per_month*months*demand_mult)}). Cost/Trip: ₹{int(new_cost_per_trip)} (Saved: ₹{int(cost_saving_per_trip)} from optimizations, +₹{rent_premium} rent premium)."

    return {
        "summary": {
            "net_profit": net_profit,
            "efficiency_score": new_eta_success,
            "carbon_reduction": carbon_reduction,
            "total_trips": int(avg_trips_per_month * months),
            "roi_percentage": round((net_profit / (total_cost or 1)) * 100, 1)
        },
        "monthly_forecast": monthly_data,
        "ai_recommendation": "Maintain current operations." if net_profit < 500000 else "EXCELLENT GROWTH PLAN",
        "risk_level": "Low" if new_eta_success > 90 else "Medium",
        "breakdown": breakdown
    }

@router.post("/strategy/save")
def save_strategy(data: dict):
    strategy_db = JSONDatabase("strategy_plans")
    company_id = data.get("company_id")
    if not company_id:
        return {"error": "Missing company_id"}
        
    all_plans = strategy_db.get_all()
    # Replace existing plan for this company if it exists, otherwise add new
    new_plans = [p for p in all_plans if p.get("company_id") != company_id]
    new_plans.append(data)
    strategy_db.write(new_plans)
    return {"message": "Strategy plan activated!"}

@router.get("/strategy/active")
def get_active_strategy(company_id: str):
    strategy_db = JSONDatabase("strategy_plans")
    plans = strategy_db.get_all()
    # Find the active plan for this specific company
    company_plan = next((p for p in plans if p.get("company_id") == company_id), None)
    return company_plan

@router.delete("/strategy/active")
def delete_strategy(company_id: str):
    strategy_db = JSONDatabase("strategy_plans")
    all_plans = strategy_db.get_all()
    remaining = [p for p in all_plans if p.get("company_id") != company_id]
    strategy_db.write(remaining)
    return {"message": "Strategy plan cleared."}
