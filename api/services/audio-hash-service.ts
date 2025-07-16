import { logger } from "../utils/logger.ts";
import { SUPPORTED_AUDIO_TYPES } from "../types/schemas.ts";
import type { SupportedAudioType } from "../types/schemas.ts";

export interface AudioMetadata {
	fileSize: number;
	duration: number;
	format: string;
}

export interface AudioHashes {
	contentHash: string;
	perceptualHash: string;
	metadataHash: string;
}

export class AudioHashService {
	private readonly SIMILARITY_THRESHOLD = 0.8; // Threshold for similarity matching

	/**
	 * Generate SHA-256 hash of audio content for exact duplicate detection
	 */
	async generateContentHash(audioBuffer: Uint8Array): Promise<string> {
		try {
			const hashBuffer = await crypto.subtle.digest("SHA-256", audioBuffer);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			const hashHex = hashArray
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");

			logger.debug("Generated content hash", {
				bufferSize: audioBuffer.length,
				hashLength: hashHex.length,
			});

			return hashHex;
		} catch (error) {
			logger.error(
				"Failed to generate content hash",
				error instanceof Error ? error : new Error(String(error))
			);
			throw new Error("Content hash generation failed");
		}
	}

	/**
	 * Generate perceptual hash for near-duplicate detection
	 * This is a simplified implementation - in production, you'd use more sophisticated audio fingerprinting
	 */
	generatePerceptualHash(audioBuffer: Uint8Array): string {
		try {
			// For this implementation, we'll create a simplified perceptual hash
			// In a real system, you'd use spectral analysis, chromaprint, or similar

			// Simple approach: sample the audio at regular intervals and create a hash
			const samplePoints = 64; // Number of sample points
			const step = Math.max(1, Math.floor(audioBuffer.length / samplePoints));

			const samples: number[] = [];
			for (let i = 0; i < audioBuffer.length; i += step) {
				samples.push(audioBuffer[i]);
			}

			// Pad or truncate to exactly samplePoints
			while (samples.length < samplePoints) {
				samples.push(0);
			}
			samples.splice(samplePoints);

			// Calculate differences between adjacent samples
			const differences = samples.slice(1).map((val, i) => val - samples[i]);

			// Convert to binary hash (1 if difference > 0, 0 otherwise)
			const binaryHash = differences
				.map((diff) => (diff > 0 ? "1" : "0"))
				.join("");

			// Convert to hex for more compact representation
			const hexHash = this.binaryToHex(binaryHash);

			logger.debug("Generated perceptual hash", {
				bufferSize: audioBuffer.length,
				samplePoints: samples.length,
				hashLength: hexHash.length,
			});

			return hexHash;
		} catch (error) {
			logger.error(
				"Failed to generate perceptual hash",
				error instanceof Error ? error : new Error(String(error))
			);
			throw new Error("Perceptual hash generation failed");
		}
	}

	/**
	 * Generate metadata hash for secondary validation
	 */
	generateMetadataHash(metadata: AudioMetadata): string {
		try {
			const metadataString = `${metadata.fileSize}|${metadata.duration}|${metadata.format}`;

			// Use a simple hash function for metadata
			let hash = 0;
			for (let i = 0; i < metadataString.length; i++) {
				const char = metadataString.charCodeAt(i);
				hash = (hash << 5) - hash + char;
				hash = hash & hash; // Convert to 32-bit integer
			}

			const hashHex = Math.abs(hash).toString(16).padStart(8, "0");

			logger.debug("Generated metadata hash", {
				metadata: metadataString,
				hash: hashHex,
			});

			return hashHex;
		} catch (error) {
			logger.error(
				"Failed to generate metadata hash",
				error instanceof Error ? error : new Error(String(error))
			);
			throw new Error("Metadata hash generation failed");
		}
	}

	/**
	 * Generate all hash types for an audio file
	 */
	async generateAllHashes(
		audioBuffer: Uint8Array,
		metadata: AudioMetadata
	): Promise<AudioHashes> {
		try {
			const contentHash = await this.generateContentHash(audioBuffer);
			const perceptualHash = this.generatePerceptualHash(audioBuffer);

			const metadataHash = this.generateMetadataHash(metadata);

			return {
				contentHash,
				perceptualHash,
				metadataHash,
			};
		} catch (error) {
			logger.error(
				"Failed to generate all hashes",
				error instanceof Error ? error : new Error(String(error))
			);
			throw new Error("Hash generation failed");
		}
	}

	/**
	 * Check if two content hashes are an exact match
	 */
	isExactMatch(hash1: string, hash2: string): boolean {
		return hash1 === hash2;
	}

	/**
	 * Check if two perceptual hashes are similar
	 */
	isSimilar(hash1: string, hash2: string): boolean {
		if (hash1 === hash2) return true;

		try {
			// Convert hex hashes to binary for comparison
			const binary1 = this.hexToBinary(hash1);
			const binary2 = this.hexToBinary(hash2);

			if (binary1.length !== binary2.length) return false;

			// Calculate Hamming distance
			let differences = 0;
			for (let i = 0; i < binary1.length; i++) {
				if (binary1[i] !== binary2[i]) {
					differences++;
				}
			}

			// Calculate similarity ratio
			const similarity = 1 - differences / binary1.length;

			logger.debug("Calculated hash similarity", {
				hash1: hash1.substring(0, 8) + "...",
				hash2: hash2.substring(0, 8) + "...",
				differences,
				similarity,
				threshold: this.SIMILARITY_THRESHOLD,
			});

			return similarity >= this.SIMILARITY_THRESHOLD;
		} catch (error) {
			logger.error(
				"Failed to calculate similarity",
				error instanceof Error ? error : new Error(String(error))
			);
			return false;
		}
	}

	/**
	 * Check if a format is supported for hashing
	 */
	isSupportedFormat(format: string): boolean {
		// Check both direct format names and MIME types
		const normalizedFormat = format.toLowerCase();

		return (
			SUPPORTED_AUDIO_TYPES.includes(normalizedFormat as SupportedAudioType) ||
			normalizedFormat === "mp3" ||
			normalizedFormat === "wav"
		);
	}

	/**
	 * Estimate processing time based on buffer size
	 */
	estimateProcessingTime(bufferSize: number): number {
		// Simple estimation: ~1ms per KB
		return Math.max(100, bufferSize / 1024);
	}

	/**
	 * Utility: Convert binary string to hex
	 */
	private binaryToHex(binary: string): string {
		const padding = 4 - (binary.length % 4);
		const paddedBinary = binary + "0".repeat(padding % 4);

		let hex = "";
		for (let i = 0; i < paddedBinary.length; i += 4) {
			const chunk = paddedBinary.substring(i, i + 4);
			hex += parseInt(chunk, 2).toString(16);
		}

		return hex;
	}

	/**
	 * Utility: Convert hex string to binary
	 */
	private hexToBinary(hex: string): string {
		let binary = "";
		for (let i = 0; i < hex.length; i++) {
			const digit = parseInt(hex[i], 16);
			binary += digit.toString(2).padStart(4, "0");
		}
		return binary;
	}

	/**
	 * Validate hash format
	 */
	validateContentHash(hash: string): boolean {
		return /^[a-f0-9]{64}$/i.test(hash);
	}

	/**
	 * Validate perceptual hash format
	 */
	validatePerceptualHash(hash: string): boolean {
		return /^[a-f0-9]+$/i.test(hash) && hash.length > 0;
	}

	/**
	 * Validate metadata hash format
	 */
	validateMetadataHash(hash: string): boolean {
		return /^[a-f0-9]{8}$/i.test(hash);
	}
}
