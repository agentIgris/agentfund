"use client";

/**
 * components/Starfield.tsx — lightweight canvas particle starfield
 * rendered fixed behind all page content. Pure CSS gradients handle
 * the nebula glow (see .af-starfield in globals.css); this canvas
 * layers slow-drifting particles on top for depth.
 */
import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  alpha: number;
  hue: number;
}

const PARTICLE_DENSITY = 1 / 9000; // particles per pixel of viewport area
const MAX_PARTICLES = 160;

export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let rafId = 0;
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const makeParticle = (): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.4 + 0.3,
      speed: Math.random() * 0.12 + 0.02,
      drift: (Math.random() - 0.5) * 0.05,
      alpha: Math.random() * 0.6 + 0.2,
      hue: Math.random() > 0.5 ? 262 : 189, // violet vs cyan
    });

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(MAX_PARTICLES, Math.floor(width * height * PARTICLE_DENSITY));
      particles = Array.from({ length: count }, makeParticle);
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue}, 85%, 75%, ${p.alpha})`;
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        if (!prefersReducedMotion) {
          p.y -= p.speed;
          p.x += p.drift;
          if (p.y < -4) {
            p.y = height + 4;
            p.x = Math.random() * width;
          }
          if (p.x < -4) p.x = width + 4;
          if (p.x > width + 4) p.x = -4;
        }
      }
      rafId = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="af-starfield" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
