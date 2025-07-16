import { assertEquals } from "../deps.ts";
import { TurnstileService } from "../services/turnstile-service.ts";

Deno.test("TurnstileService - initialization without secret key", () => {
	const service = new TurnstileService();
	assertEquals(service.isEnabled(), false);
});

Deno.test("TurnstileService - initialization with secret key", () => {
	const service = new TurnstileService("test-secret-key");
	assertEquals(service.isEnabled(), true);
});

Deno.test(
	"TurnstileService - validation without secret key returns success",
	async () => {
		const service = new TurnstileService();
		const result = await service.validateToken("test-token");
		assertEquals(result.success, true);
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
