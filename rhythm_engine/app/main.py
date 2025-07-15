from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import analysis
from .config import settings
import logging

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

logging.basicConfig(level=settings.log_level.upper(), format='[%(asctime)s] [%(levelname)s] - %(message)s')

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logging.critical(f"Unhandled exception: {exc}", exc_info=True)
    return {"detail": "An unexpected error occurred. Please try again later."}, 500

app.include_router(analysis.router)

@app.get("/")
async def root():
    return {"status": "Rhythm Analysis Engine is running"}
