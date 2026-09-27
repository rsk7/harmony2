import { useEffect, useRef } from "react";
import { getSmoothStepPath, Position, type ConnectionLineComponentProps, type Edge, type EdgeProps } from "@xyflow/react";
import { Rope, ropeFeel, slackLength } from "../physics/rope";
import { useView } from "./settings";

export type CableData = { color: string };
export type CableEdge = Edge<CableData, "cable">;

type Vec = { x: number; y: number };

const JACK_RADIUS = 9; // React Flow reports the handle's outer edge; the jack centre is this far in
const PLUG_LENGTH = 44; // jack centre to the back of the boot, where the flexible cable starts

const DIRECTIONS: Record<Position, Vec> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

// A plug seated in a jack, pointing out along `dir`: nut over the jack, grip barrel,
// then a tapered rubber boot in the cable colour.
function Plug({ at, dir, color }: { at: Vec; dir: Vec; color: string }) {
  const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  return (
    <g className="plug" transform={`translate(${at.x} ${at.y}) rotate(${angle})`}>
      <path className="plug-shadow" d="M2 -7 H30 L44 -4 V4 L30 7 H2 Z" transform="translate(0 3)" />
      <path className="plug-boot" d="M28 -6 L44 -3.5 V3.5 L28 6 Z" style={{ fill: color }} />
      <line className="plug-rib" x1="33" y1="-5" x2="33" y2="5" />
      <line className="plug-rib" x1="38" y1="-4.2" x2="38" y2="4.2" />
      <rect className="plug-barrel" x="6" y="-7" width="23" height="14" rx="2.5" />
      <line className="plug-grip" x1="12" y1="-5" x2="12" y2="5" />
      <line className="plug-grip" x1="16" y1="-5" x2="16" y2="5" />
      <line className="plug-grip" x1="20" y1="-5" x2="20" y2="5" />
      <rect className="plug-band" x="24" y="-7" width="3" height="14" style={{ fill: color }} />
      <circle className="plug-nut" r="9" />
      <circle className="plug-nut-inner" r="4" />
    </g>
  );
}

type Ends = { a: Vec; aDir: Vec; b: Vec; bDir: Vec };

const along = (p: Vec, dir: Vec, d: number): Vec => ({ x: p.x + dir.x * d, y: p.y + dir.y * d });

// Runs a rope simulation every frame between the backs of the two plugs and writes
// the path straight to the given SVG paths, bypassing React. A cable's length is set
// by the distance it was patched across; floppiness adds slack on top, live.
// `grow` lets the dragged cable pay out more length as it's pulled.
function useRope(ends: Ends, paths: React.RefObject<(SVGPathElement | null)[]>, grow = false) {
  const endsRef = useRef(ends);
  endsRef.current = ends;
  const { floppiness, cables } = useView();
  const world = cables === "hanging" ? "hanging" : "table";
  const feelRef = useRef(ropeFeel(floppiness, world));
  feelRef.current = ropeFeel(floppiness, world);

  useEffect(() => {
    const tails = () => {
      const { a, aDir, b, bDir } = endsRef.current;
      return [along(a, aDir, PLUG_LENGTH), along(b, bDir, PLUG_LENGTH)] as const;
    };
    const [a0, b0] = tails();
    let span = Math.hypot(b0.x - a0.x, b0.y - a0.y);
    const rope = new Rope(a0, b0, slackLength(span, feelRef.current), feelRef.current.world);
    let raf = 0;
    const tick = () => {
      const [a, b] = tails();
      const feel = feelRef.current;
      if (grow) span = Math.max(span, Math.hypot(b.x - a.x, b.y - a.y));
      const length = slackLength(span, feel);
      if (length !== rope.length) rope.setLength(length);
      rope.step(a, b, feel, endsRef.current.aDir, endsRef.current.bDir);
      const d = rope.path();
      paths.current.forEach((p) => p?.setAttribute("d", d));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [grow, paths]);
}

function jackCentre(x: number, y: number, dir: Vec): Vec {
  return along({ x, y }, dir, -JACK_RADIUS);
}

// Right-angle route between the backs of the two plugs.
function straightPath({ a, aDir, b, bDir }: Ends, sourcePosition: Position, targetPosition: Position) {
  const ta = along(a, aDir, PLUG_LENGTH);
  const tb = along(b, bDir, PLUG_LENGTH);
  const [path] = getSmoothStepPath({
    sourceX: ta.x,
    sourceY: ta.y,
    sourcePosition,
    targetX: tb.x,
    targetY: tb.y,
    targetPosition,
    borderRadius: 0,
    offset: 16,
  });
  return path;
}

type CableProps = { ends: Ends; color: string; interactive: boolean; positions: [Position, Position] };

function PhysicsCable({ ends, color, interactive }: CableProps) {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  useRope(ends, paths, !interactive);
  return (
    <>
      <path ref={(el) => void (paths.current[0] = el)} className="cable-shadow" />
      <path ref={(el) => void (paths.current[1] = el)} className="cable" style={{ stroke: color }} />
      {interactive && <path ref={(el) => void (paths.current[2] = el)} className="react-flow__edge-interaction" />}
    </>
  );
}

function StraightCable({ ends, color, interactive, positions }: CableProps) {
  const d = straightPath(ends, ...positions);
  return (
    <>
      <path d={d} className="cable-shadow" />
      <path d={d} className="cable straight" style={{ stroke: color }} />
      {interactive && <path d={d} className="react-flow__edge-interaction" />}
    </>
  );
}

function Cable(props: CableProps) {
  const { cables } = useView();
  const Body = cables === "straight" ? StraightCable : PhysicsCable;
  return (
    <>
      <Body {...props} />
      <Plug at={props.ends.a} dir={props.ends.aDir} color={props.color} />
      <Plug at={props.ends.b} dir={props.ends.bDir} color={props.color} />
    </>
  );
}

export function PatchCable(props: EdgeProps<CableEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const aDir = DIRECTIONS[sourcePosition];
  const bDir = DIRECTIONS[targetPosition];
  const ends = { a: jackCentre(sourceX, sourceY, aDir), aDir, b: jackCentre(targetX, targetY, bDir), bDir };
  return (
    <Cable
      ends={ends}
      color={data?.color ?? "#b0b0b0"}
      interactive
      positions={[sourcePosition, targetPosition]}
    />
  );
}

export function CableConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition }: ConnectionLineComponentProps) {
  const aDir = DIRECTIONS[fromPosition];
  const bDir = DIRECTIONS[toPosition];
  // Unlike edges, the connection line already gets jack centres. The loose end sits
  // at the cursor, or on a jack's centre when it snaps to one.
  const ends = { a: { x: fromX, y: fromY }, aDir, b: { x: toX, y: toY }, bDir };
  return (
    <g className="dragging">
      <Cable ends={ends} color="#c8c8c8" interactive={false} positions={[fromPosition, toPosition]} />
    </g>
  );
}
