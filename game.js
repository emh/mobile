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

  // ── State ─────────────────────────────────────────────────────────────────────
  let root           = null;
  let level          = 1;
  let activeRod      = null;
  let ghostLine      = null;
  let transitioning  = false;
  let touchX         = null;
  let reviewMode     = false;
  let isPanning      = false;
  let panStart       = null;
  let pinchStartDist = 0;
  let pinchStartVb   = null;
  let panTouchStart  = null;

  const stats = { total: 0 };

  // ── Arm constructors ─────────────────────────────────────────────────────────
  const disc = () => ({ type: "disc", relR: rand(0.14, 0.24) });
  const rod  = (left, right) => ({
    type: "rod", left, right,
    pivotFrac: null, leanDeg: 0,
    cx: 0, cy: 0, span: 0, xL: 0, xR: 0,
    svgGroup: null, outerGroup: null, parentString: null,
  });

  // ── Level generation ─────────────────────────────────────────────────────────
  function buildLevel(n) {
    const root = rod(disc(), disc());
    if (n === 1) return root;
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
      arm.cx     = hangX;
      arm.cy     = hangY;
      arm.radius = clamp(arm.relR * parentSpan, 18, 72);
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
    if (arm.type === "disc") return Math.PI * arm.radius * arm.radius;
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
  function totalScore(arm) {
    if (arm.type === "disc") return 0;
    const own = arm.pivotFrac !== null ? Math.abs(arm.leanDeg) : 0;
    return own + totalScore(arm.left) + totalScore(arm.right);
  }

  function rodCount(arm) {
    if (arm.type === "disc") return 0;
    return 1 + rodCount(arm.left) + rodCount(arm.right);
  }

  // ── Bounding box ─────────────────────────────────────────────────────────────
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
  const mktext = (x, y, str, cls, anc) => {
    const t = S("text", { x, y, class: cls || "txt" }, str);
    if (anc) t.setAttribute("text-anchor", anc);
    return t;
  };
  const ext   = (x1, y1, x2, y2) => mkline(x1, y1, x2, y2, "ext");
  const arrow = (x1, y1, x2, y2) => S("line", {
    x1, y1, x2, y2, class: "dim",
    "marker-start": "url(#arw)", "marker-end": "url(#arw)",
  });

  // ── Defs ─────────────────────────────────────────────────────────────────────
  function buildDefs() {
    const defs = S("defs");
    const pmin = S("pattern", { id: "gmin", width: 28, height: 28,
      patternUnits: "userSpaceOnUse", patternTransform: "translate(0,0)" });
    pmin.appendChild(S("path", { d: "M28 0 H0 V28", class: "grid-min", fill: "none" }));
    const pmaj = S("pattern", { id: "gmaj", width: 140, height: 140,
      patternUnits: "userSpaceOnUse", patternTransform: "translate(0,0)" });
    pmaj.appendChild(S("path", { d: "M140 0 H0 V140", class: "grid-maj", fill: "none" }));
    const arw = S("marker", { id: "arw", markerWidth: 7, markerHeight: 7,
      refX: 6, refY: 3, orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" });
    arw.appendChild(S("path", { d: "M0,0 L6,3 L0,6", fill: "none",
      stroke: "var(--ink-2)", "stroke-width": 1 }));
    defs.append(pmin, pmaj, arw);
    return defs;
  }

  // ── Camera ───────────────────────────────────────────────────────────────────
  function computeViewBox(b, margin) {
    const m      = (margin === undefined) ? 80 : margin;
    const bw     = b.x2 - b.x1 + 2 * m;
    const bh     = b.y2 - b.y1 + 2 * m;
    const aspect = window.innerWidth / window.innerHeight;
    let vw = bw, vh = bh;
    if (bw / bh > aspect) vh = bw / aspect;
    else                   vw = bh * aspect;
    const vx = (b.x1 + b.x2) / 2 - vw / 2;
    const vy = (b.y1 + b.y2) / 2 - vh / 2;
    return { vx, vy, vw, vh };
  }

  function applyViewBox({ vx, vy, vw, vh }) {
    svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  }

  function currentViewBox() {
    const p = svg.getAttribute("viewBox").split(" ").map(Number);
    return { vx: p[0], vy: p[1], vw: p[2], vh: p[3] };
  }

  // Extends bounds to include space for callouts, adapted for screen width.
  function rodViewBox(r) {
    const narrow = window.innerWidth < 560;
    const maxR   = Math.max(
      r.left.type  === "disc" ? r.left.radius  : 0,
      r.right.type === "disc" ? r.right.radius : 0,
    );
    const b = { ...rodBounds(r) };
    if (!narrow) {
      if (r.left.type  === "disc") b.x1 -= r.left.radius  + 80;
      if (r.right.type === "disc") b.x2 += r.right.radius + 80;
    }
    b.y1 -= 56;
    b.y2 += maxR + 56;
    return computeViewBox(b, narrow ? 70 : 24);
  }

  // Computes viewBox based on the rod's actual world-space position at its current leanDeg.
  // Used during/after tilt so the camera tracks the rod as it slides and swings.
  function tiltedRodViewBox(r) {
    const narrow = window.innerWidth < 560;
    const theta  = r.leanDeg * Math.PI / 180;
    const cos    = Math.cos(theta), sin = Math.sin(theta);
    const f      = r.pivotFrac;
    const hangX  = r.cx, cy = r.cy;
    const exL    = hangX - f            * r.span * cos;
    const eyL    = cy    - f            * r.span * sin;
    const exR    = hangX + (1 - f)      * r.span * cos;
    const eyR    = cy    + (1 - f)      * r.span * sin;
    const rL     = r.left.type  === "disc" ? r.left.radius  : 0;
    const rR     = r.right.type === "disc" ? r.right.radius : 0;
    const maxR   = Math.max(rL, rR);
    const b = {
      x1: Math.min(exL, exR) - maxR,
      x2: Math.max(exL, exR) + maxR,
      y1: Math.min(eyL, eyR) - maxR,
      y2: Math.max(eyL, eyR) + maxR,
    };
    if (!narrow) {
      if (r.left.type  === "disc") b.x1 -= rL + 80;
      if (r.right.type === "disc") b.x2 += rR + 80;
    }
    b.y1 -= 56;
    b.y2 += maxR + 56;
    return computeViewBox(b, narrow ? 70 : 24);
  }

  function overviewViewBox() { return computeViewBox(getBounds(root), 80); }

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
    const target = r.leanDeg;
    const hangX  = r.cx;
    const delta  = hangX - (r.xL + r.pivotFrac * r.span);
    const start  = performance.now();
    const DUR    = 1450, decay = 3.2, freq = 7.4;
    function frame(now) {
      const ms = now - start, t = ms / 1000;
      r.leanDeg = ms >= DUR
        ? target
        : target * (1 - Math.exp(-decay * t) * Math.cos(freq * t));
      r.svgGroup.setAttribute("transform",
        `rotate(${r.leanDeg} ${hangX} ${r.cy}) translate(${delta} 0)`);
      propagateTilt(r, 0, 0);
      applyViewBox(tiltedRodViewBox(r));   // keep rod centred as it slides + swings
      if (ms >= DUR) { done(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Recursively shift settled child assemblies so strings stay vertical and fixed-length.
  // shiftX/Y: the offset already on r's outerGroup (from r's own parent's propagation).
  // Strings keep length VGAP by translating children vertically as the parent leans.
  function propagateTilt(r, shiftX, shiftY) {
    if (r.pivotFrac === null) return;
    const ehX = r.cx + shiftX;   // r's effective hang x in world space
    const ehY = r.cy + shiftY;   // r's effective hang y in world space
    const f     = r.pivotFrac;
    const theta = r.leanDeg * Math.PI / 180;
    const cos   = Math.cos(theta), sin = Math.sin(theta);

    [[r.left, -f], [r.right, 1 - f]].forEach(([arm, armFrac]) => {
      if (arm.type !== "rod") return;
      // Arm endpoint world position after this rod's slide + tilt
      const epX = ehX + armFrac * r.span * cos;
      const epY = ehY + armFrac * r.span * sin;
      // Shift child so its hang is directly below epX at a fixed string length (VGAP)
      const csx = epX - arm.cx;
      const csy = epY + VGAP - arm.cy;   // child moves up/down to maintain string length
      if (arm.outerGroup) arm.outerGroup.setAttribute("transform", `translate(${csx} ${csy})`);
      // String: vertical, fixed length VGAP
      if (arm.parentString) {
        arm.parentString.setAttribute("x1", epX);
        arm.parentString.setAttribute("y1", epY);
        arm.parentString.setAttribute("x2", epX);
        arm.parentString.setAttribute("y2", epY + VGAP);
      }
      propagateTilt(arm, csx, csy);
    });
  }

  // ── Dimension callouts ────────────────────────────────────────────────────────
  function discCallout(g, cx, cy, radius, w, dir) {
    const dx  = cx + dir * (radius + 28);
    const anc = dir < 0 ? "end" : "start";
    const tx  = dx + dir * 10;
    g.append(ext(cx, cy - radius, dx, cy - radius),
             ext(cx, cy + radius, dx, cy + radius));
    g.appendChild(arrow(dx, cy - radius, dx, cy + radius));
    g.appendChild(mktext(tx, cy - 5,  "⌀ " + R(2 * radius), "txt",   anc));
    g.appendChild(mktext(tx, cy + 18, "W " + R(w / 100),     "txt-d", anc));
  }

  function rodArmCallout(g, ex, cy, w, dir) {
    const tx  = ex + dir * 12;
    const anc = dir < 0 ? "end" : "start";
    g.appendChild(mktext(tx, cy - 5, "W " + R(w / 100), "txt-d", anc));
  }

  function addArmLengthDims(g, r) {
    const { xL, xR, cy } = r;
    const pivX = r.xL + r.pivotFrac * r.span;
    const maxR = Math.max(
      r.left.type  === "disc" ? r.left.radius  : 0,
      r.right.type === "disc" ? r.right.radius : 0,
    );
    const dy = cy + maxR + 48;
    g.append(ext(xL,   cy, xL,   dy),
             ext(pivX, cy, pivX, dy),
             ext(xR,   cy, xR,   dy));
    g.appendChild(arrow(xL,   dy, pivX, dy));
    g.appendChild(arrow(pivX, dy, xR,   dy));
    g.appendChild(mktext((xL + pivX) / 2, dy - 10, String(R(pivX - xL)), "txt", "middle"));
    g.appendChild(mktext((pivX + xR) / 2, dy - 10, String(R(xR - pivX)), "txt", "middle"));
  }

  function addGroundDims(r) {
    const g     = r.outerGroup;                      // follows parent-shift; stays horizontal
    const { cy } = r;
    const hangX  = r.cx;
    const f      = r.pivotFrac;
    const sxL    = hangX - f * r.span;
    const sxR    = hangX + (1 - f) * r.span;
    const wL     = getSubtreeWeight(r.left);
    const wR     = getSubtreeWeight(r.right);
    const idealX = (wL * sxL + wR * sxR) / (wL + wR);
    const pivX   = hangX;
    const gap    = Math.abs(pivX - idealX);

    g.appendChild(mktext(idealX, cy + 58, "ideal", "txt-d", "middle"));
    g.appendChild(S("line", {
      x1: idealX, y1: cy + 44, x2: idealX, y2: cy + 3,
      class: "dim", "marker-end": "url(#arw)",
    }));

    if (gap > 3) {
      const dy = cy - 44;
      g.append(ext(pivX,   cy, pivX,   dy),
               ext(idealX, cy, idealX, dy));
      g.appendChild(arrow(pivX, dy, idealX, dy));
      g.appendChild(mktext(
        (pivX + idealX) / 2, dy - 10,
        "Δ " + R(gap), "txt", "middle",
      ));
    }
  }

  // Adds per-rod callouts after tilt. Disc details are skipped on narrow screens.
  function addCallouts(r) {
    const narrow = window.innerWidth < 560;
    if (!narrow) {
      if (r.left.type  === "disc") discCallout(r.svgGroup, r.xL, r.cy, r.left.radius,  getSubtreeWeight(r.left),  -1);
      else                          rodArmCallout(r.svgGroup, r.xL, r.cy, getSubtreeWeight(r.left),  -1);
      if (r.right.type === "disc") discCallout(r.svgGroup, r.xR, r.cy, r.right.radius, getSubtreeWeight(r.right), +1);
      else                          rodArmCallout(r.svgGroup, r.xR, r.cy, getSubtreeWeight(r.right), +1);
    }
    addArmLengthDims(r.svgGroup, r);
    addGroundDims(r);
  }

  // Lean-angle label above the hang point — lives in outerGroup so it follows parent shifts.
  function addScoreLabel(r) {
    const lean  = Math.abs(r.leanDeg);
    const label = lean < PERFECT ? "0°" : lean.toFixed(1) + "°";
    const cls   = lean < PERFECT ? "txt" : "txt-d";
    r.outerGroup.appendChild(mktext(r.cx, r.cy - 80, label, cls, "middle"));
  }

  // ── Renderer ─────────────────────────────────────────────────────────────────
  function drawRod(g, r) {
    const { xL, xR, cy } = r;
    const lIsDisc = r.left.type  === "disc";
    const rIsDisc = r.right.type === "disc";
    const solidL  = lIsDisc ? xL + r.left.radius  : xL;
    const solidR  = rIsDisc ? xR - r.right.radius : xR;

    if (lIsDisc) g.appendChild(mkline(xL,     cy, solidL, cy, "dash"));
    g.appendChild(       mkline(solidL, cy, solidR, cy, "ln"));
    if (rIsDisc) g.appendChild(mkline(solidR, cy, xR,     cy, "dash"));

    if (lIsDisc) {
      g.appendChild(S("circle", { cx: xL, cy, r: r.left.radius,  class: "ring" }));
      g.appendChild(S("circle", { cx: xL, cy, r: 3,              class: "dot"  }));
    }
    if (rIsDisc) {
      g.appendChild(S("circle", { cx: xR, cy, r: r.right.radius, class: "ring" }));
      g.appendChild(S("circle", { cx: xR, cy, r: 3,              class: "dot"  }));
    }
  }

  function renderTree(root) {
    const gStrings = S("g");
    svg.appendChild(gStrings);
    gStrings.appendChild(mkline(0, root.cy - VGAP * 0.45, 0, root.cy, "string"));

    function walk(arm, hangX, hangY) {
      if (arm.type === "disc") return;
      if (hangX !== null) {
        const str = mkline(hangX, hangY, arm.cx, arm.cy, "string");
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
    svg.appendChild(buildDefs());
    svg.appendChild(S("rect", { x: -9999, y: -9999, width: 19998, height: 19998, fill: "url(#gmin)" }));
    svg.appendChild(S("rect", { x: -9999, y: -9999, width: 19998, height: 19998, fill: "url(#gmaj)" }));
    renderTree(root);
    applyViewBox(overviewViewBox());
  }

  // ── Review mode ───────────────────────────────────────────────────────────────
  function enterReviewMode() {
    reviewMode = true;
    document.body.classList.add("review");

    // Draw score labels on all settled rods
    function walkLabels(arm) {
      if (arm.type === "disc") return;
      if (arm.pivotFrac !== null) addScoreLabel(arm);
      walkLabels(arm.left);
      walkLabels(arm.right);
    }
    walkLabels(root);

    stats.total += totalScore(root);
    document.getElementById("stScore").textContent = stats.total.toFixed(1) + "°";
    document.getElementById("endBtns").classList.add("show");
  }

  // ── Interaction ──────────────────────────────────────────────────────────────
  function clientToWorldX(clientX) {
    const { vx, vw } = currentViewBox();
    return vx + (clientX / window.innerWidth) * vw;
  }

  function addGhost() {
    ghostLine = mkline(0, -9999, 0, 9999, "ghost");
    svg.appendChild(ghostLine);
    updateGhost(window.innerWidth / 2);
  }

  function updateGhost(clientX) {
    if (!ghostLine || !activeRod) return;
    const x = clamp(clientToWorldX(clientX), activeRod.xL, activeRod.xR);
    ghostLine.setAttribute("x1", x);
    ghostLine.setAttribute("x2", x);
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
    const prevDepth = prevRod ? findDepth(root, prevRod) : -1;
    const nextDepth = findDepth(root, next);

    if (prevDepth > nextDepth) {
      // Moving to a shallower level — pause at overview first.
      animateViewBox(currentViewBox(), overviewViewBox(), 650, () => {
        setTimeout(() => {
          animateViewBox(currentViewBox(), rodViewBox(next), 650, () => {
            activeRod = next; transitioning = false; addGhost();
          });
        }, 400);
      });
    } else {
      // Same depth — pan directly.
      animateViewBox(currentViewBox(), rodViewBox(next), 550, () => {
        activeRod = next; transitioning = false; addGhost();
      });
    }
  }

  function onPick(clientX) {
    if (reviewMode || !activeRod || transitioning || activeRod.pivotFrac !== null) return;
    transitioning = true;

    const x = clamp(clientToWorldX(clientX), activeRod.xL, activeRod.xR);
    activeRod.pivotFrac = (x - activeRod.xL) / activeRod.span;
    activeRod.leanDeg   = computeLean(activeRod);

    if (ghostLine) { ghostLine.remove(); ghostLine = null; }

    // String stays vertical — the rod slides to hang below it (handled in animateTilt).
    const settled = activeRod;
    animateTilt(settled, () => {
      addCallouts(settled);
      transitioning = false;
      advance(settled);
    });
  }

  // ── Events ───────────────────────────────────────────────────────────────────
  svg.addEventListener("mousemove", (e) => {
    if (reviewMode) {
      if (isPanning && panStart) {
        const { vx, vy, vw, vh } = panStart.vb;
        const dx = (panStart.x - e.clientX) / window.innerWidth  * vw;
        const dy = (panStart.y - e.clientY) / window.innerHeight * vh;
        applyViewBox({ vx: vx + dx, vy: vy + dy, vw, vh });
      }
      return;
    }
    if (!transitioning) updateGhost(e.clientX);
  });

  svg.addEventListener("mousedown", (e) => {
    if (!reviewMode) return;
    isPanning = true;
    panStart  = { x: e.clientX, y: e.clientY, vb: currentViewBox() };
    document.body.classList.add("panning");
  });

  document.addEventListener("mouseup", () => {
    if (isPanning) {
      isPanning = false;
      panStart  = null;
      document.body.classList.remove("panning");
    }
  });

  svg.addEventListener("click", (e) => {
    if (!reviewMode && !transitioning) onPick(e.clientX);
  });

  svg.addEventListener("wheel", (e) => {
    if (!reviewMode) return;
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
    if (reviewMode) {
      e.preventDefault();
      if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        pinchStartVb   = currentViewBox();
        panTouchStart  = null;
      } else {
        panTouchStart  = { x: e.touches[0].clientX, y: e.touches[0].clientY, vb: currentViewBox() };
        pinchStartDist = 0;
      }
      return;
    }
    if (transitioning || !activeRod) return;
    e.preventDefault();
    touchX = e.touches[0].clientX; updateGhost(touchX);
  }, { passive: false });

  svg.addEventListener("touchmove", (e) => {
    if (reviewMode) {
      e.preventDefault();
      if (e.touches.length === 2 && pinchStartDist && pinchStartVb) {
        const t0   = e.touches[0], t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const scale = pinchStartDist / dist;
        const { vx, vy, vw, vh } = pinchStartVb;
        const wx = vx + (midX / window.innerWidth)  * vw;
        const wy = vy + (midY / window.innerHeight) * vh;
        const newVw = clamp(vw * scale, 100, 8000);
        const newVh = clamp(vh * scale, 100, 8000);
        applyViewBox({
          vx: wx - (midX / window.innerWidth)  * newVw,
          vy: wy - (midY / window.innerHeight) * newVh,
          vw: newVw, vh: newVh,
        });
      } else if (e.touches.length === 1 && panTouchStart) {
        const { vx, vy, vw, vh } = panTouchStart.vb;
        const dx = (panTouchStart.x - e.touches[0].clientX) / window.innerWidth  * vw;
        const dy = (panTouchStart.y - e.touches[0].clientY) / window.innerHeight * vh;
        applyViewBox({ vx: vx + dx, vy: vy + dy, vw, vh });
      }
      return;
    }
    if (transitioning || !activeRod) return;
    e.preventDefault();
    touchX = e.touches[0].clientX; updateGhost(touchX);
  }, { passive: false });

  svg.addEventListener("touchend", (e) => {
    if (reviewMode) {
      if (e.touches.length < 2) { pinchStartDist = 0; pinchStartVb = null; }
      if (e.touches.length === 0) panTouchStart = null;
      return;
    }
    if (transitioning || !activeRod || touchX == null) return;
    e.preventDefault();
    onPick(touchX); touchX = null;
  }, { passive: false });

  window.addEventListener("resize", () => {
    if (!root || transitioning || reviewMode) return;
    if (activeRod) applyViewBox(rodViewBox(activeRod));
    else           applyViewBox(overviewViewBox());
  });

  // ── Round / level lifecycle ────────────────────────────────────────────────
  function startRound() {
    transitioning = true;
    const first = getNextUnsettled(root);
    animateViewBox(currentViewBox(), rodViewBox(first), 700, () => {
      activeRod = first; transitioning = false; addGhost();
    });
  }

  function newRound() {
    reviewMode     = false;
    isPanning      = false;
    panStart       = null;
    pinchStartDist = 0;
    pinchStartVb   = null;
    panTouchStart  = null;
    touchX         = null;
    document.body.classList.remove("review", "panning");
    document.getElementById("stLevel").textContent = level;
    document.getElementById("endBtns").classList.remove("show");
    root = buildLevel(level);
    activeRod = null; ghostLine = null; transitioning = false;
    layoutTree(root);
    draw();
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
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

  document.getElementById("nextLevelBtn").addEventListener("click", () => {
    level += 1;
    newRound();
    startRound();
  });

  document.getElementById("startOverBtn").addEventListener("click", () => {
    stats.total = 0;
    level = 1;
    document.getElementById("stScore").textContent = "—";
    newRound();
    startRound();
  });

  newRound();
})();
