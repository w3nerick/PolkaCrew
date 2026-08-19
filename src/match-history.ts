import type { MatchSnapshot, Role } from './types';

const HISTORY_KEY = 'polkacrew.match-history.v1';
const HISTORY_LIMIT = 12;

export interface MatchHistoryEntry {
  id: string;
  roomId: string;
  recordedAt: number;
  winner: Role;
  role?: Role;
  won: boolean;
  tasksDone: number;
  players: number;
  settleable: boolean;
  replayCid?: string;
  chainMatchId?: string;
  finalized: boolean;
  cancelled: boolean;
}

export function loadMatchHistory(): MatchHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(value) ? value.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function historyFromSnapshot(snapshot: MatchSnapshot, selfId: string, roomId: string): MatchHistoryEntry {
  const self = snapshot.players.find(player => player.id === selfId);
  return {
    id: snapshot.id,
    roomId,
    recordedAt: snapshot.endedAt ?? Date.now(),
    winner: snapshot.winner ?? 'crew',
    role: self?.role,
    won: Boolean(self?.role && snapshot.winner === self.role),
    tasksDone: self?.tasksDone ?? 0,
    players: snapshot.players.length,
    settleable: snapshot.settleable ?? true,
    finalized: false,
    cancelled: false,
  };
}

export function upsertMatchHistory(entries: MatchHistoryEntry[], entry: MatchHistoryEntry) {
  const next = [entry, ...entries.filter(item => item.id !== entry.id)]
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, HISTORY_LIMIT);
  if (typeof window !== 'undefined') window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}
