from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import os
import asyncio
from dotenv import load_dotenv

# Load environment variables globally
load_dotenv()

from backend.routers import auth, manager, driver, shipment, tracking, simulation, fuel_oracle, iot
from backend.services.iot_gateway import IoTGateway

app = FastAPI(title="Logistix API", version="1.0.0")

@app.on_event("startup")
async def startup_migration():
    if os.environ.get("VERCEL") == "1":
        print("[Migration] Skipping startup migration on Vercel to prevent gateway timeouts.")
        return
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        from backend.services.finance_engine import migrate_all_shipment_finances
        loop.run_in_executor(None, migrate_all_shipment_finances)
    except Exception as e:
        print(f"[Migration Error] {e}")


try:
    if os.environ.get("VERCEL") != "1":
        os.makedirs("data/images", exist_ok=True)
        app.mount("/images", StaticFiles(directory="data/images"), name="images")
except Exception as e:
    print(f"Skipping mounting local images directory: {e}")

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(manager.router, prefix="/api/manager", tags=["Manager"])
app.include_router(driver.router, prefix="/api/driver", tags=["Driver"])
app.include_router(shipment.router, prefix="/api/shipments", tags=["Shipments"])
app.include_router(tracking.router, prefix="/api/tracking", tags=["Tracking"])
app.include_router(simulation.router, prefix="/api/simulation", tags=["Simulation"])
app.include_router(fuel_oracle.router, prefix="/api/fuel", tags=["Fuel Oracle"])
app.include_router(iot.router, prefix="/api/iot", tags=["IoT Hardware"])

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            telemetry_data = IoTGateway.generate_telemetry()
            await websocket.send_json(telemetry_data)
            await asyncio.sleep(2.0)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, reload_dirs=["backend"])
