/**
 * A tiny SSE hub so the admin dashboard repaints the moment anyone scores
 * something. SSE rather than websockets: one-way traffic, plain HTTP, no
 * dependency, and it survives any reverse proxy that doesn't do upgrades.
 */
import type { Response } from 'express';

export type AppEvent =
  | { type: 'response'; opportunityId: number; respondentId: number }
  | { type: 'submitted'; respondentId: number }
  | { type: 'config' };

const clients = new Set<Response>();

export function addClient(res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stops nginx from buffering the stream into uselessness.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(event: AppEvent) {
  const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      client.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}

/** Comment frames keep idle connections alive through proxy timeouts. */
const heartbeat = setInterval(() => {
  for (const client of clients) {
    try {
      client.write(': ping\n\n');
    } catch {
      clients.delete(client);
    }
  }
}, 25_000);
heartbeat.unref();

export function clientCount() {
  return clients.size;
}
