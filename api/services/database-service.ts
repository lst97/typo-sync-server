import { PGlite, ensureDir } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import {
	AudioFingerprint,
	AnalysisCache,
	QueueItem,
	QueuePosition,
	QueueStatistics,
	AudioRepository,
	CacheRepository,
	QueueRepository,
	QueueStatus,
} from "../types/domain.ts";

// Database row types for type safety
interface AudioFingerprintRow {
	id: string;
	content_hash: string;
	perceptual_hash: string;
	metadata_hash: string;
	file_size: string;
	duration_seconds: string;
	format: string;
	created_at: string;
}

interface AnalysisCacheRow {
	id: string;
	audio_fingerprint_id: string;
	bpm: string;
	beat_timestamps: string | object;
	melody_map: string | object;
	analysis_info: string | object;
	algorithm_version: string;
	created_at: string;
	last_accessed_at: string;
	access_count: string;
}

interface QueueItemRow {
	id: string;
	task_id: string;
	audio_fingerprint_id: string;
	priority: string;
	status: QueueStatus;
	queued_at: string;
	started_at: string | null;
	completed_at: string | null;
	error_message: string | null;
}

export class DatabaseService {
	private db: PGlite | null = null;
	public audioRepository: AudioRepository;
	public cacheRepository: CacheRepository;
	public queueRepository: QueueRepository;
	private dataDir: string;

	constructor(
		dataDir: string = Deno.env.get("DATABASE_URL") ?? "./data/typosync.db"
	) {
		this.dataDir = dataDir;
		this.audioRepository = new AudioRepositoryImpl(() => this.getDb());
		this.cacheRepository = new CacheRepositoryImpl(() => this.getDb());
		this.queueRepository = new QueueRepositoryImpl(() => this.getDb());
	}

	private getDb(): PGlite {
		if (!this.db) {
			throw new Error("Database not initialized");
		}
		return this.db;
	}

	private async cleanupStaleFiles(): Promise<void> {
		if (this.dataDir === ":memory:") return;

		try {
			const lockFile = `${this.dataDir}/.s.PGSQL.5432.lock.out`;
			const pidFile = `${this.dataDir}/postmaster.pid`;

			// Check if lock file exists and remove it
			try {
				await Deno.stat(lockFile);
				await Deno.remove(lockFile);
				logger.info("Removed stale lock file");
			} catch {
				// File doesn't exist, which is fine
			}

			// Check if PID file exists and remove it
			try {
				await Deno.stat(pidFile);
				await Deno.remove(pidFile);
				logger.info("Removed stale PID file");
			} catch {
				// File doesn't exist, which is fine
			}
		} catch (error) {
			logger.warn(
				"Could not clean up stale files",
				error instanceof Error ? error : new Error(String(error))
			);
		}
	}

	private async recoverFromCorruption(): Promise<void> {
		if (this.dataDir === ":memory:") return;

		try {
			logger.info("Attempting to recover from database corruption...");

			// Remove the entire database directory
			try {
				await Deno.stat(this.dataDir);
				await Deno.remove(this.dataDir, { recursive: true });
				logger.info("Removed corrupted database directory");
			} catch {
				// Directory doesn't exist, which is fine
			}

			// Recreate the parent directory
			const parentDir = this.dataDir.split("/").slice(0, -1).join("/");
			if (parentDir) {
				await ensureDir(parentDir);
			}

			logger.info("Database recovery preparation completed");
		} catch (error) {
			logger.error(
				"Database recovery failed",
				error instanceof Error ? error : new Error(String(error))
			);
			throw error;
		}
	}

