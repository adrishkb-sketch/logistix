FROM python:3.11-slim

# Set the working directory
WORKDIR /app

# Install system dependencies if required (for compiling certain Python packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set PYTHONPATH so absolute imports work correctly
ENV PYTHONPATH=/app

# Expose the port (informative only, Cloud Run injects PORT at runtime)
EXPOSE 8080

# Start the FastAPI server using the dynamically injected PORT from Cloud Run
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}
