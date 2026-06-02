import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const OPENCLAW_DIST_CANDIDATES = [
  "/opt/homebrew/lib/node_modules/openclaw/dist",
  "/usr/local/lib/node_modules/openclaw/dist",
  "/usr/lib/node_modules/openclaw/dist",
  "/opt/lifepilot/node_modules/openclaw/dist",
];

let clientPromise = null;
let client = null;

function moduleUrl(modulePath) {
  if (!modulePath) return "";
  if (modulePath.startsWith("file://") || modulePath.startsWith("http://") || modulePath.startsWith("https://")) {
    return modulePath;
  }
  return pathToFileURL(modulePath).href;
}

function firstExistingDistDir() {
  const configured = process.env.LIFEPILOT_OPENCLAW_DIST_DIR || process.env.OPENCLAW_DIST_DIR;
  const candidates = configured ? [configured, ...OPENCLAW_DIST_CANDIDATES] : OPENCLAW_DIST_CANDIDATES;
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  }) || "";
}

function resolveOpenClawModule({envName, fileName}) {
  const configured = process.env[envName];
  if (configured) return moduleUrl(configured);

  const distDir = firstExistingDistDir();
  if (!distDir) {
    throw new Error(
      `openclaw_runtime_not_found: set LIFEPILOT_OPENCLAW_DIST_DIR or ${envName} to the installed OpenClaw dist path.`,
    );
  }
  const filePath = path.join(distDir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`openclaw_runtime_module_not_found: ${filePath}`);
  }
  return moduleUrl(filePath);
}

async function loadOpenClawRuntime() {
  const [{ n: GatewayClient }, clientInfo] = await Promise.all([
    import(resolveOpenClawModule({
      envName: "LIFEPILOT_OPENCLAW_CLIENT_MODULE",
      fileName: process.env.LIFEPILOT_OPENCLAW_CLIENT_FILE || "client-BGs41kAq.js",
    })),
    import(resolveOpenClawModule({
      envName: "LIFEPILOT_OPENCLAW_CLIENT_INFO_MODULE",
      fileName: process.env.LIFEPILOT_OPENCLAW_CLIENT_INFO_FILE || "client-info-CgOISqZp.js",
    })),
  ]);
  const clientNames = clientInfo.GATEWAY_CLIENT_NAMES || clientInfo.i;
  const clientModes = clientInfo.GATEWAY_CLIENT_MODES || clientInfo.r;
  if (!GatewayClient || !clientNames?.GATEWAY_CLIENT || !clientModes?.BACKEND) {
    throw new Error("openclaw_runtime_exports_missing");
  }
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

export function resetOpenClawGatewayClient() {
  resetOpenClawGatewayClientForTests();
}
