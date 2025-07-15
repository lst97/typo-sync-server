FROM denoland/deno:2.4.0

# Set working directory
WORKDIR /app

# Copy dependency files
COPY deno.json deps.ts ./

# Cache dependencies
RUN deno cache deps.ts

# Copy source code
COPY . .

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD deno run --allow-net --allow-read healthcheck.ts

# Run the application
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-run", "--allow-env", "main.ts"]
