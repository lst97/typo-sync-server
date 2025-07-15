from pydantic import BaseModel, Field
from typing import List, Literal, Union

# Model for standard HTTP errors, used in `responses` documentation
class HTTPError(BaseModel):
    detail: str = Field(..., example="Resource not found")

# --- Reusable Components for Analysis Result ---

class MelodyNote(BaseModel):
    pitch: str = Field(..., description="The MIDI note name (e.g., C4, F#5).", example="A4")
    start_time: float = Field(..., description="Start time of the note in seconds.", example=1.23)
    duration: float = Field(..., description="Duration of the note in seconds.", example=0.45)

class AnalysisInfo(BaseModel):
    total_beats: int = Field(..., description="Total number of beats detected.", example=150)
    total_subdivisions: int = Field(..., description="Total number of subdivisions analyzed.", example=300)
    consolidated_notes: int = Field(..., description="Number of notes after consolidating consecutive identical notes.", example=100)
    filtered_notes: int = Field(..., description="Number of notes after applying the minimum duration filter.", example=80)
    min_note_duration: float = Field(..., description="The minimum note duration filter used.", example=0.05)
    subdivision_factor: int = Field(..., description="The number of subdivisions per beat.", example=2)

class AnalysisResult(BaseModel):
    bpm: float = Field(..., description="Estimated tempo in beats per minute.", example=120.0)
    beat_timestamps: List[float] = Field(..., description="List of timestamps for each detected beat.", example=[0.0, 0.5, 1.0, 1.5])
    melody_map: List[MelodyNote] = Field(..., description="The extracted melody as a list of notes.")
    analysis_info: AnalysisInfo = Field(..., description="Detailed information about the analysis process.")

# --- API Endpoint Specific Models ---

# POST /analyze
class AnalyzeResponse(BaseModel):
    task_id: str = Field(..., description="A unique ID for the analysis task.", example="a1b2c3d4-e5f6-7890-1234-56789abcdef0")
    backend: Literal["celery", "in-memory"] = Field(..., description="The backend used for processing.", example="in-memory")

# GET /results/{task_id} and SSE events
class SuccessResponse(BaseModel):
    state: Literal["SUCCESS"] = Field("SUCCESS", description="The task completed successfully.")
    result: AnalysisResult

class StatusResponse(BaseModel):
    state: Union[Literal["PENDING"], Literal["PROCESSING"]] = Field(..., description="The task is still being processed.", example="PROCESSING")
    status: str = Field(..., description="A message describing the current status.", example="Processing audio file...")

class FailureResponse(BaseModel):
    state: Literal["FAILURE"] = Field("FAILURE", description="The task failed during execution.")
    status: str = Field(..., description="A message describing the error.", example="Audio analysis failed due to an invalid file format.")

# Union model for the /results endpoint
TaskResultResponse = Union[SuccessResponse, StatusResponse, FailureResponse]

# The following models are for documenting the SSE stream, which has additional states not returned by the /results endpoint.
class NotFoundResponse(BaseModel):
    state: Literal["NOT_FOUND"] = Field("NOT_FOUND", description="The requested task ID was not found.")
    status: str = Field("Task not found", description="A message indicating the task ID is not valid.")

class StreamErrorResponse(BaseModel):
    state: Literal["ERROR"] = Field("ERROR", description="An error occurred with the SSE stream itself.")
    status: str = Field(..., example="Stream error: connection closed unexpectedly.") 