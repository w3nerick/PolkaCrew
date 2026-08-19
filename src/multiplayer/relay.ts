import type { RelayEnvelope, RoomWireMessage } from './types';

export type RelayStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting';

function baseUrl() {
  const configured = (import.meta.env.VITE_POLKACREW_RELAY_URL as string | undefined)?.trim();
  return configured?.replace(/\/$/, '') ?? '';
}

/**
 * Tiny relay transport used by the v0.5 pre-deploy candidate.
 *
 * `clientAuth` is never broadcast in room messages. The relay binds it to the
 * room/client pair, so knowing a public client UUID is not enough to spoof an
 * authoritative host POST.
 */
export class RelayClient {
  private source?: EventSource;
  private roomId = '';
  private clientId = '';
  private readonly clientAuth = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  private listeners = new Set<(envelope: RelayEnvelope) => void>();
  private statusListeners = new Set<(status: RelayStatus) => void>();

  connect(roomId: string, clientId: string, asHost = false) {
    this.close();
    this.roomId = roomId.toUpperCase();
    this.clientId = clientId;
    this.emitStatus('connecting');
    const params = new URLSearchParams({
      room: this.roomId,
      client: this.clientId,
      auth: this.clientAuth,
      host: asHost ? '1' : '0',
    });
    this.source = new EventSource(`${baseUrl()}/events?${params}`);
    this.source.addEventListener('connected', () => this.emitStatus('connected'));
    this.source.onmessage = event => {
      try {
        this.listeners.forEach(listener => listener(JSON.parse(event.data) as RelayEnvelope));
      } catch (error) {
        console.warn('[PolkaCrew] Ignoring malformed relay envelope', error);
      }
    };
    this.source.onerror = () => this.emitStatus('reconnecting');
  }

  async send(message: RoomWireMessage, target?: string) {
    if (!this.roomId || !this.clientId) throw new Error('Relay is not connected to a room');
    const response = await fetch(`${baseUrl()}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: this.roomId,
        sender: this.clientId,
        auth: this.clientAuth,
        target,
        message,
      }),
    });
    if (!response.ok) throw new Error(`Relay returned HTTP ${response.status}`);
    return response.json() as Promise<{ ok: boolean; delivered: number }>;
  }

  onMessage(listener: (envelope: RelayEnvelope) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: RelayStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close() {
    this.source?.close();
    this.source = undefined;
    this.emitStatus('offline');
  }

  private emitStatus(status: RelayStatus) {
    this.statusListeners.forEach(listener => listener(status));
  }
}
