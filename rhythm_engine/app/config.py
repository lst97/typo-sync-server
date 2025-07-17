from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    log_level: str = "INFO"
    # Minimum duration for notes to be considered playable (in seconds)
    min_note_duration: float = 0.05

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # Ignore extra environment variables

settings = Settings()
