import { discoverIRevElections, dedupeElections } from "../src/lib/irev-discovery.mjs";

const elections = dedupeElections(await discoverIRevElections());
console.log(JSON.stringify({
  source: "IReV",
  discoveredAt: new Date().toISOString(),
  count: elections.length,
  elections,
}, null, 2));
