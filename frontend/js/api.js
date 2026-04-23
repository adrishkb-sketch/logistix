const API_BASE = "http://localhost:8000/api";

async function apiCall(endpoint, method = "GET", body = null) {
    const options = {
        method,
        headers: {
            "Content-Type": "application/json"
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || data.message || "API Error");
        }
        return data;
    } catch (error) {
        console.error("API Call Failed:", error);
        alert(error.message);
        throw error;
    }
}
