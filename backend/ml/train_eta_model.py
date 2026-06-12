import os
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split

def generate_synthetic_data(num_samples=5000):
    np.random.seed(42)
    
    # Features
    distance_km = np.random.uniform(10, 800, num_samples) # 10 to 800 km
    weather_severity = np.random.uniform(1.0, 3.0, num_samples) # 1.0 (clear) to 3.0 (severe storm)
    driver_fatigue = np.random.uniform(0.0, 1.0, num_samples) # 0.0 (fresh) to 1.0 (very fatigued)
    traffic_congestion = np.random.uniform(1.0, 2.5, num_samples) # 1.0 (free flow) to 2.5 (gridlock)
    
    # Calculate transit time (target in hours)
    # Baseline speed 60 km/h
    base_time = distance_km / 60.0
    
    # Impact multipliers: weather, fatigue, traffic
    weather_impact = 1.0 + (weather_severity - 1.0) * 0.25
    fatigue_impact = 1.0 + driver_fatigue * 0.15
    traffic_impact = 1.0 + (traffic_congestion - 1.0) * 0.4
    
    # Add random noise (+/- 10%)
    noise = np.random.normal(1.0, 0.05, num_samples)
    
    transit_time_hours = base_time * weather_impact * fatigue_impact * traffic_impact * noise
    
    df = pd.DataFrame({
        'distance_km': distance_km,
        'weather_severity': weather_severity,
        'driver_fatigue': driver_fatigue,
        'traffic_congestion': traffic_congestion,
        'transit_time_hours': transit_time_hours
    })
    
    return df

def train_and_save_model():
    print("Generating synthetic historical shipping data...")
    df = generate_synthetic_data()
    
    X = df[['distance_km', 'weather_severity', 'driver_fatigue', 'traffic_congestion']]
    y = df['transit_time_hours']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    print("Training Random Forest Regressor...")
    model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42)
    model.fit(X_train, y_train)
    
    # Evaluate
    train_score = model.score(X_train, y_train)
    test_score = model.score(X_test, y_test)
    print(f"Model trained successfully. Train R^2: {train_score:.4f}, Test R^2: {test_score:.4f}")
    
    # Save the model
    ml_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(ml_dir, "eta_model.pkl")
    joblib.dump(model, model_path)
    print(f"Saved model artifact to {model_path}")

if __name__ == "__main__":
    train_and_save_model()
