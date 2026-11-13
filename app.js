"use strict";
/* Scale – app personale. Tutti i dati restano in questo browser (localStorage).
   Nessuna richiesta di rete verso altri siti: vedi la Content-Security-Policy in index.html. */

/* ============ utilità ============ */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(msg, ms = 2200) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), ms); }
function norm(s) {
  return String(s || "").replace(/['’`´]/g, "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ").trim();
}
function fixTok(t) { // errori tipici dell'OCR dentro le parole
  if (/[A-Z]/.test(t) && /[0-9]/.test(t) && !/^\d+[A-Z]?$/.test(t)) return t.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
  return t;
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i; const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);
const natCmp = (a, b) => String(a || "").localeCompare(String(b || ""), "it", { numeric: true, sensitivity: "base" });
const slug = (via, civ) => "civ_" + (norm(via) + " " + norm(civ)).trim().replace(/ /g, "-");
function siLabel(r) { const p = []; if (r.scala) p.push("Scala " + esc(r.scala)); if (r.interno) p.push("Int. " + esc(r.interno)); return p.length ? p.join(" · ") : "—"; }
function titleVia(s) {
  const small = new Set(["di", "del", "della", "dei", "degli", "delle", "de"]);
  return s.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && small.has(w)) ? w : (/^[ivxlc]+$/.test(w) && w.length > 1 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

/* ============ dati (solo su questo telefono) ============ */
const LS_KEY = "scale.live.v1";
let data = { civici: {} };
function loadLocal() { try { const d = JSON.parse(localStorage.getItem(LS_KEY) || "null"); if (d && d.civici) data = d; } catch (e) { } }
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { toast("Memoria del telefono piena: fai un backup"); } }
const civList = () => Object.values(data.civici);
function touch(c) { c.updatedAt = Date.now(); data.civici[c.id] = c; saveLocal(); rebuildIndex(); renderStats(); }
function getOrCreateCiv(via, civico) {
  via = via.trim().replace(/\s+/g, " "); civico = civico.trim().toUpperCase().replace(/\s+/g, "");
  const id = slug(via, civico);
  if (!data.civici[id]) data.civici[id] = { id, via, civico, codice: "", zona: "", residenti: [], updatedAt: Date.now() };
  return data.civici[id];
}

/* ============ indice per riconoscere i nomi ============ */
const STOP = new Set(["SIG", "SIGRA", "SIGNOR", "SIGNORA", "SIGG", "DOTT", "DOTTSSA", "DOTTOR", "DR", "DOTTORESSA", "ING", "AVV", "PROF", "PROFSSA", "RAG", "GEOM", "FAM", "FAMIGLIA", "PRESSO", "CO", "SPETT", "SPETTLE", "GENTILE", "GENTMO", "GENTMA", "GENTLE", "EGR", "EGREGIO", "STUDIO", "TUTTA", "LA", "SCALA"]);
const VIA_GEN = new Set(["VIA", "VIALE", "VLE", "PIAZZA", "PZA", "PZZA", "PIAZZALE", "LARGO", "LGO", "VICOLO", "CORSO", "CIRCONVALLAZIONE", "CIRC", "LUNGOTEVERE", "SALITA", "BORGO", "DEL", "DELLA", "DELLE", "DEI", "DEGLI", "DI", "DE", "LA", "IL", "LE"]);
const ADDR_RE = /\b(VIA|VIALE|V LE|VLE|PIAZZA|P ZZA|PZA|PIAZZALE|LARGO|CORSO|VICOLO|CIRCONVALLAZIONE|LUNGOTEVERE|STRADA|LOCALITA|ROMA|RM|ITALIA|CAP|INT|SC|SCALA|PIANO)\b|\b\d{5}\b/;
let INDEX = [];
const nameTokens = nome => norm(nome).split(" ").filter(t => t && !STOP.has(t));
function civNums(civico) {
  const c = norm(civico).replace(/ /g, "");
  const m = String(civico).match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) { const s = new Set(); for (let i = +m[1]; i <= +m[2] && i - +m[1] < 40; i++) s.add(String(i)); return s; }
  return new Set([c]);
}
function rebuildIndex() {
  INDEX = [];
  for (const c of civList()) {
    const viaT = norm(c.via).split(" ").filter(t => t.length >= 3 && !VIA_GEN.has(t));
    const nums = civNums(c.civico);
    for (const r of c.residenti || []) {
      const toks = nameTokens(r.nome); if (!toks.length) continue;
      INDEX.push({ c, r, toks, joined: toks.join(""), viaT, nums });
    }
  }
}
function bestSim(t, pool) {
  let best = 0;
  for (const o of pool) {
    if (Math.abs(o.length - t.length) > 2) continue;
    const s = o === t ? 1 : sim(t, o); if (s > best) { best = s; if (s === 1) break; }
  }
  return best;
}
function tokenize(lines) {
  const toks = [], singles = new Set();
  for (const ln of lines) {
    const ts = ln.split(" ").map(fixTok);
    ts.forEach((t, i) => {
      if (t.length === 1 && /[A-Z]/.test(t)) singles.add(t); else if (t.length >= 2) toks.push(t);
      if (i < ts.length - 1 && t.length >= 2 && ts[i + 1].length >= 2) toks.push(t + ts[i + 1]);
    });
  }
  return { pool: [...new Set(toks)], singles };
}
function matchText(text) {
  const lines = String(text || "").split(/\n+/).map(norm).filter(l => l.length >= 2);
  // le righe dell'indirizzo (via, CAP, Roma) non devono essere scambiate per nomi
  const addrLines = lines.filter(l => ADDR_RE.test(l));
  let nameLines = lines.filter(l => !ADDR_RE.test(l));
  if (!nameLines.length) nameLines = lines;
  const N = tokenize(nameLines), A = tokenize(addrLines.length ? addrLines : lines);
  const pool = N.pool, singles = N.singles;
  const nums = new Set(A.pool.filter(t => /^\d{1,4}[A-Z]?$/.test(t)).map(t => t.replace(/[A-Z]$/, "")).concat(A.pool.filter(t => /^\d{1,4}[A-Z]?$/.test(t))));
  const out = [];
  if (!pool.length) return out;
  for (const e of INDEX) {
    let tot = 0, got = 0, strong = false, surnameSim = 0, nGood = 0;
    e.toks.forEach((t, i) => {
      const w = Math.max(1, t.length); tot += w;
      let s;
      if (t.length === 1) s = singles.has(t) || pool.some(o => o.length >= 3 && o[0] === t && /^[A-Z]+$/.test(o)) ? 1 : 0;
      else if (t.length === 2) s = pool.includes(t) ? 1 : 0;
      else { s = bestSim(t, pool); if (s < (t.length >= 5 ? 0.7 : 0.75)) s = 0; }
      if (!s && t.length > 1 && singles.has(t[0])) s = 0.6;
      if (s >= 0.8 && t.length >= 3) strong = true;
      if (i === 0) surnameSim = s;
      if (s >= 0.8) nGood++;
      got += w * s;
    });
    let score = tot ? got / tot : 0;
    if (e.toks.length > 1) { const js = bestSim(e.joined, pool); if (js >= 0.85) { score = Math.max(score, js); strong = true; } }
    if (surnameSim >= 0.85 && e.toks[0].length >= 4) score = Math.max(score, 0.62);
    if (!strong || score < 0.6) continue;
    const viaHit = e.viaT.length ? e.viaT.filter(v => bestSim(v, A.pool) >= 0.8).length / e.viaT.length : 0;
    let civHit = 0; for (const n of e.nums) if (nums.has(n)) { civHit = 1; break; }
    const total = score + 0.03 * nGood + 0.3 * viaHit + (civHit ? (viaHit > 0 ? 0.3 : 0.05) : 0);
    out.push({ e, score, total, viaHit, civHit });
  }
  out.sort((a, b) => b.total - a.total);
  return out.slice(0, 6);
}
function searchName(q) {
  const qn = norm(q); if (qn.length < 2) return [];
  const qt = qn.split(" "); const res = [];
  for (const e of INDEX) {
    let s = 0;
    if (qt.every(x => e.toks.some(t => t.startsWith(x)))) s = 2;
    else if (e.toks.join(" ").includes(qn)) s = 1.5;
    else if (qn.length >= 4) { const b = Math.max(0, ...e.toks.map(t => sim(qt[0], t.slice(0, qt[0].length)))); if (b >= 0.75) s = b; }
    if (s) res.push({ e, s });
  }
  res.sort((a, b) => b.s - a.s || natCmp(a.e.r.nome, b.e.r.nome));
  return res.slice(0, 50);
}

/* ============ lettore (Tesseract, gira sul telefono) ============ */
const ocr = { worker: null, ready: false, p: null };
function setOcrChip(t, cls) { const c = $("#ocrChip"); c.textContent = t; c.className = "chip " + (cls || ""); }
function initOcr() {
  if (ocr.p) return ocr.p;
  ocr.p = (async () => {
    setOcrChip("Lettore: carico…");
    const base = document.baseURI;
    const w = await Tesseract.createWorker("ita", 1, {
      workerPath: new URL("vendor/worker.min.js", base).href,
      corePath: new URL("vendor/core/", base).href,
      langPath: new URL("vendor/lang", base).href,
      workerBlobURL: false, cacheMethod: "none", gzip: true,
    });
    await w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    ocr.worker = w; ocr.ready = true; setOcrChip("Lettore pronto", "ok");
    return w;
  })().catch(e => { console.error(e); ocr.p = null; setOcrChip("Lettore: errore", "warn"); throw e; });
  return ocr.p;
}

/* ============ fotocamera dal vivo ============ */
const cam = { stream: null, track: null, paused: false, loop: false, torch: false };
const video = $("#video");
function camMsg(t) { const m = $("#camMsg"); if (t) { m.innerHTML = t; m.classList.remove("hidden"); } else m.classList.add("hidden"); }
async function startCam() {
  if (cam.stream || document.hidden || !$("#v-scan").classList.contains("on")) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camMsg("Questo browser non permette di usare la fotocamera. Apri l'app con Chrome."); return; }
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
    if (document.hidden || !$("#v-scan").classList.contains("on")) { stopCam(); return; }
    video.srcObject = cam.stream; await video.play().catch(() => { });
    cam.track = cam.stream.getVideoTracks()[0];
    const caps = cam.track.getCapabilities ? cam.track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes("continuous")) cam.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => { });
    $("#torchBtn").classList.toggle("hidden", !caps.torch);
    camMsg(INDEX.length ? "" : "L'elenco è vuoto: carica prima i nomi da <b>⚙️ Altro</b>.");
    runLoop();
  } catch (e) {
    cam.stream = null;
    camMsg(e && e.name === "NotAllowedError" ? "Permesso fotocamera negato.<br>Tocca il lucchetto accanto all'indirizzo → Autorizzazioni → Fotocamera → Consenti, poi ricarica." : "Non riesco ad aprire la fotocamera (" + esc(e && e.name || "errore") + ").");
  }
}
function stopCam() {
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null; cam.track = null; cam.torch = false; $("#torchBtn").classList.remove("on");
}
$("#pauseBtn").onclick = () => { cam.paused = !cam.paused; $("#pauseBtn").textContent = cam.paused ? "▶" : "⏸"; $("#pauseBtn").classList.toggle("on", cam.paused); if (cam.paused) video.pause(); else video.play().catch(() => { }); };
$("#torchBtn").onclick = async () => { if (!cam.track) return; cam.torch = !cam.torch; try { await cam.track.applyConstraints({ advanced: [{ torch: cam.torch }] }); $("#torchBtn").classList.toggle("on", cam.torch); } catch (e) { cam.torch = false; } };
document.addEventListener("visibilitychange", () => { if (document.hidden) stopCam(); else startCam(); });

