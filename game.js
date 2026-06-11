(() => {
  "use strict";

  // ── Constants ────────────────────────────────────────────────────────────────
  const ROOT_SPAN = 800;
  const SUB_SCALE = 0.52;
  const VGAP      = 170;
  const MAXA      = 20;
  const PERFECT   = 0.4;

  const R     = Math.round;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand  = (a, b)    => a + Math.random() * (b - a);
  const randI = (a, b)    => Math.floor(rand(a, b + 1));
  const TAU   = Math.PI * 2;

  const DISC_COLORS         = ["#CC2200", "#0033AA", "#F5C400"];
  const SHAPE_KINDS         = ["ellipse", "pinched", "blob", "polygon", "petal", "banana"];
  const GAME_OVER_THRESHOLD = 15;

  // ── Shape geometry ───────────────────────────────────────────────────────────
  function polygonArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) * 0.5;
  }

  function polygonCentroid(pts) {
    let cx = 0, cy = 0, cs = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const c = a.x * b.y - b.x * a.y;
      cs += c; cx += (a.x + b.x) * c; cy += (a.y + b.y) * c;
    }
    return Math.abs(cs) < 1e-6 ? { x: 0, y: 0 } : { x: cx / (3 * cs), y: cy / (3 * cs) };
  }

  function normalizeShapePoints(pts, targetArea) {
    const cen = polygonCentroid(pts);
    const centered = pts.map(p => ({ x: p.x - cen.x, y: p.y - cen.y }));
    const scale = Math.sqrt(targetArea / Math.max(polygonArea(centered), 1e-6));
    return centered.map(p => ({ x: p.x * scale, y: p.y * scale }));
  }

  function boundingRadius(pts) {
    return pts.reduce((r, p) => Math.max(r, Math.hypot(p.x, p.y)), 0);
  }

  function makeEllipsePoints() {
    const pts = [], n = 48, stretch = rand(0.45, 2.35), shear = rand(-0.35, 0.35);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const x = Math.cos(t) * stretch, y = Math.sin(t) / stretch;
      pts.push({ x: x + y * shear, y });
    }
    return pts;
  }

  function makePinchedPoints() {
    const pts = [], n = 56, phase = rand(0, TAU), pinch = rand(0.18, 0.42), lobes = randI(2, 4);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU, p = Math.cos(t - phase);
      const r = 1 + 0.1 * Math.sin(lobes * t + phase) - pinch * p * p;
      pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
    }
    return pts;
  }

  function makeBlobPoints() {
    const pts = [], n = 44, pA = rand(0, TAU), pB = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const r = 1 + 0.18 * Math.sin(3 * t + pA) + 0.1 * Math.sin(5 * t + pB);
      pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
    }
    return pts;
  }

  function makePolygonPoints() {
    const sides = randI(3, 7);
    const anchors = Array.from({ length: sides }, (_, i) => {
      const t = (i / sides) * TAU + rand(-0.08, 0.08), r = rand(0.75, 1.18);
      return { x: Math.cos(t) * r, y: Math.sin(t) * r };
    });
    const pts = [];
    for (let i = 0; i < anchors.length; i++) {
      const p0 = anchors[(i - 1 + sides) % sides], p1 = anchors[i];
      const p2 = anchors[(i + 1) % sides],          p3 = anchors[(i + 2) % sides];
      for (let j = 0; j < 8; j++) {
        const t = j / 8, t2 = t * t, t3 = t2 * t;
        pts.push({
          x: 0.5 * (2*p1.x + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
          y: 0.5 * (2*p1.y + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
        });
      }
    }
    return pts;
  }

  function makePetalPoints() {
    const pts = [], n = 72, lobes = randI(3, 5), phase = rand(0, TAU), wobble = rand(0.04, 0.12);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const r = 1 + 0.22 * Math.sin(lobes * t + phase) + wobble * Math.sin((lobes + 2) * t - phase);
      pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r });
    }
    return pts;
  }

  function makeBananaPoints() {
    const top = [], bot = [], n = 28;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), t = -1.18 + u * 2.36;
      const cx = Math.sin(t) * 1.12, cy = -Math.cos(t) * 0.55;
      const tx = Math.cos(t) * 1.12, ty = Math.sin(t) * 0.55;
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len, ny = tx / len;
      const w = 0.08 + 0.28 * Math.sin(u * Math.PI);
      top.push({ x: cx + nx * w,        y: cy + ny * w        });
      bot.push({ x: cx - nx * w * 0.58, y: cy - ny * w * 0.58 });
    }
    return top.concat(bot.reverse());
  }

  function makeShapePoints(kind) {
    if (kind === "ellipse") return makeEllipsePoints();
    if (kind === "pinched") return makePinchedPoints();
    if (kind === "blob")    return makeBlobPoints();
    if (kind === "polygon") return makePolygonPoints();
    if (kind === "petal")   return makePetalPoints();
    return makeBananaPoints();
  }

  function pointsToPath(pts) {
    return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("") + "Z";
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  let root           = null;
  let level          = 1;
  let activeRod      = null;
  let ghostLine      = null;
  let ghostDot       = null;
  let transitioning  = false;
  let touchX         = null;
  let fingerDown     = false;
  let reviewMode     = false;
  let isPanning      = false;
  let didPan         = false;
  let panStart       = null;
  let pinchStartDist = 0;
  let pinchStartMid  = null;
  let pinchStartVb   = null;
  let panTouchStart  = null;
  let wasMultiTouch  = false;

  const stats = { score: 0, lean: 0 };

  // High score persists across sessions (localStorage may be unavailable in
  // private mode / sandboxed contexts — fail silently if so).
  const HS_KEY = "mobile-highscore";
  let highScore = 0;
  try { highScore = parseInt(localStorage.getItem(HS_KEY), 10) || 0; } catch (e) {}

  // ── Arm constructors ─────────────────────────────────────────────────────────
  const disc = () => {
    const kind = SHAPE_KINDS[Math.floor(Math.random() * SHAPE_KINDS.length)];
    return { type: "disc", kind, rawPoints: makeShapePoints(kind), relR: rand(0.07, 0.30), rotation: rand(0, TAU),
             color: null, radius: 0, area: 0, points: null, cx: 0, cy: 0 };
  };
  const rod  = (left, right) => ({
    type: "rod", left, right,
    pivotFrac: null, leanDeg: 0,
    bow: rand(8, 18) * (Math.random() < 0.5 ? 1 : -1),
    cx: 0, cy: 0, span: 0, xL: 0, xR: 0,
    svgGroup: null, outerGroup: null, parentString: null,
  });

  // ── Level generation ─────────────────────────────────────────────────────────
  function assignDiscColors(arm) {
    if (arm.type === "disc") return;
    const ci = Math.floor(Math.random() * DISC_COLORS.length);
    let oi;
    do { oi = Math.floor(Math.random() * DISC_COLORS.length); } while (oi === ci);
    if (arm.left.type  === "disc") arm.left.color  = DISC_COLORS[ci];
    if (arm.right.type === "disc") arm.right.color = DISC_COLORS[oi];
    assignDiscColors(arm.left);
    assignDiscColors(arm.right);
  }

  function buildLevel(n) {
    const root = rod(disc(), disc());
    if (n === 1) { assignDiscColors(root); return root; }
    const queue = [
      { parent: root, side: "right" },
      { parent: root, side: "left"  },
    ];
    for (let i = 1; i < n; i++) {
      const { parent, side } = queue.shift();
      const child = rod(disc(), disc());
      parent[side] = child;
      queue.push(
        { parent: child, side: "right" },
        { parent: child, side: "left"  },
      );
    }
    assignDiscColors(root);
    return root;
  }

  // ── World-space layout ───────────────────────────────────────────────────────
  function setSpans(arm, span) {
    if (arm.type === "disc") return;
    arm.span = span;
    setSpans(arm.left,  span * SUB_SCALE);
    setSpans(arm.right, span * SUB_SCALE);
  }

  function setPositions(arm, hangX, hangY, parentSpan) {
    if (arm.type === "disc") {
      arm.cx    = hangX;
      arm.cy    = hangY;
      const targetR  = clamp(arm.relR * parentSpan, 14, 75);
      arm.area       = Math.PI * targetR * targetR;
      arm.points     = normalizeShapePoints(arm.rawPoints, arm.area);
      arm.radius     = boundingRadius(arm.points);
      return;
    }
    arm.cx = hangX;
    arm.cy = hangY + VGAP;
    arm.xL = hangX - arm.span / 2;
    arm.xR = hangX + arm.span / 2;
    setPositions(arm.left,  arm.xL, arm.cy, arm.span);
    setPositions(arm.right, arm.xR, arm.cy, arm.span);
  }

  function layoutTree(root) {
    setSpans(root, ROOT_SPAN);
    setPositions(root, 0, -VGAP, ROOT_SPAN);
  }

  // ── Physics ──────────────────────────────────────────────────────────────────
  function getSubtreeWeight(arm) {
    if (arm.type === "disc") return arm.area;
    return getSubtreeWeight(arm.left) + getSubtreeWeight(arm.right);
  }

  function computeLean(r) {
    const wL  = getSubtreeWeight(r.left);
    const wR  = getSubtreeWeight(r.right);
    const px  = r.xL + r.pivotFrac * r.span;
    const net = wR * (r.xR - px) - wL * (px - r.xL);
    const max = Math.max(wL, wR) * r.span;
    return MAXA * net / max;
  }

  // ── Traversal ────────────────────────────────────────────────────────────────
  function getNextUnsettled(arm) {
    if (arm.type === "disc") return null;
    return (
      getNextUnsettled(arm.left)  ||
      getNextUnsettled(arm.right) ||
      (arm.pivotFrac === null ? arm : null)
    );
  }

  function findDepth(arm, target, d = 0) {
    if (arm === target) return d;
    if (arm.type === "disc") return -1;
    const l = findDepth(arm.left,  target, d + 1);
    if (l >= 0) return l;
    return findDepth(arm.right, target, d + 1);
  }

  // ── Scoring ──────────────────────────────────────────────────────────────────
  // Total lean in degrees for this level (used for game-over tracking).
  function totalLean(arm) {
    if (arm.type === "disc") return 0;
    const own = arm.pivotFrac !== null ? Math.abs(arm.leanDeg) : 0;
    return own + totalLean(arm.left) + totalLean(arm.right);
  }

  // Points for this level: 100 per rod at 0°, quadratic falloff to 0 at MAXA.
  function levelScore(arm) {
    if (arm.type === "disc") return 0;
    const own = arm.pivotFrac !== null
      ? Math.round(100 * Math.max(0, 1 - Math.abs(arm.leanDeg) / MAXA) ** 2)
      : 0;
    return own + levelScore(arm.left) + levelScore(arm.right);
  }

  // ── Bounding box ─────────────────────────────────────────────────────────────

  // Visual bounds accounting for the actual lean/slide transforms on each settled rod.
  // hangX/hangY is the world-space rotation center (cx in world space) of arm.
  // Child rods hang VGAP below their parent's visual arm endpoint (strings are always vertical).
  function getVisualBounds() {
    const b = { x1: Infinity, x2: -Infinity, y1: Infinity, y2: -Infinity };
    function exp(x, y, r) {
      r = r || 0;
      b.x1 = Math.min(b.x1, x - r); b.x2 = Math.max(b.x2, x + r);
      b.y1 = Math.min(b.y1, y - r); b.y2 = Math.max(b.y2, y + r);
    }
    exp(root.cx, root.cy - VGAP * 0.5); // ceiling string top

    function walk(arm, hangX, hangY) {
      if (arm.type !== "rod") return;
      exp(hangX, hangY);
      if (arm.pivotFrac === null) {
        // Unsettled — fall back to layout positions
        exp(arm.xL, arm.cy); exp(arm.xR, arm.cy);
        if (arm.left.type  === "disc") exp(arm.xL, arm.cy, arm.left.radius);
        else                           walk(arm.left,  arm.xL, arm.cy + VGAP);
        if (arm.right.type === "disc") exp(arm.xR, arm.cy, arm.right.radius);
        else                           walk(arm.right, arm.xR, arm.cy + VGAP);
        return;
      }
      const theta = arm.leanDeg * Math.PI / 180;
      const cos = Math.cos(theta), sin = Math.sin(theta);
      // Visual arm endpoint offsets from hang point (after slide + rotate)
      const lOff = -arm.pivotFrac * arm.span;
      const rOff = (1 - arm.pivotFrac) * arm.span;
      const lx = hangX + lOff * cos, ly = hangY + lOff * sin;
      const rx = hangX + rOff * cos, ry = hangY + rOff * sin;
      exp(lx, ly); exp(rx, ry);
      if (arm.left.type  === "disc") exp(lx, ly, arm.left.radius);
      else                           walk(arm.left,  lx, ly + VGAP);
      if (arm.right.type === "disc") exp(rx, ry, arm.right.radius);
      else                           walk(arm.right, rx, ry + VGAP);
    }
    walk(root, root.cx, root.cy);
    return b;
  }

  function getBounds(arm, b) {
    b = b || { x1: Infinity, x2: -Infinity, y1: Infinity, y2: -Infinity };
    if (arm.type === "disc") {
      b.x1 = Math.min(b.x1, arm.cx - arm.radius);
      b.x2 = Math.max(b.x2, arm.cx + arm.radius);
      b.y1 = Math.min(b.y1, arm.cy - arm.radius);
      b.y2 = Math.max(b.y2, arm.cy + arm.radius);
    } else {
      b.x1 = Math.min(b.x1, arm.xL);
      b.x2 = Math.max(b.x2, arm.xR);
      b.y1 = Math.min(b.y1, arm.cy);
      b.y2 = Math.max(b.y2, arm.cy);
      getBounds(arm.left,  b);
      getBounds(arm.right, b);
    }
    return b;
  }

  function rodBounds(r) {
    const b = { x1: r.xL, x2: r.xR, y1: r.cy, y2: r.cy };
    if (r.left.type === "disc") {
      b.x1 = Math.min(b.x1, r.xL - r.left.radius);
      b.y1 = Math.min(b.y1, r.cy  - r.left.radius);
      b.y2 = Math.max(b.y2, r.cy  + r.left.radius);
    }
    if (r.right.type === "disc") {
      b.x2 = Math.max(b.x2, r.xR + r.right.radius);
      b.y1 = Math.min(b.y1, r.cy  - r.right.radius);
      b.y2 = Math.max(b.y2, r.cy  + r.right.radius);
    }
    return b;
  }

  // ── SVG helpers ──────────────────────────────────────────────────────────────
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg   = document.getElementById("sheet");

  function S(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    for (const kid of kids)
      el.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    return el;
  }

  const mkline = (x1, y1, x2, y2, cls) => S("line", { x1, y1, x2, y2, class: cls });
  const mkbow  = (x1, y1, x2, y2, bow, cls) => S("path", {
    d: `M${x1},${y1} Q${(x1 + x2) / 2},${(y1 + y2) / 2 + bow} ${x2},${y2}`,
    class: cls || "ln", fill: "none",
  });


  // ── Camera ───────────────────────────────────────────────────────────────────

  function applyViewBox({ vx, vy, vw, vh }) {
    svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  }

  function currentViewBox() {
    const p = svg.getAttribute("viewBox").split(" ").map(Number);
    return { vx: p[0], vy: p[1], vw: p[2], vh: p[3] };
  }

  // Returns a viewBox showing bounds b (world units) such that the content
  // appears at most min(innerWidth × 0.9, 800) px wide on screen, and fits
  // vertically within 88% of screen height. pad is added on all sides.
  function fitViewBox(b, pad) {
    pad = (pad === undefined) ? 80 : pad;
    const bw  = b.x2 - b.x1 + 2 * pad;
    const bh  = b.y2 - b.y1 + 2 * pad;
    const W   = window.innerWidth, H = window.innerHeight;
    const asp = W / H;
    const maxW = Math.min(W * 0.9, 800);
    // vw must be large enough that content ≤ maxW px wide AND ≤ 88% of screen tall
    const vw  = Math.max(bw * W / maxW, bh * asp / 0.88);
    const vh  = vw / asp;
    return {
      vx: (b.x1 + b.x2) / 2 - vw / 2,
      vy: (b.y1 + b.y2) / 2 - vh / 2,
      vw, vh,
    };
  }

  function rodViewBox(r)     { return fitViewBox(getBounds(r),   80); }
  function overviewViewBox() { return rodViewBox(root); }

  // ── Camera animation ─────────────────────────────────────────────────────────
  const easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  let cameraAnimId = null;

  function animateViewBox(from, to, ms, done) {
    if (cameraAnimId) cancelAnimationFrame(cameraAnimId);
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / ms, 1);
      const e = easeInOut(t);
      applyViewBox({
        vx: from.vx + (to.vx - from.vx) * e,
        vy: from.vy + (to.vy - from.vy) * e,
        vw: from.vw + (to.vw - from.vw) * e,
        vh: from.vh + (to.vh - from.vh) * e,
      });
      if (t < 1) { cameraAnimId = requestAnimationFrame(frame); }
      else        { cameraAnimId = null; if (done) done(); }
    }
    cameraAnimId = requestAnimationFrame(frame);
  }

  // ── Tilt animation ───────────────────────────────────────────────────────────
  // The rod slides so the chosen pivot sits directly below its hang string (r.cx),
  // then rotates around that hang point.  On every frame the whole settled subtree
  // cascades so child assemblies follow in real time.
  function animateTilt(r, done) {
    const target      = r.leanDeg;
    const hangX       = r.cx;
    const targetDelta = hangX - (r.xL + r.pivotFrac * r.span);
    const start       = performance.now();
    const DUR = 1800, decay = 2.4, freq = 5.2;

    const leanLabel = S("text", {
      x: r.cx, y: r.cy + 52,
      class: "lbl-lean", "text-anchor": "middle",
    }, "0.0°");
    r.outerGroup.appendChild(leanLabel);

    function frame(now) {
      const ms     = now - start, t = ms / 1000;
      const spring = ms >= DUR ? 1 : (1 - Math.exp(-decay * t) * Math.cos(freq * t));
      r.leanDeg    = target * spring;
      r._slideDelta = targetDelta * spring;  // for propagateTilt to track visual arm endpoints
      r.svgGroup.setAttribute("transform",
        `rotate(${r.leanDeg} ${hangX} ${r.cy}) translate(${r._slideDelta} 0)`);
      propagateTilt(r, 0, 0);
      leanLabel.textContent = Math.abs(r.leanDeg).toFixed(1) + "°";
      if (ms >= DUR) { done(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Recursively shift settled child assemblies so strings stay vertical and fixed-length.
  // Uses r._slideDelta (animated) when set, otherwise the final settled delta, so child
  // rods correctly track the visual arm endpoints throughout the slide+tilt animation.
  function propagateTilt(r, shiftX, shiftY) {
    if (r.pivotFrac === null) return;
    const ehX  = r.cx + shiftX;
    const ehY  = r.cy + shiftY;
    const theta = r.leanDeg * Math.PI / 180;
    const cos  = Math.cos(theta), sin = Math.sin(theta);
    const slide = r._slideDelta !== undefined
      ? r._slideDelta
      : (r.cx - (r.xL + r.pivotFrac * r.span));

    [[r.left, r.xL], [r.right, r.xR]].forEach(([arm, armX]) => {
      if (arm.type !== "rod") return;
      // Arm endpoint: local x offset from hang point, accounting for current slide
      const armOffset = armX - r.cx + slide;
      const epX = ehX + armOffset * cos;
      const epY = ehY + armOffset * sin;
      const csx = epX - arm.cx;
      const csy = epY + VGAP - arm.cy;
      if (arm.outerGroup) arm.outerGroup.setAttribute("transform", `translate(${csx} ${csy})`);
      if (arm.parentString) {
        arm.parentString.setAttribute("x1", epX);
        arm.parentString.setAttribute("y1", epY);
        arm.parentString.setAttribute("x2", epX);
        arm.parentString.setAttribute("y2", epY + VGAP + bowAtPivot(arm));
      }
      propagateTilt(arm, csx, csy);
    });
  }

  // Y-offset of the bowed rod at the hang/pivot x (quadratic Bézier: y = 2t(1-t)·bow).
  // Bow now runs the full rod span xL→xR.
  function bowAtPivot(r) {
    if (r.span <= 0) return 0;
    const px = r.pivotFrac !== null ? r.xL + r.pivotFrac * r.span : r.cx;
    const t  = clamp((px - r.xL) / r.span, 0, 1);
    return 2 * t * (1 - t) * r.bow;
  }

  // ── Renderer ─────────────────────────────────────────────────────────────────
  function drawShape(g, arm, x, y) {
    const sg = S("g", { transform: `translate(${x},${y}) rotate(${arm.rotation * 180 / Math.PI})` });
    sg.appendChild(S("path", { d: pointsToPath(arm.points), fill: arm.color || DISC_COLORS[0] }));
    g.appendChild(sg);
  }

  function drawRod(g, r) {
    const { xL, xR, cy } = r;
    g.appendChild(mkbow(xL, cy, xR, cy, r.bow));
    if (r.left.type  === "disc") drawShape(g, r.left,  xL, cy);
    if (r.right.type === "disc") drawShape(g, r.right, xR, cy);
  }

  function renderTree(root) {
    const gStrings = S("g");
    svg.appendChild(gStrings);
    gStrings.appendChild(mkline(0, root.cy - VGAP * 0.45, 0, root.cy + bowAtPivot(root), "string"));

    function walk(arm, hangX, hangY) {
      if (arm.type === "disc") return;
      if (hangX !== null) {
        const str = mkline(hangX, hangY, arm.cx, arm.cy + bowAtPivot(arm), "string");
        gStrings.appendChild(str);
        arm.parentString = str;
      } else {
        arm.parentString = null;
      }
      walk(arm.left,  arm.xL, arm.cy);
      walk(arm.right, arm.xR, arm.cy);
      const outerG = S("g");   // carries parent-induced world-space shift
      const innerG = S("g");   // carries this rod's own slide + tilt
      outerG.appendChild(innerG);
      arm.outerGroup = outerG;
      arm.svgGroup   = innerG;
      drawRod(innerG, arm);
      svg.appendChild(outerG);
    }
    walk(root, null, null);
  }

  function draw() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    renderTree(root);
    applyViewBox(overviewViewBox());
  }

  // ── Review mode ───────────────────────────────────────────────────────────────
  function enterReviewMode() {
    reviewMode = true;
    document.body.classList.add("review");

    const levelLean = totalLean(root);
    const prev      = stats.score;
    stats.score    += levelScore(root);
    const newBest = stats.score > highScore;
    if (newBest) {
      highScore = stats.score;
      try { localStorage.setItem(HS_KEY, String(highScore)); } catch (e) {}
    }
    const scoreEl   = document.getElementById("stScore");
    const DUR = 1400, start = performance.now();
    (function frame(now) {
      const t = Math.min((now - start) / DUR, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      scoreEl.textContent = Math.round(prev + (stats.score - prev) * eased);
      if (t < 1) requestAnimationFrame(frame);
    })(performance.now());

    const endBtns = document.getElementById("endBtns");
    if (levelLean > GAME_OVER_THRESHOLD) {
      endBtns.classList.add("gameover");
      const bl = document.getElementById("bestLabel");
      bl.innerHTML = newBest ? `New Best <b>${highScore}</b>` : `Best <b>${highScore}</b>`;
    }
    endBtns.classList.add("show");
  }

  // ── Interaction ──────────────────────────────────────────────────────────────
  function clientToWorldX(clientX) {
    const { vx, vw } = currentViewBox();
    return vx + (clientX / window.innerWidth) * vw;
  }

  function addGhost() {
    // Ghost is created lazily on first pointer interaction, not immediately on rod activation.
  }

  function updateGhost(clientX) {
    if (!activeRod) return;
    if (!ghostLine) {
      ghostLine = mkline(0, -9999, 0, 9999, "ghost");
      svg.appendChild(ghostLine);
    }
    if (!ghostDot) {
      ghostDot = S("circle", { r: 5, class: "ghost-dot" });
      svg.appendChild(ghostDot);
    }
    const r = activeRod;
    const x = clamp(clientToWorldX(clientX), r.xL, r.xR);
    const t = (x - r.xL) / r.span;
    const y = r.cy + 2 * t * (1 - t) * r.bow;
    ghostLine.setAttribute("x1", x);
    ghostLine.setAttribute("x2", x);
    ghostDot.setAttribute("cx", x);
    ghostDot.setAttribute("cy", y);
  }

  function advance(prevRod) {
    activeRod  = null;
    const next = getNextUnsettled(root);

    if (!next) {
      // All rods settled — zoom out then enter review mode.
      animateViewBox(currentViewBox(), overviewViewBox(), 700, enterReviewMode);
      return;
    }

    transitioning = true;
    animateViewBox(currentViewBox(), rodViewBox(next), 600, () => {
      activeRod = next; transitioning = false;
      if (fingerDown && touchX !== null) updateGhost(touchX);
    });
  }

  function onPick(clientX) {
    if (reviewMode || !activeRod || transitioning || activeRod.pivotFrac !== null) return;
    transitioning = true;

    const x = clamp(clientToWorldX(clientX), activeRod.xL, activeRod.xR);
    activeRod.pivotFrac = (x - activeRod.xL) / activeRod.span;
    activeRod.leanDeg   = computeLean(activeRod);

    if (ghostLine) { ghostLine.remove(); ghostLine = null; }
    if (ghostDot)  { ghostDot.remove();  ghostDot  = null; }

    // Animate back to the ideal view first, then lean.
    const settled = activeRod;
    activeRod = null;
    animateViewBox(currentViewBox(), rodViewBox(settled), 350, () => {
      animateTilt(settled, () => {
        transitioning = false;
        advance(settled);
      });
    });
  }

  // ── Events ───────────────────────────────────────────────────────────────────
  svg.addEventListener("mousemove", (e) => {
    // Promote to pan once drag exceeds threshold (gameplay) or immediately (review)
    if (!isPanning && panStart) {
      const dist = Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y);
      if (dist > 6) { isPanning = true; didPan = true; }
    }
    if (isPanning && panStart) {
      const { vx, vy, vw, vh } = panStart.vb;
      const dx = (panStart.x - e.clientX) / window.innerWidth  * vw;
      const dy = (panStart.y - e.clientY) / window.innerHeight * vh;
      applyViewBox({ vx: vx + dx, vy: vy + dy, vw, vh });
      return;
    }
    if (!reviewMode && !transitioning) updateGhost(e.clientX);
  });

  svg.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    didPan   = false;
    panStart = { x: e.clientX, y: e.clientY, vb: currentViewBox() };
    if (reviewMode) {
      isPanning = true;
      document.body.classList.add("panning");
    }
  });

  document.addEventListener("mouseup", () => {
    isPanning = false;
    panStart  = null;
    document.body.classList.remove("panning");
  });

  svg.addEventListener("click", (e) => {
    if (!reviewMode && !transitioning && !didPan) onPick(e.clientX);
  });

  svg.addEventListener("wheel", (e) => {
    if (!reviewMode && !activeRod) return;
    e.preventDefault();
    const { vx, vy, vw, vh } = currentViewBox();
    const factor = 1 + e.deltaY * 0.001;
    const wx     = vx + (e.clientX / window.innerWidth)  * vw;
    const wy     = vy + (e.clientY / window.innerHeight) * vh;
    const newVw  = clamp(vw * factor, 100, 8000);
    const newVh  = clamp(vh * factor, 100, 8000);
    applyViewBox({
      vx: wx - (e.clientX / window.innerWidth)  * newVw,
      vy: wy - (e.clientY / window.innerHeight) * newVh,
      vw: newVw, vh: newVh,
    });
  }, { passive: false });

  svg.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      // Two-finger: start pinch+pan — works in both gameplay and review.
      wasMultiTouch  = true;
      touchX         = null;
      panTouchStart  = null;
      if (ghostLine) { ghostLine.remove(); ghostLine = null; }
      if (ghostDot)  { ghostDot.remove();  ghostDot  = null; }
      const t0 = e.touches[0], t1 = e.touches[1];
      pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      pinchStartMid  = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
      pinchStartVb   = currentViewBox();
      return;
    }
    // One finger — ignore until all fingers from a prior multi-touch are gone.
    if (wasMultiTouch) return;
    if (reviewMode) {
      panTouchStart  = { x: e.touches[0].clientX, y: e.touches[0].clientY, vb: currentViewBox() };
      pinchStartDist = 0;
      return;
    }
    fingerDown = true;
    touchX = e.touches[0].clientX;
    if (transitioning || !activeRod) return;
    updateGhost(touchX);
  }, { passive: false });

  svg.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 2 && pinchStartDist && pinchStartVb) {
      // Combined pinch-zoom + pan: world point under initial midpoint tracks to current midpoint.
      const t0    = e.touches[0], t1 = e.touches[1];
      const dist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const midX  = (t0.clientX + t1.clientX) / 2;
      const midY  = (t0.clientY + t1.clientY) / 2;
      const scale = pinchStartDist / dist;
      const { vx, vy, vw, vh } = pinchStartVb;
      // World point that was under the initial midpoint
      const wx    = vx + (pinchStartMid.x / window.innerWidth)  * vw;
      const wy    = vy + (pinchStartMid.y / window.innerHeight) * vh;
      const newVw = clamp(vw * scale, 100, 8000);
      const newVh = clamp(vh * scale, 100, 8000);
      applyViewBox({
        vx: wx - (midX / window.innerWidth)  * newVw,
        vy: wy - (midY / window.innerHeight) * newVh,
        vw: newVw, vh: newVh,
      });
      return;
    }
    if (wasMultiTouch) return;
    if (reviewMode && e.touches.length === 1 && panTouchStart) {
      const { vx, vy, vw, vh } = panTouchStart.vb;
      applyViewBox({
        vx: vx + (panTouchStart.x - e.touches[0].clientX) / window.innerWidth  * vw,
        vy: vy + (panTouchStart.y - e.touches[0].clientY) / window.innerHeight * vh,
        vw, vh,
      });
      return;
    }
    if (transitioning || !activeRod) return;
    touchX = e.touches[0].clientX;
    updateGhost(touchX);
  }, { passive: false });

  svg.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) { pinchStartDist = 0; pinchStartMid = null; pinchStartVb = null; }
    if (e.touches.length === 0) {
      wasMultiTouch = false;
      panTouchStart = null;
      fingerDown    = false;
    }
    if (wasMultiTouch || reviewMode) return;
    if (transitioning || !activeRod || touchX == null) return;
    onPick(touchX);
    touchX = null;
  }, { passive: false });

  window.addEventListener("resize", () => {
    if (!root || transitioning || reviewMode) return;
    if (activeRod) applyViewBox(rodViewBox(activeRod));
    else           applyViewBox(overviewViewBox());
  });

  // ── Share ─────────────────────────────────────────────────────────────────

  // Build a self-contained SVG clone of the current mobile at overview zoom,
  // with all CSS inlined (no external stylesheet needed for export).
  function buildShareSvg() {
    // Compute bounds from actual visual (post-tilt) positions, not layout coords.
    const pad  = 60;
    const b    = getVisualBounds();
    const vb   = { vx: b.x1 - pad, vy: b.y1 - pad, vw: b.x2 - b.x1 + 2 * pad, vh: b.y2 - b.y1 + 2 * pad };
    const aspect = vb.vw / vb.vh;
    const W    = 1200, H = Math.round(W / aspect);

    const clone = svg.cloneNode(true);
    clone.removeAttribute("id");
    clone.setAttribute("viewBox",  `${vb.vx} ${vb.vy} ${vb.vw} ${vb.vh}`);
    clone.setAttribute("width",  W);
    clone.setAttribute("height", H);
    clone.setAttribute("xmlns",  "http://www.w3.org/2000/svg");

    // Background rect so PNG isn't transparent
    const bg = document.createElementNS(SVGNS, "rect");
    bg.setAttribute("x", vb.vx);  bg.setAttribute("y", vb.vy);
    bg.setAttribute("width", vb.vw); bg.setAttribute("height", vb.vh);
    bg.setAttribute("fill", "#F4F1EA");
    clone.insertBefore(bg, clone.firstChild);

    // Inline all the class-based styles (resolve CSS vars to literals)
    const style = document.createElementNS(SVGNS, "style");
    style.textContent = [
      ".ln     { fill:none; stroke:#111111; stroke-width:3; stroke-linecap:round; }",
      ".ring   { fill:none; stroke:#111111; stroke-width:2; }",
      ".dot    { fill:#111111; }",
      ".string { fill:none; stroke:#111111; stroke-width:1; opacity:.4; }",
      ".ghost     { display:none; }",
      ".ghost-dot { display:none; }",
      ".lbl-lean { font-family:sans-serif; fill:#111111; font-size:19px; letter-spacing:1px; }",
    ].join("\n");
    clone.insertBefore(style, clone.firstChild);

    return { el: clone, w: W, h: H };
  }

  // Rasterise a self-contained SVG element to a PNG Blob.
  function svgToPngBlob(svgEl, w, h) {
    return new Promise((resolve, reject) => {
      const xml  = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        const canvas  = document.createElement("canvas");
        canvas.width  = w; canvas.height = h;
        const ctx     = canvas.getContext("2d");
        ctx.fillStyle = "#F4F1EA";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(pngBlob => pngBlob ? resolve(pngBlob) : reject(new Error("toBlob failed")), "image/png");
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img load failed")); };
      img.src = url;
    });
  }

  async function doShare() {
    const btn       = document.getElementById("shareDoBtn");
    const origText  = btn.textContent;
    const shareText = `I reached level ${level} on Mobile with a score of ${stats.score}`;
    const shareUrl  = "https://emh.io/mobile";

    btn.textContent = "…";
    btn.disabled    = true;

    try {
      const { el, w, h } = buildShareSvg();
      const pngBlob = await svgToPngBlob(el, w, h);
      const file    = new File([pngBlob], "mobile.png", { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareText, url: shareUrl });
      } else if (navigator.share) {
        await navigator.share({ text: `${shareText}\n${shareUrl}` });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        btn.textContent = "copied!";
        setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
        return;
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        // Last-resort: silently try clipboard
        navigator.clipboard.writeText(`${shareText}\n${shareUrl}`).catch(() => {});
      }
    }
    btn.textContent = origText;
    btn.disabled    = false;
  }

  async function doCopyImage() {
    const btn      = document.getElementById("shareCopyImgBtn");
    const origText = btn.textContent;
    btn.textContent = "…";
    btn.disabled    = true;
    try {
      const { el, w, h } = buildShareSvg();
      // Safari/WebKit (desktop Safari + iOS PWA) requires clipboard.write to be
      // called synchronously within the click gesture. Awaiting the blob first
      // expires the user activation and the write is rejected. Passing a
      // Promise<Blob> as the ClipboardItem value keeps the call synchronous and
      // lets the browser resolve the blob itself.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": svgToPngBlob(el, w, h) }),
      ]);
      btn.textContent = "copied!";
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
      return;
    } catch (err) {
      console.error("Copy image failed:", err);
    }
    btn.textContent = origText;
    btn.disabled    = false;
  }

  function openShareModal() {
    const modal   = document.getElementById("shareModal");
    const preview = document.getElementById("sharePreview");
    const caption = document.getElementById("shareCaption");

    // Show the modal immediately so it's never silently blocked by a preview error.
    caption.textContent = `Level ${level}  ·  Score ${stats.score}`;
    modal.classList.add("show");

    // Build and inject the preview SVG (fails gracefully — modal still shows).
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    try {
      const { el, w, h } = buildShareSvg();
      // Size the clone to the preview container via an explicit aspect-ratio box.
      el.setAttribute("width",  "100%");
      el.setAttribute("height", "100%");
      el.style.aspectRatio = `${w} / ${h}`;
      preview.appendChild(el);
    } catch (err) {
      console.error("Share preview failed:", err);
    }
  }

  // ── Round / level lifecycle ────────────────────────────────────────────────
  function startRound() {
    const first  = getNextUnsettled(root);
    const target = rodViewBox(first);
    const cur    = currentViewBox();
    // If already at the target view (level 1: overview == rodViewBox(root)), start immediately.
    if (Math.abs(cur.vw - target.vw) < 1 && Math.abs(cur.vx - target.vx) < 1) {
      activeRod = first; transitioning = false; return;
    }
    transitioning = true;
    // Brief pause at the overview so the player sees the full mobile, then zoom to first rod.
    setTimeout(() => {
      animateViewBox(currentViewBox(), target, 700, () => {
        activeRod = first; transitioning = false;
      });
    }, 600);
  }

  function newRound() {
    reviewMode     = false;
    isPanning      = false;
    panStart       = null;
    pinchStartDist = 0;
    pinchStartMid  = null;
    pinchStartVb   = null;
    panTouchStart  = null;
    wasMultiTouch  = false;
    touchX         = null;
    fingerDown     = false;
    document.body.classList.remove("review", "panning");
    document.getElementById("stLevel").textContent = level;
    document.getElementById("endBtns").classList.remove("show", "gameover");
    document.getElementById("shareModal").classList.remove("show");
    root = buildLevel(level);
    activeRod = null; ghostLine = null; ghostDot = null; transitioning = false;
    layoutTree(root);
    draw();
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  function renderIntroBest() {
    const el = document.getElementById("introBest");
    if (highScore > 0) { el.innerHTML = `Best Score <b>${highScore}</b>`; el.hidden = false; }
    else el.hidden = true;
  }
  renderIntroBest();

  const intro = document.getElementById("intro");
  intro.addEventListener("click", (e) => {
    if (e.target === intro || e.target.id === "beginBtn") {
      intro.classList.add("hide");
      setTimeout(startRound, 450);
    }
  });
  intro.addEventListener("touchstart", (e) => {
    if (e.target === intro || e.target.id === "beginBtn") {
      intro.classList.add("hide"); e.preventDefault();
      setTimeout(startRound, 450);
    }
  }, { passive: false });

  document.getElementById("shareBtn").addEventListener("click", openShareModal);
  document.getElementById("shareDoBtn").addEventListener("click", doShare);
  document.getElementById("shareCopyImgBtn").addEventListener("click", doCopyImage);
  document.getElementById("shareCloseBtn").addEventListener("click", () => {
    document.getElementById("shareModal").classList.remove("show");
  });
  document.getElementById("shareModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("shareModal")) {
      document.getElementById("shareModal").classList.remove("show");
    }
  });

  document.getElementById("nextLevelBtn").addEventListener("click", () => {
    level += 1;
    newRound();
    startRound();
  });

  document.getElementById("startOverBtn").addEventListener("click", () => {
    stats.score = 0;
    stats.lean  = 0;
    level = 1;
    document.getElementById("stScore").textContent = "—";
    document.getElementById("endBtns").classList.remove("gameover");
    newRound();
    startRound();
  });

  newRound();
})();
