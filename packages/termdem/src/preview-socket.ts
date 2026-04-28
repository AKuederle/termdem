import type { BrowserToServerMessage } from "./protocol.ts";

export type PreviewSocketLike = Pick<WebSocket, "readyState" | "send">;

const socketConnectingState = 0;
const socketOpenState = 1;

export function queueOrSendPreviewMessage(
  socket: PreviewSocketLike | null,
  pendingMessages: BrowserToServerMessage[],
  message: BrowserToServerMessage,
) {
  if (socket?.readyState === socketOpenState) {
    socket.send(JSON.stringify(message));
    return;
  }

  if (!socket || socket.readyState === socketConnectingState) {
    pendingMessages.push(message);
    return;
  }

  throw new Error("Preview socket is not connected");
}

export function flushQueuedPreviewMessages(
  socket: PreviewSocketLike,
  pendingMessages: BrowserToServerMessage[],
) {
  if (socket.readyState !== socketOpenState) {
    return;
  }

  for (const message of pendingMessages.splice(0)) {
    socket.send(JSON.stringify(message));
  }
}