// ritaglia dal video la zona del riquadro giallo
const frameCv = document.createElement("canvas");
function grabBox() {
  const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
  const camEl = $("#cam"), boxEl = $("#box");
  const cw = camEl.clientWidth, ch = camEl.clientHeight;
  const sc = Math.max(cw / vw, ch / vh), ox = (cw - vw * sc) / 2, oy = (ch - vh * sc) / 2;
  const sx = Math.max(0, (boxEl.offsetLeft - ox) / sc), sy = Math.max(0, (boxEl.offsetTop - oy) / sc);
  const sw = Math.min(vw - sx, boxEl.offsetWidth / sc), sh = Math.min(vh - sy, boxEl.offsetHeight / sc);
  if (!(sw > 20 && sh > 20)) return null;
  const k = Math.min(1, 1200 / sw);
  frameCv.width = Math.round(sw * k); frameCv.height = Math.round(sh * k);
  const g = frameCv.getContext("2d", { willReadFrequently: true });
  g.drawImage(video, sx, sy, sw, sh, 0, 0, frameCv.width, frameCv.height);
  const id = g.getImageData(0, 0, frameCv.width, frameCv.height), d = id.data; let mn = 255, mx = 0;
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; d[i] = y; if (y < mn) mn = y; if (y > mx) mx = y; }
  const lo = mn + (mx - mn) * 0.1, hi = mx - (mx - mn) * 0.1, kk = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * kk)); d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(id, 0, 0);
  return frameCv;
}
const seen = { key: null, n: 0, shown: null };
async function runLoop() {
  if (cam.loop) return; cam.loop = true;
  try { await initOcr(); } catch (e) { cam.loop = false; camMsg("Il lettore non si è avviato. Controlla la connessione e ricarica la pagina (serve solo la prima volta)."); return; }
  while (cam.stream) {
    if (!cam.paused && video.readyState >= 2 && INDEX.length) {
      try { const cv = grabBox(); if (cv) { const r = await ocr.worker.recognize(cv); onText(r.data.text || ""); } }
      catch (e) { console.warn(e); await sleep(300); }
    }
    await sleep(80);
  }
  cam.loop = false;
}
function onText(text) {
  $("#ocrTxt").textContent = text.trim();
  const res = matchText(text);
  const b = res[0];
  if (!b || b.score < 0.7) { seen.key = null; seen.n = 0; return; }
  const key = b.e.c.id + "|" + b.e.r.id;
  if (key === seen.key) seen.n++; else { seen.key = key; seen.n = 1; }
  const sure = b.score >= 0.95 && b.viaHit > 0 && b.civHit;
  if (seen.n >= 2 || sure) {
    if (key !== seen.shown) { seen.shown = key; if (navigator.vibrate) navigator.vibrate(60); }
    showResult(res);
  }
}
function showResult(res) {
  const b = res[0];
  const rivali = res.slice(1).filter(x => x.total >= b.total - 0.1 && (x.e.r.scala !== b.e.r.scala || x.e.r.interno !== b.e.r.interno || x.e.c.id !== b.e.c.id));
  const altri = res.slice(1).filter(x => x.total >= b.total * 0.8).slice(0, 3);
  const box = $("#result");
  box.className = "result " + (rivali.length ? "warn" : "ok");
  box.innerHTML = `<div class="nm">${esc(b.e.r.nome)}</div>
    <div class="si">${b.e.r.scala ? `<span>Scala ${esc(b.e.r.scala)}</span>` : ""}${b.e.r.interno ? `<span>Int. ${esc(b.e.r.interno)}</span>` : ""}${!b.e.r.scala && !b.e.r.interno ? "—" : ""}</div>
    <div class="where">${esc(b.e.c.via)} ${esc(b.e.c.civico)}${b.e.r.note ? " · " + esc(b.e.r.note) : ""}</div>
    ${b.e.c.codice ? `<div style="margin-top:4px">🔑 <b>${esc(b.e.c.codice)}</b></div>` : ""}
    ${rivali.length ? `<div style="margin-top:6px;color:var(--warn);font-weight:700">⚠️ Nomi simili, controlla:</div>` : ""}
    ${altri.length ? `<div style="margin-top:6px">${altri.map(x => `<div class="alt"><div><b>${esc(x.e.r.nome)}</b><br><span class="small mute">${esc(x.e.c.via)} ${esc(x.e.c.civico)}</span></div><div class="tag">${siLabel(x.e.r)}</div></div>`).join("")}</div>` : ""}`;
  $("#box").classList.add("hit"); clearTimeout(showResult._t); showResult._t = setTimeout(() => $("#box").classList.remove("hit"), 700);
}

