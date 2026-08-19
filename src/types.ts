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
  players: Array<Pick<Player, 'id' | 'name' | 'role' | 'alive' | 'tasksDone'>>;
  events: GameEvent[];
}

export interface GameEvent {
  t: number;
  type: 'move' | 'task' | 'kill' | 'meeting' | 'vote' | 'end';
  actor?: string;
  target?: string;
  data?: Record<string, unknown>;
}
