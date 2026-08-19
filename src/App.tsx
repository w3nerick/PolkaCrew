import { useEffect, useMemo, useRef, useState } from 'react';
import { MultiplayerCanvas } from './components/MultiplayerCanvas';
import { TaskMinigame } from './components/TaskMinigame';
import { gameSound } from './game-sound';
import { PolkaCrewRoom, ROOM_TASKS } from './multiplayer/room';
import type { RoomState, RoomTask, SabotageKind } from './multiplayer/types';
import { participantsForSettlement, prepareMatchForDevnet, verifyOnChainProposal, verifyPreparedMatch, type OnChainProposalVerification, type PreparedVerification } from './polkadot/match';
import { connectPolkadotProduct, type ProductSession } from './polkadot/product';
import type { ChainMatchStatus, PlayerStats } from './polkadot/contract';
import './styles.css';
import './game-effects.css';

const emptyRoomState: RoomState = {
  roomId: '', hostId: '', isHost: false, selfId: '', phase: 'home',
  knownSaboteurs: [], players: {}, completed: {}, bodies: [], doors: {}, settleable: true, networkStatus: 'offline',
};

export default function App() {
  const [session, setSession] = useState<ProductSession | null>(null);
  const [room, setRoom] = useState<PolkaCrewRoom | null>(null);
  const [roomState, setRoomState] = useState<RoomState>(emptyRoomState);
  const [name, setName] = useState('Crewmate');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [settlementMessage, setSettlementMessage] = useState('');
  const [settlementError, setSettlementError] = useState('');
  const [verification, setVerification] = useState<PreparedVerification | null>(null);
  const [chainStatus, setChainStatus] = useState<ChainMatchStatus | null>(null);
  const [proposalVerification, setProposalVerification] = useState<OnChainProposalVerification | null>(null);
  const [selfAttested, setSelfAttested] = useState(false);
  const [activeTask, setActiveTask] = useState<RoomTask | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [clock, setClock] = useState(Date.now());
  const previous = useRef({ bodies: 0, phase: 'home', sabotage: '' as string, winner: '' as string });

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    let cleanupRoom: (() => void) | undefined;
    let product: ProductSession | undefined;

    void connectPolkadotProduct().then(connected => {
      if (!alive) { connected.destroy(); return; }
      product = connected;
      setSession(connected);
      const defaultName = connected.username
        ? `${connected.username}.dot`
        : connected.personhood.contextAlias
          ? `crew-${connected.personhood.contextAlias.slice(2, 10)}`
          : short(connected.productH160) || 'Crewmate';
      setName(defaultName);
      const multiplayer = new PolkaCrewRoom({
        name: defaultName,
        h160Address: connected.productH160,
        productAddress: connected.productAccount,
      });
      cleanupRoom = multiplayer.subscribe(setRoomState);
      setRoom(multiplayer);
    });

    return () => {
      alive = false;
      cleanupRoom?.();
      product?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!room || !session) return;
    room.setIdentity({
      name: name.trim() || 'Crewmate',
      h160Address: session.productH160,
      productAddress: session.productAccount,
    });
  }, [name, room, session]);

  useEffect(() => {
    if (!session?.productH160 || !session.contract.configured) return;
    let cancelled = false;
    void session.getPlayerStats(session.productH160).then(stats => { if (!cancelled) setPlayerStats(stats); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    const settlement = roomState.settlement;
    const snapshot = roomState.finalSnapshot;
    if (!session || !settlement || !snapshot) return;
    let cancelled = false;
    setVerification(null);
    setSelfAttested(false);
    setProposalVerification(null);
    void Promise.all([
      verifyPreparedMatch(session, snapshot, settlement.replayCid, settlement.matchId),
      session.contract.configured ? session.getMatchStatus(settlement.matchId) : Promise.resolve(null),
      session.contract.configured ? verifyOnChainProposal(session, settlement) : Promise.resolve(null),
      session.contract.configured && session.productH160
        ? session.hasAttested(settlement.matchId, session.productH160)
        : Promise.resolve(false),
    ])
      .then(([result, current, chainProposal, alreadyAttested]) => {
        if (cancelled) return;
        setVerification(result);
        setChainStatus(current);
        setProposalVerification(chainProposal);
        setSelfAttested(alreadyAttested);
      })
      .catch(error => {
        if (!cancelled) setSettlementError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [roomState.settlement?.matchId, roomState.finalSnapshot?.id, session]);

  useEffect(() => {
    if (roomState.phase !== 'playing') setActiveTask(null);
    const prev = previous.current;
    if (roomState.bodies.length > prev.bodies) gameSound.kill();
    if (roomState.phase === 'meeting' && prev.phase !== 'meeting') gameSound.report();
    if (roomState.sabotage?.kind && roomState.sabotage.kind !== prev.sabotage) gameSound.sabotage();
    if (roomState.phase === 'ended' && prev.phase !== 'ended' && roomState.winner) {
      const me = roomState.finalSnapshot?.players.find(player => player.id === roomState.selfId);
      if (me && me.role === roomState.winner) gameSound.win(); else gameSound.lose();
    }
    previous.current = {
      bodies: roomState.bodies.length,
      phase: roomState.phase,
      sabotage: roomState.sabotage?.kind ?? '',
      winner: roomState.winner ?? '',
    };
  }, [roomState.phase, roomState.bodies.length, roomState.sabotage?.kind, roomState.winner, roomState.finalSnapshot, roomState.selfId]);

  const self = roomState.players[roomState.selfId];
  const players = useMemo(() => Object.values(roomState.players), [roomState.players]);
  const onChainReady = players.filter(player => player.h160Address).length;
  const productAccounts = players.flatMap(player => player.h160Address ? [player.h160Address.toLowerCase()] : []);
  const allOnChainReady = players.length >= 2 && onChainReady === players.length && new Set(productAccounts).size === players.length;
  const nearestTask = room?.nearestTask();
  const nearestVictim = room?.nearestVictim();
  const nearestBody = room?.nearestBody();
  const nearestFix = room?.nearestFixPanel();
  const killCooldown = room ? room.cooldownRemaining('kill', clock) : 0;
  const sabotageCooldown = room ? room.cooldownRemaining('sabotage', clock) : 0;
  const meetingCooldown = room ? room.cooldownRemaining('meeting', clock) : 0;
  const sabotageRemaining = roomState.sabotage ? Math.max(0, roomState.sabotage.endsAt - clock) : 0;
  const meetingRemaining = roomState.meeting ? Math.max(0, roomState.meeting.endsAt - clock) : 0;

  const createRoom = () => {
    setSettlementError('');
    setSettlementMessage('');
    room?.createRoom();
  };

  const joinRoom = () => {
    try {
      setSettlementError('');
      setSettlementMessage('');
      room?.joinRoom(joinCode);
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : String(error));
    }
  };

  const startTask = () => {
    if (!room?.canDoTask() || !nearestTask) return;
    setActiveTask(nearestTask.task);
  };

  const finishTask = () => {
    if (!activeTask || !room) return;
    room.completeTask(activeTask.id);
    setActiveTask(null);
  };

  const publishResult = async () => {
    if (!session || !room || !roomState.finalSnapshot || !roomState.winner || !session.productH160) return;
    setBusy(true);
    setSettlementError('');
    setSettlementMessage('Uploading canonical replay to Bulletin…');
    try {
      if (!roomState.settleable) throw new Error(roomState.settlementBlockReason || 'This match was marked non-settleable.');
      if (session.mode !== 'polkadot-host') throw new Error('Open PolkaCrew inside Polkadot App / dev-dot.li to settle a match.');
      if (!session.contract.configured) throw new Error(session.contract.reason || 'PolkaCrewResults is not installed through CDM.');
      const participantRows = participantsForSettlement(roomState.finalSnapshot, roomState.winner);
      const prepared = await prepareMatchForDevnet(session, roomState.finalSnapshot);
      setSettlementMessage('Replay stored. Re-reading it from Bulletin…');
      const hostVerification = await verifyPreparedMatch(session, roomState.finalSnapshot, prepared.replayCid, prepared.matchId);
      if (!hostVerification.valid) throw new Error('Bulletin replay verification failed after upload. Match was not proposed.');
      setVerification(hostVerification);
      setSettlementMessage('Replay verified. Proposing match on Asset Hub…');
      await session.proposeMatch({
        matchId: prepared.matchId,
        replayCid: prepared.replayCid,
        winner: roomState.winner,
        participants: participantRows.map(row => row.h160Address),
        won: participantRows.map(row => row.won),
      });
      const settlement = {
        matchId: prepared.matchId,
        replayCid: prepared.replayCid,
        winner: roomState.winner,
        proposerH160: session.productH160,
        participants: participantRows,
      } as const;
      setSettlementMessage('Proposal included. Verifying Asset Hub state…');
      const chainProposal = await verifyOnChainProposal(session, settlement);
      if (!chainProposal.valid) throw new Error('Asset Hub proposal does not match the verified replay. Host attestation was blocked.');
      setProposalVerification(chainProposal);
      room.publishSettlement(settlement);
      setSettlementMessage('Proposal verified. Attesting with this Product Account…');
      await session.attestMatch(prepared.matchId);
      room.markAttested(session.productH160);
      setSelfAttested(true);
      const current = await session.getMatchStatus(prepared.matchId);
      setChainStatus(current);
      setSettlementMessage(current?.finalized ? 'Match finalized on Asset Hub ✓' : 'Your attestation is on-chain. Waiting for the crew…');
      if (current?.finalized) void refreshPlayerStats(session);
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : String(error));
      setSettlementMessage('');
    } finally {
      setBusy(false);
    }
  };

  const refreshPlayerStats = async (product = session) => {
    if (!product?.productH160 || !product.contract.configured) return;
    try { setPlayerStats(await product.getPlayerStats(product.productH160)); } catch { /* optional profile read */ }
  };

  const attestResult = async () => {
    const settlement = roomState.settlement;
    if (!session || !room || !settlement || !session.productH160) return;
    setBusy(true);
    setSettlementError('');
    try {
      if (!verification?.valid) throw new Error('Replay verification failed. Refusing to attest this match.');
      if (!proposalVerification?.valid) throw new Error('Asset Hub proposal does not match the verified replay. Refusing to attest.');
      if (chainStatus?.cancelled) throw new Error('This match proposal was cancelled after expiry.');
      if (!settlement.participants.some(row => row.h160Address.toLowerCase() === session.productH160!.toLowerCase())) {
        throw new Error('This Product Account is not listed as a match participant.');
      }
      setSettlementMessage('Checking optional .dot identity proof…');
      await session.proveDotIdentity(`PolkaCrew match attestation\n${settlement.matchId}`, session.username);
      setSettlementMessage('Submitting attestation to Asset Hub…');
      await session.attestMatch(settlement.matchId);
      room.markAttested(session.productH160);
      setSelfAttested(true);
      const current = await session.getMatchStatus(settlement.matchId);
      setChainStatus(current);
      setSettlementMessage(current?.finalized ? 'Match finalized on Asset Hub ✓' : 'Attestation confirmed. Waiting for other players…');
      if (current?.finalized) void refreshPlayerStats(session);
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const refreshChainStatus = async () => {
    if (!session || !roomState.settlement) return;
    try {
      const [current, chainProposal, alreadyAttested] = await Promise.all([
        session.getMatchStatus(roomState.settlement.matchId),
        verifyOnChainProposal(session, roomState.settlement),
        session.productH160 ? session.hasAttested(roomState.settlement.matchId, session.productH160) : Promise.resolve(false),
      ]);
      setChainStatus(current);
      setProposalVerification(chainProposal);
      setSelfAttested(alreadyAttested);
      if (current?.finalized) void refreshPlayerStats(session);
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : String(error));
    }
  };

  const cancelExpired = async () => {
    if (!session || !roomState.settlement) return;
    setBusy(true);
    setSettlementError('');
    try {
      await session.cancelExpiredMatch(roomState.settlement.matchId);
      await refreshChainStatus();
      setSettlementMessage('Expired proposal cancelled. No XP was minted.');
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  if (!room || !session) {
    return <main className="boot"><div className="loader"/><h1>POLKACREW</h1><p>Connecting to the Product host…</p></main>;
  }

  const xp = Number(playerStats?.xp ?? 0n);
  const level = Math.max(1, Math.floor(Math.sqrt(xp / 180)) + 1);

  return <main className="app-shell">
    <header className="topbar">
      <div><div className="eyebrow">POLKADOT PRODUCTS DEVNET · v0.5.1 PRE-DEPLOY</div><h1>POLKA<span>CREW</span></h1></div>
      <div className="top-status">
        <div className="host-pill"><i className={roomState.networkStatus === 'connected' ? 'online' : ''}/>{roomState.networkStatus.toUpperCase()}</div>
        <div className="host-pill"><i className={session.mode === 'polkadot-host' ? 'online' : ''}/>{session.mode === 'polkadot-host' ? 'POLKADOT HOST' : 'LOCAL DEV'}</div>
      </div>
    </header>

    {roomState.phase === 'home' && <section className="home-grid">
      <div className="hero-card">
        <div className="eyebrow">SOCIAL DEDUCTION · POLKADOT NATIVE</div>
        <h2>Sabotage the ship.<br/><span>Not the truth.</span></h2>
        <p>Fast realtime gameplay stays off-chain. Clean match replays are pinned to Bulletin and only participant-verified results earn permanent XP on Asset Hub.</p>
        <div className="feature-row"><span>☠ Bodies + reports</span><span>⚠ Sabotage</span><span>🧩 Mini tasks</span><span>🔐 Verified settlement</span></div>
        <label>PLAYER NAME<input value={name} maxLength={18} onChange={(event: { target: { value: string } }) => setName(event.target.value)} /></label>
        <div className="home-actions"><button className="primary big" onClick={createRoom}>CREATE ROOM</button><div className="join-row"><input placeholder="ROOM CODE" maxLength={5} value={joinCode} onChange={(event: { target: { value: string } }) => setJoinCode(event.target.value.toUpperCase())}/><button onClick={joinRoom}>JOIN</button></div></div>
        {settlementError && <p className="error-line">{settlementError}</p>}
      </div>
      <aside className="identity-card panel">
        <div className="eyebrow">PRODUCT PROFILE</div>
        <h3>{session.username ? `${session.username}.dot` : 'Anonymous crew'}</h3>
        <div className="profile-level"><strong>LV {level}</strong><span>{xp} XP</span></div>
        <div className="stat"><span>Games</span><b>{String(playerStats?.games ?? 0n)}</b></div>
        <div className="stat"><span>Wins</span><b>{String(playerStats?.wins ?? 0n)}</b></div>
        <div className="stat"><span>Product H160</span><b>{short(session.productH160)}</b></div>
        <div className="stat"><span>Asset Hub</span><b>{session.devnet.assetHubConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>Bulletin</span><b>{session.devnet.bulletinConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>People</span><b>{session.devnet.peopleConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>Personhood</span><b>{session.personhood.tier.toUpperCase()}</b></div>
        <div className="stat"><span>Private app alias</span><b>{short(session.personhood.contextAlias)}</b></div>
        <div className="stat"><span>CDM contract</span><b>{session.contract.configured ? 'RESOLVED' : 'NOT INSTALLED'}</b></div>
        <p className="hint">Product Account signs PolkaCrew state. .dot identity and personhood stay separate.</p>
      </aside>
    </section>}

    {roomState.phase === 'lobby' && <section className="lobby-card panel">
      <div className="lobby-head"><div><div className="eyebrow">ROOM CODE</div><div className="room-code">{roomState.roomId}</div></div><button className="ghost" onClick={() => room.leave()}>LEAVE</button></div>
      <p className="muted">Share the code. Brief network drops can reconnect; if the host disappears for more than the grace window during a match, settlement is aborted instead of guessing game truth.</p>
      <div className="lobby-list">{players.map(player => <div className={`lobby-player ${!player.connected ? 'disconnected' : ''}`} key={player.id}><i style={{background:player.color}}/><div><strong>{player.name} {player.id === roomState.hostId && '👑'}</strong><small>{player.productAddress ? short(player.productAddress) : 'local identity'}</small></div><span className={player.h160Address ? 'chain-ready' : ''}>{player.h160Address ? 'ON-CHAIN' : 'LOCAL'}</span><b className={player.connected ? (player.ready ? 'ready' : '') : 'offline'}>{player.connected ? (player.ready ? 'READY' : 'WAITING') : 'OFFLINE'}</b></div>)}</div>
      <div className="lobby-footer"><div><b>{onChainReady}/{players.length}</b> Product Accounts ready</div><button onClick={() => room.setReady(!self?.ready)}>{self?.ready ? 'NOT READY' : "I'M READY"}</button>{roomState.isHost && <button className="primary" disabled={!room.canStart()} onClick={() => room.startMatch()}>START MATCH</button>}</div>
      {!allOnChainReady && <p className="warning-line">The match can still be played locally, but Asset Hub settlement is blocked if any participant lacks a unique Product H160.</p>}
    </section>}

    {(roomState.phase === 'playing' || roomState.phase === 'meeting' || roomState.phase === 'ended') && <section className="game-layout">
      <aside className="panel left-panel">
        <div className="role-card"><small>YOUR ROLE</small><strong className={roomState.selfRole}>{self?.alive === false ? 'GHOST' : roomState.selfRole === 'saboteur' ? 'SABOTEUR' : 'CREW'}</strong><p>{self?.alive === false ? 'You can roam as a ghost, but cannot influence tasks, reports or votes.' : roomState.selfRole === 'saboteur' ? `Blend in, lock doors and break ship systems.${roomState.knownSaboteurs.length > 1 ? ` Allies: ${roomState.knownSaboteurs.filter(id => id !== roomState.selfId).map(id => roomState.players[id]?.name).filter(Boolean).join(', ')}` : ''}` : 'Complete mini tasks, repair sabotage and expose the saboteur.'}</p></div>
        <div className="stat"><span>Room</span><b>{roomState.roomId}</b></div>
        <div className="stat"><span>Players alive</span><b>{players.filter(player => player.alive).length}/{players.length}</b></div>
        <div className="stat"><span>Tasks</span><b>{self?.tasksDone ?? 0}/{ROOM_TASKS.length}</b></div>
        <div className="progress"><i style={{width:`${((self?.tasksDone ?? 0) / ROOM_TASKS.length) * 100}%`}}/></div>
        <div className="stat"><span>Emergency calls</span><b>{self?.emergenciesLeft ?? 0}</b></div>
        <div className="stat"><span>Integrity</span><b className={roomState.settleable ? 'ok-text' : 'warn-text'}>{roomState.settleable ? 'CLEAN' : 'LOCAL ONLY'}</b></div>
        {!roomState.settleable && <p className="warning-line compact">{roomState.settlementBlockReason}</p>}
        <p className="hint">WASD / arrows · touch pad on mobile.</p>
      </aside>

      <section className="stage">
        <MultiplayerCanvas room={room} state={roomState}/>
        {roomState.sabotage && roomState.phase === 'playing' && <div className={`sabotage-banner ${roomState.sabotage.kind}`}><b>{sabotageLabel(roomState.sabotage.kind)}</b><span>{roomState.sabotage.kind === 'reactor' ? `${Math.ceil(sabotageRemaining/1000)}s` : roomState.sabotage.kind === 'doors' ? `${Math.ceil(sabotageRemaining/1000)}s` : 'REPAIR REQUIRED'}</span></div>}
        {activeTask && roomState.phase === 'playing' && <TaskMinigame task={activeTask} onComplete={finishTask} onCancel={() => setActiveTask(null)}/>}
        {roomState.phase === 'meeting' && roomState.meeting && <MeetingOverlay state={roomState} room={room} remaining={meetingRemaining}/>}
        {roomState.phase === 'ended' && <ResultOverlay
          room={room}
          session={session}
          state={roomState}
          allOnChainReady={allOnChainReady}
          busy={busy}
          verification={verification}
          proposalVerification={proposalVerification}
          chainStatus={chainStatus}
          selfAttested={selfAttested}
          settlementMessage={settlementMessage}
          settlementError={settlementError}
          onPublish={publishResult}
          onAttest={attestResult}
          onRefresh={refreshChainStatus}
          onCancelExpired={cancelExpired}
          clock={clock}
        />}
      </section>

      <aside className="panel actions">
        <div><div className="eyebrow">ACTION DECK</div><h3>Ship systems</h3></div>
        {roomState.selfRole === 'crew' && <>
          <button className="action pink" disabled={!room.canDoTask()} onClick={startTask}>🧩 Open task<small>{nearestTask ? `${Math.round(nearestTask.d)}m · ${nearestTask.task.label}` : 'No task nearby'}</small></button>
          <button className="action report" disabled={!room.canReport()} onClick={() => room.reportBody()}>☠ REPORT BODY<small>{nearestBody ? `${Math.round(nearestBody.d)}m · ${nearestBody.body.victimName}` : 'No body nearby'}</small></button>
          <button className="action repair" disabled={!room.canFixSabotage()} onClick={() => room.fixSabotage()}>⚡ Repair sabotage<small>{nearestFix ? `${Math.round(nearestFix.d)}m · ${nearestFix.panel.label}` : roomState.sabotage ? 'Find the repair panel' : 'Systems nominal'}</small></button>
        </>}
        {roomState.selfRole === 'saboteur' && <>
          <button className="action danger" disabled={!room.canKill(clock)} onClick={() => room.kill()}>✦ Disable crew<small>{killCooldown ? `Cooldown ${seconds(killCooldown)}` : nearestVictim ? `${Math.round(nearestVictim.d)}m · ${nearestVictim.player.name}` : 'No target nearby'}</small></button>
          <div className="sabotage-grid">{(['reactor','lights','doors'] as SabotageKind[]).map(kind => <button key={kind} disabled={!room.canSabotage(kind, clock)} onClick={() => room.sabotage(kind)}>{kind === 'reactor' ? '☢' : kind === 'lights' ? '◐' : '▥'}<small>{kind}</small></button>)}</div>
          <div className="cooldown-line">Sabotage {sabotageCooldown ? seconds(sabotageCooldown) : 'READY'}</div>
        </>}
        <button className="action" disabled={!room.canCallMeeting(clock)} onClick={() => room.callMeeting()}>◉ Emergency meeting<small>{meetingCooldown ? `Cooldown ${seconds(meetingCooldown)}` : `${self?.emergenciesLeft ?? 0} call remaining`}</small></button>
        <div className="network-card"><span>Settlement layer</span><b>{roomState.settlement ? 'MATCH HASH READY' : session.contract.configured ? 'ASSET HUB READY' : 'CDM REQUIRED'}</b><small>Realtime: relay · Replay: Bulletin · Consensus: PolkaVM</small></div>
      </aside>
    </section>}
  </main>;
}

function MeetingOverlay({ state, room, remaining }: { state: RoomState; room: PolkaCrewRoom; remaining: number }) {
  const meeting = state.meeting!;
  const players = Object.values(state.players);
  const me = state.players[state.selfId];
  const myVote = meeting.votes[state.selfId];
  return <div className="overlay meeting"><div className="dialog meeting-dialog">
    <div className="meeting-title"><div><div className="eyebrow">{meeting.reason === 'body' ? 'BODY REPORTED' : 'EMERGENCY CONSENSUS'}</div><h2>{meeting.reason === 'body' ? 'A crew member is down.' : 'Who is the saboteur?'}</h2></div><div className="meeting-clock">{Math.ceil(remaining/1000)}s</div></div>
    <div className="vote-grid">{players.filter(player => player.alive).map(player => <button key={player.id} disabled={!me?.alive || Boolean(myVote)} onClick={() => { gameSound.vote(); room.vote(player.id); }}><i style={{background:player.color}}/><span>{player.name}<small>{player.connected ? '' : 'OFFLINE'}</small></span>{Object.values(meeting.votes).filter(v => v === player.id).length > 0 && <b>{Object.values(meeting.votes).filter(v => v === player.id).length}</b>}</button>)}<button className="skip-vote" disabled={!me?.alive || Boolean(myVote)} onClick={() => { gameSound.vote(); room.vote('skip'); }}>SKIP VOTE <b>{Object.values(meeting.votes).filter(v => v === 'skip').length || ''}</b></button></div>
    <p className="hint">Vote resolves when all connected living players vote, or when the timer expires. Disconnected players do not freeze the meeting.</p>
  </div></div>;
}

function ResultOverlay(props: {
  room: PolkaCrewRoom;
  session: ProductSession;
  state: RoomState;
  allOnChainReady: boolean;
  busy: boolean;
  verification: PreparedVerification | null;
  proposalVerification: OnChainProposalVerification | null;
  chainStatus: ChainMatchStatus | null;
  selfAttested: boolean;
  settlementMessage: string;
  settlementError: string;
  onPublish: () => void;
  onAttest: () => void;
  onRefresh: () => void;
  onCancelExpired: () => void;
  clock: number;
}) {
  const { room, session, state, allOnChainReady, busy, verification, proposalVerification, chainStatus, selfAttested, settlementMessage, settlementError, onPublish, onAttest, onRefresh, onCancelExpired, clock } = props;
  const snapshot = state.finalSnapshot;
  const me = snapshot?.players.find(player => player.id === state.selfId);
  const won = Boolean(me && state.winner && me.role === state.winner);
  const projectedXp = won ? 125 : 40;
  const achievements = snapshot && me ? achievementsFor(snapshot, me.id) : [];
  const expired = Boolean(chainStatus?.expiresAt && BigInt(Math.floor(clock/1000)) > chainStatus.expiresAt);

  return <div className="overlay result-overlay"><div className="dialog result wide">
    <div className="eyebrow">{state.winner ? 'MATCH COMPLETE' : 'MATCH ABORTED'}</div>
    <h2>{state.winner === 'crew' ? 'CREW VICTORY' : state.winner === 'saboteur' ? 'SABOTEUR VICTORY' : 'NO CANONICAL RESULT'}</h2>
    {state.winner && <div className="result-score"><strong>{won ? `+${projectedXp} XP` : `+${projectedXp} XP`}</strong><span>{won ? 'Victory reward' : 'Participation reward'} · minted only after finalization</span></div>}
    {snapshot && <div className="role-reveal">{snapshot.players.map(player => <div key={player.id} className={player.role}><i/><span>{player.name}</span><b>{player.role.toUpperCase()}</b><small>{player.alive ? 'SURVIVED' : 'OUT'}</small></div>)}</div>}
    {achievements.length > 0 && <div className="achievement-row">{achievements.map(item => <span key={item}>✦ {item}</span>)}</div>}

    {!state.settleable && <p className="warning-line">Settlement disabled: {state.settlementBlockReason || 'match integrity was interrupted'}. The game result stays local and cannot mint XP.</p>}
    {state.settleable && <p>The role reveal is canonicalized before Bulletin storage. Every participant independently checks replay CID, match hash and Asset Hub proposal before attesting.</p>}

    {!state.settlement && state.isHost && state.settleable && <button className="primary" onClick={onPublish} disabled={busy || !allOnChainReady || !session.contract.configured}>{busy ? 'WORKING…' : 'UPLOAD + PROPOSE + ATTEST'}</button>}
    {!state.settlement && !state.isHost && state.settleable && <div className="settlement-wait">Waiting for the host to publish the immutable replay…</div>}
    {state.settlement && <SettlementPanel session={session} state={state} verification={verification} proposalVerification={proposalVerification} chainStatus={chainStatus} attestedCount={room.settlementAttestedCount} selfAttested={selfAttested} busy={busy} expired={expired} onAttest={onAttest} onRefresh={onRefresh} onCancelExpired={onCancelExpired}/>}
    {settlementMessage && <p className="success-line">{settlementMessage}</p>}
    {settlementError && <p className="error-line">{settlementError}</p>}
    {state.settleable && !allOnChainReady && state.isHost && <p className="warning-line">This room contains local-only players. Replay settlement is intentionally blocked.</p>}
    <button className="ghost result-leave" onClick={() => room.leave()}>BACK TO HOME</button>
  </div></div>;
}

function SettlementPanel({ session, state, verification, proposalVerification, chainStatus, attestedCount, selfAttested, busy, expired, onAttest, onRefresh, onCancelExpired }: {
  session: ProductSession;
  state: RoomState;
  verification: PreparedVerification | null;
  proposalVerification: OnChainProposalVerification | null;
  chainStatus: ChainMatchStatus | null;
  attestedCount: number;
  selfAttested: boolean;
  busy: boolean;
  expired: boolean;
  onAttest: () => void;
  onRefresh: () => void;
  onCancelExpired: () => void;
}) {
  const settlement = state.settlement!;
  const mine = session.productH160 && settlement.participants.some(item => item.h160Address.toLowerCase() === session.productH160!.toLowerCase());
  const verified = Boolean(verification?.valid && proposalVerification?.valid);
  return <div className="settlement-panel">
    <div className="verify-grid"><span>Replay CID <b className={verification?.cidMatches ? 'ok' : ''}>{verification ? (verification.cidMatches ? 'VERIFIED' : 'MISMATCH') : 'VERIFYING…'}</b></span><span>Match hash <b className={verification?.matchIdMatches ? 'ok' : ''}>{verification ? (verification.matchIdMatches ? 'VERIFIED' : 'MISMATCH') : 'VERIFYING…'}</b></span><span>Asset Hub proposal <b className={proposalVerification?.valid ? 'ok' : ''}>{proposalVerification ? (proposalVerification.valid ? 'VERIFIED' : 'MISMATCH') : 'VERIFYING…'}</b></span><span>Attestations <b>{chainStatus ? `${chainStatus.attestations ?? 0}/${chainStatus.playerCount ?? settlement.participants.length}` : `${attestedCount}/${settlement.participants.length}`}</b></span><span>Finalized <b className={chainStatus?.finalized ? 'ok' : ''}>{chainStatus?.finalized ? 'YES' : 'NO'}</b></span><span>Proposal <b className={chainStatus?.cancelled ? 'bad-text' : expired ? 'warn-text' : ''}>{chainStatus?.cancelled ? 'CANCELLED' : expired ? 'EXPIRED' : 'OPEN'}</b></span></div>
    <code>{settlement.replayCid}</code><code>{settlement.matchId}</code>
    <div className="settlement-actions">{mine && !chainStatus?.finalized && !chainStatus?.cancelled && !expired && <button className="primary" disabled={busy || !verified || session.mode !== 'polkadot-host' || selfAttested} onClick={onAttest}>{selfAttested ? 'ATTESTED ✓' : 'ATTEST RESULT'}</button>}{mine && expired && !chainStatus?.cancelled && !chainStatus?.finalized && <button className="danger-button" disabled={busy} onClick={onCancelExpired}>CANCEL EXPIRED PROPOSAL</button>}<button className="ghost" onClick={onRefresh}>REFRESH CHAIN</button></div>
  </div>;
}

function achievementsFor(snapshot: NonNullable<RoomState['finalSnapshot']>, playerId: string) {
  const player = snapshot.players.find(item => item.id === playerId);
  if (!player) return [];
  const items: string[] = [];
  if (player.tasksDone >= ROOM_TASKS.length) items.push('Task Singularity');
  if (player.alive && player.role === snapshot.winner) items.push('Still Breathing');
  const kills = snapshot.events.filter(event => event.type === 'kill' && event.actor === playerId).length;
  if (kills >= 2) items.push('Silent Fork');
  if (snapshot.events.some(event => event.type === 'report' && event.actor === playerId)) items.push('Truth Courier');
  if (snapshot.events.some(event => event.type === 'sabotage-fixed' && event.actor === playerId)) items.push('Runtime Medic');
  return items.slice(0, 3);
}

function sabotageLabel(kind: SabotageKind) {
  return kind === 'reactor' ? 'REACTOR MELTDOWN' : kind === 'lights' ? 'LIGHTS OFFLINE' : 'DOORS LOCKED';
}

function seconds(ms: number) { return `${Math.ceil(ms / 1000)}s`; }

function short(value?: string) {
  if (!value) return 'N/A';
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`;
}
