import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.database import JSONDatabase

def main():
    db = JSONDatabase("drivers")
    drivers = db.get_all()
    print(f"Total drivers in DB: {len(drivers)}")
    companies = {}
    for d in drivers:
        cid = d.get('company_id')
        companies.setdefault(cid, []).append(d)
        
    for cid, plist in companies.items():
        print(f"\nCompany ID: {cid}")
        print(f"  Total Drivers: {len(plist)}")
        verified = [d for d in plist if d.get("verification_status") == "verified"]
        unverified = [d for d in plist if d.get("verification_status") != "verified"]
        print(f"  Verified: {len(verified)}")
        print(f"  Unverified: {len(unverified)}")
        for d in plist:
            print(f"    - Name: {d.get('name')}, Status: {d.get('verification_status')}, ID: {d.get('id')}")

if __name__ == "__main__":
    main()
