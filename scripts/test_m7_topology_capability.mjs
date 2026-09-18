// Use native global fetch
const API_BASE = "http://localhost:3000"; // Assuming local Vite proxy or ESP32 simulator

async function verifyTopology() {
  console.log("== Starting M7 Topology & Capability Test ==");

  try {
    const res = await fetch(`${API_BASE}/api/v1/topology`);
    if (!res.ok) {
      console.error("Failed to fetch topology:", res.status, res.statusText);
      return;
    }
    const topo = await res.json();
    console.log("Topology State received:", JSON.stringify(topo, null, 2));

    let pass = true;
    for (const gh of topo.greenhouses) {
      console.log(`\nVerifying GH: ${gh.ghId}`);
      if (!gh.hydraulicallyReachable) {
        console.log(`[!] Not Reachable: ${gh.blockingReason}`);
      }
      if (gh.capabilities.CAN_DELIVER && gh.capabilities.CAN_AUTO_ROUTE && !gh.capabilities.CAN_RUN_AUTONOMOUSLY) {
        console.log("[FAIL] Should be able to run autonomously if it can deliver and route automatically.");
        pass = false;
      }
    }

    if (pass) {
      console.log("\n✅ Topology capabilities passed basic assertions.");
    } else {
      console.log("\n❌ Topology capabilities failed basic assertions.");
      process.exit(1);
    }
  } catch (err) {
    console.error("Test failed with exception:", err);
  }
}

verifyTopology();
