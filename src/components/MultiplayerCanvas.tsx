import { useEffect, useRef } from 'react';
import { BASE_DOORS, PolkaCrewRoom, ROOM_TASKS, ROOM_WORLD, SABOTAGE_PANELS } from '../multiplayer/room';
import type { DoorState, RoomBody, RoomPlayer, RoomState } from '../multiplayer/types';

const artwork = {
  deck: loadImage('assets/polkacrew/relay-ark.webp'),
  crew: loadImage('assets/polkacrew/relay-ranger.png'),
  mechanic: loadImage('assets/polkacrew/chain-mechanic.png'),
  diver: loadImage('assets/polkacrew/bulletin-diver.png'),
  warden: loadImage('assets/polkacrew/validator-warden.png'),
  medic: loadImage('assets/polkacrew/orbit-medic.png'),
  saboteur: loadImage('assets/polkacrew/fork-wraith.png'),
  task: loadImage('assets/polkacrew/relay-beacon.png'),
};

const crewSkins = [artwork.crew, artwork.mechanic, artwork.diver, artwork.warden, artwork.medic];

export function MultiplayerCanvas({ room, state }: { room: PolkaCrewRoom; state: RoomState }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keys = useRef(new Set<string>());
  const touch = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const down = (event: KeyboardEvent) => keys.current.add(event.key.toLowerCase());
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    let id = 0;
    let previous = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - previous) / 1000, .04);
      previous = now;
      const input = {
        x: (keys.current.has('d') || keys.current.has('arrowright') ? 1 : 0)
          - (keys.current.has('a') || keys.current.has('arrowleft') ? 1 : 0)
          + touch.current.x,
        y: (keys.current.has('s') || keys.current.has('arrowdown') ? 1 : 0)
          - (keys.current.has('w') || keys.current.has('arrowup') ? 1 : 0)
          + touch.current.y,
      };
      if (input.x || input.y) room.moveLocal(input, dt, now);
      room.tick(Date.now());
      draw(canvasRef.current, room.snapshot, now);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [room]);

  useEffect(() => draw(canvasRef.current, state, performance.now()), [state]);

  const press = (x: number, y: number) => () => { touch.current = { x, y }; };
  const release = () => { touch.current = { x: 0, y: 0 }; };

  return <>
    <canvas ref={canvasRef} width={ROOM_WORLD.width} height={ROOM_WORLD.height} className="game-canvas" />
    <div className="touch-pad" onPointerLeave={release} onPointerUp={release}>
      <button className="up" onPointerDown={press(0,-1)}>▲</button>
      <button className="left" onPointerDown={press(-1,0)}>◀</button>
      <button className="right" onPointerDown={press(1,0)}>▶</button>
      <button className="down" onPointerDown={press(0,1)}>▼</button>
    </div>
  </>;
}

const ROOMS = [
  { label: 'PEOPLE LAB', x: 45, y: 48 },
  { label: 'BULLETIN BAY', x: 673, y: 48 },
  { label: 'RELAY CORE', x: 45, y: 374 },
  { label: 'ASSET FORGE', x: 673, y: 374 },
  { label: 'CONSENSUS HUB', x: 365, y: 238 },
];

function draw(canvas: HTMLCanvasElement | null, state: RoomState, now: number) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;

  drawDeck(ctx, w, h, now);
  drawRoomLabels(ctx);
  drawDoors(ctx, state.doors, Date.now());

  const completedBySelf = state.completed[state.selfId] ?? [];
  ROOM_TASKS.forEach((task, index) => {
    drawTask(ctx, task.x, task.y, task.label, completedBySelf.includes(task.id), now, index);
  });

  drawSabotage(ctx, state, now);
  for (const body of state.bodies) if (!body.reported) drawBody(ctx, body, now);

  const playersByDepth = Object.values(state.players).sort((a, b) => a.y - b.y);
  for (const player of playersByDepth) {
    const local = player.id === state.selfId;
    if (!player.alive) {
      drawGhost(ctx, player, local, state, now);
      continue;
    }
    drawCrew(ctx, player, local, state, now);
    const bob = Math.sin((now + hash(player.id)) / 220) * 1.8;
    ctx.fillStyle = player.connected ? '#fff' : '#8b788f';
    ctx.font = '700 13px system-ui';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#09030e';
    ctx.shadowBlur = 6;
    ctx.fillText(player.name, player.x, player.y - 47 + bob);
    ctx.shadowBlur = 0;
    if (!player.connected) {
      ctx.fillStyle = '#ffb15e';
      ctx.font = '800 9px system-ui';
      ctx.fillText('RECONNECTING', player.x, player.y - 60 + bob);
    }
    if (player.id === state.hostId) {
      ctx.fillStyle = '#ffcf66';
      ctx.font = '800 9px system-ui';
      ctx.fillText('HOST', player.x, player.y + 44 + bob);
    }
  }

  const self = state.players[state.selfId];
  if (state.sabotage?.kind === 'lights' && self?.alive && state.selfRole !== 'saboteur') {
    drawLightsOut(ctx, self.x, self.y, w, h);
  }
  if (state.sabotage?.kind === 'reactor') {
    drawReactorWarning(ctx, state.sabotage.endsAt - Date.now(), w, h, now);
  }
}

