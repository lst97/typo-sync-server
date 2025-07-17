import { logger } from "../utils/logger.ts";

export interface TurnstileValidationResult {
	success: boolean;
	error?: string;
	challengeTs?: string;
	hostname?: string;
}

export class TurnstileService {
	private readonly secretKey: string;
	private readonly verifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

	constructor(secretKey?: string) {
		this.secretKey = secretKey || Deno.env.get("TURNSTILE_SECRET_KEY") || "";
		
		if (!this.secretKey) {
			logger.warn("Turnstile secret key not configured - validation will be skipped");
		}
	}

	/**
	 * Validate a Turnstile token
	 */
	async validateToken(token: string, remoteIp?: string): Promise<TurnstileValidationResult> {
		if (!this.secretKey) {
			logger.warn("Turnstile validation skipped - no secret key configured");
			return { success: true }; // Skip validation if not configured
		}

		if (!token) {
			return { 
				success: false, 
				error: "Turnstile token is required" 
			};
		}

		try {
			const formData = new FormData();
			formData.append("secret", this.secretKey);
			formData.append("response", token);
			
			if (remoteIp) {
				formData.append("remoteip", remoteIp);
			}

			const response = await fetch(this.verifyUrl, {
				method: "POST",
				body: formData,
			});

			if (!response.ok) {
				logger.error("Turnstile verification request failed", 
					new Error(`Request failed with status ${response.status}: ${response.statusText}`));
				return { 
					success: false, 
					error: "Turnstile verification service unavailable" 
				};
			}

			const result = await response.json();
			
			logger.debug("Turnstile validation result", {
				success: result.success,
				errorCodes: result["error-codes"],
			});

			if (!result.success) {
				const errorCodes = result["error-codes"] || [];
				let errorMessage = "Turnstile verification failed";
				
				if (errorCodes.includes("timeout-or-duplicate")) {
					errorMessage = "Turnstile token expired or already used";
				} else if (errorCodes.includes("invalid-input-response")) {
					errorMessage = "Invalid Turnstile token";
				} else if (errorCodes.includes("missing-input-response")) {
					errorMessage = "Turnstile token is required";
				}

				return { 
					success: false, 
					error: errorMessage 
				};
			}

			return {
				success: true,
				challengeTs: result.challenge_ts,
				hostname: result.hostname,
			};
		} catch (error) {
			logger.error("Turnstile validation error", error instanceof Error ? error : new Error(String(error)));
			return { 
				success: false, 
				error: "Turnstile verification failed" 
			};
		}
	}

	/**
	 * Check if Turnstile validation is enabled
	 */
	isEnabled(): boolean {
		return !!this.secretKey;
	}
}

// Export singleton instance
export const turnstileService = new TurnstileService();