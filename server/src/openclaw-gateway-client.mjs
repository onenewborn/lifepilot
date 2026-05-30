import { randomUUID } from "node:crypto";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

let clientPromise = null;
let client = null;

async function loadOpenClawRuntime() {
  const [{ n: GatewayClient }, { i: clientNames, r: clientModes }] = await Promise.all([
    import("/opt/homebrew/lib/node_modules/openclaw/dist/client-BGs41kAq.js"),
    import("/opt/homebrew/lib/node_modules/openclaw/dist/client-info-CgOISqZp.js"),
  ]);
  return { GatewayClient, clientNames, clientModes };
}

function gatewayUrl() {
  return process.env.LIFEPILOT_OPENCLAW_GATEWAY_URL || process.env.OPENCLAW_GATEWAY_WS || DEFAULT_GATEWAY_URL;
}

async function connectGatewayClient() {
  const { GatewayClient, clientNames, clientModes } = await loadOpenClawRuntime();
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("openclaw_gateway_connect_timeout"));
    }, 10000);

    const nextClient = new GatewayClient({
      url: gatewayUrl(),
      instanceId: randomUUID(),
      clientName: clientNames.GATEWAY_CLIENT,
      clientDisplayName: "lifepilot-backend",
      clientVersion: "lifepilot-next",
      platform: process.platform,
      mode: clientModes.BACKEND,
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      minProtocol: 4,
      maxProtocol: 4,
      onHelloOk: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        client = nextClient;
        resolve(nextClient);
      },
      onConnectError: (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
      onClose: () => {
        if (client === nextClient) client = null;
        clientPromise = null;
      },
    });
    nextClient.start();
  });
}

async function getGatewayClient() {
  if (client) return client;
  if (!clientPromise) clientPromise = connectGatewayClient();
  return await clientPromise;
}

export async function requestOpenClawAgent({message, sessionId, idempotencyKey, timeoutSeconds = 240, thinking} = {}) {
  const gateway = await getGatewayClient();
  const timeoutMs = Math.max(30, Math.min(Number(timeoutSeconds || 240), 900)) * 1000;
  return await gateway.request("agent", {
    message,
    sessionId,
    idempotencyKey: idempotencyKey || `lifepilot-${Date.now()}-${randomUUID().slice(0, 8)}`,
    thinking,
  }, {
    expectFinal: true,
    timeoutMs,
  });
}

export function resetOpenClawGatewayClientForTests() {
  if (client) client.stop();
  client = null;
  clientPromise = null;
}