	async initialize(): Promise<void> {
		try {
			// Close existing connection if any
			if (this.db) {
				await this.db.close();
				this.db = null;
			}

			// For in-memory database, just use new PGlite()
			if (this.dataDir === ":memory:") {
				this.db = new PGlite();
			} else {
				// Ensure the data directory exists
				const parentDir = this.dataDir.split("/").slice(0, -1).join("/");
				if (parentDir) {
					await ensureDir(parentDir);
				}

				// Clean up stale lock files that might prevent database startup
				await this.cleanupStaleFiles();

				// Add retry logic for database initialization
				let retries = 3;
				while (retries > 0) {
					try {
						this.db = new PGlite(this.dataDir);
						break;
					} catch {
						retries--;
						if (retries === 0) {
							// If all retries failed, try to recover by removing corrupted data
							logger.warn(
								"Database initialization failed after all retries, attempting recovery..."
							);
							await this.recoverFromCorruption();

							// Final attempt with clean database
							try {
								this.db = new PGlite(this.dataDir);
								logger.info("Database recovered successfully");
								break;
							} catch {
								logger.error(
									"Database recovery failed, falling back to in-memory database"
								);
								this.db = new PGlite(); // Fallback to in-memory
								this.dataDir = ":memory:";
								break;
							}
						}
						logger.warn(
							`Database initialization failed, retrying... (${retries} retries left)`
						);

						// Clean up stale files on retry
						await this.cleanupStaleFiles();
						await new Promise((resolve) => setTimeout(resolve, 1000));
					}
				}
			}

			logger.info("Database initialized successfully");
		} catch (error) {
			logger.error(
				"Failed to initialize database",
				error instanceof Error ? error : new Error(String(error))
			);
			this.db = null;
			throw error;
		}
	}

	async migrate(): Promise<void> {
		if (!this.db) {
			throw new Error("Database not initialized");
		}

		try {
			// Check if database is ready before migration
			await this.healthCheck();

			await this.db.exec(`
        -- Audio fingerprints table
        CREATE TABLE IF NOT EXISTS audio_fingerprints (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          content_hash VARCHAR(64) UNIQUE NOT NULL,
          perceptual_hash VARCHAR(64),
          metadata_hash VARCHAR(64),
          file_size BIGINT NOT NULL,
          duration_seconds DECIMAL(10,3),
          format VARCHAR(10),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_audio_content_hash ON audio_fingerprints(content_hash);
        CREATE INDEX IF NOT EXISTS idx_audio_perceptual_hash ON audio_fingerprints(perceptual_hash);
        CREATE INDEX IF NOT EXISTS idx_audio_created_at ON audio_fingerprints(created_at);

        -- Analysis cache table
        CREATE TABLE IF NOT EXISTS analysis_cache (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          audio_fingerprint_id UUID REFERENCES audio_fingerprints(id) ON DELETE CASCADE,
          bpm DECIMAL(6,2) NOT NULL,
          beat_timestamps JSONB NOT NULL,
          melody_map JSONB NOT NULL,
          analysis_info JSONB NOT NULL,
          algorithm_version VARCHAR(10) NOT NULL DEFAULT '1.0',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          access_count INTEGER DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_cache_fingerprint_id ON analysis_cache(audio_fingerprint_id);
        CREATE INDEX IF NOT EXISTS idx_cache_algorithm_version ON analysis_cache(algorithm_version);
        CREATE INDEX IF NOT EXISTS idx_cache_last_accessed ON analysis_cache(last_accessed_at);

        -- Processing queue table
        CREATE TABLE IF NOT EXISTS processing_queue (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id VARCHAR(26) UNIQUE NOT NULL,
          audio_fingerprint_id UUID REFERENCES audio_fingerprints(id),
          priority INTEGER DEFAULT 1,
          status VARCHAR(20) DEFAULT 'QUEUED',
          queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          started_at TIMESTAMP WITH TIME ZONE,
          completed_at TIMESTAMP WITH TIME ZONE,
          error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_queue_task_id ON processing_queue(task_id);
        CREATE INDEX IF NOT EXISTS idx_queue_status_priority ON processing_queue(status, priority DESC, queued_at);
        CREATE INDEX IF NOT EXISTS idx_queue_queued_at ON processing_queue(queued_at);

        -- Queue statistics table
        CREATE TABLE IF NOT EXISTS queue_statistics (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          total_queued INTEGER NOT NULL,
          currently_processing INTEGER NOT NULL,
          avg_processing_time_ms DECIMAL(10,2),
          cache_hit_rate DECIMAL(5,4)
        );

        CREATE INDEX IF NOT EXISTS idx_stats_recorded_at ON queue_statistics(recorded_at);
      `);

			logger.info("Database migration completed successfully");
		} catch (error) {
			logger.error(
				"Database migration failed",
				error instanceof Error ? error : new Error(String(error))
			);
			throw error;
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			if (!this.db) return false;

			// Add retry logic for health checks
			let retries = 3;
			while (retries > 0) {
				try {
					const result = await this.db.query("SELECT 1 as health");
					return result.rows.length > 0;
				} catch (error) {
					retries--;
					if (retries === 0) {
						throw error;
					}
					logger.warn(
						`Database health check failed, retrying... (${retries} retries left)`
					);
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
			}

			return false;
		} catch (error) {
			logger.error(
				"Database health check failed",
				error instanceof Error ? error : new Error(String(error))
			);
			return false;
		}
	}

	async query(sql: string, params?: unknown[]): Promise<unknown[]> {
		if (!this.db) {
			throw new Error("Database not initialized");
		}

		const result = await this.db.query(sql, params);
		return result.rows;
	}

	async close(): Promise<void> {
		if (this.db) {
			await this.db.close();
			this.db = null;
			logger.info("Database connection closed");
		}
	}

	/**
	 * Get the data directory path
	 */
	getDataDir(): string {
		return this.dataDir;
	}
}

// Repository Implementations
class AudioRepositoryImpl implements AudioRepository {
	constructor(private getDb: () => PGlite) {}

