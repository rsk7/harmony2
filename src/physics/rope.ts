// Verlet rope: a chain of point masses under gravity, held together by distance
// constraints, with both ends pinned to the jacks.

type Vec = { x: number; y: number };

const GRAVITY = 2200; // px/s²
const ITERATIONS = 24; // constraint passes per step; higher = less stretchy rope
const DT = 1 / 60;

// Floppiness 0..1 maps to how much slack a cable has, how long it keeps swinging,
// and how easily it bends.
export function ropeFeel(floppiness: number) {
  const f = Math.min(1, Math.max(0, floppiness));
  return {
    slackScale: 1 + 0.25 * f,
    slackExtra: 10 + 120 * f, // px
    damping: 0.93 + 0.06 * f, // velocity kept per step
    stiffness: 0.25 - 0.23 * f, // pull toward neighbours' midpoint per pass
  };
}

export type RopeFeel = ReturnType<typeof ropeFeel>;

// Cables get some slack beyond the distance they span.
export function slackLength(distance: number, feel: RopeFeel) {
  return distance * feel.slackScale + feel.slackExtra;
}

export class Rope {
  private pts: Vec[];
  private prev: Vec[];
  segment: number;

  constructor(a: Vec, b: Vec, public length: number, readonly count = 28) {
    this.segment = length / (count - 1);
    // Start as a straight line between the ends; gravity drops it into a swinging sag.
    this.pts = Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    });
    this.prev = this.pts.map((p) => ({ ...p }));
  }

  setLength(length: number) {
    this.length = length;
    this.segment = length / (this.count - 1);
  }

  // aDir/bDir: unit vectors the cable leaves each end along. When given, the first
  // link is pinned along it too, so the cable exits a stiff plug straight.
  step(a: Vec, b: Vec, feel: RopeFeel, aDir?: Vec, bDir?: Vec) {
    const { pts, prev } = this;
    const n = pts.length;
    const g = GRAVITY * DT * DT;
    const pinned = (i: number) =>
      i === 0 || i === n - 1 || (i === 1 && !!aDir) || (i === n - 2 && !!bDir);
    const pin = () => {
      pts[0].x = a.x;
      pts[0].y = a.y;
      pts[n - 1].x = b.x;
      pts[n - 1].y = b.y;
      if (aDir) {
        pts[1].x = a.x + aDir.x * this.segment;
        pts[1].y = a.y + aDir.y * this.segment;
      }
      if (bDir) {
        pts[n - 2].x = b.x + bDir.x * this.segment;
        pts[n - 2].y = b.y + bDir.y * this.segment;
      }
    };

    for (let i = 1; i < n - 1; i++) {
      if (pinned(i)) continue;
      const p = pts[i];
      const vx = (p.x - prev[i].x) * feel.damping;
      const vy = (p.y - prev[i].y) * feel.damping;
      prev[i].x = p.x;
      prev[i].y = p.y;
      p.x += vx;
      p.y += vy + g;
    }

    for (let k = 0; k < ITERATIONS; k++) {
      pin();
      for (let i = 0; i < n - 1; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - this.segment) / d;
        // Pinned points don't move; their free neighbour takes the whole correction.
        const fp = !pinned(i);
        const fq = !pinned(i + 1);
        if (!fp && !fq) continue;
        const wp = fp ? (fq ? 0.5 : 1) : 0;
        const wq = fq ? (fp ? 0.5 : 1) : 0;
        p.x += dx * diff * wp;
        p.y += dy * diff * wp;
        q.x -= dx * diff * wq;
        q.y -= dy * diff * wq;
      }
      // Bending: nudge each free point toward the midpoint of its neighbours.
      for (let i = 1; i < n - 1; i++) {
        if (pinned(i)) continue;
        const p = pts[i];
        p.x += ((pts[i - 1].x + pts[i + 1].x) / 2 - p.x) * feel.stiffness;
        p.y += ((pts[i - 1].y + pts[i + 1].y) / 2 - p.y) * feel.stiffness;
      }
    }
    pin();
  }

  // Smooth path through the points (quadratic curves between segment midpoints).
  path() {
    const p = this.pts;
    let d = `M ${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i].x + p[i + 1].x) / 2;
      const my = (p[i].y + p[i + 1].y) / 2;
      d += ` Q ${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    const last = p[p.length - 1];
    return d + ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  }
}