/* ============ cerca ============ */
function runSearch() {
  const q = $("#q").value, box = $("#searchRes");
  if (norm(q).length < 2) { box.innerHTML = `<div class="empty">Scrivi almeno 2 lettere.</div>`; return; }
  const r = searchName(q);
  box.innerHTML = r.length ? r.map(x => `<div class="alt"><div><b>${esc(x.e.r.nome)}</b><br><span class="small mute">${esc(x.e.c.via)} ${esc(x.e.c.civico)}${x.e.c.codice ? " · 🔑 " + esc(x.e.c.codice) : ""}</span></div><div class="tag">${siLabel(x.e.r)}</div></div>`).join("") : `<div class="empty">Nessuno trovato.</div>`;
}
$("#q").addEventListener("input", runSearch);

/* ============ civici ============ */
let openCiv = null;
function renderCivList() {
  const list = civList().sort((a, b) => natCmp(a.via, b.via) || natCmp(a.civico, b.civico));
  const tot = list.reduce((s, c) => s + (c.residenti || []).length, 0);
  let h = `<button class="btn pri block" id="newCiv" style="margin-bottom:12px">＋ Nuovo civico</button><div class="card">`;
  if (!list.length) h += `<div class="empty">Nessun civico. Carica il file dei nomi da <b>⚙️ Altro</b>.</div>`;
  else {
    h += `<input id="civFilter" type="search" placeholder="Filtra vie…" style="margin-bottom:6px">`;
    h += list.map(c => { const sc = [...new Set((c.residenti || []).map(r => r.scala).filter(Boolean))].sort(natCmp); return `<div class="list-item" data-id="${esc(c.id)}" data-f="${esc(norm(c.via + " " + c.civico))}"><div class="grow"><b>${esc(c.via)} ${esc(c.civico)}</b><br><span class="small mute">${(c.residenti || []).length} nomi${sc.length ? " · scale " + esc(sc.join(", ")) : ""}</span></div><span class="mute">›</span></div>`; }).join("");
    h += `<div class="small mute" style="padding-top:8px">${list.length} civici · ${tot} nomi</div>`;
  }
  $("#civList").innerHTML = h + `</div>`;
  $("#newCiv").onclick = () => civForm(null);
  const cf = $("#civFilter"); if (cf) cf.oninput = () => { const q = norm(cf.value); document.querySelectorAll("#civList .list-item").forEach(el => el.classList.toggle("hidden", !!q && !el.dataset.f.includes(q))); };
  document.querySelectorAll("#civList .list-item").forEach(el => el.onclick = () => showCiv(el.dataset.id));
}
function showPanel(w) { $("#civList").classList.toggle("hidden", w !== "list"); $("#civDetail").classList.toggle("hidden", w !== "detail"); window.scrollTo(0, 0); }
function showCiv(id) {
  const c = data.civici[id]; if (!c) { openCiv = null; renderCivList(); showPanel("list"); return; }
  openCiv = id;
  const rs = [...(c.residenti || [])].sort((a, b) => natCmp(a.scala, b.scala) || natCmp(a.interno, b.interno) || natCmp(a.nome, b.nome));
  let h = `<button class="btn small" id="back">‹ Civici</button>
  <div class="card" style="margin-top:10px"><div class="row"><h2 class="grow" style="margin:0">${esc(c.via)} ${esc(c.civico)}</h2><button class="btn small" id="civEdit">✏️</button></div>
  ${c.codice ? `<div style="margin-top:6px">🔑 ${esc(c.codice)}</div>` : ""}<div class="small mute" style="margin-top:4px">${rs.length} nomi</div>
  <button class="btn pri small block" style="margin-top:10px" id="addRes">＋ Aggiungi persona</button></div><div class="card">`;
  if (!rs.length) h += `<div class="empty">Nessun nome.</div>`;
  let last = null;
  rs.forEach(r => {
    if (r.scala !== last) { h += `<div class="scala-h">${r.scala ? "Scala " + esc(r.scala) : "Senza scala"}</div>`; last = r.scala; }
    h += `<div class="list-item" data-r="${esc(r.id)}"><div class="grow"><b>${esc(r.nome)}</b>${r.note ? `<br><span class="small mute">${esc(r.note)}</span>` : ""}</div><span class="tag">${r.interno ? "Int. " + esc(r.interno) : "—"}</span></div>`;
  });
  h += `</div><button class="btn bad small" id="civDel">Elimina questo civico</button>`;
  $("#civDetail").innerHTML = h; showPanel("detail");
  $("#back").onclick = () => { openCiv = null; renderCivList(); showPanel("list"); };
  $("#addRes").onclick = () => resForm(c, null);
  $("#civEdit").onclick = () => civForm(c);
  $("#civDel").onclick = () => ask(`Eliminare <b>${esc(c.via)} ${esc(c.civico)}</b> e i suoi ${rs.length} nomi?`, "Elimina", () => { delete data.civici[c.id]; saveLocal(); rebuildIndex(); renderStats(); openCiv = null; renderCivList(); showPanel("list"); toast("Civico eliminato"); });
  document.querySelectorAll("#civDetail [data-r]").forEach(el => el.onclick = () => resForm(c, c.residenti.find(r => r.id === el.dataset.r)));
}
function modal(html, bind) { $("#modal").innerHTML = html; $("#modalBg").classList.add("on"); bind && bind($("#modal")); }
function closeModal() { $("#modalBg").classList.remove("on"); }
$("#modalBg").addEventListener("click", e => { if (e.target.id === "modalBg") closeModal(); });
function ask(msg, okLabel, onOk) {
  modal(`<p style="font-size:17px">${msg}</p><div class="row"><button class="btn grow" id="mNo">Annulla</button><button class="btn bad grow" id="mOk">${esc(okLabel)}</button></div>`, m => { $("#mNo", m).onclick = closeModal; $("#mOk", m).onclick = () => { closeModal(); onOk(); }; });
}
function civForm(c) {
  modal(`<h2>${c ? "Modifica civico" : "Nuovo civico"}</h2>
    <label class="l">Via</label><input type="text" id="fVia" placeholder="es. Via Aurelia" value="${esc(c ? c.via : "")}">
    <label class="l">Numero civico</label><input type="text" id="fCiv" placeholder="es. 120" value="${esc(c ? c.civico : "")}">
    <label class="l">Codice cancello / portone</label><input type="text" id="fCod" value="${esc(c ? c.codice || "" : "")}">
    <div class="row" style="margin-top:16px"><button class="btn grow" id="mNo">Annulla</button><button class="btn pri grow" id="mOk">Salva</button></div>`, m => {
    $("#mNo", m).onclick = closeModal;
    $("#mOk", m).onclick = () => {
      const via = $("#fVia", m).value.trim(), civ = $("#fCiv", m).value.trim(), cod = $("#fCod", m).value.trim();
      if (!via || !civ) { toast("Scrivi via e numero"); return; }
      let t;
      if (c && slug(via, civ) !== c.id) { t = getOrCreateCiv(via, civ); t.residenti = t.residenti.concat(c.residenti); delete data.civici[c.id]; }
      else t = c || getOrCreateCiv(via, civ);
      t.via = via; t.civico = civ.toUpperCase(); t.codice = cod; touch(t); closeModal(); showCiv(t.id);
    };
  });
}
function resForm(c, r) {
  modal(`<h2>${r ? "Modifica" : "Nuova persona"} <span class="mute small">${esc(c.via)} ${esc(c.civico)}</span></h2>
    <label class="l">Nome (es. Rossi M.)</label><input type="text" id="fN" value="${esc(r ? r.nome : "")}">
    <div class="row"><div class="grow"><label class="l">Scala</label><input type="text" id="fS" value="${esc(r ? r.scala : "")}"></div><div class="grow"><label class="l">Interno</label><input type="text" id="fI" value="${esc(r ? r.interno : "")}"></div></div>
    <label class="l">Nota</label><input type="text" id="fNo" value="${esc(r ? r.note || "" : "")}">
    <div class="row" style="margin-top:16px">${r ? `<button class="btn bad" id="mDel">🗑</button>` : ""}<button class="btn grow" id="mNo">Annulla</button><button class="btn pri grow" id="mOk">Salva</button></div>`, m => {
    $("#mNo", m).onclick = closeModal;
    $("#mOk", m).onclick = () => {
      const nome = $("#fN", m).value.trim(); if (!nome) { toast("Scrivi il nome"); return; }
      const v = { nome, scala: $("#fS", m).value.trim().toUpperCase(), interno: $("#fI", m).value.trim().toUpperCase(), note: $("#fNo", m).value.trim() };
      if (r) Object.assign(r, v); else c.residenti.push({ id: uid(), ...v });
      touch(c); closeModal(); showCiv(c.id);
    };
    const d = $("#mDel", m); if (d) d.onclick = () => { c.residenti = c.residenti.filter(x => x !== r); touch(c); closeModal(); showCiv(c.id); };
  });
}