	async save(fingerprint: AudioFingerprint): Promise<AudioFingerprint> {
		const db = this.getDb();

		if (fingerprint.id) {
			// Update existing
			const result = await db.query(
				`
        UPDATE audio_fingerprints 
        SET content_hash = $1, perceptual_hash = $2, metadata_hash = $3, 
            file_size = $4, duration_seconds = $5, format = $6
        WHERE id = $7
        RETURNING *
      `,
				[
					fingerprint.contentHash,
					fingerprint.perceptualHash,
					fingerprint.metadataHash,
					fingerprint.fileSize,
					fingerprint.durationSeconds,
					fingerprint.format,
					fingerprint.id,
				]
			);

			return this.mapToAudioFingerprint(result.rows[0] as AudioFingerprintRow);
		} else {
			// Insert new
			const result = await db.query(
				`
        INSERT INTO audio_fingerprints 
        (content_hash, perceptual_hash, metadata_hash, file_size, duration_seconds, format)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
				[
					fingerprint.contentHash,
					fingerprint.perceptualHash,
					fingerprint.metadataHash,
					fingerprint.fileSize,
					fingerprint.durationSeconds,
					fingerprint.format,
				]
			);

			return this.mapToAudioFingerprint(result.rows[0] as AudioFingerprintRow);
		}
	}

	async findByContentHash(hash: string): Promise<AudioFingerprint | null> {
		const db = this.getDb();
		const result = await db.query(
			"SELECT * FROM audio_fingerprints WHERE content_hash = $1",
			[hash]
		);

		return result.rows.length > 0
			? this.mapToAudioFingerprint(result.rows[0] as AudioFingerprintRow)
			: null;
	}

	async findByPerceptualHash(hash: string): Promise<AudioFingerprint[]> {
		const db = this.getDb();
		const result = await db.query(
			"SELECT * FROM audio_fingerprints WHERE perceptual_hash = $1",
			[hash]
		);

		return result.rows.map((row) =>
			this.mapToAudioFingerprint(row as AudioFingerprintRow)
		);
	}

	async findById(id: string): Promise<AudioFingerprint | null> {
		const db = this.getDb();
		const result = await db.query(
			"SELECT * FROM audio_fingerprints WHERE id = $1",
			[id]
		);

		return result.rows.length > 0
			? this.mapToAudioFingerprint(result.rows[0] as AudioFingerprintRow)
			: null;
	}

	private mapToAudioFingerprint(row: AudioFingerprintRow): AudioFingerprint {
		return new AudioFingerprint({
			id: row.id,
			contentHash: row.content_hash,
			perceptualHash: row.perceptual_hash,
			metadataHash: row.metadata_hash,
			fileSize: parseInt(row.file_size),
			durationSeconds: parseFloat(row.duration_seconds),
			format: row.format,
			createdAt: new Date(row.created_at),
		});
	}
}

class CacheRepositoryImpl implements CacheRepository {
	constructor(private getDb: () => PGlite) {}

	async save(cache: AnalysisCache): Promise<AnalysisCache> {
		const db = this.getDb();

		if (cache.id) {
			// Update existing
			const result = await db.query(
				`
        UPDATE analysis_cache 
        SET audio_fingerprint_id = $1, bpm = $2, beat_timestamps = $3, 
            melody_map = $4, analysis_info = $5, algorithm_version = $6,
            last_accessed_at = $7, access_count = $8
        WHERE id = $9
        RETURNING *
      `,
				[
					cache.audioFingerprintId,
					cache.bpm,
					JSON.stringify(cache.beatTimestamps),
					JSON.stringify(cache.melodyMap),
					JSON.stringify(cache.analysisInfo),
					cache.algorithmVersion,
					cache.lastAccessedAt,
					cache.accessCount,
					cache.id,
				]
			);

			return this.mapToAnalysisCache(result.rows[0] as AnalysisCacheRow);
		} else {
			// Insert new
			const result = await db.query(
				`
        INSERT INTO analysis_cache 
        (audio_fingerprint_id, bpm, beat_timestamps, melody_map, analysis_info, algorithm_version, last_accessed_at, access_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
				[
					cache.audioFingerprintId,
					cache.bpm,
					JSON.stringify(cache.beatTimestamps),
					JSON.stringify(cache.melodyMap),
					JSON.stringify(cache.analysisInfo),
					cache.algorithmVersion,
					cache.lastAccessedAt,
					cache.accessCount,
				]
			);

			return this.mapToAnalysisCache(result.rows[0] as AnalysisCacheRow);
		}
	}

	async findByFingerprint(
		fingerprintId: string
	): Promise<AnalysisCache | null> {
		const db = this.getDb();
		const result = await db.query(
			"SELECT * FROM analysis_cache WHERE audio_fingerprint_id = $1",
			[fingerprintId]
		);

		return result.rows.length > 0
			? this.mapToAnalysisCache(result.rows[0] as AnalysisCacheRow)
			: null;
	}

	async updateAccessStats(id: string): Promise<void> {
		const db = this.getDb();
		await db.query(
			`
      UPDATE analysis_cache 
      SET access_count = access_count + 1, last_accessed_at = NOW()
      WHERE id = $1
    `,
			[id]
		);
	}

	async cleanupExpired(olderThan: Date): Promise<number> {
		const db = this.getDb();
		const result = await db.query(
			"DELETE FROM analysis_cache WHERE created_at < $1",
			[olderThan]
		);

		return result.affectedRows || 0;
	}

	async findById(id: string): Promise<AnalysisCache | null> {
		const db = this.getDb();
		const result = await db.query(
			"SELECT * FROM analysis_cache WHERE id = $1",
			[id]
		);

		return result.rows.length > 0
			? this.mapToAnalysisCache(result.rows[0] as AnalysisCacheRow)
			: null;
	}

	private mapToAnalysisCache(row: AnalysisCacheRow): AnalysisCache {
		return new AnalysisCache({
			id: row.id,
			audioFingerprintId: row.audio_fingerprint_id,
			bpm: parseFloat(row.bpm),
			beatTimestamps:
				typeof row.beat_timestamps === "string"
					? JSON.parse(row.beat_timestamps)
					: row.beat_timestamps,
			melodyMap:
				typeof row.melody_map === "string"
					? JSON.parse(row.melody_map)
					: row.melody_map,
			analysisInfo:
				typeof row.analysis_info === "string"
					? JSON.parse(row.analysis_info)
					: row.analysis_info,
			algorithmVersion: row.algorithm_version,
			createdAt: new Date(row.created_at),
			lastAccessedAt: new Date(row.last_accessed_at),
			accessCount: parseInt(row.access_count),
		});
	}
}

class QueueRepositoryImpl implements QueueRepository {
	constructor(private getDb: () => PGlite) {}

