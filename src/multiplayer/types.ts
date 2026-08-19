import type { MatchSnapshot, Role } from '../types';

export interface RoomIdentity {
  name: string;
  h160Address?: `0x${string}`;
  productAddress?: string;
}

export interface PlayerCooldowns {
  killUntil: number;
  sabotageUntil: number;
  meetingUntil: number;
}

export interface RoomPlayer extends RoomIdentity {
  id: string;
  color: string;
  ready: boolean;
  alive: boolean;
  connected: boolean;
  disconnectedAt?: number;
  x: number;
  y: number;
  tasksDone: number;
  emergenciesLeft: number;
  cooldowns: PlayerCooldowns;
}

export type RoomPhase = 'home' | 'lobby' | 'playing' | 'meeting' | 'ended';
export type TaskKind = 'wires' | 'sequence' | 'slider' | 'pulse';
export type SabotageKind = 'reactor' | 'lights' | 'doors';

export interface RoomTask {
  id: string;
  label: string;
  room: string;
  kind: TaskKind;
  x: number;
  y: number;
}

export interface RoomBody {
  id: string;
  victimId: string;
  victimName: string;
  color: string;
  x: number;
  y: number;
  killedAt: number;
  reported: boolean;
}

export interface DoorState {
  id: string;
  label: string;
  x: number;
  y: number;
  orientation: 'horizontal' | 'vertical';
  span: number;
  lockedUntil: number;
}

export interface SabotageState {
  kind: SabotageKind;
  startedAt: number;
  endsAt: number;
  fixedPanels: string[];
  requiredPanels: string[];
}

export interface MeetingState {
  reason: 'emergency' | 'body';
  reporterId: string;
  bodyId?: string;
  startedAt: number;
  endsAt: number;
  votes: Record<string, string>;
  resolved?: boolean;
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
  knownSaboteurs: string[];
  phase: RoomPhase;
  players: Record<string, RoomPlayer>;
  completed: Record<string, string[]>;
  bodies: RoomBody[];
  doors: Record<string, DoorState>;
  sabotage?: SabotageState;
  meeting?: MeetingState;
  winner?: Role;
  finalSnapshot?: MatchSnapshot;
  settlement?: SettlementNotice;
  settleable: boolean;
  settlementBlockReason?: string;
  networkStatus: 'offline' | 'connecting' | 'connected' | 'reconnecting';
  error?: string;
}

export type PlayerJoinPayload = Omit<RoomPlayer, 'color' | 'alive' | 'connected' | 'x' | 'y' | 'tasksDone' | 'emergenciesLeft' | 'cooldowns'>;

export type RoomWireMessage =
  | { type: 'who-is-host' }
  | { type: 'host'; hostId: string }
  | { type: 'host-migrated'; hostId: string }
  | { type: 'host-lost'; hostId: string }
  | { type: 'presence'; clientId: string; connected: boolean }
  | { type: 'join'; player: PlayerJoinPayload }
  | { type: 'lobby'; hostId: string; players: Record<string, RoomPlayer> }
  | { type: 'ready'; ready: boolean }
  | { type: 'start-secret'; role: Role; knownSaboteurs: string[]; players: Record<string, RoomPlayer>; matchId: string; startedAt: number }
  | {
      type: 'snapshot';
      players: Record<string, RoomPlayer>;
      completed: Record<string, string[]>;
      bodies: RoomBody[];
      doors: Record<string, DoorState>;
      sabotage?: SabotageState;
      meeting?: MeetingState;
      phase: RoomPhase;
      winner?: Role;
      settleable: boolean;
      settlementBlockReason?: string;
    }
  | { type: 'move'; x: number; y: number }
  | { type: 'action'; action: 'task' | 'kill' | 'meeting' | 'report' | 'sabotage' | 'fix-sabotage'; target?: string; sabotage?: SabotageKind }
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