/* ============ importa / esporta ============ */
// formato tabulato: "VIA CONFORTI 130" / "CODICE: 0712" / "ROSSI M.; B; 11"
function parseTabulati(text) {
  const out = []; let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    if (/^CODICE\s*:/i.test(l)) { if (cur) cur.codice = l.replace(/^CODICE\s*:\s*/i, ""); continue; }
    if (!l.includes(";")) {
      let m = l.match(/^(.+?)\s+DAL\s+(\d+)\s+AL\s+(\d+)$/i), via, civ;
      if (m) { via = m[1]; civ = m[2] + "-" + m[3]; }
      else if ((m = l.match(/^(.+?)\s+(\d+\s?[A-Z]?)$/i))) { via = m[1]; civ = m[2].replace(/\s/g, ""); }
      if (via) { cur = { via: titleVia(via), civico: civ.toUpperCase(), codice: "", residenti: [] }; out.push(cur); }
      continue;
    }
    if (!cur) continue;
    const p = l.split(";").map(x => x.trim());
    if (!p[0]) continue;
    let interno = (p[2] || "").toUpperCase(), note = p[3] || "";
    if (interno === "?") { interno = ""; note = note || "interno da verificare"; }
    cur.residenti.push({ id: uid(), nome: p[0], scala: (p[1] || "").toUpperCase(), interno, note });
  }
  return out;
}
function importCivici(arr) {
  let n = 0, p = 0;
  for (const c of arr) {
    if (!c || !c.via || !c.civico) continue;
    const id = slug(c.via, c.civico);
    data.civici[id] = { id, via: c.via, civico: String(c.civico), codice: c.codice || "", zona: c.zona || "", updatedAt: Date.now(),
      residenti: (c.residenti || []).filter(r => r && r.nome).map(r => ({ id: r.id || uid(), nome: String(r.nome), scala: String(r.scala || ""), interno: String(r.interno || ""), note: String(r.note || "") })) };
    n++; p += data.civici[id].residenti.length;
  }
  saveLocal(); rebuildIndex(); renderStats();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
  return { n, p };
}
function confirmImport(arr) {
  const ok = arr.filter(c => c && c.via && c.civico);
  if (!ok.length) { toast("Nel file non ho trovato civici", 3000); return; }
  const p = ok.reduce((s, c) => s + (c.residenti || []).length, 0);
  ask(`Caricare <b>${ok.length} civici</b> con <b>${p} nomi</b>? I civici con lo stesso indirizzo verranno sostituiti.`, "Carica", () => {
    const r = importCivici(ok); toast(`Caricati ${r.n} civici, ${r.p} nomi`, 3000);
    camMsg(""); if (openCiv) showCiv(openCiv); else renderCivList();
  });
}
$("#impFile").onchange = async ev => {
  const files = [...ev.target.files]; ev.target.value = ""; if (!files.length) return;
  let all = [];
  for (const f of files) {
    const t = await f.text();
    try { const d = JSON.parse(t); all = all.concat(Array.isArray(d) ? d : (d.civici || [])); }
    catch (e) { all = all.concat(parseTabulati(t)); }
  }
  confirmImport(all);
};
$("#pasteBtn").onclick = () => modal(`<h2>Incolla tabulato</h2><p class="small mute" style="margin-top:0">Formato: prima riga la via con il numero, poi una persona per riga: <b>NOME; SCALA; INTERNO</b></p>
  <textarea id="pTxt" placeholder="VIA CONFORTI 130&#10;CODICE: 0712&#10;ROSSI M.; B; 11"></textarea>
  <div class="row" style="margin-top:10px"><button class="btn grow" id="mNo">Annulla</button><button class="btn pri grow" id="mOk">Leggi</button></div>`, m => {
  $("#mNo", m).onclick = closeModal;
  $("#mOk", m).onclick = () => { const arr = parseTabulati($("#pTxt", m).value); closeModal(); confirmImport(arr); };
});
$("#expBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ app: "scale", v: 1, esportato: new Date().toISOString(), civici: civList() })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "scale-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
};
$("#wipeBtn").onclick = () => ask("Cancellare <b>tutti</b> i nomi da questo telefono? Non si può annullare.", "Cancella tutto", () => { data = { civici: {} }; saveLocal(); rebuildIndex(); renderStats(); toast("Dati cancellati"); });
function renderStats() { const l = civList(); $("#stats").textContent = `Su questo telefono: ${l.length} civici, ${l.reduce((s, c) => s + (c.residenti || []).length, 0)} nomi.`; }

/* ============ navigazione ============ */
function go(v) {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  if (v === "scan") startCam(); else stopCam();
  if (v === "civici") { if (openCiv) showCiv(openCiv); else { renderCivList(); showPanel("list"); } }
  if (v === "search") runSearch();
  window.scrollTo(0, 0);
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => go(b.dataset.v));

/* ============ avvio ============ */
loadLocal(); rebuildIndex(); renderStats();
initOcr().catch(() => { });
startCam();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
window.__scale = { matchText, parseTabulati, importCivici, get INDEX() { return INDEX; } };
