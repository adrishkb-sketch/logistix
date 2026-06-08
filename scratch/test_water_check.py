from backend.services.water_check import is_location_in_water

test_coords = [
    # Land points (should be False)
    (22.5726, 88.3639, "Kolkata Land", False),
    (18.939, 72.825, "Gateway of India Land", False),
    
    # Ocean/Sea points (should be True)
    (15.0, 88.0, "Bay of Bengal", True),
    (18.9, 72.75, "Mumbai Ocean", True),
    
    # Large Still Water Lakes (should be True)
    (19.72, 85.38, "Chilika Lake", True),
    (17.423, 78.475, "Hussain Sagar Hyderabad", True),
    (17.4225, 78.4772, "Hussain Sagar Middle", True),
    (22.5115, 88.3582, "Rabindra Sarobar Middle", True),
    (19.1274, 72.9038, "Powai Lake Middle", True),
    
    # Smaller Still Water Lakes (should be True)
    (11.4034, 76.6917, "Ooty Lake Center", True),
    (26.8899, 88.1826, "Mirik Lake Center", True),
]

print("=== Running Still Water Validation Test ===")
all_pass = True
for lat, lon, desc, expected in test_coords:
    result = is_location_in_water(lat, lon)
    status = "PASS" if result == expected else "FAIL"
    if status == "FAIL":
        all_pass = False
    print(f"{desc:30s} ({lat:.4f}, {lon:.4f}) -> Result: {result}, Expected: {expected} -> {status}")

if all_pass:
    print("\n✅ ALL TESTS PASSED SUCCESSFULLY!")
else:
    print("\n❌ SOME TESTS FAILED!")
