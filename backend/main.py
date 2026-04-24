from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import os

from backend.routers import auth, manager, driver, shipment, tracking, simulation

app = FastAPI(title="Logistix API", version="1.0.0")

# Ensure image directory exists
os.makedirs("data/images", exist_ok=True)
app.mount("/images", StaticFiles(directory="data/images"), name="images")

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

@app.get("/")
def read_root():
    return {"message": "Welcome to Logistix API"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
