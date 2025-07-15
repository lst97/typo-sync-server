from celery import Celery
from app.config import settings
from app.analysis_utils import perform_analysis

# This worker will only be used if settings.redis_url is set
celery_app = Celery(
    "worker",
    broker=settings.redis_url,
    backend=settings.redis_url
)

@celery_app.task
def process_audio_task(file_path: str):
    """Celery task to process audio file using the centralized analysis function."""
    return perform_analysis(file_path)
