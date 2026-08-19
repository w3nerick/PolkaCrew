import type { GameEvent, MatchSnapshot, Player, Role, TaskNode, Vec2 } from '../types';

const WORLD = { width: 1000, height: 620 };
const SPEED = 245;
const KILL_DISTANCE = 78;
const TASK_DISTANCE = 72;

const palette = ['#ff267d', '#8c5cff', '#36e4da', '#ffd166', '#6ef08b', '#ff7b54', '#4ea1ff', '#f4f1ff'];
const names = ['Nova', 'Byte', 'Kappa', 'Orbit', 'Pixel', 'Relay', 'Zero'];

export class PolkaCrewEngine {
  players: Player[] = [];
  tasks: TaskNode[] = [];
  events: GameEvent[] = [];
  phase: 'lobby' | 'playing' | 'meeting' | 'ended' = 'lobby';
  winner?: Role;
  matchId = crypto.randomUUID();
  startedAt = Date.now();

  constructor(localName = 'erick.dot') {
    this.players = this.createPlayers(localName);
    this.tasks = [
      { id: 'reactor', label: 'Stabilize Relay', position: { x: 155, y: 145 }, completedBy: [] },
      { id: 'bulletin', label: 'Sync Bulletin', position: { x: 815, y: 145 }, completedBy: [] },
      { id: 'hub', label: 'Route Asset Hub', position: { x: 790, y: 470 }, completedBy: [] },
      { id: 'people', label: 'Verify Identity', position: { x: 195, y: 475 }, completedBy: [] },
    ];
  }

  private createPlayers(localName: string): Player[] {
    const all = [localName, ...names];
    const saboteurIndex = Math.floor(Math.random() * all.length);
    return all.map((name, i) => ({
      id: i === 0 ? 'local' : `bot-${i}`,
      name,
      color: palette[i % palette.length],
      role: i === saboteurIndex ? 'saboteur' : 'crew',
      alive: true,
      position: { x: 470 + Math.cos(i) * 130, y: 310 + Math.sin(i) * 130 },
      tasksDone: 0,
      totalTasks: 4,
      isLocal: i === 0,
    }));
  }

  start() { this.phase = 'playing'; this.startedAt = Date.now(); }

  get local() { return this.players.find(p => p.isLocal)!; }

  moveLocal(input: Vec2, dt: number) {
    if (this.phase !== 'playing' || !this.local.alive) return;
    const length = Math.hypot(input.x, input.y) || 1;
    const normalized = { x: input.x / length, y: input.y / length };
    this.local.position.x = clamp(this.local.position.x + normalized.x * SPEED * dt, 45, WORLD.width - 45);
    this.local.position.y = clamp(this.local.position.y + normalized.y * SPEED * dt, 55, WORLD.height - 45);
  }

  tickBots(dt: number) {
    if (this.phase !== 'playing') return;
    for (const p of this.players.filter(p => !p.isLocal && p.alive)) {
      const seed = performance.now() / 900 + Number(p.id.replace('bot-', '')) * 1.7;
      p.position.x = clamp(p.position.x + Math.cos(seed) * 34 * dt, 45, WORLD.width - 45);
      p.position.y = clamp(p.position.y + Math.sin(seed * .83) * 34 * dt, 55, WORLD.height - 45);
    }
  }

  nearestTask() {
    return this.tasks
      .filter(t => !t.completedBy.includes(this.local.id))
      .map(t => ({ task: t, d: distance(t.position, this.local.position) }))
      .sort((a, b) => a.d - b.d)[0];
  }

  canDoTask() {
    const n = this.nearestTask();
    return this.local.role === 'crew' && !!n && n.d <= TASK_DISTANCE;
  }

  doTask() {
    if (!this.canDoTask()) return false;
    const n = this.nearestTask()!;
    n.task.completedBy.push(this.local.id);
    this.local.tasksDone += 1;
    this.events.push({ t: Date.now(), type: 'task', actor: this.local.id, target: n.task.id });
    if (this.players.filter(p => p.role === 'crew').every(p => p.tasksDone >= p.totalTasks || !p.isLocal)) {
      if (this.local.tasksDone >= this.local.totalTasks) this.end('crew');
    }
    return true;
  }

  nearestVictim() {
    return this.players
      .filter(p => p.alive && !p.isLocal && p.role === 'crew')
      .map(p => ({ player: p, d: distance(p.position, this.local.position) }))
      .sort((a, b) => a.d - b.d)[0];
  }

  canKill() {
    const n = this.nearestVictim();
    return this.local.role === 'saboteur' && !!n && n.d <= KILL_DISTANCE;
  }

  kill() {
    if (!this.canKill()) return false;
    const victim = this.nearestVictim()!.player;
    victim.alive = false;
    this.events.push({ t: Date.now(), type: 'kill', actor: this.local.id, target: victim.id });
    if (this.players.filter(p => p.alive && p.role === 'crew').length <= this.players.filter(p => p.alive && p.role === 'saboteur').length) {
      this.end('saboteur');
    }
    return true;
  }

  callMeeting() {
    if (this.phase !== 'playing') return;
    this.phase = 'meeting';
    this.events.push({ t: Date.now(), type: 'meeting', actor: this.local.id });
  }

  vote(targetId: string) {
    if (this.phase !== 'meeting') return;
    const target = this.players.find(p => p.id === targetId && p.alive);
    if (!target) return;
    target.alive = false;
    this.events.push({ t: Date.now(), type: 'vote', actor: this.local.id, target: target.id });
    if (target.role === 'saboteur' && this.players.filter(p => p.alive && p.role === 'saboteur').length === 0) this.end('crew');
    else if (this.players.filter(p => p.alive && p.role === 'crew').length <= this.players.filter(p => p.alive && p.role === 'saboteur').length) this.end('saboteur');
    else this.phase = 'playing';
  }

  end(winner: Role) {
    this.winner = winner;
    this.phase = 'ended';
    this.events.push({ t: Date.now(), type: 'end', data: { winner } });
  }

  snapshot(): MatchSnapshot {
    return {
      id: this.matchId,
      startedAt: this.startedAt,
      endedAt: this.phase === 'ended' ? Date.now() : undefined,
      winner: this.winner,
      players: this.players.map(({ id, name, role, alive, tasksDone }) => ({ id, name, role, alive, tasksDone })),
      events: this.events,
    };
  }
}

export const world = WORLD;
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function distance(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.y - b.y); }
