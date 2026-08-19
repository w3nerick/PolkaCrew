export type NetworkMessage =
  | { type: 'hello'; playerId: string; name: string }
  | { type: 'move'; playerId: string; x: number; y: number; seq: number }
  | { type: 'action'; playerId: string; action: 'task' | 'kill' | 'meeting'; target?: string }
  | { type: 'vote'; playerId: string; target: string }
  | { type: 'snapshot'; payload: unknown };

export interface MultiplayerTransport {
  connect(roomId: string): Promise<void>;
  send(message: NetworkMessage): void;
  close(): void;
  onMessage(handler: (message: NetworkMessage) => void): () => void;
}

// MVP boundary: implement WebRTC signalling here in v0.2. The game engine intentionally
// has no transport dependency, so host-authoritative or P2P networking can be swapped in.