function drawDeck(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
  if (ready(artwork.deck)) {
    ctx.drawImage(artwork.deck, 0, 0, w, h);
    const vignette = ctx.createRadialGradient(w * .5, h * .47, 155, w * .5, h * .47, 650);
    vignette.addColorStop(0, 'rgba(6,2,14,0)');
    vignette.addColorStop(1, 'rgba(6,2,14,.42)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  } else {
    const bg = ctx.createRadialGradient(w * .5, h * .45, 90, w * .5, h * .45, 720);
    bg.addColorStop(0, '#21123a');
    bg.addColorStop(1, '#05030a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#251634';
    ctx.lineWidth = 1;
    for (let x = 20; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 20; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  }
  drawAmbientParticles(ctx, w, h, now);
  drawConsensusField(ctx, now);
}

function drawRoomLabels(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.font = '800 10px system-ui';
  ctx.textAlign = 'left';
  for (const room of ROOMS) {
    ctx.fillStyle = 'rgba(8,3,13,.72)';
    ctx.fillRect(room.x + 10, room.y + 9, 115, 20);
    ctx.fillStyle = '#dbc9e7';
    ctx.fillText(room.label, room.x + 17, room.y + 23);
  }
  ctx.restore();
}

function drawTask(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, completed: boolean, now: number, index: number) {
  ctx.save();
  ctx.translate(x, y);
  drawTaskPulse(ctx, now, index, completed);
  ctx.globalAlpha = completed ? .35 : 1;
  ctx.shadowColor = completed ? '#6ef08b' : '#ff4fbc';
  ctx.shadowBlur = completed ? 8 : 18;
  if (ready(artwork.task)) {
    const height = 58;
    const width = height * artwork.task.naturalWidth / artwork.task.naturalHeight;
    ctx.drawImage(artwork.task, -width / 2, -height / 2, width, height);
  } else {
    ctx.fillStyle = completed ? '#3b8064' : '#ff4fbc';
    ctx.beginPath(); ctx.arc(0, 0, completed ? 8 : 12, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = completed ? '#7df4a1' : '#efe4f7';
  ctx.font = '700 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(completed ? `${label} · SYNCED` : label, 0, 43);
  ctx.restore();
}

function drawDoors(ctx: CanvasRenderingContext2D, doors: Record<string, DoorState>, now: number) {
  for (const fallback of BASE_DOORS) {
    const door = doors[fallback.id] ?? fallback;
    const locked = door.lockedUntil > now;
    ctx.save();
    ctx.translate(door.x, door.y);
    ctx.strokeStyle = locked ? '#ff426f' : '#5b3a69';
    ctx.lineWidth = locked ? 10 : 3;
    ctx.shadowColor = locked ? '#ff426f' : '#8e55a3';
    ctx.shadowBlur = locked ? 16 : 5;
    ctx.beginPath();
    if (door.orientation === 'horizontal') { ctx.moveTo(-door.span/2, 0); ctx.lineTo(door.span/2, 0); }
    else { ctx.moveTo(0, -door.span/2); ctx.lineTo(0, door.span/2); }
    ctx.stroke();
    if (locked) {
      ctx.fillStyle = '#ffd1dc';
      ctx.font = '900 9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('LOCKED', 0, -12);
    }
    ctx.restore();
  }
}

function drawSabotage(ctx: CanvasRenderingContext2D, state: RoomState, now: number) {
  const sabotage = state.sabotage;
  if (!sabotage || sabotage.kind === 'doors') return;
  for (const id of sabotage.requiredPanels) {
    const panel = Object.values(SABOTAGE_PANELS).find(item => item.id === id);
    if (!panel) continue;
    const fixed = sabotage.fixedPanels.includes(id);
    ctx.save();
    ctx.translate(panel.x, panel.y);
    ctx.shadowColor = fixed ? '#4ff59b' : '#ff4b67';
    ctx.shadowBlur = 18;
    ctx.fillStyle = fixed ? '#4ff59b' : '#ff4b67';
    const r = 12 + Math.sin(now / 130) * 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '800 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(fixed ? 'FIXED' : panel.label, 0, 28);
    ctx.restore();
  }
}

function drawCrew(ctx: CanvasRenderingContext2D, player: RoomPlayer, local: boolean, state: RoomState, now: number) {
  const seed = hash(player.id);
  const skin = crewSkins[seed % crewSkins.length];
  const showSaboteur = local && state.selfRole === 'saboteur';
  const image = showSaboteur ? artwork.saboteur : skin;
  const bob = Math.sin((now + seed) / 220) * 1.8;

  ctx.save();
  ctx.translate(player.x, player.y + bob);
  const energy = .72 + Math.sin(now * .008 + seed) * .18;
  ctx.fillStyle = `${player.color}22`;
  ctx.strokeStyle = player.color;
  ctx.lineWidth = local ? 3 : 2;
  ctx.shadowColor = player.color;
  ctx.shadowBlur = (local ? 25 : 10) * energy;
  ctx.beginPath();
  ctx.ellipse(0, 23, (local ? 25 : 21) * energy, local ? 10 : 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  drawBootEnergy(ctx, player.color, now, seed);
  if (ready(image)) {
    const height = showSaboteur ? 78 : 70;
    const width = height * image.naturalWidth / image.naturalHeight;
    ctx.drawImage(image, -width / 2, 28 - height, width, height);
  } else {
    drawFallbackCrew(ctx, player.color);
  }

  ctx.fillStyle = player.color;
  ctx.strokeStyle = '#100817';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(-20, -24, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (local) drawLocalOrbit(ctx, player.color, now);
  if (showSaboteur) drawSaboteurGlitch(ctx, now, seed);
  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, player: RoomPlayer, local: boolean, state: RoomState, now: number) {
  const seed = hash(player.id);
  const showSaboteur = local && state.selfRole === 'saboteur';
  const image = showSaboteur ? artwork.saboteur : crewSkins[seed % crewSkins.length];
  ctx.save();
  ctx.translate(player.x, player.y + Math.sin(now / 180 + seed) * 4);
  ctx.globalAlpha = local ? .52 : .22;
  ctx.globalCompositeOperation = 'screen';
  ctx.shadowColor = '#8eefff';
  ctx.shadowBlur = local ? 22 : 10;
  if (ready(image)) {
    const height = 62;
    const width = height * image.naturalWidth / image.naturalHeight;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
  } else {
    ctx.fillStyle = player.color;
    ctx.beginPath(); ctx.arc(0, -4, 17, Math.PI, 0); ctx.lineTo(17, 18); ctx.quadraticCurveTo(8, 9, 0, 18); ctx.quadraticCurveTo(-8, 9, -17, 18); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, body: RoomBody, now: number) {
  const seed = hash(body.victimId);
  const image = crewSkins[seed % crewSkins.length];
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.rotate(-Math.PI / 2);
  ctx.globalAlpha = .42 + Math.sin(now * .006 + seed) * .06;
  ctx.shadowColor = body.color;
  ctx.shadowBlur = 8 + Math.sin(now / 210) * 3;
  if (ready(image)) {
    const height = 58;
    const width = height * image.naturalWidth / image.naturalHeight;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
  } else {
    ctx.fillStyle = body.color;
    ctx.fillRect(-23, -7, 46, 14);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.strokeStyle = '#ff426f';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ff426f';
  ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffc7d9';
  ctx.font = '900 9px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('REPORT', 0, 31);
  ctx.restore();
}

function drawAmbientParticles(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 18; i += 1) {
    const speed = .006 + (i % 4) * .002;
    const x = (i * 137 + now * speed * 10) % w;
    const y = 48 + (i * 83) % (h - 96) + Math.sin(now * .0015 + i) * 7;
    const alpha = .08 + (Math.sin(now * .003 + i * 1.7) + 1) * .06;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = i % 3 === 0 ? '#ff3cad' : '#55eaff';
    ctx.beginPath(); ctx.arc(x, y, i % 5 === 0 ? 2 : 1.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawConsensusField(ctx: CanvasRenderingContext2D, now: number) {
  ctx.save();
  ctx.translate(ROOM_WORLD.width / 2, ROOM_WORLD.height / 2);
  ctx.rotate(now * .00016);
  ctx.strokeStyle = '#ff4fbc';
  ctx.lineWidth = 2;
  ctx.globalAlpha = .24;
  ctx.setLineDash([10, 17]);
  ctx.shadowColor = '#ff4fbc';
  ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(0, 0, 66, 0, Math.PI * 2); ctx.stroke();
  ctx.rotate(-now * .00038);
  ctx.strokeStyle = '#4feaff';
  ctx.beginPath(); ctx.arc(0, 0, 76, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawTaskPulse(ctx: CanvasRenderingContext2D, now: number, index: number, completed: boolean) {
  const pulse = .5 + Math.sin(now * .007 + index * 1.4) * .5;
  const signalColor = completed ? '#6ef08b' : '#ff4fbc';
  ctx.save();
  ctx.globalAlpha = completed ? .22 : .16 + pulse * .3;
  ctx.strokeStyle = signalColor;
  ctx.lineWidth = 2;
  ctx.shadowColor = signalColor;
  ctx.shadowBlur = 13;
  ctx.beginPath(); ctx.arc(0, 0, 29 + pulse * 9, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 3; i += 1) {
    const angle = now * .0015 + index + i * Math.PI * 2 / 3;
    ctx.fillStyle = i === 1 ? '#55eaff' : signalColor;
    ctx.beginPath(); ctx.arc(Math.cos(angle) * 35, Math.sin(angle) * 18, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBootEnergy(ctx: CanvasRenderingContext2D, color: string, now: number, seed: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i += 1) {
    const flicker = (Math.sin(now * .014 + seed + i * 2.1) + 1) / 2;
    ctx.globalAlpha = .12 + flicker * .38;
    ctx.fillStyle = i % 2 ? '#55eaff' : color;
    const side = i < 2 ? -1 : 1;
    ctx.fillRect(side * (7 + (i % 2) * 6) - 2, 28 + flicker * 4, 4, 2 + flicker * 5);
  }
  ctx.restore();
}

function drawLocalOrbit(ctx: CanvasRenderingContext2D, color: string, now: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i += 1) {
    const angle = now * .0018 + i * Math.PI / 2;
    const x = Math.cos(angle) * 31;
    const y = -5 + Math.sin(angle) * 20;
    ctx.globalAlpha = .45 + .25 * Math.sin(angle * 2);
    ctx.fillStyle = i % 2 ? '#55eaff' : color;
    ctx.shadowColor = String(ctx.fillStyle);
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawSaboteurGlitch(ctx: CanvasRenderingContext2D, now: number, seed: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i += 1) {
    const beat = Math.sin(now * .021 + seed * .8 + i * 2.4);
    if (beat < .42) continue;
    ctx.globalAlpha = (beat - .42) * .8;
    ctx.fillStyle = i % 2 ? '#ff285f' : '#c63cff';
    const x = Math.sin(seed + i * 4.1) * 36;
    const y = -35 + ((i * 17 + Math.floor(now / 90)) % 68);
    ctx.fillRect(x, y, 4 + i % 3 * 3, 2 + i % 2 * 2);
  }
  ctx.restore();
}

function drawFallbackCrew(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(-18, -23, 36, 48, 16); ctx.fill();
  ctx.fillStyle = '#bdeeff';
  ctx.beginPath(); ctx.roundRect(3, -14, 20, 14, 6); ctx.fill();
  ctx.fillStyle = '#0e1830';
  ctx.beginPath(); ctx.roundRect(-23, -8, 10, 27, 5); ctx.fill();
}

function drawLightsOut(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const gradient = ctx.createRadialGradient(x, y, 70, x, y, 185);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(.6, 'rgba(0,0,0,.35)');
  gradient.addColorStop(1, 'rgba(0,0,0,.93)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

function drawReactorWarning(ctx: CanvasRenderingContext2D, remaining: number, w: number, h: number, now: number) {
  const flash = .15 + (Math.sin(now / 110) + 1) * .08;
  ctx.strokeStyle = `rgba(255,55,85,${.55 + flash})`;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.fillStyle = '#ff617b';
  ctx.font = '900 18px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(`REACTOR ${Math.max(0, Math.ceil(remaining / 1000))}s`, w/2, 31);
}

function loadImage(src: string) {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  return image;
}

function ready(image: HTMLImageElement) { return image.complete && image.naturalWidth > 0; }
function hash(value: string) { return Array.from(value).reduce((sum, c) => sum + c.charCodeAt(0), 0); }
