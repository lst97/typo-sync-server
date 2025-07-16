import { Context } from "../deps.ts";
import { logger } from "../utils/logger.ts";

const REDOC_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>TypoSync API Documentation</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <style>
      body {
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body>
    <redoc spec-url="/docs/openapi.yaml"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2.5.0/bundles/redoc.standalone.js"> </script>
  </body>
</html>`;

export class DocsHandler {
	// deno-lint-ignore require-await
	async serveDocs(ctx: Context) {
		logger.debug("Serving API documentation");

		ctx.response.headers.set("Content-Type", "text/html");
		ctx.response.body = REDOC_HTML;
	}

	async serveOpenApiSpec(ctx: Context) {
		logger.debug("Serving OpenAPI specification");

		try {
			const specPath = new URL("./openapi.yaml", import.meta.url).pathname;
			const spec = await Deno.readTextFile(specPath);

			ctx.response.headers.set("Content-Type", "application/yaml");
			ctx.response.body = spec;
		} catch (error) {
			logger.error(
				"Failed to load OpenAPI spec",
				error instanceof Error ? error : new Error(String(error))
			);
			ctx.response.status = 500;
			ctx.response.body = { detail: "Failed to load API specification" };
		}
	}
}
