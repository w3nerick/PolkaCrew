import type { GameEvent, MatchSnapshot, Role } from '../types';
import { RelayClient } from './relay';
import type {
  CrewSkinId,
  DoorState,
  MeetingState,
  RelayEnvelope,
  RoomBody,
  RoomIdentity,
  RoomPlayer,
  RoomState,
  RoomTask,
  RoomWireMessage,
  SabotageKind,
  SabotageState,
  SettlementNotice,
} from './types';

export const ROOM_WORLD = { width: 1000, height: 620 } as const;
export const ROOM_SPEED = 245;
export const GHOST_SPEED = 285;
export const KILL_DISTANCE = 76;
export const REPORT_DISTANCE = 86;
export const TASK_DISTANCE = 72;
export const FIX_DISTANCE = 78;
export const KILL_COOLDOWN_MS = 22_000;
export const SABOTAGE_COOLDOWN_MS = 30_000;
export const MEETING_COOLDOWN_MS = 25_000;
export const MEETING_DURATION_MS = 45_000;
export const DISCONNECT_GRACE_MS = 18_000;

export const CREW_SKINS: Array<{ id: CrewSkinId; label: string; specialty: string; asset: string }> = [
  { id: 'relay-ranger', label: 'Relay Ranger', specialty: 'Realtime scout', asset: '/assets/polkacrew/relay-ranger.png' },
  { id: 'chain-mechanic', label: 'Chain Mechanic', specialty: 'Runtime engineer', asset: '/assets/polkacrew/chain-mechanic.png' },
  { id: 'bulletin-diver', label: 'Bulletin Diver', specialty: 'Storage explorer', asset: '/assets/polkacrew/bulletin-diver.png' },
  { id: 'validator-warden', label: 'Validator Warden', specialty: 'Consensus guard', asset: '/assets/polkacrew/validator-warden.png' },
  { id: 'orbit-medic', label: 'Orbit Medic', specialty: 'System recovery', asset: '/assets/polkacrew/orbit-medic.png' },
];

export interface MapWall { id: string; x: number; y: number; width: number; height: number }

// The four gates are deliberately omitted from these permanent wall segments.
// BASE_DOORS fills those gaps only while a door-lock sabotage is active.
export const MAP_WALLS: MapWall[] = [
  { id: 'hub-north-west', x: 346, y: 216, width: 91, height: 14 },
  { id: 'hub-north-east', x: 563, y: 216, width: 91, height: 14 },
  { id: 'hub-south-west', x: 346, y: 390, width: 91, height: 14 },
  { id: 'hub-south-east', x: 563, y: 390, width: 91, height: 14 },
  { id: 'hub-west-north', x: 339, y: 223, width: 14, height: 31 },
  { id: 'hub-west-south', x: 339, y: 366, width: 14, height: 31 },
  { id: 'hub-east-north', x: 647, y: 223, width: 14, height: 31 },
  { id: 'hub-east-south', x: 647, y: 366, width: 14, height: 31 },
  { id: 'people-console', x: 76, y: 264, width: 164, height: 12 },
  { id: 'bulletin-console', x: 760, y: 264, width: 164, height: 12 },
  { id: 'relay-console', x: 76, y: 344, width: 164, height: 12 },
  { id: 'asset-console', x: 760, y: 344, width: 164, height: 12 },
];

export const ROOM_TASKS: RoomTask[] = [
  { id: 'identity-wires', label: 'Route Identity Wires', room: 'People Lab', kind: 'wires', x: 155, y: 132 },
  { id: 'people-sequence', label: 'Verify People Proof', room: 'People Lab', kind: 'sequence', x: 248, y: 202 },
  { id: 'bulletin-pulse', label: 'Pin Bulletin Chunks', room: 'Bulletin Bay', kind: 'pulse', x: 823, y: 132 },
  { id: 'bulletin-slider', label: 'Tune Storage Fee', room: 'Bulletin Bay', kind: 'slider', x: 747, y: 205 },
  { id: 'asset-sequence', label: 'Sequence Asset Route', room: 'Asset Forge', kind: 'sequence', x: 805, y: 474 },
  { id: 'relay-wires', label: 'Stabilize Relay Bus', room: 'Relay Core', kind: 'wires', x: 175, y: 476 },
];

export const SABOTAGE_PANELS = {
  reactorLeft: { id: 'reactor-left', label: 'Left Relay Key', x: 118, y: 520 },
  reactorRight: { id: 'reactor-right', label: 'Right Asset Key', x: 882, y: 520 },
  lights: { id: 'lights', label: 'Restore Ship Lights', x: 500, y: 126 },
} as const;

