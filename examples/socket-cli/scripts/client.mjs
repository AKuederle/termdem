#!/usr/bin/env node
import net from "node:net";

const [command, rawUrl, ...messageParts] = process.argv.slice(2);

if (!command || !rawUrl) {
  usage();
}

const endpoint = parseEndpoint(rawUrl);

switch (command) {
  case "listen":
    await listen(endpoint);
    break;
  case "send":
    await send(endpoint, messageParts.join(" "));
    break;
  default:
    usage();
}

async function listen(endpoint) {
  const socket = net.createConnection(endpoint.port, endpoint.host);
  socket.setEncoding("utf8");

  socket.on("connect", () => {
    socket.write(`${JSON.stringify({ type: "listen" })}\n`);
    console.log(`listening on ${formatEndpoint(endpoint)}`);
  });

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
      if (event.type === "message") {
        console.log(`received: ${event.message}`);
      }
    }
  });
}

async function send(endpoint, message) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.port, endpoint.host);
    socket.on("error", reject);
    socket.on("connect", () => {
      socket.end(`${JSON.stringify({ type: "send", message })}\n`);
    });
    socket.on("close", resolve);
  });

  console.log(`sent: ${message}`);
}

function parseEndpoint(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "tcp:") {
    throw new Error(`Expected tcp:// URL, got ${rawUrl}`);
  }

  return {
    host: url.hostname,
    port: Number(url.port),
  };
}

function formatEndpoint(endpoint) {
  return `tcp://${endpoint.host}:${endpoint.port}`;
}

function usage() {
  console.error("usage: client.mjs listen <tcp-url>");
  console.error("       client.mjs send <tcp-url> <message>");
  process.exit(1);
}
