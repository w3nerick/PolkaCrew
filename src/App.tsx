import { useEffect, useMemo, useState } from 'react';
import { MultiplayerCanvas } from './components/MultiplayerCanvas';
import { PolkaCrewRoom, ROOM_TASKS } from './multiplayer/room';
import type { RoomState } from './multiplayer/types';
import { participantsForSettlement, prepareMatchForDevnet, verifyOnChainProposal, verifyPreparedMatch, type OnChainProposalVerification, type PreparedVerification } from './polkadot/match';
import { connectPolkadotProduct, type ProductSession } from './polkadot/product';
import type { ChainMatchStatus } from './polkadot/contract';
import './styles.css';
import './game-effects.css';

const emptyRoomState: RoomState = {
  roomId: '', hostId: '', isHost: false, selfId: '', phase: 'home',
  players: {}, completed: {}, networkStatus: 'offline',
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

  const self = roomState.players[roomState.selfId];
  const players = useMemo(() => Object.values(roomState.players), [roomState.players]);
  const onChainReady = players.filter(player => player.h160Address).length;
  const productAccounts = players.flatMap(player => player.h160Address ? [player.h160Address.toLowerCase()] : []);
  const allOnChainReady = players.length >= 2 && onChainReady === players.length && new Set(productAccounts).size === players.length;
  const nearestTask = room?.nearestTask();
  const nearestVictim = room?.nearestVictim();

  const createRoom = () => {
    setSettlementError('');
    room?.createRoom();
  };

  const joinRoom = () => {
    try {
      setSettlementError('');
      room?.joinRoom(joinCode);
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : String(error));
    }
  };

  const publishResult = async () => {
    if (!session || !room || !roomState.finalSnapshot || !roomState.winner || !session.productH160) return;
    setBusy(true);
    setSettlementError('');
    setSettlementMessage('Uploading canonical replay to Bulletin…');
    try {
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
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : String(error));
      setSettlementMessage('');
    } finally {
      setBusy(false);
    }
  };

  const attestResult = async () => {
    const settlement = roomState.settlement;
    if (!session || !room || !settlement || !session.productH160) return;
    setBusy(true);
    setSettlementError('');
    try {
      if (!verification?.valid) throw new Error('Replay verification failed. Refusing to attest this match.');
      if (!proposalVerification?.valid) throw new Error('Asset Hub proposal does not match the verified replay. Refusing to attest.');
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
    } catch (error) {
      setSettlementError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!room || !session) {
    return <main className="boot"><div className="loader"/><h1>POLKACREW</h1><p>Connecting to the Product host…</p></main>;
  }

  return <main className="app-shell">
    <header className="topbar">
      <div><div className="eyebrow">POLKADOT PRODUCTS DEVNET · v0.4</div><h1>POLKA<span>CREW</span></h1></div>
      <div className="top-status">
        <div className="host-pill"><i className={roomState.networkStatus === 'connected' ? 'online' : ''}/>{roomState.networkStatus.toUpperCase()}</div>
        <div className="host-pill"><i className={session.mode === 'polkadot-host' ? 'online' : ''}/>{session.mode === 'polkadot-host' ? 'POLKADOT HOST' : 'LOCAL DEV'}</div>
      </div>
    </header>

    {roomState.phase === 'home' && <section className="home-grid">
      <div className="hero-card">
        <div className="eyebrow">SOCIAL DEDUCTION · POLKADOT NATIVE</div>
        <h2>Trust the crew.<br/><span>Verify the result.</span></h2>
        <p>Real-time gameplay stays fast off-chain. Match consensus, identity and immutable replays settle through Polkadot Products Devnet.</p>
        <label>PLAYER NAME<input value={name} maxLength={18} onChange={event => setName(event.target.value)} /></label>
        <div className="home-actions"><button className="primary big" onClick={createRoom}>CREATE ROOM</button><div className="join-row"><input placeholder="ROOM CODE" maxLength={5} value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())}/><button onClick={joinRoom}>JOIN</button></div></div>
        {settlementError && <p className="error-line">{settlementError}</p>}
      </div>
      <aside className="identity-card panel">
        <div className="eyebrow">PRODUCT IDENTITY</div>
        <h3>{session.username ? `${session.username}.dot` : 'Anonymous crew'}</h3>
        <div className="stat"><span>Product H160</span><b>{short(session.productH160)}</b></div>
        <div className="stat"><span>Product SS58</span><b>{short(session.productAccount)}</b></div>
        <div className="stat"><span>Asset Hub</span><b>{session.devnet.assetHubConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>Bulletin</span><b>{session.devnet.bulletinConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>People</span><b>{session.devnet.peopleConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>Personhood</span><b>{session.personhood.tier.toUpperCase()}</b></div>
        <div className="stat"><span>Private app alias</span><b>{short(session.personhood.contextAlias)}</b></div>
        <div className="stat"><span>CDM contract</span><b>{session.contract.configured ? 'RESOLVED' : 'NOT INSTALLED'}</b></div>
        <p className="hint">The Product Account signs game-contract transactions. Your .dot identity remains a separate People-chain proof.</p>
      </aside>
    </section>}

    {roomState.phase === 'lobby' && <section className="lobby-card panel">
      <div className="lobby-head"><div><div className="eyebrow">ROOM CODE</div><div className="room-code">{roomState.roomId}</div></div><button className="ghost" onClick={() => room.leave()}>LEAVE</button></div>
      <p className="muted">Share the code. For on-chain settlement every player needs to enter through the Polkadot host with a Product Account.</p>
      <div className="lobby-list">{players.map(player => <div className="lobby-player" key={player.id}><i style={{background:player.color}}/><div><strong>{player.name} {player.id === roomState.hostId && '👑'}</strong><small>{player.productAddress ? short(player.productAddress) : 'local identity'}</small></div><span className={player.h160Address ? 'chain-ready' : ''}>{player.h160Address ? 'ON-CHAIN' : 'LOCAL'}</span><b className={player.ready ? 'ready' : ''}>{player.ready ? 'READY' : 'WAITING'}</b></div>)}</div>
      <div className="lobby-footer"><div><b>{onChainReady}/{players.length}</b> Product Accounts ready</div><button onClick={() => room.setReady(!self?.ready)}>{self?.ready ? 'NOT READY' : "I'M READY"}</button>{roomState.isHost && <button className="primary" disabled={!room.canStart()} onClick={() => room.startMatch()}>START MATCH</button>}</div>
      {!allOnChainReady && <p className="warning-line">The match can still be played, but Asset Hub settlement will be disabled if any participant lacks a Product H160.</p>}
    </section>}

    {(roomState.phase === 'playing' || roomState.phase === 'meeting' || roomState.phase === 'ended') && <section className="game-layout">
      <aside className="panel left-panel">
        <div className="role-card"><small>YOUR ROLE</small><strong className={roomState.selfRole}>{roomState.selfRole === 'saboteur' ? 'SABOTEUR' : 'CREW'}</strong><p>{roomState.selfRole === 'saboteur' ? 'Blend in. Disable the crew. Survive consensus.' : 'Complete platform tasks and expose the saboteur.'}</p></div>
        <div className="stat"><span>Room</span><b>{roomState.roomId}</b></div>
        <div className="stat"><span>Players alive</span><b>{players.filter(player => player.alive).length}/{players.length}</b></div>
        <div className="stat"><span>Tasks</span><b>{self?.tasksDone ?? 0}/{ROOM_TASKS.length}</b></div>
        <div className="progress"><i style={{width:`${((self?.tasksDone ?? 0) / ROOM_TASKS.length) * 100}%`}}/></div>
        <div className="stat"><span>Product H160</span><b>{short(session.productH160)}</b></div>
        <p className="hint">Move with WASD or arrow keys.</p>
      </aside>

      <section className="stage">
        <MultiplayerCanvas room={room} state={roomState}/>
        {roomState.phase === 'meeting' && <div className="overlay meeting"><div className="dialog"><div className="eyebrow">EMERGENCY CONSENSUS</div><h2>Who is the saboteur?</h2><div className="vote-grid">{players.filter(player => player.alive).map(player => <button key={player.id} onClick={() => room.vote(player.id)}><i style={{background:player.color}}/>{player.name}</button>)}</div><p className="hint">The host waits for every living player before resolving the vote.</p></div></div>}
        {roomState.phase === 'ended' && <div className="overlay result-overlay"><div className="dialog result"><div className="eyebrow">MATCH COMPLETE</div><h2>{roomState.winner === 'crew' ? 'CREW VICTORY' : 'SABOTEUR VICTORY'}</h2><p>The final role reveal is canonicalized before storage. Every participant verifies the Bulletin CID and match hash before their Product Account can attest.</p>
          {!roomState.settlement && roomState.isHost && <button className="primary" onClick={publishResult} disabled={busy || !allOnChainReady || !session.contract.configured}>{busy ? 'WORKING…' : 'UPLOAD + PROPOSE + ATTEST'}</button>}
          {!roomState.settlement && !roomState.isHost && <div className="settlement-wait">Waiting for the host to publish the immutable replay…</div>}
          {roomState.settlement && <SettlementPanel session={session} state={roomState} verification={verification} proposalVerification={proposalVerification} chainStatus={chainStatus} attestedCount={room.settlementAttestedCount} selfAttested={selfAttested} busy={busy} onAttest={attestResult} onRefresh={refreshChainStatus}/>} 
          {settlementMessage && <p className="success-line">{settlementMessage}</p>}
          {settlementError && <p className="error-line">{settlementError}</p>}
          {!allOnChainReady && roomState.isHost && <p className="warning-line">This room contains local-only players. Replay settlement is intentionally blocked.</p>}
        </div></div>}
      </section>

      <aside className="panel actions">
        <div><div className="eyebrow">ACTION DECK</div><h3>Ship systems</h3></div>
        <button className="action pink" disabled={!room.canDoTask()} onClick={() => room.doTask()}>⚡ Complete task<small>{nearestTask ? `${Math.round(nearestTask.d)}m · ${nearestTask.task.label}` : 'No task nearby'}</small></button>
        <button className="action danger" disabled={!room.canKill()} onClick={() => room.kill()}>✦ Disable crew<small>{nearestVictim ? `${Math.round(nearestVictim.d)}m · ${nearestVictim.player.name}` : 'No target nearby'}</small></button>
        <button className="action" disabled={roomState.phase !== 'playing' || !self?.alive} onClick={() => room.callMeeting()}>◉ Emergency meeting<small>Start a vote</small></button>
        <div className="network-card"><span>Settlement layer</span><b>{roomState.settlement ? 'MATCH HASH READY' : session.contract.configured ? 'ASSET HUB READY' : 'CDM REQUIRED'}</b><small>Realtime state: relay · Replay: Bulletin · Consensus: PolkaVM</small></div>
      </aside>
    </section>}
  </main>;
}

function SettlementPanel({ session, state, verification, proposalVerification, chainStatus, attestedCount, selfAttested, busy, onAttest, onRefresh }: {
  session: ProductSession;
  state: RoomState;
  verification: PreparedVerification | null;
  proposalVerification: OnChainProposalVerification | null;
  chainStatus: ChainMatchStatus | null;
  attestedCount: number;
  selfAttested: boolean;
  busy: boolean;
  onAttest: () => void;
  onRefresh: () => void;
}) {
  const settlement = state.settlement!;
  const mine = session.productH160 && settlement.participants.some(item => item.h160Address.toLowerCase() === session.productH160!.toLowerCase());
  const verified = Boolean(verification?.valid && proposalVerification?.valid);
  return <div className="settlement-panel">
    <div className="verify-grid"><span>Replay CID <b className={verification?.cidMatches ? 'ok' : ''}>{verification ? (verification.cidMatches ? 'VERIFIED' : 'MISMATCH') : 'VERIFYING…'}</b></span><span>Match hash <b className={verification?.matchIdMatches ? 'ok' : ''}>{verification ? (verification.matchIdMatches ? 'VERIFIED' : 'MISMATCH') : 'VERIFYING…'}</b></span><span>Asset Hub proposal <b className={proposalVerification?.valid ? 'ok' : ''}>{proposalVerification ? (proposalVerification.valid ? 'VERIFIED' : 'MISMATCH') : 'VERIFYING…'}</b></span><span>Network attestations <b>{chainStatus ? `${chainStatus.attestations ?? 0}/${chainStatus.playerCount ?? settlement.participants.length}` : `${attestedCount}/${settlement.participants.length}`}</b></span><span>Finalized <b className={chainStatus?.finalized ? 'ok' : ''}>{chainStatus?.finalized ? 'YES' : 'NO'}</b></span></div>
    <code>{settlement.replayCid}</code><code>{settlement.matchId}</code>
    <div className="settlement-actions">{mine && !chainStatus?.finalized && <button className="primary" disabled={busy || !verified || session.mode !== 'polkadot-host' || selfAttested} onClick={onAttest}>{selfAttested ? 'ATTESTED ✓' : 'ATTEST RESULT'}</button>}<button className="ghost" onClick={onRefresh}>REFRESH CHAIN</button></div>
  </div>;
}

function short(value?: string) {
  if (!value) return 'N/A';
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`;
}
