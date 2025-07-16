import { z } from "../deps.ts";
import { MelodyNote, AnalysisInfo } from "./schemas.ts";

// Domain Value Objects
export class AudioFingerprint {
  public id?: string;
  public contentHash: string;
  public perceptualHash: string;
  public metadataHash: string;
  public fileSize: number;
  public durationSeconds: number;
  public format: string;
  public createdAt: Date;

  constructor(data: {
    id?: string;
    contentHash: string;
    perceptualHash: string;
    metadataHash: string;
    fileSize: number;
    durationSeconds: number;
    format: string;
    createdAt?: Date;
  }) {
    this.id = data.id;
    this.contentHash = data.contentHash;
    this.perceptualHash = data.perceptualHash;
    this.metadataHash = data.metadataHash;
    this.fileSize = data.fileSize;
    this.durationSeconds = data.durationSeconds;
    this.format = data.format;
    this.createdAt = data.createdAt || new Date();
  }

  equals(other: AudioFingerprint): boolean {
    return this.contentHash === other.contentHash;
  }

  isSimilar(other: AudioFingerprint): boolean {
    return this.perceptualHash === other.perceptualHash;
  }
}

export class AnalysisCache {
  public id?: string;
  public audioFingerprintId: string;
  public bpm: number;
  public beatTimestamps: number[];
  public melodyMap: MelodyNote[];
  public analysisInfo: AnalysisInfo;
  public algorithmVersion: string;
  public createdAt: Date;
  public lastAccessedAt: Date;
  public accessCount: number;

  constructor(data: {
    id?: string;
    audioFingerprintId: string;
    bpm: number;
    beatTimestamps: number[];
    melodyMap: MelodyNote[];
    analysisInfo: AnalysisInfo;
    algorithmVersion: string;
    createdAt?: Date;
    lastAccessedAt?: Date;
    accessCount?: number;
  }) {
    this.id = data.id;
    this.audioFingerprintId = data.audioFingerprintId;
    this.bpm = data.bpm;
    this.beatTimestamps = data.beatTimestamps;
    this.melodyMap = data.melodyMap;
    this.analysisInfo = data.analysisInfo;
    this.algorithmVersion = data.algorithmVersion;
    this.createdAt = data.createdAt || new Date();
    this.lastAccessedAt = data.lastAccessedAt || new Date();
    this.accessCount = data.accessCount || 1;
  }

  incrementAccess(): void {
    this.accessCount++;
    this.lastAccessedAt = new Date();
  }

  isExpired(ttlDays: number): boolean {
    const expireDate = new Date(this.createdAt.getTime() + (ttlDays * 24 * 60 * 60 * 1000));
    return new Date() > expireDate;
  }
}

export class QueueItem {
  public id?: string;
  public taskId: string;
  public audioFingerprintId: string;
  public priority: number;
  public status: QueueStatus;
  public queuedAt: Date;
  public startedAt?: Date;
  public completedAt?: Date;
  public errorMessage?: string;

  constructor(data: {
    id?: string;
    taskId: string;
    audioFingerprintId: string;
    priority: number;
    status: QueueStatus;
    queuedAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
    errorMessage?: string;
  }) {
    this.id = data.id;
    this.taskId = data.taskId;
    this.audioFingerprintId = data.audioFingerprintId;
    this.priority = data.priority;
    this.status = data.status;
    this.queuedAt = data.queuedAt || new Date();
    this.startedAt = data.startedAt;
    this.completedAt = data.completedAt;
    this.errorMessage = data.errorMessage;
  }

  markStarted(): void {
    this.status = "PROCESSING";
    this.startedAt = new Date();
  }

  markCompleted(): void {
    this.status = "COMPLETED";
    this.completedAt = new Date();
  }

  markFailed(error: string): void {
    this.status = "FAILED";
    this.errorMessage = error;
    this.completedAt = new Date();
  }

  getProcessingTimeMs(): number | null {
    if (!this.startedAt || !this.completedAt) return null;
    return this.completedAt.getTime() - this.startedAt.getTime();
  }

  getWaitTimeMs(): number | null {
    if (!this.startedAt) return null;
    return this.startedAt.getTime() - this.queuedAt.getTime();
  }
}

// Domain Services
export class QueuePosition {
  constructor(
    public readonly position: number,
    public readonly estimatedWaitTimeMs: number
  ) {}

  getEstimatedWaitTimeMinutes(): number {
    return Math.ceil(this.estimatedWaitTimeMs / 60000);
  }
}

export class QueueStatistics {
  constructor(
    public readonly totalQueued: number,
    public readonly currentlyProcessing: number,
    public readonly averageProcessingTimeMs: number,
    public readonly averageWaitTimeMs: number,
    public readonly cacheHitRate: number
  ) {}

  getEstimatedWaitTime(position: number): number {
    if (position <= 0) return 0;
    
    // Simple estimation: average processing time * position / current processing capacity
    const processingCapacity = Math.max(1, this.currentlyProcessing);
    return Math.ceil((this.averageProcessingTimeMs * position) / processingCapacity);
  }
}

// Enums and Types
export type QueueStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type Priority = 1 | 2 | 3; // 1 = high, 2 = normal, 3 = batch

// Repository Interfaces
export interface AudioRepository {
  save(fingerprint: AudioFingerprint): Promise<AudioFingerprint>;
  findByContentHash(hash: string): Promise<AudioFingerprint | null>;
  findByPerceptualHash(hash: string): Promise<AudioFingerprint[]>;
  findById(id: string): Promise<AudioFingerprint | null>;
}

export interface CacheRepository {
  save(cache: AnalysisCache): Promise<AnalysisCache>;
  findByFingerprint(fingerprintId: string): Promise<AnalysisCache | null>;
  updateAccessStats(id: string): Promise<void>;
  cleanupExpired(olderThan: Date): Promise<number>;
  findById(id: string): Promise<AnalysisCache | null>;
}

export interface QueueRepository {
  enqueue(item: QueueItem): Promise<void>;
  dequeue(limit?: number): Promise<QueueItem[]>;
  findByTaskId(taskId: string): Promise<QueueItem | null>;
  updateStatus(taskId: string, status: QueueStatus, errorMessage?: string): Promise<void>;
  getQueueStats(): Promise<QueueStatistics>;
  getQueuePosition(taskId: string): Promise<QueuePosition | null>;
}

// Domain Events
export interface DomainEvent {
  type: string;
  timestamp: Date;
  data: unknown;
}

export class AudioQueuedEvent implements DomainEvent {
  public readonly type = "AUDIO_QUEUED";
  public readonly timestamp = new Date();
  
  constructor(
    public readonly data: {
      taskId: string;
      audioHash: string;
      queuePosition: number;
    }
  ) {}
}

export class ProcessingStartedEvent implements DomainEvent {
  public readonly type = "PROCESSING_STARTED";
  public readonly timestamp = new Date();
  
  constructor(
    public readonly data: {
      taskId: string;
      startedAt: Date;
    }
  ) {}
}

export class ProcessingCompletedEvent implements DomainEvent {
  public readonly type = "PROCESSING_COMPLETED";
  public readonly timestamp = new Date();
  
  constructor(
    public readonly data: {
      taskId: string;
      processingTimeMs: number;
      cacheHit: boolean;
    }
  ) {}
}

export class CacheHitEvent implements DomainEvent {
  public readonly type = "CACHE_HIT";
  public readonly timestamp = new Date();
  
  constructor(
    public readonly data: {
      audioHash: string;
      cacheLevel: "L1" | "L2" | "DB";
    }
  ) {}
}