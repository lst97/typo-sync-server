import os
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    log_level: str = "INFO"
    # If REDIS_URL is not set, Celery will be disabled and a fallback will be used.
    redis_url: Optional[str] = None
    # Minimum duration for notes to be considered playable (in seconds)
    min_note_duration: float = 0.05

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore extra environment variables

settings = Settings()

# A boolean flag to easily check if Celery is enabled.
CELERY_ENABLED = settings.redis_url is not None
