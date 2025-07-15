# app/analysis_utils.py
import librosa
import logging
import numpy as np
from collections import Counter
from app.config import settings

logger = logging.getLogger(__name__)

def perform_analysis(file_path: str) -> dict:
    """
    Loads an audio file and performs beat-quantized melody extraction using librosa.
    
    This implementation follows a three-phase approach:
    1. Foundational Analysis: Extract beat grid and raw pitch contour
    2. Beat-Subdivision Pitch Analysis: Find dominant note per subdivision (8th notes)
    3. Consolidation & Humanization Filter: Merge notes and filter by minimum duration
    
    Returns a dictionary with bpm, beat timestamps, and a filtered melody map.
    """
    try:
        logger.info(f"Starting beat-quantized melody analysis for: {file_path}")
        y, sr = librosa.load(file_path)

        # ===== PHASE 1: FOUNDATIONAL ANALYSIS =====
        logger.info("Phase 1: Performing foundational analysis")
        
        # Beat Tracking (The Grid)
        bpm, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_timestamps = librosa.frames_to_time(beat_frames, sr=sr)
        
        # Raw Pitch Contour Extraction
        f0, voiced_flag, voiced_probs = librosa.pyin(
            y, 
            fmin=librosa.note_to_hz('C2'), 
            fmax=librosa.note_to_hz('C7')
        )
        pitch_times = librosa.times_like(f0)
        
        logger.info(f"Found {len(beat_timestamps)} beats and {len(f0)} pitch frames")

        # ===== PHASE 2: BEAT-SUBDIVISION PITCH ANALYSIS =====
        logger.info("Phase 2: Performing beat-subdivision pitch analysis")
        
        # Create a finer time grid using beat subdivisions (8th notes)
        subdivision_factor = 2  # 2 subdivisions per beat (8th notes)
        subdivision_notes = []
        subdivision_timestamps = []
        
        if len(beat_timestamps) > 1:
            # Calculate average beat duration
            avg_beat_duration = np.mean(np.diff(beat_timestamps))
            subdivision_duration = avg_beat_duration / subdivision_factor
            
            # Create subdivision grid
            for i in range(len(beat_timestamps) - 1):
                beat_start = beat_timestamps[i]
                beat_end = beat_timestamps[i + 1]
                
                # Create subdivisions within this beat
                for sub in range(subdivision_factor):
                    sub_start = beat_start + (sub * subdivision_duration)
                    sub_end = min(beat_start + ((sub + 1) * subdivision_duration), beat_end)
                    subdivision_timestamps.append(sub_start)
                    
                    # Find dominant note in this subdivision
                    dominant_note = find_dominant_note_in_interval(
                        sub_start, sub_end, pitch_times, f0, voiced_flag
                    )
                    subdivision_notes.append(dominant_note)
            
            # Handle the last beat
            if len(beat_timestamps) > 0:
                beat_start = beat_timestamps[-1]
                # Estimate end time for last beat
                beat_end = beat_start + avg_beat_duration
                
                for sub in range(subdivision_factor):
                    sub_start = beat_start + (sub * subdivision_duration)
                    sub_end = beat_start + ((sub + 1) * subdivision_duration)
                    subdivision_timestamps.append(sub_start)
                    
                    dominant_note = find_dominant_note_in_interval(
                        sub_start, sub_end, pitch_times, f0, voiced_flag
                    )
                    subdivision_notes.append(dominant_note)
        
        else:
            # Fallback for songs with very few beats - use fixed time grid
            total_duration = len(y) / sr
            subdivision_duration = 0.2  # 200ms subdivisions
            current_time = 0
            
            while current_time < total_duration:
                subdivision_timestamps.append(current_time)
                dominant_note = find_dominant_note_in_interval(
                    current_time, current_time + subdivision_duration, 
                    pitch_times, f0, voiced_flag
                )
                subdivision_notes.append(dominant_note)
                current_time += subdivision_duration
        
        logger.info(f"Beat-subdivision sequence: {subdivision_notes[:10]}..." if len(subdivision_notes) > 10 else f"Beat-subdivision sequence: {subdivision_notes}")

        # ===== PHASE 3: CONSOLIDATION & HUMANIZATION FILTER =====
        logger.info("Phase 3: Consolidating notes and applying humanization filter")
        
        # Step 1: Consolidate consecutive identical notes
        consolidated_melody = []
        
        if len(subdivision_notes) > 0 and len(subdivision_timestamps) > 0:
            current_note = subdivision_notes[0]
            current_start_time = subdivision_timestamps[0]
            current_subdivision_count = 1
            
            for i in range(1, len(subdivision_notes)):
                if subdivision_notes[i] == current_note:
                    # Same note continues
                    current_subdivision_count += 1
                else:
                    # Note changed, save the previous note
                    if current_note != "REST":
                        # Calculate duration based on subdivision count
                        if i < len(subdivision_timestamps):
                            duration = subdivision_timestamps[i] - current_start_time
                        else:
                            # For the last note, estimate duration
                            avg_subdivision_duration = np.mean(np.diff(subdivision_timestamps)) if len(subdivision_timestamps) > 1 else 0.2
                            duration = avg_subdivision_duration * current_subdivision_count
                        
                        consolidated_melody.append({
                            "pitch": current_note,
                            "start_time": float(current_start_time),
                            "duration": float(duration)
                        })
                    
                    # Start tracking the new note
                    current_note = subdivision_notes[i]
                    current_start_time = subdivision_timestamps[i] if i < len(subdivision_timestamps) else subdivision_timestamps[-1]
                    current_subdivision_count = 1
            
            # Don't forget the last note
            if current_note != "REST":
                # Calculate duration for the last note
                if len(subdivision_timestamps) > 1:
                    avg_subdivision_duration = np.mean(np.diff(subdivision_timestamps))
                    duration = avg_subdivision_duration * current_subdivision_count
                else:
                    duration = 0.2 * current_subdivision_count
                
                consolidated_melody.append({
                    "pitch": current_note,
                    "start_time": float(current_start_time),
                    "duration": float(duration)
                })
        
        # Step 2: Filter by minimum duration (humanization)
        MIN_NOTE_DURATION = settings.min_note_duration
        filtered_melody = [
            note for note in consolidated_melody 
            if note["duration"] >= MIN_NOTE_DURATION
        ]
        
        logger.info(f"Consolidated melody: {len(consolidated_melody)} notes")
        logger.info(f"Filtered melody (min duration {MIN_NOTE_DURATION}s): {len(filtered_melody)} notes")
        
        # Prepare the result
        result = {
            "bpm": float(bpm),
            "beat_timestamps": beat_timestamps.tolist(),
            "melody_map": filtered_melody,
            "analysis_info": {
                "total_beats": len(beat_timestamps),
                "total_subdivisions": len(subdivision_notes),
                "consolidated_notes": len(consolidated_melody),
                "filtered_notes": len(filtered_melody),
                "min_note_duration": MIN_NOTE_DURATION,
                "subdivision_factor": subdivision_factor
            }
        }
        
        logger.info(f"Successfully completed beat-quantized melody analysis for: {file_path}")
        return result
        
    except Exception as e:
        logger.error(f"Beat-quantized melody analysis failed for {file_path}", exc_info=True)
        raise e


def find_dominant_note_in_interval(start_time, end_time, pitch_times, f0, voiced_flag):
    """
    Find the dominant note in a given time interval.
    Returns the most common note or "REST" if no voiced notes found.
    """
    # Find all pitch frames within this time interval
    interval_indices = np.where(
        (pitch_times >= start_time) & (pitch_times < end_time)
    )[0]
    
    if len(interval_indices) == 0:
        return "REST"
    
    # Filter for voiced notes only
    voiced_indices = [
        idx for idx in interval_indices 
        if voiced_flag[idx] and not np.isnan(f0[idx])
    ]
    
    if len(voiced_indices) == 0:
        return "REST"
    
    # Convert frequencies to note names
    notes_in_interval = [
        librosa.hz_to_note(f0[idx]) for idx in voiced_indices
    ]
    
    # Find the most common note (mode) in this interval
    note_counter = Counter(notes_in_interval)
    dominant_note = note_counter.most_common(1)[0][0]
    
    return dominant_note
