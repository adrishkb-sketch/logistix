from backend.services.turso_db import TursoGenericDB

db = TursoGenericDB("warehouses")
whs = db.get_filtered({"company_id": "1cd1e383-5cba-45ee-b38d-c14b4a080a44"})
print(f"Number of warehouses found: {len(whs)}")
for w in whs:
    print(f"ID: {w['id']}, Name: {w['name']}, Lat: {w['lat']}, Lng: {w['lng']}")
