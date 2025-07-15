from fastapi import APIRouter, File, UploadFile, HTTPException, BackgroundTasks, status
from fastapi.responses import StreamingResponse
from app.config import CELERY_ENABLED
from app.analysis_utils import perform_analysis
from app import schemas
import tempfile
import logging
import uuid
import json
import asyncio
import time

# Conditionally import the Celery task
if CELERY_ENABLED:
    from app.worker import process_audio_task

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory storage for fallback when Redis/Celery is not available
in_memory_storage = {}
# Storage for SSE connections
sse_connections = {}

def run_analysis_in_background(task_id: str, path: str):
    """A wrapper function for running analysis and storing the result."""
    try:
        # Update status to processing
        in_memory_storage[task_id] = {"state": "PROCESSING", "status": "Processing audio file..."}
        
        result = perform_analysis(path)
        in_memory_storage[task_id] = {"state": "SUCCESS", "result": result}
    except Exception as e:
        in_memory_storage[task_id] = {"state": "FAILURE", "status": str(e)}

async def sse_generator(task_id: str):
    """Generator function for SSE streaming"""
    try:
        while True:
            if CELERY_ENABLED:
                # Check Celery task status
                task = process_audio_task.AsyncResult(task_id)
                if task.state == 'PENDING':
                    data = {'state': task.state, 'status': 'Pending...'}
                elif task.state == 'PROCESSING':
                    data = {'state': task.state, 'status': 'Processing audio file...'}
                elif task.state == 'SUCCESS':
                    data = {'state': task.state, 'result': task.result}
                    yield f"data: {json.dumps(data)}\n\n"
                    break
                elif task.state == 'FAILURE':
                    data = {'state': task.state, 'status': str(task.info)}
                    yield f"data: {json.dumps(data)}\n\n"
                    break
                else:
                    data = {'state': task.state, 'status': 'Processing...'}
            else:
                # Check in-memory storage
                result = in_memory_storage.get(task_id)
                if not result:
                    data = {'state': 'NOT_FOUND', 'status': 'Task not found'}
                    yield f"data: {json.dumps(data)}\n\n"
                    break
                elif result['state'] in ['SUCCESS', 'FAILURE']:
                    data = result
                    yield f"data: {json.dumps(data)}\n\n"
                    break
                else:
                    data = result
            
            yield f"data: {json.dumps(data)}\n\n"
            await asyncio.sleep(1)  # Check every second
            
    except Exception as e:
        logger.error(f"SSE stream error for task {task_id}: {e}")
        error_data = {'state': 'ERROR', 'status': f'Stream error: {str(e)}'}
        yield f"data: {json.dumps(error_data)}\n\n"

@router.post(
    "/analyze",
    response_model=schemas.AnalyzeResponse,
    summary="Submit an audio file for analysis",
    description="Upload an audio file (MP3 or WAV) to start the rhythm and melody analysis. "
                "This endpoint initiates a background task and returns a task ID to track the progress.",
)
async def analyze_audio(
    background_tasks: BackgroundTasks, 
    file: UploadFile = File(..., description="The audio file to be analyzed.")
):
    logger.info(f"Received request to analyze file: {file.filename}")
    if file.content_type not in ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp3"]:
        raise HTTPException(status_code=400, detail=f"Invalid file type: {file.content_type}. Please upload an audio file.")

    # Save the file to a temporary path that persists for the task
    with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file.filename}") as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    if CELERY_ENABLED:
        logger.info("Using Celery backend for analysis.")
        task = process_audio_task.delay(tmp_path)
        return {"task_id": task.id, "backend": "celery"}
    else:
        logger.info("Using in-memory fallback for analysis.")
        task_id = str(uuid.uuid4())
        in_memory_storage[task_id] = {"state": "PENDING", "status": "Processing..."}
        background_tasks.add_task(run_analysis_in_background, task_id, tmp_path)
        return {"task_id": task_id, "backend": "in-memory"}

@router.get(
    "/stream/{task_id}",
    summary="Stream real-time analysis results via SSE",
    responses={
        200: {
            "description": "A stream of Server-Sent Events with task status updates.",
            "content": {
                "text/event-stream": {
                    "schema": {
                        "type": "string",
                        "example": 'data: {"state": "PROCESSING", "status": "Processing audio file..."}\n\n',
                    }
                }
            },
        }
    },
    description="""
Connect to this endpoint using an EventSource client to receive real-time updates on the analysis task.
The stream will send JSON objects with the task's current state.

**Event Format:**

- **state**: The current state of the task (`PENDING`, `PROCESSING`, `SUCCESS`, `FAILURE`, `NOT_FOUND`).
- **status**: A descriptive message (for `PENDING`, `PROCESSING`, `FAILURE` states).
- **result**: The full analysis result object (only for the `SUCCESS` state).

The stream closes after a `SUCCESS`, `FAILURE`, or `NOT_FOUND` event is sent.
""",
)
async def stream_results(task_id: str):
    """SSE endpoint for streaming analysis results"""
    logger.info(f"Starting SSE stream for task: {task_id}")
    
    return StreamingResponse(
        sse_generator(task_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control"
        }
    )

@router.get(
    "/results/{task_id}",
    response_model=schemas.TaskResultResponse,
    summary="Fetch the result of an analysis task",
    description="Retrieve the current status or final result of a completed analysis task using its task ID.",
    responses={
        200: {
            "description": "The current status or final result of the analysis task.",
            "content": {
                "application/json": {
                    "examples": {
                        "success": {
                            "summary": "Successful Analysis",
                            "value": {
                                "state": "SUCCESS",
                                "result": {
                                    "bpm": 120.0,
                                    "beat_timestamps": [0.0, 0.5, 1.0],
                                    "melody_map": [
                                        {"pitch": "C4", "start_time": 0.5, "duration": 0.45}
                                    ],
                                    "analysis_info": {
                                        "total_beats": 150,
                                        "total_subdivisions": 300,
                                        "consolidated_notes": 100,
                                        "filtered_notes": 80,
                                        "min_note_duration": 0.05,
                                        "subdivision_factor": 2,
                                    },
                                },
                            },
                        },
                        "processing": {
                            "summary": "Task in Progress",
                            "value": {"state": "PROCESSING", "status": "Processing audio file..."},
                        },
                        "failure": {
                            "summary": "Failed Task",
                            "value": {"state": "FAILURE", "status": "Analysis failed."},
                        },
                    }
                }
            },
        },
        status.HTTP_404_NOT_FOUND: {
            "description": "Task not found", 
            "model": schemas.HTTPError
        },
    },
)
async def get_results(task_id: str):
    if CELERY_ENABLED:
        logger.info(f"Fetching results from Celery for task: {task_id}")
        task = process_audio_task.AsyncResult(task_id)
        if task.state == 'PENDING':
            return {'state': task.state, 'status': 'Pending...'}
        elif task.state != 'FAILURE':
            return {'state': task.state, 'result': task.result}
        else:
            return {'state': task.state, 'status': str(task.info)}
    else:
        logger.info(f"Fetching results from in-memory storage for task: {task_id}")
        result = in_memory_storage.get(task_id)
        if not result:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
        return result
