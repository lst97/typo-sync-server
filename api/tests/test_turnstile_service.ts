import { assertEquals } from "../deps.ts";
import { TurnstileService } from "../services/turnstile-service.ts";

Deno.test("TurnstileService - initialization without secret key", () => {
	// Clear environment variable to ensure clean test
	const originalKey = Deno.env.get("TURNSTILE_SECRET_KEY");
	Deno.env.delete("TURNSTILE_SECRET_KEY");
	
	try {
		const service = new TurnstileService();
		assertEquals(service.isEnabled(), false);
	} finally {
		// Restore original value
		if (originalKey) {
			Deno.env.set("TURNSTILE_SECRET_KEY", originalKey);
		}
	}
});

Deno.test("TurnstileService - initialization with secret key", () => {
	const service = new TurnstileService("test-secret-key");
	assertEquals(service.isEnabled(), true);
});

Deno.test(
	"TurnstileService - validation without secret key returns success",
	async () => {
		// Clear environment variable to ensure clean test
		const originalKey = Deno.env.get("TURNSTILE_SECRET_KEY");
		Deno.env.delete("TURNSTILE_SECRET_KEY");
		
		try {
			const service = new TurnstileService();
			const result = await service.validateToken("test-token");
			assertEquals(result.success, true);
		} finally {
			// Restore original value
			if (originalKey) {
				Deno.env.set("TURNSTILE_SECRET_KEY", originalKey);
			}
		}
	}
);

Deno.test(
	"TurnstileService - validation with empty token returns error",
	async () => {
		const service = new TurnstileService("test-secret-key");
		const result = await service.validateToken("");
		assertEquals(result.success, false);
		assertEquals(result.error, "Turnstile token is required");
	}
);

Deno.test(
	"TurnstileService - validation with missing token returns error",
	async () => {
		const service = new TurnstileService("test-secret-key");
		const result = await service.validateToken("");
		assertEquals(result.success, false);
		assertEquals(result.error, "Turnstile token is required");
	}
);
