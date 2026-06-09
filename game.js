(() => {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("sheet");

  const R = Math.round;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand  = (a, b) => a + Math.random() * (b - a);

  const MAXA    = 20;    // degrees of lean at worst placement
  const PERFECT = 0.4;  // below this counts as a clean balance

  // ---- state ----------------------------------------------------------------
  let round     = null;  // { fracL, fracR, radL, radR }
  let pivotFrac = null;  // chosen fulcrum as fraction of width
  let resolved  = false;
  let animating = false;
  const stats = { rounds: 0, sum: 0, best: Infinity };

  // ---- tiny SVG builder -----------------------------------------------------
  function S(tag, attrs, ...kids) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    for (const kid of kids) e.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    return e;
  }
  const line  = (x1, y1, x2, y2, cls) => S("line", { x1, y1, x2, y2, class: cls });
  const text  = (x, y, str, cls, anchor) => {
    const t = S("text", { x, y, class: cls || "txt" }, str);
    if (anchor) t.setAttribute("text-anchor", anchor);
    return t;
  };
  const ext   = (x1, y1, x2, y2) => line(x1, y1, x2, y2, "ext");
  const arrow = (x1, y1, x2, y2) => S("line", { x1, y1, x2, y2, class: "dim", "marker-start": "url(#arw)", "marker-end": "url(#arw)" });

  // ---- geometry from current viewport ---------------------------------------
  function metrics() {
    const W = window.innerWidth, H = window.innerHeight, midY = H / 2;
    let xL = round.fracL * W, xR = round.fracR * W;
    const rMax = (xR - xL) * 0.40;
    let rL = Math.min(round.radL * Math.min(W, H), rMax);
    let rR = Math.min(round.radR * Math.min(W, H), rMax);

    // Shrink assembly so outer callouts stay on-screen on narrow viewports
    const PAD = 15, GAP = 24, OFF = 8, CHARW = 9, ROT = 12;
    const dig  = n => String(Math.round(n)).length;
    const foot = r => GAP + OFF + (2 + Math.max(dig(2 * r), dig(Math.PI * r * r / 100))) * CHARW + ROT;
    const cx = W / 2;
    const s = Math.min(1,
      (cx - PAD - foot(rL)) / ((cx - xL) + rL),
      (cx - PAD - foot(rR)) / ((xR - cx) + rR));
    if (s < 1 && s > 0) { xL = cx + (xL - cx) * s; xR = cx + (xR - cx) * s; rL *= s; rR *= s; }

    const span = xR - xL;
    const wL = Math.PI * rL * rL, wR = Math.PI * rR * rR;
    const idealX = (wL * xL + wR * xR) / (wL + wR);
    const o = { W, H, midY, xL, xR, rL, rR, wL, wR, idealX, maxR: Math.max(rL, rR) };
    if (pivotFrac != null) {
      const px = pivotFrac * W;
      const net = wR * (xR - px) - wL * (px - xL);
      const maxMag = Math.max(wL, wR) * span;
      o.px = px;
      o.leanDeg = MAXA * net / maxMag;
      o.gap = px - idealX;
    }
    return o;
  }

  // ---- defs (grid pattern + arrowhead) -------------------------------------
  function buildDefs(midY, cx) {
    const defs = S("defs");
    const pmin = S("pattern", { id: "gmin", width: 28, height: 28, patternUnits: "userSpaceOnUse",
                                patternTransform: `translate(${cx % 28}, ${midY % 28})` });
    pmin.appendChild(S("path", { d: "M28 0 H0 V28", class: "grid-min", fill: "none" }));
    const pmaj = S("pattern", { id: "gmaj", width: 140, height: 140, patternUnits: "userSpaceOnUse",
                                patternTransform: `translate(${cx % 140}, ${midY % 140})` });
    pmaj.appendChild(S("path", { d: "M140 0 H0 V140", class: "grid-maj", fill: "none" }));
    const arw = S("marker", { id: "arw", markerWidth: 11, markerHeight: 11, refX: 8.5, refY: 3,
                               orient: "auto-start-reverse", markerUnits: "userSpaceOnUse" });
    arw.appendChild(S("path", { d: "M0,0 L8.5,3 L0,6", fill: "none", stroke: "var(--ink-2)", "stroke-width": 1 }));
    defs.append(pmin, pmaj, arw);
    return defs;
  }

  // ---- fulcrum triangle path ------------------------------------------------
  const triPath = (x, y) => `M${x} ${y} L${x - 15} ${y + 24} L${x + 15} ${y + 24} Z`;

  // ---- main render ----------------------------------------------------------
  function draw() {
    const g = metrics();
    const { W, H, midY } = g;

    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);

    svg.appendChild(buildDefs(midY, (g.xL + g.xR) / 2));
    svg.appendChild(S("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#gmin)" }));
    svg.appendChild(S("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#gmaj)" }));
    svg.appendChild(S("rect", { x: 14, y: 14, width: W - 28, height: H - 28, class: "frame", rx: 2 }));
    svg.appendChild(line(40, midY, W - 40, midY, "baseline"));

    // rotating assembly: rod + circles + centre dots
    const asm = S("g", { id: "assembly" });
    const innerL = g.xL + g.rL, innerR = g.xR - g.rR;
    asm.appendChild(line(g.xL, midY, innerL, midY, "dash"));
    asm.appendChild(line(innerL, midY, innerR, midY, "ln"));
    asm.appendChild(line(innerR, midY, g.xR, midY, "dash"));
    asm.appendChild(S("circle", { cx: g.xL, cy: midY, r: g.rL, class: "ring" }));
    asm.appendChild(S("circle", { cx: g.xR, cy: midY, r: g.rR, class: "ring" }));
    asm.appendChild(S("circle", { cx: g.xL, cy: midY, r: 3, class: "dot" }));
    asm.appendChild(S("circle", { cx: g.xR, cy: midY, r: 3, class: "dot" }));

    if (resolved) {
      asm.setAttribute("transform", `rotate(${g.leanDeg} ${g.px} ${midY})`);
      addAttachedDims(asm, g);
    }
    svg.appendChild(asm);

    if (pivotFrac != null) {
      svg.appendChild(S("path", { d: triPath(g.px, midY), class: "tri" }));
      if (resolved) addGroundDims(g);
    } else {
      svg.appendChild(line(0, 0, 0, 0, "ghost"));
      svg.lastChild.id = "ghost";
    }
  }

  // dimensions glued to the assembly (local space is un-rotated) -------------
  function addAttachedDims(asm, g) {
    const { midY, xL, xR, rL, rR, px, maxR } = g;

    sizeCallout(asm, xL, midY, rL, g.wL, -1);
    sizeCallout(asm, xR, midY, rR, g.wR, +1);

    const dy = midY + maxR + 38;
    asm.append(ext(xL, midY, xL, dy), ext(px, midY, px, dy), ext(xR, midY, xR, dy));
    asm.appendChild(arrow(xL, dy, px, dy));
    asm.appendChild(arrow(px, dy, xR, dy));
    asm.appendChild(text((xL + px) / 2, dy - 8, String(R(px - xL)), "txt", "middle"));
    asm.appendChild(text((px + xR) / 2, dy - 8, String(R(xR - px)), "txt", "middle"));
  }

  function sizeCallout(asm, cx, cy, r, w, dir) {
    const dx = cx + dir * (r + 24);
    asm.append(ext(cx, cy - r, dx, cy - r), ext(cx, cy + r, dx, cy + r));
    asm.appendChild(arrow(dx, cy - r, dx, cy + r));
    const tx = dx + dir * 8, anc = dir < 0 ? "end" : "start";
    asm.appendChild(text(tx, cy - 3, "⌀ " + R(2 * r), "txt", anc));
    asm.appendChild(text(tx, cy + 17, "W " + R(w / 100), "txt-d", anc));
  }

  // ground-space dimensions: ideal fulcrum + offset from chosen one ----------
  function addGroundDims(g) {
    const { midY, px, idealX, gap } = g;
    svg.appendChild(S("path", { d: triPath(idealX, midY), class: "tri-ghost" }));
    svg.appendChild(text(idealX, midY + 40, "ideal", "txt-d", "middle"));

    const dy = midY - 34;
    svg.append(ext(px, midY, px, dy), ext(idealX, midY, idealX, dy));
    svg.appendChild(arrow(px, dy, idealX, dy));
    svg.appendChild(text((px + idealX) / 2, dy - 8, "Δ " + R(Math.abs(gap)), "txt", "middle"));
  }

  // ---- damped settle animation ---------------------------------------------
  function animateTilt(target, px, py, done) {
    const asm = document.getElementById("assembly");
    const start = performance.now();
    const DUR = 1450, decay = 3.2, freq = 7.4;
    function frame(now) {
      const ms = now - start, t = ms / 1000;
      const a = ms >= DUR ? target : target * (1 - Math.exp(-decay * t) * Math.cos(freq * t));
      asm.setAttribute("transform", `rotate(${a} ${px} ${py})`);
      if (ms >= DUR) { done(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- interaction ----------------------------------------------------------
  function onPick(clientX) {
    if (resolved || animating || !round) return;
    const g0 = metrics();
    const px = clamp(clientX, g0.xL, g0.xR);
    pivotFrac = px / g0.W;

    draw();
    const g = metrics();
    animating = true;
    animateTilt(g.leanDeg, g.px, g.midY, () => {
      animating = false;
      resolved  = true;
      document.body.classList.add("resolved");
      recordScore(Math.abs(g.leanDeg));
      draw();
      showResult(Math.abs(g.leanDeg));
    });
  }

  function recordScore(lean) {
    stats.rounds += 1;
    stats.sum    += lean;
    stats.best    = Math.min(stats.best, lean);
    document.getElementById("stRounds").textContent = stats.rounds;
    document.getElementById("stBest").textContent   = stats.best.toFixed(1) + "°";
    document.getElementById("stAvg").textContent    = (stats.sum / stats.rounds).toFixed(1) + "°";
  }

  function showResult(lean) {
    const balanced = lean < PERFECT;
    document.getElementById("resRound").textContent   = stats.rounds;
    document.getElementById("resScore").textContent   = balanced ? "0.0" : lean.toFixed(1);
    document.getElementById("resVerdict").textContent = balanced ? "balanced" : "lean";
    document.getElementById("resRounds").textContent  = stats.rounds;
    document.getElementById("resBest").textContent    = stats.best.toFixed(1) + "°";
    document.getElementById("resAvg").textContent     = (stats.sum / stats.rounds).toFixed(1) + "°";
    document.getElementById("round-result").classList.add("show");
  }

  function newRound() {
    round = {
      fracL: rand(0.21, 0.28),
      fracR: rand(0.72, 0.79),
      radL:  rand(0.045, 0.085),
      radR:  rand(0.045, 0.085),
    };
    pivotFrac = null;
    resolved  = false;
    animating = false;
    document.body.classList.remove("resolved");
    document.getElementById("round-result").classList.remove("show");
    draw();
  }

  // ---- events ---------------------------------------------------------------
  svg.addEventListener("click", (e) => onPick(e.clientX));
  svg.addEventListener("mousemove", (e) => {
    if (resolved || animating || pivotFrac != null) return;
    updateGhost(e.clientX);
  });
  let touchX = null;

  function updateGhost(clientX) {
    const ghost = document.getElementById("ghost");
    if (!ghost) return;
    const g = metrics();
    const x = clamp(clientX, g.xL, g.xR);
    ghost.setAttribute("x1", x); ghost.setAttribute("x2", x);
    ghost.setAttribute("y1", 20); ghost.setAttribute("y2", g.H - 20);
  }

  svg.addEventListener("touchstart", (e) => {
    if (resolved || animating || pivotFrac != null) return;
    e.preventDefault();
    touchX = e.touches[0].clientX;
    updateGhost(touchX);
  }, { passive: false });

  svg.addEventListener("touchmove", (e) => {
    if (resolved || animating || pivotFrac != null) return;
    e.preventDefault();
    touchX = e.touches[0].clientX;
    updateGhost(touchX);
  }, { passive: false });

  svg.addEventListener("touchend", (e) => {
    if (resolved || animating || pivotFrac != null || touchX == null) return;
    e.preventDefault();
    onPick(touchX);
    touchX = null;
  }, { passive: false });

  document.getElementById("playAgainBtn").addEventListener("click", newRound);
  window.addEventListener("resize", () => { if (round) draw(); });

  // ---- intro overlay --------------------------------------------------------
  const intro = document.getElementById("intro");
  const dismissIntro = () => intro.classList.add("hide");
  intro.addEventListener("click", (e) => {
    if (e.target === intro || e.target.id === "beginBtn") dismissIntro();
  });
  intro.addEventListener("touchstart", (e) => {
    if (e.target === intro || e.target.id === "beginBtn") { dismissIntro(); e.preventDefault(); }
  }, { passive: false });

  newRound();
})();
