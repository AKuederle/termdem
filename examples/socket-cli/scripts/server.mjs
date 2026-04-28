#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const stateId = createHash("sha256").update(scriptPath).digest("hex").slice(0, 16);
const statePath = join(tmpdir(), `termdem-socket-cli-server-${stateId}.json`);
const command = process.argv[2];

switch (command) {
  case "setup":
    await setup();
    break;
  case "serve":
    await serve();
    break;
  case "status":
    await status();
    break;
  case "health":
    await health(process.argv[3]);
    break;
  case "cleanup":
    await cleanup();
    break;
  default:
    usage();
}

async function setup() {
  if (existsSync(statePath)) {
    await cleanup();
  }

  const child = spawn(process.execPath, [scriptPath, "serve"], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });

  const url = await readFirstLine(child.stdout);
  child.unref();
  console.log(`CHAT_URL=${url}`);
}

async function serve() {
  const listeners = new Set();
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");

    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line) {
          continue;
        }

        const event = JSON.parse(line);
        if (event.type === "listen") {
          listeners.add(socket);
          socket.on("close", () => listeners.delete(socket));
          continue;
        }

        if (event.type === "send") {
          broadcast(listeners, event.message);
          socket.end();
          continue;
        }

        if (event.type === "health") {
          socket.end(`${JSON.stringify({ type: "health", listenerCount: listeners.size })}\n`);
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  const url = `tcp://127.0.0.1:${address.port}`;
  await writeFile(statePath, JSON.stringify({ pid: process.pid, url }, null, 2));
  console.log(url);
}

async function status() {
  const state = await readState();
  console.log(`server pid: ${state.pid}`);
  console.log(`server url: ${state.url}`);
}

async function health(rawUrl) {
  const state = rawUrl ? { url: rawUrl } : await readState();
  const result = await requestHealth(state.url);
  console.log(result.listenerCount > 0 ? "listener ready" : "server ready");
}

async function cleanup() {
  if (!existsSync(statePath)) {
    return;
  }

  const state = await readState();
  try {
    process.kill(state.pid);
  } catch {}
  await rm(statePath, { force: true });
}

async function requestHealth(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "tcp:") {
    throw new Error(`Expected tcp:// URL, got ${rawUrl}`);
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(Number(url.port), url.hostname);
    socket.setEncoding("utf8");
    socket.setTimeout(1000);
    let buffer = "";

    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy(new Error("health check timed out"));
    });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ type: "health" })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
    });
    socket.on("close", () => {
      try {
        resolve(JSON.parse(buffer));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function broadcast(listeners, message) {
  const payload = `${JSON.stringify({ type: "message", message })}\n`;
  for (const listener of listeners) {
    listener.write(payload);
  }
}

async function readFirstLine(stream) {
  stream.setEncoding("utf8");
  let buffer = "";

  for await (const chunk of stream) {
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline >= 0) {
      return buffer.slice(0, newline);
    }
  }

  throw new Error("Server exited before printing a URL");
}

async function readState() {
  return JSON.parse(await readFile(statePath, "utf8"));
}

function usage() {
  console.error("usage: server.mjs setup|status|health|cleanup");
  process.exit(1);
}
