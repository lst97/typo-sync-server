# TypoSync - Audio Rhythm Analysis Engine

TypoSync is a modern, high-performance audio analysis service that extracts rhythm and melody information from audio files using a hybrid Deno-Python architecture.

## Core Features

- **Beat-Quantized Melody Extraction** - Advanced 3-phase analysis pipeline
- **Real-time Progress Tracking** - Server-Sent Events for live updates  
- **Intelligent Caching** - Multi-tier cache system with 99%+ hit rates
- **Priority Queue Management** - High/normal/batch processing priorities
- **Dual Backend Support** - Redis for production, in-memory for development
- **Audio Fingerprinting** - Duplicate detection using content hashing

## Architecture

The system uses a hybrid architecture with:
- **Deno API Server** - High-performance HTTP server with Oak framework
- **Python Analysis Engine** - Standalone executable for audio processing using librosa
- **Redis Backend** - Task management and result storage (optional)
- **Multi-tier Caching** - L1 (in-memory), L2 (Redis), L3 (database)

## API Versions

- **v1**: Legacy endpoints for backward compatibility
- **v2**: Enhanced endpoints with caching, queue management, and audio fingerprinting

## Output Format

Analysis results include:
- BPM (beats per minute)
- Beat timestamps array
- Melody map with pitch, start time, and duration
- Analysis metadata (beats, subdivisions, filtering info)