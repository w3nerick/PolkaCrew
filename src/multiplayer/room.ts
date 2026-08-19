import type { GameEvent, MatchSnapshot, Role } from '../types';
import { RelayClient } from './relay';
import type {
  RelayEnvelope,
  RoomIdentity,
  RoomPlayer,
  RoomState,
  RoomTask,
  RoomWireMessage,
  SettlementNotice,
} from './types';

export const ROOM_WORLD = { width: 1000, height: 620 } as const;
export const ROOM_SPEED = 245;
export const KILL_DISTANCE = 78;
export const TASK_DISTANCE = 72;
export const ROOM_TASKS: RoomTask[] = [
  { id: 'relay', label: 'Stabilize Relay', x: 155, y: 145 },
  { id: 'bulletin', label: 'Sync Bulletin', x: 815, y: 145 },
  { id: 'asset-hub', label: 'Route Asset Hub', x: 790, y: 470 },
  { id: 'people', label: 'Verify Identity', x: 195, y: 475 },
];

const COLORS = ['#ff267d', '#8c5cff', '#36e4da', '#ffd166', '#6ef08b', '#ff7b54', '#4ea1ff', '#f4f1ff', '#d45dff', '#70f0ff'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Listener = (state: RoomState) => void;

export class PolkaCrewRoom {
  readonly selfId = crypto.randomUUID();
  private relay = new RelayClient();
  private listeners = new Set<Listener>();
  private identity: RoomIdentity;
  private roles: Record<string, Role> = {};
  private votes: Record<string, string> = {};
  private events: GameEvent[] = [];
  private matchId = '';
  private startedAt = 0;
  private endedAt = 0;
  private lastMoveSent = 0;
  private lastMoveAt: Record<string, number> = {};
  private attested = new Set<string>();
  private state: RoomState;

  constructor(identity: RoomIdentity) {
    this.identity = identity;
    this.state = {
      roomId: '',
      hostId: '',
      isHost: false,
      selfId: this.selfId,
      phase: 'home',
      players: {},
      completed: {},
      networkStatus: 'offline',
    };
    this.relay.onMessage(envelope => this.handle(envelope));
    this.relay.onStatus(networkStatus => {
      this.patch({ networkStatus });
      if (networkStatus === 'connected' && this.state.roomId && !this.state.isHost) {
        void this.relay.send({ type: 'join', player: this.joinPayload() });
        void this.relay.send({ type: 'who-is-host' });
      }
    });
  }

  get snapshot() { return this.state; }
  get self() { return this.state.players[this.selfId]; }
  get settlementAttestedCount() { return this.attested.size; }

  setIdentity(identity: RoomIdentity) {
    this.identity = identity;
    const self = this.state.players[this.selfId];
    if (self) {
      Object.assign(self, identity);
      if (this.state.isHost) this.broadcastLobby();
      this.emit();
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  createRoom() {
    const roomId = randomRoomCode();
    const self = this.makePlayer(0);
    this.roles = {};
    this.events = [];
    this.votes = {};
    this.attested.clear();
    this.state = {
      roomId,
      hostId: this.selfId,
      isHost: true,
      selfId: this.selfId,
      phase: 'lobby',
      players: { [this.selfId]: self },
      completed: {},
      networkStatus: 'connecting',
    };
    this.emit();
    this.relay.connect(roomId, this.selfId, true);
    return roomId;
  }

  joinRoom(roomId: string) {
    const clean = roomId.trim().toUpperCase();
    if (clean.length < 3) throw new Error('Enter a valid room code');
    this.roles = {};
    this.events = [];
    this.votes = {};
    this.attested.clear();
    this.state = {
      roomId: clean,
      hostId: '',
      isHost: false,
      selfId: this.selfId,
      phase: 'lobby',
      players: {},
      completed: {},
      networkStatus: 'connecting',
    };
    this.emit();
    this.relay.connect(clean, this.selfId, false);
  }

  leave() {
    this.relay.close();
    this.state = {
      roomId: '', hostId: '', isHost: false, selfId: this.selfId,
      phase: 'home', players: {}, completed: {}, networkStatus: 'offline',
    };
    this.emit();
  }

  setReady(ready: boolean) {
    const self = this.state.players[this.selfId];
    if (this.state.isHost && self) {
      self.ready = ready;
      this.broadcastLobby();
      return;
    }
    void this.safeSend({ type: 'ready', ready });
  }

  canStart() {
    const players = Object.values(this.state.players);
    return this.state.isHost && players.length >= 2 && players.every(player => player.ready);
  }

  startMatch() {
    if (!this.canStart()) return false;
    const ids = Object.keys(this.state.players);
    const saboteurCount = ids.length >= 7 ? 2 : 1;
    const shuffled = [...ids].sort(() => Math.random() - .5);
    this.roles = Object.fromEntries(ids.map(id => [id, 'crew' as Role]));
    for (const id of shuffled.slice(0, saboteurCount)) this.roles[id] = 'saboteur';
    this.matchId = crypto.randomUUID();
    this.startedAt = Date.now();
    this.endedAt = 0;
    this.events = [];
    this.votes = {};
    this.attested.clear();
    this.lastMoveAt = {};
    this.state.completed = {};
    this.state.winner = undefined;
    this.state.finalSnapshot = undefined;
    this.state.settlement = undefined;
    this.state.phase = 'playing';
    this.state.selfRole = this.roles[this.selfId];

    for (const id of ids) {
      const message: RoomWireMessage = {
        type: 'start-secret',
        role: this.roles[id],
        players: this.safePlayers(),
        matchId: this.matchId,
        startedAt: this.startedAt,
      };
      if (id !== this.selfId) void this.safeSend(message, id);
    }
    this.broadcastSnapshot();
    this.emit();
    return true;
  }

  moveLocal(input: { x: number; y: number }, dt: number, now = performance.now()) {
    if (this.state.phase !== 'playing') return;
    const self = this.self;
    if (!self?.alive) return;
    const length = Math.hypot(input.x, input.y) || 1;
    self.x = clamp(self.x + input.x / length * ROOM_SPEED * dt, 45, ROOM_WORLD.width - 45);
    self.y = clamp(self.y + input.y / length * ROOM_SPEED * dt, 55, ROOM_WORLD.height - 45);
    if (now - this.lastMoveSent < 70) return;
    this.lastMoveSent = now;
    if (this.state.isHost) this.broadcastSnapshot();
    else void this.safeSend({ type: 'move', x: self.x, y: self.y });
  }

  nearestTask() {
    const self = this.self;
    if (!self) return undefined;
    return ROOM_TASKS
      .filter(task => !(this.state.completed[this.selfId] ?? []).includes(task.id))
      .map(task => ({ task, d: distance(self, task) }))
      .sort((a, b) => a.d - b.d)[0];
  }

  nearestVictim() {
    const self = this.self;
    if (!self) return undefined;
    return Object.values(this.state.players)
      .filter(player => player.id !== self.id && player.alive)
      .map(player => ({ player, d: distance(self, player) }))
      .sort((a, b) => a.d - b.d)[0];
  }

  canDoTask() {
    const nearest = this.nearestTask();
    return this.state.selfRole === 'crew' && this.state.phase === 'playing' && !!nearest && nearest.d <= TASK_DISTANCE;
  }

  canKill() {
    const nearest = this.nearestVictim();
    return this.state.selfRole === 'saboteur' && this.state.phase === 'playing' && !!nearest && nearest.d <= KILL_DISTANCE;
  }

  doTask() {
    const target = this.nearestTask()?.task.id;
    if (!target) return;
    if (this.state.isHost) this.hostAction(this.selfId, 'task', target);
    else void this.safeSend({ type: 'action', action: 'task', target });
  }

  kill() {
    const target = this.nearestVictim()?.player.id;
    if (!target) return;
    if (this.state.isHost) this.hostAction(this.selfId, 'kill', target);
    else void this.safeSend({ type: 'action', action: 'kill', target });
  }

  callMeeting() {
    if (this.state.isHost) this.hostAction(this.selfId, 'meeting');
    else void this.safeSend({ type: 'action', action: 'meeting' });
  }

  vote(target: string) {
    if (this.state.isHost) this.hostVote(this.selfId, target);
    else void this.safeSend({ type: 'vote', target });
  }

  publishSettlement(settlement: SettlementNotice) {
    if (!this.state.isHost || this.state.phase !== 'ended') return;
    this.state.settlement = settlement;
    this.emit();
    void this.safeSend({ type: 'settlement', settlement });
  }

  markAttested(h160Address: `0x${string}`) {
    this.attested.add(h160Address.toLowerCase());
    this.emit();
    void this.safeSend({ type: 'settlement-attested', h160Address });
  }

  private async handle({ sender, message }: RelayEnvelope) {
    const hostOnly = new Set(['host', 'lobby', 'start-secret', 'snapshot', 'match-ended', 'settlement', 'error']);
    if (hostOnly.has(message.type) && this.state.hostId && sender !== this.state.hostId) return;
    switch (message.type) {
      case 'who-is-host':
        if (this.state.isHost) await this.safeSend({ type: 'host', hostId: this.selfId }, sender);
        break;
      case 'host':
        this.patch({ hostId: message.hostId, isHost: message.hostId === this.selfId });
        break;
      case 'join':
        if (!this.state.isHost) break;
        if (!this.state.players[sender] && Object.keys(this.state.players).length >= 10) {
          await this.safeSend({ type: 'error', text: 'Room is full' }, sender);
          break;
        }
        if (!this.state.players[sender]) {
          const incomingH160 = message.player.h160Address?.toLowerCase();
          if (incomingH160 && Object.values(this.state.players).some(player => player.h160Address?.toLowerCase() === incomingH160)) {
            await this.safeSend({ type: 'error', text: 'That Product Account is already present in this room.' }, sender);
            break;
          }
          const index = Object.keys(this.state.players).length;
          this.state.players[sender] = {
            ...message.player,
            id: sender,
            color: COLORS[index % COLORS.length],
            alive: true,
            x: 500 + Math.cos(index) * 120,
            y: 310 + Math.sin(index) * 120,
            tasksDone: 0,
          };
        }
        this.broadcastLobby();
        break;
      case 'lobby':
        if (this.state.isHost) break;
        this.state.hostId = message.hostId;
        this.state.players = message.players;
        this.emit();
        break;
      case 'ready':
        if (this.state.isHost && this.state.players[sender]) {
          this.state.players[sender].ready = message.ready;
          this.broadcastLobby();
        }
        break;
      case 'start-secret':
        this.matchId = message.matchId;
        this.startedAt = message.startedAt;
        this.state.selfRole = message.role;
        this.state.players = message.players;
        this.state.completed = {};
        this.state.phase = 'playing';
        this.state.winner = undefined;
        this.state.finalSnapshot = undefined;
        this.state.settlement = undefined;
        this.emit();
        break;
      case 'snapshot':
        if (this.state.isHost) break;
        this.state.players = message.players;
        this.state.completed = message.completed;
        this.state.phase = message.phase;
        this.state.winner = message.winner;
        this.emit();
        break;
      case 'move':
        if (this.state.isHost && this.state.phase === 'playing') {
          const player = this.state.players[sender];
          if (player?.alive) this.hostMove(sender, player, message.x, message.y);
        }
        break;
      case 'action':
        if (this.state.isHost) this.hostAction(sender, message.action, message.target);
        break;
      case 'vote':
        if (this.state.isHost) this.hostVote(sender, message.target);
        break;
      case 'match-ended':
        if (!this.state.isHost) {
          this.state.finalSnapshot = message.snapshot;
          this.state.phase = 'ended';
          this.state.winner = message.snapshot.winner;
          this.emit();
        }
        break;
      case 'settlement':
        this.state.settlement = message.settlement;
        this.emit();
        break;
      case 'settlement-attested': {
        const expected = this.state.players[sender]?.h160Address;
        if (!expected || expected.toLowerCase() !== message.h160Address.toLowerCase()) break;
        this.attested.add(message.h160Address.toLowerCase());
        this.emit();
        break;
      }
      case 'error':
        this.patch({ error: message.text });
        break;
    }
  }


  private hostMove(sender: string, player: RoomPlayer, requestedX: number, requestedY: number) {
    const now = performance.now();
    const previous = this.lastMoveAt[sender];
    this.lastMoveAt[sender] = now;
    if (previous == null) return;

    const elapsed = Math.min(Math.max((now - previous) / 1000, 0), .5);
    const maxDistance = ROOM_SPEED * elapsed * 1.55;
    const targetX = clamp(requestedX, 45, ROOM_WORLD.width - 45);
    const targetY = clamp(requestedY, 55, ROOM_WORLD.height - 45);
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const requestedDistance = Math.hypot(dx, dy);
    if (requestedDistance <= maxDistance || requestedDistance === 0) {
      player.x = targetX;
      player.y = targetY;
    } else if (maxDistance > 0) {
      player.x += dx / requestedDistance * maxDistance;
      player.y += dy / requestedDistance * maxDistance;
    }
    this.broadcastSnapshot();
  }

  private hostAction(actorId: string, action: 'task' | 'kill' | 'meeting', target?: string) {
    const actor = this.state.players[actorId];
    if (!actor?.alive || this.state.phase !== 'playing') return;

    if (action === 'task') {
      if (this.roles[actorId] !== 'crew') return;
      const task = ROOM_TASKS.find(item => item.id === target);
      if (!task || distance(actor, task) > TASK_DISTANCE) return;
      const completed = this.state.completed[actorId] ?? (this.state.completed[actorId] = []);
      if (!completed.includes(task.id)) {
        completed.push(task.id);
        actor.tasksDone = completed.length;
        this.events.push({ t: Date.now(), type: 'task', actor: actorId, target: task.id });
      }
    } else if (action === 'kill') {
      if (this.roles[actorId] !== 'saboteur') return;
      const victim = target ? this.state.players[target] : undefined;
      if (!victim?.alive || victim.id === actorId || this.roles[victim.id] === 'saboteur') return;
      if (distance(actor, victim) > KILL_DISTANCE) return;
      victim.alive = false;
      this.events.push({ t: Date.now(), type: 'kill', actor: actorId, target: victim.id });
    } else {
      this.state.phase = 'meeting';
      this.votes = {};
      this.events.push({ t: Date.now(), type: 'meeting', actor: actorId });
    }

    if (this.state.phase !== 'meeting') this.checkWin();
    this.broadcastSnapshot();
  }

  private hostVote(actorId: string, targetId: string) {
    if (this.state.phase !== 'meeting') return;
    const actor = this.state.players[actorId];
    const target = this.state.players[targetId];
    if (!actor?.alive || !target?.alive || this.votes[actorId]) return;
    this.votes[actorId] = targetId;
    this.events.push({ t: Date.now(), type: 'vote', actor: actorId, target: targetId });

    const alive = Object.values(this.state.players).filter(player => player.alive);
    if (!alive.every(player => this.votes[player.id])) {
      this.broadcastSnapshot();
      return;
    }

    const counts = Object.values(this.votes).reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (ranked[0] && (!ranked[1] || ranked[0][1] > ranked[1][1])) {
      this.state.players[ranked[0][0]].alive = false;
    }
    this.state.phase = 'playing';
    this.checkWin();
    this.broadcastSnapshot();
  }

  private checkWin() {
    const alive = Object.values(this.state.players).filter(player => player.alive);
    const saboteurs = alive.filter(player => this.roles[player.id] === 'saboteur').length;
    const crew = alive.filter(player => this.roles[player.id] === 'crew').length;
    if (saboteurs === 0) return this.finish('crew');
    if (saboteurs >= crew) return this.finish('saboteur');
    const crewIds = Object.keys(this.state.players).filter(id => this.roles[id] === 'crew');
    if (crewIds.length && crewIds.every(id => (this.state.completed[id] ?? []).length >= ROOM_TASKS.length)) {
      return this.finish('crew');
    }
  }

  private finish(winner: Role) {
    if (this.state.phase === 'ended') return;
    this.state.phase = 'ended';
    this.state.winner = winner;
    this.endedAt = Date.now();
    this.events.push({ t: this.endedAt, type: 'end', data: { winner } });
    const snapshot = this.finalMatchSnapshot(winner);
    this.state.finalSnapshot = snapshot;
    this.broadcastSnapshot();
    this.emit();
    void this.safeSend({ type: 'match-ended', snapshot });
  }

  private finalMatchSnapshot(winner: Role): MatchSnapshot {
    return {
      id: this.matchId,
      startedAt: this.startedAt,
      endedAt: this.endedAt || Date.now(),
      winner,
      players: Object.values(this.state.players).map(player => ({
        id: player.id,
        name: player.name,
        role: this.roles[player.id],
        alive: player.alive,
        tasksDone: player.tasksDone,
        h160Address: player.h160Address,
        productAddress: player.productAddress,
      })),
      events: [...this.events],
    };
  }

  private broadcastLobby() {
    if (!this.state.isHost) return;
    this.emit();
    void this.safeSend({ type: 'lobby', hostId: this.selfId, players: this.safePlayers() });
  }

  private broadcastSnapshot() {
    if (!this.state.isHost) return;
    this.emit();
    void this.safeSend({
      type: 'snapshot',
      players: this.safePlayers(),
      completed: structuredClone(this.state.completed),
      phase: this.state.phase,
      winner: this.state.winner,
    });
  }

  private safePlayers() {
    return Object.fromEntries(Object.entries(this.state.players).map(([id, player]) => [id, { ...player }]));
  }

  private joinPayload() {
    return {
      id: this.selfId,
      name: this.identity.name,
      h160Address: this.identity.h160Address,
      productAddress: this.identity.productAddress,
      ready: false,
    };
  }

  private makePlayer(index: number): RoomPlayer {
    return {
      id: this.selfId,
      ...this.identity,
      color: COLORS[index % COLORS.length],
      ready: false,
      alive: true,
      x: 500,
      y: 310,
      tasksDone: 0,
    };
  }

  private async safeSend(message: RoomWireMessage, target?: string) {
    try {
      await this.relay.send(message, target);
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  private patch(partial: Partial<RoomState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit() {
    const view: RoomState = {
      ...this.state,
      players: { ...this.state.players },
      completed: { ...this.state.completed },
    };
    this.listeners.forEach(listener => listener(view));
  }
}

function randomRoomCode() {
  return Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function distance(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }
