FROM python:3.13-slim

# Set working directory
WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    libsndfile1-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Make run.py executable
RUN chmod +x run.py

# Create a non-root user for security
RUN groupadd -r rhythmuser && useradd -r -g rhythmuser rhythmuser
RUN chown -R rhythmuser:rhythmuser /app
USER rhythmuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD python run.py --version || exit 1

# Default command (this image is meant to be used as a worker, not run directly)
CMD ["python", "run.py", "--help"]