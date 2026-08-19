import { useMemo, useState } from 'react';
import type { RoomTask } from '../multiplayer/types';
import { gameSound } from '../game-sound';

export function TaskMinigame({ task, onComplete, onCancel }: {
  task: RoomTask;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const finish = () => { gameSound.task(); onComplete(); };
  return <div className="overlay task-overlay">
    <div className="dialog task-dialog">
      <div className="task-head"><div><div className="eyebrow">{task.room.toUpperCase()}</div><h2>{task.label}</h2></div><button className="ghost" onClick={onCancel}>CLOSE</button></div>
      {task.kind === 'wires' && <Wires onDone={finish}/>}
      {task.kind === 'sequence' && <Sequence onDone={finish}/>}
      {task.kind === 'slider' && <Slider onDone={finish}/>}
      {task.kind === 'pulse' && <Pulse onDone={finish}/>}
    </div>
  </div>;
}

function Wires({ onDone }: { onDone: () => void }) {
  const target = useMemo(() => shuffle(['PINK', 'CYAN', 'GOLD', 'LIME']), []);
  const [picked, setPicked] = useState<string[]>([]);
  const choose = (wire: string) => {
    if (picked.includes(wire)) return;
    const next = [...picked, wire];
    setPicked(next);
    if (next.length === target.length && next.every((value, index) => value === target[index])) setTimeout(onDone, 180);
  };
  return <div className="mini-game"><p>Route the encrypted lanes in this order:</p><div className="sequence-hint">{target.join(' → ')}</div><div className="wire-grid">{['PINK','CYAN','GOLD','LIME'].map(wire => <button key={wire} className={`wire ${wire.toLowerCase()} ${picked.includes(wire) ? 'used' : ''}`} onClick={() => choose(wire)}>{wire}</button>)}</div>{picked.length > 0 && !target.slice(0, picked.length).every((v,i)=>v===picked[i]) && <button className="ghost" onClick={() => setPicked([])}>RESET ROUTE</button>}</div>;
}

function Sequence({ onDone }: { onDone: () => void }) {
  const pattern = useMemo(() => Array.from({length: 5}, () => Math.floor(Math.random() * 4)), []);
  const [step, setStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const tap = (index: number) => {
    if (pattern[step] !== index) { setFailed(true); setStep(0); return; }
    setFailed(false);
    const next = step + 1;
    setStep(next);
    if (next === pattern.length) setTimeout(onDone, 160);
  };
  return <div className="mini-game"><p>Repeat the validator sequence:</p><div className="sequence-hint">{pattern.map(v => v + 1).join(' · ')}</div><div className="pad-grid">{[0,1,2,3].map(i => <button key={i} onClick={() => tap(i)}>{i+1}</button>)}</div><div className={failed ? 'mini-status bad' : 'mini-status'}>{failed ? 'Mismatch. Sequence reset.' : `${step}/${pattern.length} verified`}</div></div>;
}

function Slider({ onDone }: { onDone: () => void }) {
  const target = useMemo(() => 35 + Math.floor(Math.random() * 35), []);
  const [value, setValue] = useState(50);
  const delta = Math.abs(value - target);
  return <div className="mini-game"><p>Tune storage pressure to <b>{target}%</b> ±2.</p><div className="slider-readout">{value}%</div><input className="task-slider" type="range" min="0" max="100" value={value} onChange={(event: { target: { value: string } }) => setValue(Number(event.target.value))}/><button className="primary" disabled={delta > 2} onClick={onDone}>LOCK CALIBRATION</button></div>;
}

function Pulse({ onDone }: { onDone: () => void }) {
  const [charge, setCharge] = useState(0);
  const tap = () => {
    const next = Math.min(5, charge + 1);
    setCharge(next);
    if (next === 5) setTimeout(onDone, 150);
  };
  return <div className="mini-game"><p>Pin five Bulletin chunks into the manifest.</p><div className="pulse-meter"><i style={{width: `${charge * 20}%`}}/></div><button className="pulse-button" onClick={tap}>PIN CHUNK {Math.min(charge + 1, 5)}</button><div className="mini-status">{charge}/5 chunks anchored</div></div>;
}

function shuffle<T>(values: T[]) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
