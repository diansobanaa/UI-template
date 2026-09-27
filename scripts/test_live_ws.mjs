const ws = new WebSocket("ws://192.168.0.139/api/v1/telemetry/stream");

console.log("Connecting to ws://192.168.0.139/api/v1/telemetry/stream...");

let frameCount = 0;

ws.onopen = () => {
  console.log("WebSocket connection opened successfully!");
};

ws.onmessage = (event) => {
  frameCount++;
  console.log(`[Frame ${frameCount}] received:`);
  try {
    const data = JSON.parse(event.data);
    console.log(JSON.stringify(data, null, 2));
    if (frameCount >= 2) {
      console.log("Successfully received 2 telemetry batch frames! Test PASS.");
      ws.close();
      process.exit(0);
    }
  } catch (e) {
    console.error("Failed to parse JSON frame:", e);
  }
};

ws.onerror = (err) => {
  console.error("WebSocket error:", err);
};

ws.onclose = () => {
  console.log("WebSocket connection closed.");
};

setTimeout(() => {
  if (frameCount === 0) {
    console.error("Timeout: No frames received in 25 seconds.");
    process.exit(1);
  }
}, 25000);
