export type Role = 'crew' | 'saboteur';
export type Phase = 'lobby' | 'playing' | 'meeting' | 'ended';

export interface Vec2 { x: number; y: number; }

export interface Player {
  id: string;
  name: string;
  color: string;
  role: Role;
  alive: boolean;
  position: Vec2;
  tasksDone: number;
  totalTasks: number;
  isLocal?: boolean;
  h160Address?: `0x${string}`;
  productAddress?: string;
  skinId?: string;
}

export interface TaskNode {
  id: string;
  label: string;
  position: Vec2;
  completedBy: string[];
}

export interface MatchSnapshot {
  id: string;
  startedAt: number;
  endedAt?: number;
  winner?: Role;
  settleable?: boolean;
  settlementBlockReason?: string;
  players: Array<Pick<Player, 'id' | 'name' | 'role' | 'alive' | 'tasksDone' | 'h160Address' | 'productAddress'>>;
  events: GameEvent[];
}

export interface GameEvent {
  t: number;
  type:
    | 'move'
    | 'task'
    | 'kill'
    | 'report'
    | 'meeting'
    | 'vote'
    | 'chat'
    | 'eject'
    | 'sabotage'
    | 'sabotage-fixed'
    | 'door-lock'
    | 'disconnect'
    | 'reconnect'
    | 'forfeit'
    | 'end'
    | 'abort';
  actor?: string;
  target?: string;
  data?: Record<string, unknown>;
}
