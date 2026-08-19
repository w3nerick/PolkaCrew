import { useEffect, useRef } from 'react';
import { PolkaCrewRoom, ROOM_TASKS, ROOM_WORLD } from '../multiplayer/room';
import type { RoomState } from '../multiplayer/types';

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
      draw(canvasRef.current, room.snapshot);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [room]);

  useEffect(() => draw(canvasRef.current, state), [state]);

  return <canvas ref={canvasRef} width={ROOM_WORLD.width} height={ROOM_WORLD.height} className="game-canvas" />;
}

function draw(canvas: HTMLCanvasElement | null, state: RoomState) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
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
  ctx.fillStyle = '#f7a9e1';
  ctx.font = '700 22px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('POLKACREW', 500, 320);

  for (const task of ROOM_TASKS) {
    ctx.save();
    ctx.translate(task.x, task.y);
    ctx.shadowColor = '#ff4fbc';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ff4fbc';
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d9c8ea';
    ctx.font = '600 13px system-ui';
    ctx.fillText(task.label, 0, 31);
    ctx.restore();
  }

  for (const player of Object.values(state.players)) {
    if (!player.alive) {
      drawBody(ctx, player.x, player.y, player.color);
      continue;
    }
    drawCrew(ctx, player.x, player.y, player.color, player.id === state.selfId);
    ctx.fillStyle = '#fff';
    ctx.font = '600 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, player.x, player.y - 35);
    if (player.id === state.hostId) {
      ctx.fillStyle = '#ffcf66';
      ctx.font = '700 10px system-ui';
      ctx.fillText('HOST', player.x, player.y + 40);
    }
  }
}

function drawCrew(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, local: boolean) {
  ctx.save();
  ctx.translate(x, y);
  if (local) { ctx.shadowColor = color; ctx.shadowBlur = 24; }
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(-18, -23, 36, 48, 16); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#bdeeff';
  ctx.beginPath(); ctx.roundRect(3, -14, 20, 14, 6); ctx.fill();
  ctx.fillStyle = '#0e1830';
  ctx.beginPath(); ctx.roundRect(-23, -8, 10, 27, 5); ctx.fill();
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = .38;
  ctx.fillStyle = color;
  ctx.fillRect(-23, -7, 46, 14);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}
