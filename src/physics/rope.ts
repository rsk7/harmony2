// Verlet rope for cables lying on a table, seen from above: gravity points into the
// screen, so nothing pulls the cable sideways. Table friction bleeds off motion,
// bending stiffness keeps curves smooth, and any slack bows the cable out into an arc.
// Both ends are pinned to the plugs.

type Vec = { x: number; y: number };

const ITERATIONS = 24; // constraint passes per step; higher = less stretchy rope
const STATIC_FRICTION = 0.05; // px/frame; a point that would move less than this stays put

// Floppiness 0..1 maps to how much slack a cable has, how easily it bends,
// and how far it slides across the table after being tugged.
export function ropeFeel(floppiness: number) {
  const f = Math.min(1, Math.max(0, floppiness));
  return {
    slackScale: 1 + 0.3 * f,
    slackExtra: 10 + 100 * f, // px
    damping: 0.75 + 0.12 * f, // velocity kept per step, i.e. 1 - table friction
    stiffness: 0.12 - 0.09 * f, // how hard skip-one springs resist bending, per pass
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
    // Start as a parabolic bow whose arc length roughly matches the cable, bulging
    // toward the bottom of the screen, so the cable is already lying slack.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const chord = Math.hypot(dx, dy) || 1;
    const bow = length > chord ? Math.sqrt((3 * chord * (length - chord)) / 8) : 0;
    let nx = -dy / chord;
    let ny = dx / chord;
    if (ny < 0) (nx = -nx), (ny = -ny);
    this.pts = Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      const off = 4 * bow * t * (1 - t);
      return { x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off };
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

    // Inertia with table friction; no in-plane gravity.
    for (let i = 1; i < n - 1; i++) {
      if (pinned(i)) continue;
      const p = pts[i];
      const vx = (p.x - prev[i].x) * feel.damping;
      const vy = (p.y - prev[i].y) * feel.damping;
      prev[i].x = p.x;
      prev[i].y = p.y;
      p.x += vx;
      p.y += vy;
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
      // Bending: points two apart resist getting closer than a straight run allows,
      // which penalises folds and zigzags so slack settles into one smooth bow.
      const reach = 2 * this.segment;
      for (let i = 0; i < n - 2; i++) {
        const p = pts[i];
        const q = pts[i + 2];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        if (d >= reach) continue;
        const fp = !pinned(i);
        const fq = !pinned(i + 2);
        if (!fp && !fq) continue;
        const push = ((reach - d) / d) * feel.stiffness;
        const wp = fp ? (fq ? 0.5 : 1) : 0;
        const wq = fq ? (fp ? 0.5 : 1) : 0;
        p.x -= dx * push * wp;
        p.y -= dy * push * wp;
        q.x += dx * push * wq;
        q.y += dy * push * wq;
      }
    }
    pin();

    // Static friction: tiny net movements don't overcome the table, so the cable
    // comes fully to rest instead of creeping.
    for (let i = 1; i < n - 1; i++) {
      if (pinned(i)) continue;
      if (Math.hypot(pts[i].x - prev[i].x, pts[i].y - prev[i].y) < STATIC_FRICTION) {
        pts[i].x = prev[i].x;
        pts[i].y = prev[i].y;
      }
    }
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
