import type { MatchSnapshot, Role } from '../types';

export interface RoomIdentity {
  name: string;
  h160Address?: `0x${string}`;
  productAddress?: string;
}

export interface RoomPlayer extends RoomIdentity {
  id: string;
  color: string;
  ready: boolean;
  alive: boolean;
  x: number;
  y: number;
  tasksDone: number;
}

export type RoomPhase = 'home' | 'lobby' | 'playing' | 'meeting' | 'ended';

export interface RoomTask {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface SettlementNotice {
  matchId: `0x${string}`;
  replayCid: string;
  winner: Role;
  proposerH160: `0x${string}`;
  participants: Array<{ h160Address: `0x${string}`; won: boolean }>;
}

export interface RoomState {
  roomId: string;
  hostId: string;
  isHost: boolean;
  selfId: string;
  selfRole?: Role;
  phase: RoomPhase;
  players: Record<string, RoomPlayer>;
  completed: Record<string, string[]>;
  winner?: Role;
  finalSnapshot?: MatchSnapshot;
  settlement?: SettlementNotice;
  networkStatus: 'offline' | 'connecting' | 'connected' | 'reconnecting';
  error?: string;
}

export type RoomWireMessage =
  | { type: 'who-is-host' }
  | { type: 'host'; hostId: string }
  | { type: 'join'; player: Omit<RoomPlayer, 'color' | 'alive' | 'x' | 'y' | 'tasksDone'> }
  | { type: 'lobby'; hostId: string; players: Record<string, RoomPlayer> }
  | { type: 'ready'; ready: boolean }
  | { type: 'start-secret'; role: Role; players: Record<string, RoomPlayer>; matchId: string; startedAt: number }
  | { type: 'snapshot'; players: Record<string, RoomPlayer>; completed: Record<string, string[]>; phase: RoomPhase; winner?: Role }
  | { type: 'move'; x: number; y: number }
  | { type: 'action'; action: 'task' | 'kill' | 'meeting'; target?: string }
  | { type: 'vote'; target: string }
  | { type: 'match-ended'; snapshot: MatchSnapshot }
  | { type: 'settlement'; settlement: SettlementNotice }
  | { type: 'settlement-attested'; h160Address: `0x${string}` }
  | { type: 'error'; text: string };

export interface RelayEnvelope {
  sender: string;
  message: RoomWireMessage;
  ts: number;
}
