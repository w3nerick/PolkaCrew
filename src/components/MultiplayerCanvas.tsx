import { useEffect, useRef } from 'react';
import { PolkaCrewRoom, ROOM_TASKS, ROOM_WORLD } from '../multiplayer/room';
import type { RoomState } from '../multiplayer/types';

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keys = useRef(new Set<string>());

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
        x: (keys.current.has('d') || keys.current.has('arrowright') ? 1 : 0) - (keys.current.has('a') || keys.current.has('arrowleft') ? 1 : 0),
        y: (keys.current.has('s') || keys.current.has('arrowdown') ? 1 : 0) - (keys.current.has('w') || keys.current.has('arrowup') ? 1 : 0),
      };
      if (input.x || input.y) room.moveLocal(input, dt, now);
      draw(canvasRef.current, room.snapshot, now);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [room]);

  useEffect(() => draw(canvasRef.current, state, performance.now()), [state]);

  return <canvas ref={canvasRef} width={ROOM_WORLD.width} height={ROOM_WORLD.height} className="game-canvas" />;
}

function draw(canvas: HTMLCanvasElement | null, state: RoomState, time: number) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;

  if (ready(artwork.deck)) {
    ctx.drawImage(artwork.deck, 0, 0, w, h);
    const vignette = ctx.createRadialGradient(w * .5, h * .47, 155, w * .5, h * .47, 650);
    vignette.addColorStop(0, 'rgba(6,2,14,0)');
    vignette.addColorStop(1, 'rgba(6,2,14,.36)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  } else {
    drawFallbackDeck(ctx, w, h);
  }

  drawAmbientParticles(ctx, w, h, time);
  drawConsensusField(ctx, time);

  const completedBySelf = state.completed[state.selfId] ?? [];
  ROOM_TASKS.forEach((task, index) => {
    const completed = completedBySelf.includes(task.id);
    ctx.save();
    ctx.translate(task.x, task.y);
    drawTaskPulse(ctx, time, index, completed);
    ctx.globalAlpha = completed ? .34 : 1;
    ctx.shadowColor = completed ? '#6ef08b' : '#ff4fbc';
    ctx.shadowBlur = completed ? 8 : 19;
    if (ready(artwork.task)) {
      const height = 57;
      const width = height * artwork.task.naturalWidth / artwork.task.naturalHeight;
      ctx.drawImage(artwork.task, -width / 2, -height / 2, width, height);
    } else {
      ctx.fillStyle = completed ? '#6ef08b' : '#ff4fbc';
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.fillStyle = completed ? '#7df4a1' : '#efe4f7';
    ctx.font = '700 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(completed ? `${task.label} · SYNCED` : task.label, 0, 43);
    ctx.restore();
  });

  const playersByDepth = Object.values(state.players).sort((a, b) => a.y - b.y);
  for (const player of playersByDepth) {
    const seed = hashId(player.id);
    const skin = crewSkins[seed % crewSkins.length];
    if (!player.alive) {
      drawBody(ctx, player.x, player.y, player.color, skin, time, seed);
      continue;
    }
    const local = player.id === state.selfId;
    const revealSaboteurSkin = local && state.selfRole === 'saboteur';
    const bob = Math.sin(time * .006 + seed) * 1.7;
    drawCrew(ctx, player.x, player.y + bob, player.color, local, revealSaboteurSkin ? artwork.saboteur : skin, revealSaboteurSkin, time, seed);
    ctx.fillStyle = '#fff';
    ctx.font = '700 13px system-ui';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#09030e';
    ctx.shadowBlur = 6;
    ctx.fillText(player.name, player.x, player.y - 46 + bob);
    ctx.shadowBlur = 0;
    if (player.id === state.hostId) {
      ctx.fillStyle = '#ffcf66';
      ctx.font = '800 10px system-ui';
      ctx.fillText('HOST', player.x, player.y + 43 + bob);
    }
  }
}

function drawCrew(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, local: boolean, image: HTMLImageElement, saboteur: boolean, time: number, seed: number) {
  ctx.save();
  ctx.translate(x, y);
  const energy = .72 + Math.sin(time * .008 + seed) * .18;
  ctx.fillStyle = `${color}22`;
  ctx.strokeStyle = color;
  ctx.lineWidth = local ? 3 : 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = (local ? 25 : 10) * energy;
  ctx.beginPath();
  ctx.ellipse(0, 23, (local ? 25 : 21) * energy, local ? 10 : 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  drawBootEnergy(ctx, color, time, seed);
  if (ready(image)) {
    const height = saboteur ? 78 : 70;
    const width = height * image.naturalWidth / image.naturalHeight;
    ctx.drawImage(image, -width / 2, 28 - height, width, height);
  } else {
    drawFallbackCrew(ctx, color);
  }

  ctx.fillStyle = color;
  ctx.strokeStyle = '#100817';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(-20, -24, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (local) drawLocalOrbit(ctx, color, time);
  if (saboteur) drawSaboteurGlitch(ctx, time, seed);
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, image: HTMLImageElement, time: number, seed: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.globalAlpha = .34 + Math.sin(time * .006 + seed) * .08;
  if (ready(image)) {
    const height = 58;
    const width = height * image.naturalWidth / image.naturalHeight;
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(-23, -7, 46, 14);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#ff426f';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ff426f';
  ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8); ctx.stroke();
  ctx.globalAlpha = .45 + Math.sin(time * .012 + seed) * .35;
  ctx.fillStyle = '#ff426f';
  ctx.fillRect(-18, 16, 7, 3); ctx.fillRect(-7, 16, 4, 3); ctx.fillRect(2, 16, 10, 3);
  ctx.restore();
}

function drawAmbientParticles(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 18; i += 1) {
    const speed = .006 + (i % 4) * .002;
    const x = (i * 137 + time * speed * 10) % w;
    const y = 48 + (i * 83) % (h - 96) + Math.sin(time * .0015 + i) * 7;
    const alpha = .08 + (Math.sin(time * .003 + i * 1.7) + 1) * .06;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = i % 3 === 0 ? '#ff3cad' : '#55eaff';
    ctx.beginPath(); ctx.arc(x, y, i % 5 === 0 ? 2 : 1.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawConsensusField(ctx: CanvasRenderingContext2D, time: number) {
  ctx.save();
  ctx.translate(ROOM_WORLD.width / 2, ROOM_WORLD.height / 2);
  ctx.rotate(time * .00016);
  ctx.strokeStyle = '#ff4fbc';
  ctx.lineWidth = 2;
  ctx.globalAlpha = .24;
  ctx.setLineDash([10, 17]);
  ctx.shadowColor = '#ff4fbc';
  ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(0, 0, 66, 0, Math.PI * 2); ctx.stroke();
  ctx.rotate(-time * .00038);
  ctx.strokeStyle = '#4feaff';
  ctx.beginPath(); ctx.arc(0, 0, 76, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawTaskPulse(ctx: CanvasRenderingContext2D, time: number, index: number, completed: boolean) {
  const pulse = .5 + Math.sin(time * .007 + index * 1.4) * .5;
  const signalColor = completed ? '#6ef08b' : '#ff4fbc';
  ctx.save();
  ctx.globalAlpha = completed ? .22 : .16 + pulse * .3;
  ctx.strokeStyle = signalColor;
  ctx.lineWidth = 2;
  ctx.shadowColor = signalColor;
  ctx.shadowBlur = 13;
  ctx.beginPath(); ctx.arc(0, 0, 29 + pulse * 9, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 3; i += 1) {
    const angle = time * .0015 + index + i * Math.PI * 2 / 3;
    ctx.fillStyle = i === 1 ? '#55eaff' : signalColor;
    ctx.beginPath(); ctx.arc(Math.cos(angle) * 35, Math.sin(angle) * 18, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawBootEnergy(ctx: CanvasRenderingContext2D, color: string, time: number, seed: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i += 1) {
    const flicker = (Math.sin(time * .014 + seed + i * 2.1) + 1) / 2;
    ctx.globalAlpha = .12 + flicker * .38;
    ctx.fillStyle = i % 2 ? '#55eaff' : color;
    const side = i < 2 ? -1 : 1;
    ctx.fillRect(side * (7 + (i % 2) * 6) - 2, 28 + flicker * 4, 4, 2 + flicker * 5);
  }
  ctx.restore();
}

function drawLocalOrbit(ctx: CanvasRenderingContext2D, color: string, time: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i += 1) {
    const angle = time * .0018 + i * Math.PI / 2;
    const x = Math.cos(angle) * 31;
    const y = -5 + Math.sin(angle) * 20;
    ctx.globalAlpha = .45 + .25 * Math.sin(angle * 2);
    ctx.fillStyle = i % 2 ? '#55eaff' : color;
    ctx.shadowColor = ctx.fillStyle as string;
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawSaboteurGlitch(ctx: CanvasRenderingContext2D, time: number, seed: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i += 1) {
    const beat = Math.sin(time * .021 + seed * .8 + i * 2.4);
    if (beat < .42) continue;
    ctx.globalAlpha = (beat - .42) * .8;
    ctx.fillStyle = i % 2 ? '#ff285f' : '#c63cff';
    const x = Math.sin(seed + i * 4.1) * 36;
    const y = -35 + ((i * 17 + Math.floor(time / 90)) % 68);
    ctx.fillRect(x, y, 4 + i % 3 * 3, 2 + i % 2 * 2);
  }
  ctx.restore();
}

function drawFallbackDeck(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createRadialGradient(w * .5, h * .45, 80, w * .5, h * .45, 650);
  bg.addColorStop(0, '#24143f');
  bg.addColorStop(1, '#07030e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  roundRect(ctx, 28, 30, w - 56, h - 60, 34, '#130b22', '#512b74');
  ctx.strokeStyle = '#301a45';
  ctx.lineWidth = 2;
  for (let x = 80; x < w; x += 90) {
    ctx.beginPath(); ctx.moveTo(x, 45); ctx.lineTo(x, h - 45); ctx.stroke();
  }
  for (let y = 80; y < h; y += 90) {
    ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(w - 45, y); ctx.stroke();
  }
  roundRect(ctx, 390, 245, 220, 130, 28, '#261235', '#d6409f');
}

function drawFallbackCrew(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(-18, -23, 36, 48, 16); ctx.fill();
  ctx.fillStyle = '#bdeeff';
  ctx.beginPath(); ctx.roundRect(3, -14, 20, 14, 6); ctx.fill();
  ctx.fillStyle = '#0e1830';
  ctx.beginPath(); ctx.roundRect(-23, -8, 10, 27, 5); ctx.fill();
}

function loadImage(src: string) {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  return image;
}

function ready(image: HTMLImageElement) { return image.complete && image.naturalWidth > 0; }
function hashId(id: string) { return [...id].reduce((total, character) => total + character.charCodeAt(0), 0); }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}