export const BASE_DOORS: DoorState[] = [
  { id: 'north', label: 'North Gate', x: 500, y: 223, orientation: 'horizontal', span: 126, lockedUntil: 0 },
  { id: 'east', label: 'East Gate', x: 654, y: 310, orientation: 'vertical', span: 112, lockedUntil: 0 },
  { id: 'south', label: 'South Gate', x: 500, y: 397, orientation: 'horizontal', span: 126, lockedUntil: 0 },
  { id: 'west', label: 'West Gate', x: 346, y: 310, orientation: 'vertical', span: 112, lockedUntil: 0 },
];

const COLORS = ['#ff267d', '#8c5cff', '#36e4da', '#ffd166', '#6ef08b', '#ff7b54', '#4ea1ff', '#f4f1ff', '#d45dff', '#70f0ff'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOST_ONLY = new Set(['host', 'lobby', 'start-secret', 'snapshot', 'match-ended', 'settlement', 'error']);

type Listener = (state: RoomState) => void;

export class PolkaCrewRoom {
  readonly selfId = crypto.randomUUID();
  private relay = new RelayClient();
  private listeners = new Set<Listener>();
  private identity: RoomIdentity;
  private roles: Record<string, Role> = {};
  private events: GameEvent[] = [];
  private matchId = '';
  private startedAt = 0;
  private endedAt = 0;
  private lastMoveSent = 0;
  private lastMoveAt: Record<string, number> = {};
  private lastChatAt: Record<string, number> = {};
  private attested = new Set<string>();
  private state: RoomState;

  constructor(identity: RoomIdentity) {
    this.identity = identity;
    this.state = emptyState(this.selfId);
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
    if (!self) return;
    Object.assign(self, identity);
    if (this.state.isHost) this.broadcastLobby();
    this.emit();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  createRoom() {
    const roomId = randomRoomCode();
    const self = this.makePlayer(0);
    this.resetMatchInternals();
    this.state = {
      ...emptyState(this.selfId),
      roomId,
      hostId: this.selfId,
      isHost: true,
      phase: 'lobby',
      players: { [this.selfId]: self },
      networkStatus: 'connecting',
      settleable: true,
      doors: initialDoors(),
      bodies: [],
    };
    this.emit();
    this.relay.connect(roomId, this.selfId, true);
    return roomId;
  }

  joinRoom(roomId: string) {
    const clean = roomId.trim().toUpperCase();
    if (clean.length < 3) throw new Error('Enter a valid room code');
    this.resetMatchInternals();
    this.state = {
      ...emptyState(this.selfId),
      roomId: clean,
      phase: 'lobby',
      networkStatus: 'connecting',
      settleable: true,
      doors: initialDoors(),
      bodies: [],
    };
    this.emit();
    this.relay.connect(clean, this.selfId, false);
  }

  leave() {
    this.relay.close();
    this.resetMatchInternals();
    this.state = emptyState(this.selfId);
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
    return this.state.isHost && players.length >= 2 && players.every(player => player.ready && player.connected);
  }

  startMatch() {
    if (!this.canStart()) return false;
    const ids = Object.keys(this.state.players);
    const saboteurCount = ids.length >= 7 ? 2 : 1;
    const shuffled = cryptoShuffle(ids);
    this.roles = Object.fromEntries(ids.map(id => [id, 'crew' as Role]));
    for (const id of shuffled.slice(0, saboteurCount)) this.roles[id] = 'saboteur';

    this.matchId = crypto.randomUUID();
    this.startedAt = Date.now();
    this.endedAt = 0;
    this.events = [];
    this.attested.clear();
    this.lastMoveAt = {};
    this.state.completed = {};
    this.state.bodies = [];
    this.state.doors = initialDoors();
    this.state.sabotage = undefined;
    this.state.meeting = undefined;
    this.state.winner = undefined;
    this.state.finalSnapshot = undefined;
    this.state.settlement = undefined;
    this.state.settleable = true;
    this.state.settlementBlockReason = undefined;
    this.state.phase = 'playing';
    this.state.selfRole = this.roles[this.selfId];

    const now = Date.now();
    for (const [index, id] of ids.entries()) {
      const player = this.state.players[id];
      player.alive = true;
      player.connected = true;
      player.tasksDone = 0;
      player.emergenciesLeft = 1;
      player.x = 500 + Math.cos(index * 1.9) * 95;
      player.y = 310 + Math.sin(index * 1.9) * 80;
      player.cooldowns = {
        killUntil: now + 10_000,
        sabotageUntil: now + 15_000,
        meetingUntil: now + 12_000,
      };
    }
    const saboteurIds = ids.filter(id => this.roles[id] === 'saboteur');
    this.state.knownSaboteurs = this.roles[this.selfId] === 'saboteur' ? saboteurIds : [];
    for (const id of ids) {
      const role = this.roles[id];
      const message: RoomWireMessage = {
        type: 'start-secret',
        role,
        knownSaboteurs: role === 'saboteur' ? saboteurIds : [],
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

  tick(now = Date.now()) {
    if (!this.state.isHost || (this.state.phase !== 'playing' && this.state.phase !== 'meeting')) return;
    let changed = false;

    for (const door of Object.values(this.state.doors)) {
      if (door.lockedUntil && door.lockedUntil <= now) {
        door.lockedUntil = 0;
        changed = true;
      }
    }

    if (this.state.sabotage?.kind === 'doors' && this.state.sabotage.endsAt <= now) {
      this.state.sabotage = undefined;
      changed = true;
    }

    if (this.state.sabotage?.kind === 'reactor' && this.state.sabotage.endsAt <= now) {
      this.events.push({ t: now, type: 'sabotage', data: { kind: 'reactor', outcome: 'timeout' } });
      this.finish('saboteur');
      return;
    }

    if (this.state.meeting && this.state.meeting.endsAt <= now && !this.state.meeting.resolved) {
      this.resolveMeeting();
      return;
    }

    if (this.state.meeting?.resolved && this.state.meeting.result && this.state.meeting.result.resumeAt <= now) {
      this.resumeAfterMeeting();
      return;
    }

    for (const player of Object.values(this.state.players)) {
      if (!player.connected && player.alive && player.disconnectedAt && now - player.disconnectedAt >= DISCONNECT_GRACE_MS) {
        player.alive = false;
        player.disconnectedAt = undefined;
        this.blockSettlement(`${player.name} disconnected long enough to forfeit.`);
        this.events.push({ t: now, type: 'forfeit', actor: player.id });
        changed = true;
      }
    }

    if (changed) {
      if (this.state.phase === 'playing') this.checkWin();
      this.broadcastSnapshot();
    }
  }

  moveLocal(input: { x: number; y: number }, dt: number, now = performance.now()) {
    if (this.state.phase !== 'playing') return;
    const self = this.self;
    if (!self) return;
    const length = Math.hypot(input.x, input.y) || 1;
    const speed = self.alive ? ROOM_SPEED : GHOST_SPEED;
    const next = {
      x: clamp(self.x + input.x / length * speed * dt, 38, ROOM_WORLD.width - 38),
      y: clamp(self.y + input.y / length * speed * dt, 46, ROOM_WORLD.height - 46),
    };
    const corrected = self.alive ? resolveWorldCollision(self, next, this.state.doors, Date.now()) : next;
    self.x = corrected.x;
    self.y = corrected.y;
    if (now - this.lastMoveSent < 65) return;
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
      .filter(player => player.id !== self.id && player.alive && player.connected)
      .filter(player => this.state.selfRole !== 'saboteur' || !this.state.knownSaboteurs.includes(player.id))
      .map(player => ({ player, d: distance(self, player) }))
      .sort((a, b) => a.d - b.d)[0];
  }

  nearestBody() {
    const self = this.self;
    if (!self) return undefined;
    return this.state.bodies
      .filter(body => !body.reported)
      .map(body => ({ body, d: distance(self, body) }))
      .sort((a, b) => a.d - b.d)[0];
  }

  nearestFixPanel() {
    const self = this.self;
    const sabotage = this.state.sabotage;
    if (!self || !sabotage || sabotage.kind === 'doors') return undefined;
    const candidates = sabotage.requiredPanels
      .filter(id => !sabotage.fixedPanels.includes(id))
      .map(id => Object.values(SABOTAGE_PANELS).find(panel => panel.id === id))
      .filter((panel): panel is (typeof SABOTAGE_PANELS)[keyof typeof SABOTAGE_PANELS] => Boolean(panel))
      .map(panel => ({ panel, d: distance(self, panel) }))
      .sort((a, b) => a.d - b.d);
    return candidates[0];
  }

  canDoTask() {
    const nearest = this.nearestTask();
    return this.state.selfRole === 'crew' && this.state.phase === 'playing' && !!this.self?.alive && !!nearest && nearest.d <= TASK_DISTANCE;
  }

  canKill(now = Date.now()) {
    const nearest = this.nearestVictim();
    return this.state.selfRole === 'saboteur' && this.state.phase === 'playing' && !!this.self?.alive && !!nearest && nearest.d <= KILL_DISTANCE && now >= (this.self?.cooldowns.killUntil ?? 0);
  }

  canReport() {
    const nearest = this.nearestBody();
    return this.state.phase === 'playing' && !!this.self?.alive && !!nearest && nearest.d <= REPORT_DISTANCE;
  }

  canCallMeeting(now = Date.now()) {
    return this.state.phase === 'playing' && !!this.self?.alive && (this.self?.emergenciesLeft ?? 0) > 0 && now >= (this.self?.cooldowns.meetingUntil ?? 0);
  }

  canSabotage(kind: SabotageKind, now = Date.now()) {
    return this.state.selfRole === 'saboteur' && this.state.phase === 'playing' && !!this.self?.alive && !this.state.sabotage && now >= (this.self?.cooldowns.sabotageUntil ?? 0) && ['reactor', 'lights', 'doors'].includes(kind);
  }

  canFixSabotage() {
    const nearest = this.nearestFixPanel();
    return this.state.selfRole === 'crew' && this.state.phase === 'playing' && !!this.self?.alive && !!nearest && nearest.d <= FIX_DISTANCE;
  }

  cooldownRemaining(kind: 'kill' | 'sabotage' | 'meeting', now = Date.now()) {
    const cooldowns = this.self?.cooldowns;
    if (!cooldowns) return 0;
    const until = kind === 'kill' ? cooldowns.killUntil : kind === 'sabotage' ? cooldowns.sabotageUntil : cooldowns.meetingUntil;
    return Math.max(0, until - now);
  }

  completeTask(taskId: string) {
    if (this.state.isHost) this.hostAction(this.selfId, 'task', taskId);
    else void this.safeSend({ type: 'action', action: 'task', target: taskId });
  }

  kill() {
    const target = this.nearestVictim()?.player.id;
    if (!target) return;
    if (this.state.isHost) this.hostAction(this.selfId, 'kill', target);
    else void this.safeSend({ type: 'action', action: 'kill', target });
  }

  reportBody() {
    const target = this.nearestBody()?.body.id;
    if (!target) return;
    if (this.state.isHost) this.hostAction(this.selfId, 'report', target);
    else void this.safeSend({ type: 'action', action: 'report', target });
  }

  callMeeting() {
    if (this.state.isHost) this.hostAction(this.selfId, 'meeting');
    else void this.safeSend({ type: 'action', action: 'meeting' });
  }

  sabotage(kind: SabotageKind) {
    if (this.state.isHost) this.hostAction(this.selfId, 'sabotage', undefined, kind);
    else void this.safeSend({ type: 'action', action: 'sabotage', sabotage: kind });
  }

  fixSabotage() {
    const target = this.nearestFixPanel()?.panel.id;
    if (!target) return;
    if (this.state.isHost) this.hostAction(this.selfId, 'fix-sabotage', target);
    else void this.safeSend({ type: 'action', action: 'fix-sabotage', target });
  }

  vote(target: string) {
    if (this.state.isHost) this.hostVote(this.selfId, target);
    else void this.safeSend({ type: 'vote', target });
  }

  sendMeetingChat(text: string) {
    if (this.state.isHost) this.hostMeetingChat(this.selfId, text);
    else void this.safeSend({ type: 'chat', text });
  }

  publishSettlement(settlement: SettlementNotice) {
    if (!this.state.isHost || this.state.phase !== 'ended' || !this.state.settleable) return;
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
    const fromRelay = sender === 'relay';
    if (HOST_ONLY.has(message.type) && !fromRelay && this.state.hostId && sender !== this.state.hostId) return;

    switch (message.type) {
      case 'presence':
        if (!fromRelay) break;
        this.handlePresence(message.clientId, message.connected);
        break;
      case 'host-migrated':
        if (!fromRelay) break;
        this.state.hostId = message.hostId;
        this.state.isHost = message.hostId === this.selfId;
        if (this.state.phase === 'lobby' && this.state.isHost) this.broadcastLobby();
        this.emit();
        break;
      case 'host-lost':
        if (!fromRelay) break;
        if (this.state.phase === 'playing' || this.state.phase === 'meeting') {
          this.state.phase = 'ended';
          this.state.settleable = false;
          this.state.settlementBlockReason = 'The authoritative host did not reconnect within the grace period.';
          this.state.error = 'Host lost. Match aborted before settlement.';
        }
        this.emit();
        break;
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
          this.state.players[sender] = this.makeRemotePlayer(sender, message.player, index);
        } else {
          Object.assign(this.state.players[sender], message.player, { connected: true, disconnectedAt: undefined });
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
        this.state.knownSaboteurs = message.knownSaboteurs;
        this.state.players = message.players;
        this.state.completed = {};
        this.state.bodies = [];
        this.state.doors = initialDoors();
        this.state.sabotage = undefined;
        this.state.meeting = undefined;
        this.state.phase = 'playing';
        this.state.winner = undefined;
        this.state.finalSnapshot = undefined;
        this.state.settlement = undefined;
        this.state.settleable = true;
        this.state.settlementBlockReason = undefined;
        this.emit();
        break;
      case 'snapshot':
        if (this.state.isHost) break;
        this.state.players = message.players;
        this.state.completed = message.completed;
        this.state.bodies = message.bodies;
        this.state.doors = message.doors;
        this.state.sabotage = message.sabotage;
        this.state.meeting = message.meeting;
        this.state.phase = message.phase;
        this.state.winner = message.winner;
        this.state.settleable = message.settleable;
        this.state.settlementBlockReason = message.settlementBlockReason;
        this.emit();
        break;
      case 'move':
        if (this.state.isHost && this.state.phase === 'playing') {
          const player = this.state.players[sender];
          if (player) this.hostMove(sender, player, message.x, message.y);
        }
        break;
      case 'action':
        if (this.state.isHost) this.hostAction(sender, message.action, message.target, message.sabotage);
        break;
      case 'vote':
        if (this.state.isHost) this.hostVote(sender, message.target);
        break;
      case 'chat':
        if (this.state.isHost) this.hostMeetingChat(sender, message.text);
        break;
      case 'match-ended':
        if (!this.state.isHost) {
          this.state.finalSnapshot = message.snapshot;
          this.state.phase = 'ended';
          this.state.winner = message.snapshot.winner;
          this.state.settleable = message.snapshot.settleable ?? true;
          this.state.settlementBlockReason = message.snapshot.settlementBlockReason;
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

  private handlePresence(clientId: string, connected: boolean) {
    const player = this.state.players[clientId];
    if (!player) return;
    const now = Date.now();
    if (connected) {
      if (!player.connected) this.events.push({ t: now, type: 'reconnect', actor: clientId });
      player.connected = true;
      player.disconnectedAt = undefined;
    } else {
      player.connected = false;
      player.disconnectedAt = now;
      if (this.state.isHost && (this.state.phase === 'playing' || this.state.phase === 'meeting')) {
        this.events.push({ t: now, type: 'disconnect', actor: clientId });
      }
    }
    if (this.state.isHost) this.broadcastSnapshot();
    else this.emit();
  }

  private hostMove(sender: string, player: RoomPlayer, requestedX: number, requestedY: number) {
    const now = performance.now();
    const previous = this.lastMoveAt[sender];
    this.lastMoveAt[sender] = now;
    if (previous == null) return;
    const elapsed = Math.min(Math.max((now - previous) / 1000, 0), .5);
    const speed = player.alive ? ROOM_SPEED : GHOST_SPEED;
    const maxDistance = speed * elapsed * 1.6;
    let target = {
      x: clamp(requestedX, 38, ROOM_WORLD.width - 38),
      y: clamp(requestedY, 46, ROOM_WORLD.height - 46),
    };
    if (player.alive) target = resolveWorldCollision(player, target, this.state.doors, Date.now());
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const requestedDistance = Math.hypot(dx, dy);
    if (requestedDistance <= maxDistance || requestedDistance === 0) {
      player.x = target.x;
      player.y = target.y;
    } else if (maxDistance > 0) {
      player.x += dx / requestedDistance * maxDistance;
      player.y += dy / requestedDistance * maxDistance;
    }
    this.broadcastSnapshot();
  }

  private hostAction(
    actorId: string,
    action: 'task' | 'kill' | 'meeting' | 'report' | 'sabotage' | 'fix-sabotage',
    target?: string,
    sabotageKind?: SabotageKind,
  ) {
    const actor = this.state.players[actorId];
    if (!actor?.alive || !actor.connected || this.state.phase !== 'playing') return;
    const now = Date.now();

    if (action === 'task') {
      if (this.roles[actorId] !== 'crew') return;
      const task = ROOM_TASKS.find(item => item.id === target);
      if (!task || distance(actor, task) > TASK_DISTANCE) return;
      const completed = this.state.completed[actorId] ?? (this.state.completed[actorId] = []);
      if (!completed.includes(task.id)) {
        completed.push(task.id);
        actor.tasksDone = completed.length;
        this.events.push({ t: now, type: 'task', actor: actorId, target: task.id, data: { kind: task.kind, room: task.room } });
      }
    } else if (action === 'kill') {
      if (this.roles[actorId] !== 'saboteur' || now < actor.cooldowns.killUntil) return;
      const victim = target ? this.state.players[target] : undefined;
      if (!victim?.alive || !victim.connected || victim.id === actorId || this.roles[victim.id] === 'saboteur') return;
      if (distance(actor, victim) > KILL_DISTANCE) return;
      victim.alive = false;
      actor.cooldowns.killUntil = now + KILL_COOLDOWN_MS;
      const body: RoomBody = {
        id: crypto.randomUUID(), victimId: victim.id, victimName: victim.name, color: victim.color,
        skinId: victim.skinId, x: victim.x, y: victim.y, killedAt: now, reported: false,
      };
      this.state.bodies.push(body);
      this.events.push({ t: now, type: 'kill', actor: actorId, target: victim.id, data: { bodyId: body.id } });
    } else if (action === 'meeting') {
      if (actor.emergenciesLeft <= 0 || now < actor.cooldowns.meetingUntil) return;
      actor.emergenciesLeft -= 1;
      this.startMeeting(actorId, 'emergency');
      return;
    } else if (action === 'report') {
      const body = this.state.bodies.find(item => item.id === target && !item.reported);
      if (!body || distance(actor, body) > REPORT_DISTANCE) return;
      body.reported = true;
      this.events.push({ t: now, type: 'report', actor: actorId, target: body.victimId, data: { bodyId: body.id } });
      this.startMeeting(actorId, 'body', body.id);
      return;
    } else if (action === 'sabotage') {
      if (this.roles[actorId] !== 'saboteur' || !sabotageKind || now < actor.cooldowns.sabotageUntil || this.state.sabotage) return;
      this.startSabotage(actorId, sabotageKind, now);
    } else if (action === 'fix-sabotage') {
      if (this.roles[actorId] !== 'crew') return;
      const sabotage = this.state.sabotage;
      if (!sabotage || sabotage.kind === 'doors' || !target || !sabotage.requiredPanels.includes(target)) return;
      const panel = Object.values(SABOTAGE_PANELS).find(item => item.id === target);
      if (!panel || distance(actor, panel) > FIX_DISTANCE || sabotage.fixedPanels.includes(target)) return;
      sabotage.fixedPanels.push(target);
      this.events.push({ t: now, type: 'sabotage-fixed', actor: actorId, target, data: { kind: sabotage.kind } });
      if (sabotage.requiredPanels.every(panelId => sabotage.fixedPanels.includes(panelId))) this.state.sabotage = undefined;
    }

    if (this.state.phase === 'playing') this.checkWin();
    this.broadcastSnapshot();
  }

  private startSabotage(actorId: string, kind: SabotageKind, now: number) {
    const actor = this.state.players[actorId];
    actor.cooldowns.sabotageUntil = now + SABOTAGE_COOLDOWN_MS;
    let sabotage: SabotageState;
    if (kind === 'reactor') {
      sabotage = { kind, startedAt: now, endsAt: now + 35_000, fixedPanels: [], requiredPanels: ['reactor-left', 'reactor-right'] };
    } else if (kind === 'lights') {
      sabotage = { kind, startedAt: now, endsAt: now + 60_000, fixedPanels: [], requiredPanels: ['lights'] };
    } else {
      sabotage = { kind, startedAt: now, endsAt: now + 10_000, fixedPanels: [], requiredPanels: [] };
      for (const door of Object.values(this.state.doors)) door.lockedUntil = sabotage.endsAt;
      this.events.push({ t: now, type: 'door-lock', actor: actorId, data: { until: sabotage.endsAt } });
    }
    this.state.sabotage = sabotage;
    this.events.push({ t: now, type: 'sabotage', actor: actorId, data: { kind } });
  }

  private startMeeting(reporterId: string, reason: 'emergency' | 'body', bodyId?: string) {
    const now = Date.now();
    this.state.sabotage = undefined;
    for (const door of Object.values(this.state.doors)) door.lockedUntil = 0;
    this.state.phase = 'meeting';
    this.state.meeting = {
      reason, reporterId, bodyId, startedAt: now, endsAt: now + MEETING_DURATION_MS, votes: {}, chat: [],
    };
    this.events.push({ t: now, type: 'meeting', actor: reporterId, data: { reason, bodyId } });
    this.broadcastSnapshot();
  }

  private hostVote(actorId: string, targetId: string) {
    const meeting = this.state.meeting;
    if (this.state.phase !== 'meeting' || !meeting || meeting.resolved) return;
    const actor = this.state.players[actorId];
    const targetValid = targetId === 'skip' || Boolean(this.state.players[targetId]?.alive);
    if (!actor?.alive || !actor.connected || !targetValid || meeting.votes[actorId]) return;
    meeting.votes[actorId] = targetId;
    this.events.push({ t: Date.now(), type: 'vote', actor: actorId, target: targetId });

    const eligible = Object.values(this.state.players).filter(player => player.alive && player.connected);
    if (eligible.every(player => meeting.votes[player.id])) this.resolveMeeting();
    else this.broadcastSnapshot();
  }

  private hostMeetingChat(actorId: string, rawText: string) {
    const meeting = this.state.meeting;
    const actor = this.state.players[actorId];
    if (this.state.phase !== 'meeting' || !meeting || meeting.resolved || !actor?.alive || !actor.connected) return;
    const now = Date.now();
    if (now - (this.lastChatAt[actorId] ?? 0) < 700) return;
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!text) return;
    this.lastChatAt[actorId] = now;
    meeting.chat.push({ id: crypto.randomUUID(), senderId: actorId, senderName: actor.name, text, sentAt: now });
    if (meeting.chat.length > 30) meeting.chat.splice(0, meeting.chat.length - 30);
    this.events.push({ t: now, type: 'chat', actor: actorId, data: { text } });
    this.broadcastSnapshot();
  }

  private resolveMeeting() {
    const meeting = this.state.meeting;
    if (!meeting || meeting.resolved) return;
    meeting.resolved = true;
    const counts = Object.values(meeting.votes).reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const winner = ranked[0];
    const tied = Boolean(winner && ranked[1] && winner[1] === ranked[1][1]);
    let ejected: RoomPlayer | undefined;
    if (winner && winner[0] !== 'skip' && !tied) {
      ejected = this.state.players[winner[0]];
      if (ejected?.alive) {
        ejected.alive = false;
        this.events.push({ t: Date.now(), type: 'eject', target: ejected.id });
      }
    }
    const now = Date.now();
    for (const player of Object.values(this.state.players)) {
      player.cooldowns.meetingUntil = now + MEETING_COOLDOWN_MS;
      if (this.roles[player.id] === 'saboteur') {
        player.cooldowns.killUntil = Math.max(player.cooldowns.killUntil, now + 8_000);
        player.cooldowns.sabotageUntil = Math.max(player.cooldowns.sabotageUntil, now + 12_000);
      }
    }
    meeting.result = {
      ejectedId: ejected?.id,
      ejectedName: ejected?.name,
      wasSaboteur: ejected ? this.roles[ejected.id] === 'saboteur' : undefined,
      skipped: !winner || (winner[0] === 'skip' && !tied),
      tied,
      resumeAt: now + 4_500,
    };
    meeting.endsAt = meeting.result.resumeAt;
    this.broadcastSnapshot();
  }

  private resumeAfterMeeting() {
    if (!this.state.meeting?.resolved) return;
    this.state.meeting = undefined;
    this.state.phase = 'playing';
    this.checkWin();
    this.broadcastSnapshot();
  }

  private checkWin() {
    if (this.state.phase !== 'playing') return;
    const alive = Object.values(this.state.players).filter(player => player.alive);
    const saboteurs = alive.filter(player => this.roles[player.id] === 'saboteur').length;
    const crew = alive.filter(player => this.roles[player.id] === 'crew').length;
    if (saboteurs === 0) return this.finish('crew');
    if (saboteurs >= crew) return this.finish('saboteur');
    const crewIds = Object.keys(this.state.players).filter(id => this.roles[id] === 'crew');
    if (crewIds.length && crewIds.every(id => (this.state.completed[id] ?? []).length >= ROOM_TASKS.length)) this.finish('crew');
  }

  private finish(winner: Role) {
    if (this.state.phase === 'ended') return;
    this.state.phase = 'ended';
    this.state.winner = winner;
    this.state.sabotage = undefined;
    this.state.meeting = undefined;
    this.endedAt = Date.now();
    this.events.push({ t: this.endedAt, type: 'end', data: { winner, settleable: this.state.settleable } });
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
      settleable: this.state.settleable,
      settlementBlockReason: this.state.settlementBlockReason,
      players: Object.values(this.state.players).map(player => ({
        id: player.id,
        name: player.name,
        role: this.roles[player.id],
        alive: player.alive,
        tasksDone: player.tasksDone,
        h160Address: player.h160Address,
        productAddress: player.productAddress,
        skinId: player.skinId,
      })),
      events: [...this.events],
    };
  }

  private blockSettlement(reason: string) {
    if (!this.state.settleable) return;
    this.state.settleable = false;
    this.state.settlementBlockReason = reason;
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
      bodies: structuredClone(this.state.bodies),
      doors: structuredClone(this.state.doors),
      sabotage: this.state.sabotage ? structuredClone(this.state.sabotage) : undefined,
      meeting: this.state.meeting ? structuredClone(this.state.meeting) : undefined,
      phase: this.state.phase,
      winner: this.state.winner,
      settleable: this.state.settleable,
      settlementBlockReason: this.state.settlementBlockReason,
    });
  }

  private safePlayers() {
    return Object.fromEntries(Object.entries(this.state.players).map(([id, player]) => [id, { ...player, cooldowns: { ...player.cooldowns } }]));
  }

  private joinPayload() {
    return {
      id: this.selfId,
      name: this.identity.name,
      skinId: this.identity.skinId,
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
      connected: true,
      x: 500,
      y: 310,
      tasksDone: 0,
      emergenciesLeft: 1,
      cooldowns: { killUntil: 0, sabotageUntil: 0, meetingUntil: 0 },
    };
  }

  private makeRemotePlayer(id: string, player: { name: string; skinId: CrewSkinId; h160Address?: `0x${string}`; productAddress?: string; ready: boolean }, index: number): RoomPlayer {
    return {
      id,
      ...player,
      skinId: CREW_SKINS.some(skin => skin.id === player.skinId) ? player.skinId : 'relay-ranger',
      color: COLORS[index % COLORS.length],
      alive: true,
      connected: true,
      x: 500 + Math.cos(index) * 120,
      y: 310 + Math.sin(index) * 120,
      tasksDone: 0,
      emergenciesLeft: 1,
      cooldowns: { killUntil: 0, sabotageUntil: 0, meetingUntil: 0 },
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
      players: Object.fromEntries(Object.entries(this.state.players).map(([id, player]) => [id, { ...player, cooldowns: { ...player.cooldowns } }])),
      completed: structuredClone(this.state.completed),
      bodies: structuredClone(this.state.bodies),
      doors: structuredClone(this.state.doors),
      sabotage: this.state.sabotage ? structuredClone(this.state.sabotage) : undefined,
      meeting: this.state.meeting ? structuredClone(this.state.meeting) : undefined,
    };
    this.listeners.forEach(listener => listener(view));
  }

  private resetMatchInternals() {
    this.roles = {};
    this.events = [];
    this.attested.clear();
    this.matchId = '';
    this.startedAt = 0;
    this.endedAt = 0;
    this.lastMoveAt = {};
    this.lastChatAt = {};
  }
}

function emptyState(selfId: string): RoomState {
  return {
    roomId: '', hostId: '', isHost: false, selfId,
    phase: 'home', knownSaboteurs: [], players: {}, completed: {}, bodies: [], doors: initialDoors(),
    settleable: true, networkStatus: 'offline',
  };
}

function initialDoors() {
  return Object.fromEntries(BASE_DOORS.map(door => [door.id, { ...door }]));
}

function resolveWorldCollision(
  current: { x: number; y: number },
  next: { x: number; y: number },
  doors: Record<string, DoorState>,
  now: number,
) {
  let out = resolveWallCollision(current, next);
  const radius = 18;
  for (const door of Object.values(doors)) {
    if (door.lockedUntil <= now) continue;
    if (door.orientation === 'horizontal') {
      const withinSpan = Math.abs(out.x - door.x) <= door.span / 2 + radius;
      const crossed = (current.y < door.y && out.y + radius >= door.y) || (current.y > door.y && out.y - radius <= door.y);
      if (withinSpan && crossed) out.y = current.y;
    } else {
      const withinSpan = Math.abs(out.y - door.y) <= door.span / 2 + radius;
      const crossed = (current.x < door.x && out.x + radius >= door.x) || (current.x > door.x && out.x - radius <= door.x);
      if (withinSpan && crossed) out.x = current.x;
    }
  }
  return out;
}

function resolveWallCollision(current: { x: number; y: number }, next: { x: number; y: number }) {
  const radius = 18;
  const collides = (point: { x: number; y: number }) => MAP_WALLS.some(wall =>
    point.x + radius > wall.x
      && point.x - radius < wall.x + wall.width
      && point.y + radius > wall.y
      && point.y - radius < wall.y + wall.height,
  );
  const out = { x: next.x, y: current.y };
  if (collides(out)) out.x = current.x;
  out.y = next.y;
  if (collides(out)) out.y = current.y;
  return out;
}

function cryptoShuffle<T>(items: T[]) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const j = random[0] % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function randomRoomCode() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function distance(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }
