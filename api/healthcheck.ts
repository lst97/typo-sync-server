/**
 * Docker health check script for the Deno API
 */

try {
  const response = await fetch("http://localhost:8000/", {
    method: "GET",
    signal: AbortSignal.timeout(5000), // 5 second timeout
  });

  if (response.ok) {
    const data = await response.json();
    
    if (data.status && data.status.includes("running")) {
      console.log("Health check passed");
      Deno.exit(0);
    } else {
      console.error("Service not running properly");
      Deno.exit(1);
    }
  } else {
    console.error(`Health check failed with status: ${response.status}`);
    Deno.exit(1);
  }
} catch (error) {
  console.error(`Health check failed: ${error.message}`);
  Deno.exit(1);
}