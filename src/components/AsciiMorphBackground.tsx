import { useEffect, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';

const CHARS = '0123456789ABCDEFabcdef{}[]<>+=*/&@#%';

export function AsciiMorphBackground() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const mouseRef = useRef({ x: -1, y: -1, vx: 0, vy: 0 });
  const trailRef = useRef<{ x: number; y: number; t: number }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = 0, H = 0;
    const CELL = 16;
    let cols = 0, rows = 0;
    let grid: { char: string; age: number }[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(W / CELL);
      rows = Math.ceil(H / CELL);
      grid = [];
      for (let i = 0; i < cols * rows; i++) {
        grid.push({
          char: CHARS[Math.floor(Math.random() * CHARS.length)],
          age: Math.random() * 500,
        });
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const handleMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const m = mouseRef.current;
      m.vx = x - m.x;
      m.vy = y - m.y;
      m.x = x;
      m.y = y;
      trailRef.current.push({ x, y, t: performance.now() });
      if (trailRef.current.length > 60) trailRef.current.shift();
    };

    const handleMouseLeave = () => {
      mouseRef.current.x = -1;
      mouseRef.current.y = -1;
    };

    canvas.addEventListener('mousemove', handleMouse);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    const animate = (time: number) => {
      const t = time * 0.001;
      const m = mouseRef.current;
      const trail = trailRef.current;
      const now = performance.now();

      // Fade old trail points
      while (trail.length > 0 && now - trail[0].t > 1200) trail.shift();

      // 다크는 랜딩과 같은 거의-검정, 라이트는 애플 라이트의 종이색
      ctx.fillStyle = isLight ? 'rgb(245, 245, 247)' : 'rgb(8, 10, 18)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = `${CELL - 3}px monospace`;
      ctx.textBaseline = 'top';

      const mouseSpeed = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
      const mouseRadius = 120 + Math.min(mouseSpeed * 2, 80);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const cell = grid[idx];
          const px = c * CELL + CELL / 2;
          const py = r * CELL + CELL / 2;

          // Mouse proximity glow
          let mouseInfluence = 0;
          if (m.x >= 0) {
            const dx = px - m.x;
            const dy = py - m.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            mouseInfluence = Math.max(0, 1 - dist / mouseRadius);
            mouseInfluence *= mouseInfluence;
            if (mouseInfluence > 0.3 && Math.random() < 0.15) {
              cell.char = CHARS[Math.floor(Math.random() * CHARS.length)];
            }
          }

          // Trail glow
          let trailInfluence = 0;
          for (let ti = trail.length - 1; ti >= 0; ti -= 3) {
            const tp = trail[ti];
            const tdx = px - tp.x;
            const tdy = py - tp.y;
            const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
            const age = (now - tp.t) / 1200;
            const fade = 1 - age;
            const reach = 60 + fade * 40;
            if (tdist < reach) {
              trailInfluence = Math.max(trailInfluence, fade * (1 - tdist / reach) * 0.5);
            }
          }

          if (Math.random() < 0.012) {
            cell.char = CHARS[Math.floor(Math.random() * CHARS.length)];
          }

          // Waves
          const nx = c / cols;
          const ny = r / rows;
          const wave1 = Math.sin(nx * 4.0 + t * 1.2) * Math.cos(ny * 3.0 + t * 0.8) * 0.5 + 0.5;
          const wave2 = Math.sin(nx * 1.5 - t * 0.7 + ny * 5.0) * 0.5 + 0.5;
          const wave3 = Math.cos(ny * 2.5 + t * 0.9 + nx * 3.0) * 0.5 + 0.5;
          const wave4 = Math.sin((nx + ny) * 2.5 + t * 0.5) * 0.5 + 0.5;
          const pulse = Math.pow(Math.sin(nx * 1.0 + ny * 0.8 - t * 0.6) * 0.5 + 0.5, 3);
          const cx = nx - 0.5, cy = ny - 0.5;
          const dist = Math.sqrt(cx * cx + cy * cy);
          const ripple = Math.pow(Math.sin(dist * 8 - t * 1.5) * 0.5 + 0.5, 2) * 0.15;

          const combined = wave1 * 0.2 + wave2 * 0.18 + wave3 * 0.18 + wave4 * 0.12 + pulse * 0.17 + ripple;
          const baseBrightness = 0.02 + combined * 0.2;

          const totalMouseEffect = Math.min(mouseInfluence * 0.8 + trailInfluence, 1);
          const brightness = baseBrightness + totalMouseEffect * 0.6;

          const hue = 200 + Math.sin(nx * 2.5 + t * 0.3) * 25 - totalMouseEffect * 60;
          const sat = 35 + combined * 45 + totalMouseEffect * 30;
          // 라이트에서는 밝은 종이 위라 글리프를 어둡게 뒤집는다
          const light = isLight ? 92 - brightness * 150 : 25 + brightness * 220;

          const alpha = Math.min(brightness * 2.0 + 0.04, 1) * (isLight ? 0.55 : 1);
          ctx.fillStyle = `hsla(${hue}, ${isLight ? sat * 0.6 : sat}%, ${light}%, ${alpha})`;
          ctx.fillText(cell.char, c * CELL, r * CELL);
        }
      }

      m.vx *= 0.85;
      m.vy *= 0.85;
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', handleMouse);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isLight]);   // 테마가 바뀌면 캔버스를 다시 그린다

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ zIndex: 0, background: isLight ? 'rgb(245, 245, 247)' : 'rgb(8, 10, 18)' }}
    />
  );
}
