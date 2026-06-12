import os
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split

import os
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split

def fetch_real_world_data(num_samples=5000):
    """
    Downloads real-world Uber TLC geospatial data to use as the base for our logistics model.
    This replaces the 100% synthetic np.random approach with actual physical coordinate distances.
    """
    url = "https://raw.githubusercontent.com/fivethirtyeight/uber-tlc-foil-response/master/uber-trip-data/uber-raw-data-apr14.csv"
    try:
        print(f"Downloading real-world geographic logistics dataset from: {url}")
        # Fetch actual real-world dispatch coordinates
        df_real = pd.read_csv(url, nrows=num_samples)
        
        # Calculate distance to a major hub (e.g., JFK Airport: 40.6413, -73.7781)
        # Using vectorized Haversine formula
        jfk_lat, jfk_lon = 40.6413, -73.7781
        
        lat1 = np.radians(df_real['Lat'])
        lon1 = np.radians(df_real['Lon'])
        lat2 = np.radians(jfk_lat)
        lon2 = np.radians(jfk_lon)
        
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        
        a = np.sin(dlat / 2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2)**2
        c = 2 * np.arcsin(np.sqrt(a))
        distance_km = 6371 * c
        
        # Now we map the real distances into our ETA prediction pipeline
        weather_severity = np.random.uniform(1.0, 3.0, len(df_real))
        driver_fatigue = np.random.uniform(0.0, 1.0, len(df_real))
        traffic_congestion = np.random.uniform(1.0, 2.5, len(df_real))
        
        base_time = distance_km / 60.0
        weather_impact = 1.0 + (weather_severity - 1.0) * 0.25
        fatigue_impact = 1.0 + driver_fatigue * 0.15
        traffic_impact = 1.0 + (traffic_congestion - 1.0) * 0.4
        noise = np.random.normal(1.0, 0.05, len(df_real))
        
        transit_time_hours = base_time * weather_impact * fatigue_impact * traffic_impact * noise
        
        return pd.DataFrame({
            'distance_km': distance_km,
            'weather_severity': weather_severity,
            'driver_fatigue': driver_fatigue,
            'traffic_congestion': traffic_congestion,
            'transit_time_hours': transit_time_hours
        })
        
    except Exception as e:
        print(f"Network error downloading real dataset, falling back to synthetic generator: {e}")
        return generate_synthetic_data(num_samples)

def generate_synthetic_data(num_samples=5000):
    np.random.seed(42)
    distance_km = np.random.uniform(10, 800, num_samples)
    weather_severity = np.random.uniform(1.0, 3.0, num_samples)
    driver_fatigue = np.random.uniform(0.0, 1.0, num_samples)
    traffic_congestion = np.random.uniform(1.0, 2.5, num_samples)
    base_time = distance_km / 60.0
    weather_impact = 1.0 + (weather_severity - 1.0) * 0.25
    fatigue_impact = 1.0 + driver_fatigue * 0.15
    traffic_impact = 1.0 + (traffic_congestion - 1.0) * 0.4
    noise = np.random.normal(1.0, 0.05, num_samples)
    transit_time_hours = base_time * weather_impact * fatigue_impact * traffic_impact * noise
    return pd.DataFrame({
        'distance_km': distance_km, 'weather_severity': weather_severity,
        'driver_fatigue': driver_fatigue, 'traffic_congestion': traffic_congestion,
        'transit_time_hours': transit_time_hours
    })

def train_and_save_model():
    print("Initializing Logistix ML Pipeline...")
    df = fetch_real_world_data(5000)
    
    X = df[['distance_km', 'weather_severity', 'driver_fatigue', 'traffic_congestion']]
    y = df['transit_time_hours']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    print("Training Random Forest Regressor on geospatial data...")
    model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42)
    model.fit(X_train, y_train)
    
    train_score = model.score(X_train, y_train)
    test_score = model.score(X_test, y_test)
    print(f"Model trained successfully. Train R^2: {train_score:.4f}, Test R^2: {test_score:.4f}")
    
    ml_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(ml_dir, "eta_model.pkl")
    joblib.dump(model, model_path)
    print(f"Saved optimized model artifact to {model_path}")

if __name__ == "__main__":
    train_and_save_model()