	async enqueue(item: QueueItem): Promise<void> {
		const db = this.getDb();

		await db.query(
			`
      INSERT INTO processing_queue 
      (task_id, audio_fingerprint_id, priority, status, queued_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
			[
				item.taskId,
				item.audioFingerprintId,
				item.priority,
				item.status,
				item.queuedAt,
			]
		);
	}

	async dequeue(limit: number = 1): Promise<QueueItem[]> {
		const db = this.getDb();

		const result = await db.query(
			`
      SELECT * FROM processing_queue 
      WHERE status = 'QUEUED'
      ORDER BY priority ASC, queued_at ASC
      LIMIT $1
    `,
			[limit]
		);

		return result.rows.map((row) => this.mapToQueueItem(row as QueueItemRow));
	}

	async findByTaskId(taskId: string): Promise<QueueItem | null> {
		const db = this.getDb();
		const result = await db.query(
			"SELECT * FROM processing_queue WHERE task_id = $1",
			[taskId]
		);

		return result.rows.length > 0
			? this.mapToQueueItem(result.rows[0] as QueueItemRow)
			: null;
	}

	async updateStatus(
		taskId: string,
		status: QueueStatus,
		errorMessage?: string
	): Promise<void> {
		const db = this.getDb();

		let updateFields = "status = $1";
		const params: unknown[] = [status];

		if (status === "PROCESSING") {
			updateFields += ", started_at = NOW()";
		} else if (status === "COMPLETED" || status === "FAILED") {
			updateFields += ", completed_at = NOW()";
		}

		if (status === "FAILED" && errorMessage) {
			updateFields += ", error_message = $2";
			params.push(errorMessage);
		}

		params.push(taskId);

		await db.query(
			`
      UPDATE processing_queue 
      SET ${updateFields}
      WHERE task_id = $${params.length}
    `,
			params
		);
	}

	async getQueueStats(): Promise<QueueStatistics> {
		const db = this.getDb();

		const queuedResult = await db.query(
			"SELECT COUNT(*) as count FROM processing_queue WHERE status = 'QUEUED'"
		);

		const processingResult = await db.query(
			"SELECT COUNT(*) as count FROM processing_queue WHERE status = 'PROCESSING'"
		);

		const avgProcessingResult = await db.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_time
      FROM processing_queue 
      WHERE status IN ('COMPLETED', 'FAILED') AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND completed_at > NOW() - INTERVAL '1 hour'
    `);

		const avgWaitResult = await db.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (started_at - queued_at)) * 1000) as avg_wait
      FROM processing_queue 
      WHERE status IN ('PROCESSING', 'COMPLETED', 'FAILED') AND started_at IS NOT NULL
      AND started_at > NOW() - INTERVAL '1 hour'
    `);

		return new QueueStatistics(
			parseInt((queuedResult.rows[0] as { count: string }).count || "0"),
			parseInt((processingResult.rows[0] as { count: string }).count || "0"),
			parseFloat(
				(avgProcessingResult.rows[0] as { avg_time: string }).avg_time ||
					"30000"
			), // Default 30 seconds
			parseFloat(
				(avgWaitResult.rows[0] as { avg_wait: string }).avg_wait || "10000"
			), // Default 10 seconds
			0.0 // Cache hit rate will be calculated elsewhere
		);
	}

	async getQueuePosition(taskId: string): Promise<QueuePosition | null> {
		const db = this.getDb();

		const result = await db.query(
			`
      SELECT position FROM (
        SELECT 
          task_id,
          ROW_NUMBER() OVER (ORDER BY priority ASC, queued_at ASC) as position
        FROM processing_queue 
        WHERE status = 'QUEUED'
      ) ranked
      WHERE task_id = $1
    `,
			[taskId]
		);

		if (result.rows.length === 0) return null;

		const stats = await this.getQueueStats();
		const position = parseInt(
			(result.rows[0] as { position: string }).position
		);
		const estimatedWaitTime = stats.getEstimatedWaitTime(position);

		return new QueuePosition(position, estimatedWaitTime);
	}

	private mapToQueueItem(row: QueueItemRow): QueueItem {
		return new QueueItem({
			id: row.id,
			taskId: row.task_id,
			audioFingerprintId: row.audio_fingerprint_id,
			priority: parseInt(row.priority),
			status: row.status,
			queuedAt: new Date(row.queued_at),
			startedAt: row.started_at ? new Date(row.started_at) : undefined,
			completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
			errorMessage: row.error_message || undefined,
		});
	}
}
