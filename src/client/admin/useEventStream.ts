import { useEffect, useRef, useState } from 'react';

/**
 * Subscribes to the server's SSE stream so the dashboard updates the moment
 * anyone scores an opportunity.
 *
 * EventSource reconnects on its own, but a proxy that buffers or drops the
 * stream would leave the page silently stale - so a slow poll runs alongside
 * as a floor on freshness.
 */
export function useEventStream(onChange: () => void, pollMs = 15_000) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const source = new EventSource('/api/admin/stream');

    const refresh = () => handler.current();
    source.addEventListener('ready', () => setConnected(true));
    source.addEventListener('response', refresh);
    source.addEventListener('submitted', refresh);
    source.addEventListener('config', refresh);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const poll = window.setInterval(refresh, pollMs);

    return () => {
      source.close();
      window.clearInterval(poll);
    };
  }, [pollMs]);

  return connected;
}
