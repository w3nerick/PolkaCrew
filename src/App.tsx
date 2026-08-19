import { useCallback, useEffect, useMemo, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { PolkaCrewEngine } from './game/engine';
import { prepareMatchForDevnet, type PreparedMatch } from './polkadot/match';
import { connectPolkadotProduct, type ProductSession } from './polkadot/product';
import './styles.css';

export default function App() {
  const engine = useMemo(() => new PolkaCrewEngine(), []);
  const [, redraw] = useState(0);
  const [session, setSession] = useState<ProductSession | null>(null);
  const [prepared, setPrepared] = useState<PreparedMatch | null>(null);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(() => redraw(v => (v + 1) % 100000), []);

  useEffect(() => {
    let mounted = true;
    connectPolkadotProduct().then(s => mounted && setSession(s));
    engine.start();
    refresh();
    return () => { mounted = false; session?.destroy(); };
    // session deliberately not in deps: teardown is best-effort for this MVP shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, refresh]);

  const local = engine.local;
  const nearestTask = engine.nearestTask();
  const nearestVictim = engine.nearestVictim();

  const prepareOnDevnet = async () => {
    if (!session || saving) return;
    setSaving(true);
    try {
      setPrepared(await prepareMatchForDevnet(session, engine.snapshot()));
    } finally {
      setSaving(false);
    }
  };

  return <main className="app-shell">
    <header className="topbar">
      <div><div className="eyebrow">POLKADOT PRODUCTS DEVNET · v0.3</div><h1>POLKA<span>CREW</span></h1></div>
      <div className="host-pill"><i className={session?.mode === 'polkadot-host' ? 'online' : ''}/>{session?.mode === 'polkadot-host' ? 'POLKADOT HOST' : 'LOCAL DEV MODE'}</div>
    </header>

    <section className="game-layout">
      <aside className="panel left-panel">
        <div className="role-card"><small>YOUR ROLE</small><strong className={local.role}>{local.role === 'crew' ? 'CREW' : 'SABOTEUR'}</strong><p>{local.role === 'crew' ? 'Complete platform tasks and expose the saboteur.' : 'Blend in. Disable the crew. Survive consensus.'}</p></div>
        <div className="stat"><span>Context alias</span><b>{session?.alias?.slice(0,14) || 'local-player'}</b></div>
        <div className="stat"><span>Asset Hub</span><b>{session?.devnet.assetHubConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>Bulletin</span><b>{session?.devnet.bulletinConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>People</span><b>{session?.devnet.peopleConnected ? 'READY' : 'LOCAL'}</b></div>
        <div className="stat"><span>Tasks</span><b>{local.tasksDone}/{local.totalTasks}</b></div>
        <div className="progress"><i style={{width:`${local.tasksDone/local.totalTasks*100}%`}}/></div>
        <p className="hint">Move with WASD or arrow keys.</p>
      </aside>

      <section className="stage">
        <GameCanvas engine={engine} onFrame={refresh}/>
        {engine.phase === 'meeting' && <div className="overlay meeting"><div className="dialog"><div className="eyebrow">EMERGENCY CONSENSUS</div><h2>Who is the saboteur?</h2><div className="vote-grid">{engine.players.filter(p=>p.alive).map(p=><button key={p.id} onClick={()=>{engine.vote(p.id);refresh();}}><i style={{background:p.color}}/>{p.name}</button>)}</div></div></div>}
        {engine.phase === 'ended' && <div className="overlay"><div className="dialog result"><div className="eyebrow">MATCH COMPLETE</div><h2>{engine.winner === 'crew' ? 'CREW VICTORY' : 'SABOTEUR VICTORY'}</h2><p>Prepare an immutable replay, upload it through Product SDK to Bulletin, and request a .dot identity proof for the match attestation.</p><button className="primary" onClick={prepareOnDevnet} disabled={saving}>{saving ? 'Preparing…' : prepared ? 'Prepared ✓' : 'Prepare Devnet attestation'}</button>{prepared && <><code>{prepared.replayCid}</code><code>{prepared.matchId}</code><p className="hint">{prepared.identityProof ? `Identity: ${prepared.identityProof.username}` : 'Local mode: identity proof is unavailable.'}</p></>}</div></div>}
      </section>

      <aside className="panel actions">
        <div><div className="eyebrow">ACTION DECK</div><h3>Ship systems</h3></div>
        <button className="action pink" disabled={!engine.canDoTask()} onClick={()=>{engine.doTask();refresh();}}>⚡ Complete task<small>{nearestTask ? `${Math.round(nearestTask.d)}m · ${nearestTask.task.label}` : 'No task nearby'}</small></button>
        <button className="action danger" disabled={!engine.canKill()} onClick={()=>{engine.kill();refresh();}}>✦ Disable crew<small>{nearestVictim ? `${Math.round(nearestVictim.d)}m · ${nearestVictim.player.name}` : 'No target nearby'}</small></button>
        <button className="action" onClick={()=>{engine.callMeeting();refresh();}}>◉ Emergency meeting<small>Start a vote</small></button>
        <div className="network-card"><span>Replay layer</span><b>{prepared ? 'BULLETIN CID READY' : 'WAITING'}</b><small>{session?.mode === 'polkadot-host' ? 'Host wallet + Devnet Cloud Storage active' : 'Local digest fallback active'}</small></div>
      </aside>
    </section>
  </main>;
}
