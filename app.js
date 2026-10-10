/* Bismark Cut — simple video editor. All client-side, no uploads. */
'use strict';

const $ = id => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PX_PER_SEC = 56;

const S = {
  media: [],        // imported source files: {id,kind,file,url,name,dur,thumb}
  clips: [],        // timeline: ordered clip objects (subset of media)
  sel: null,        // selected clip id
  overlays: [],     // {id,text,start,end,pos,size,color,bg}
  editingOv: null,
  music: null,      // {file,url,name}
  musicVol: 0.5,
  muteOrig: false,
  aspect: '9:16',
  res: '720p',
  T: 0,             // playhead, timeline seconds
  playing: false,
};

function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtT(s){
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), sec = s % 60;
  return m + ':' + sec.toFixed(1).padStart(4, '0');
}
function toast(msg){
  let t = document.querySelector('.toast');
  if(!t){ t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 2200);
}
const byId = id => S.clips.find(c => c.id === id);
const clipLen = c => c.kind === 'image' ? c.imgDur : Math.max(0.1, c.te - c.ts);
function segs(){
  let t = 0;
  return S.clips.map(c => { const len = clipLen(c); const s = { clip:c, start:t, len, end:t+len }; t += len; return s; });
}
function totalDur(){ const s = segs(); return s.length ? s[s.length-1].end : 0; }
function segAt(t){ return segs().find(s => t >= s.start && t < s.end) || null; }

/* ---------------- MEDIA BIN ---------------- */
$('btn-add-media').onclick = () => $('file-media').click();
$('file-media').addEventListener('change', async e => {
  for(const f of e.target.files){ await addMediaFile(f); }
  e.target.value = '';
  renderMediaBin();
});

function probeDuration(url){
  return new Promise(res => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => res(v.duration || 0);
    v.onerror = () => res(0);
    v.src = url;
  });
}
function captureThumb(url, t){
  return new Promise(res => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const done = ok => { try{
      if(!ok) return res(url);
      const c = document.createElement('canvas'); c.width = 160; c.height = 90;
      c.getContext('2d').drawImage(v, 0, 0, 160, 90);
      res(c.toDataURL('image/jpeg', 0.7));
    }catch(e){ res(url); } };
    v.onloadedmetadata = () => { try{ v.currentTime = t; }catch(e){ done(false); } };
    v.onseeked = () => done(true);
    v.onerror = () => done(false);
    setTimeout(()=>done(false), 6000);
    v.src = url;
  });
}

async function addMediaFile(f){
  const isImg = f.type.startsWith('image/');
  const url = URL.createObjectURL(f);
  const m = { id: uid(), kind: isImg ? 'image' : 'video', file: f, url, name: f.name || (isImg?'photo':'clip'),
              dur: 0, ts: 0, te: 0, imgDur: 3, thumb: url };
  if(!isImg){
    m.dur = await probeDuration(url);
    if(!m.dur){ toast('Could not read ' + m.name); URL.revokeObjectURL(url); return; }
    m.te = m.dur;
    m.thumb = await captureThumb(url, Math.min(1, m.dur / 3));
  }
  S.media.push(m);
}

function renderMediaBin(){
  const bin = $('media-bin'); bin.innerHTML = '';
  if(!S.media.length){ bin.innerHTML = '<p class="empty-note">Nothing yet — add videos or photos.</p>'; return; }
  S.media.forEach(m => {
    const d = document.createElement('div');
    d.className = 'media-item';
    const inTl = S.clips.includes(m);
    d.innerHTML = (m.kind === 'image'
        ? `<img src="${m.thumb}" alt="">`
        : `<img src="${m.thumb}" alt="">`) +
      `<div class="mname">${esc(m.name)}${m.kind==='video' ? ' · ' + fmtT(m.dur) : ''}</div>` +
      (inTl ? '' : `<button class="madd">+ Timeline</button>`);
    const btn = d.querySelector('.madd');
    if(btn) btn.onclick = e => { e.stopPropagation(); addToTimeline(m); };
    bin.appendChild(d);
  });
}

function addToTimeline(m){
  if(!S.clips.includes(m)) S.clips.push(m);
  S.sel = m.id;
  afterEdit();
}

/* ---------------- TIMELINE ---------------- */
function renderTimeline(){
  const track = $('tl-track'); track.innerHTML = '';
  const ruler = $('tl-ruler'); ruler.innerHTML = '';
  const sg = segs(), total = totalDur();
  const maxTick = Math.min(600, Math.ceil(total) + 1);
  for(let t = 0; t <= maxTick; t++){
    const tick = document.createElement('div');
    tick.className = 'tick'; tick.style.left = (10 + t * PX_PER_SEC) + 'px';
    tick.textContent = t + 's';
    ruler.appendChild(tick);
  }
  sg.forEach(s => {
    const c = s.clip;
    const d = document.createElement('div');
    d.className = 'clip-block' + (c.kind === 'image' ? ' img' : '') + (S.sel === c.id ? ' selected' : '');
    d.style.width = Math.max(70, s.len * PX_PER_SEC) + 'px';
    d.dataset.id = c.id;
    d.innerHTML =
      (c.kind === 'image' ? '' : '<div class="handle left">◀</div>') +
      `<div class="cname">${esc(c.name)}</div><div class="cdur">${fmtT(s.len)}</div>` +
      (c.kind === 'image' ? '' : '<div class="handle right">▶</div>');
    track.appendChild(d);
  });
  $('tl-inner').style.width = Math.max($('tl-scroll').clientWidth - 2, 20 + total * PX_PER_SEC + 60) + 'px';
  positionPlayhead();
}

function positionPlayhead(){
  const ph = $('tl-playhead'), total = totalDur();
  if(total <= 0){ ph.hidden = true; return; }
  ph.hidden = false;
  ph.style.left = (10 + clamp(S.T, 0, total) * PX_PER_SEC) + 'px';
}

/* drag-to-reorder + trim handles (pointer events, touch friendly) */
(function initTimelineGestures(){
  const track = $('tl-track');
  let drag = null, trim = null;

  track.addEventListener('pointerdown', e => {
    const blk = e.target.closest('.clip-block');
    if(!blk) return;
    const id = blk.dataset.id;
    selectClip(id);
    const h = e.target.closest('.handle');
    if(h){ try{ h.setPointerCapture(e.pointerId); }catch(err){} startTrim(e, blk, id, h.classList.contains('left') ? 'l' : 'r'); return; }
    try{ blk.setPointerCapture(e.pointerId); }catch(err){}
    drag = { id, el: blk, x0: e.clientX, moved: false };
    e.preventDefault();
  });
  track.addEventListener('pointermove', e => {
    if(trim){ trimMove(e); return; }
    if(!drag) return;
    const dx = e.clientX - drag.x0;
    if(Math.abs(dx) > 10) drag.moved = true;
    if(drag.moved) drag.el.style.transform = `translateX(${dx}px)`;
  });
  track.addEventListener('pointerup', e => {
    if(trim){ trimEnd(); trim = null; return; }
    if(!drag) return;
    const d = drag; drag = null;
    d.el.style.transform = '';
    if(!d.moved) return;
    // find drop index by pointer x among blocks
    const blocks = [...track.querySelectorAll('.clip-block')];
    let idx = blocks.length;
    for(let i = 0; i < blocks.length; i++){
      const r = blocks[i].getBoundingClientRect();
      if(e.clientX < r.left + r.width / 2){ idx = i; break; }
    }
    const clip = byId(d.id);
    const from = S.clips.indexOf(clip);
    S.clips.splice(from, 1);
    S.clips.splice(clamp(idx > from ? idx - 1 : idx, 0, S.clips.length), 0, clip);
    afterEdit();
  });
  track.addEventListener('pointercancel', () => {
    if(drag){ drag.el.style.transform = ''; drag = null; }
    if(trim){ trimEnd(); trim = null; }
  });

  function startTrim(e, blk, id, side){
    const clip = byId(id);
    trim = { clip, blk, side, x0: e.clientX, ts0: clip.ts, te0: clip.te };
    e.preventDefault(); e.stopPropagation();
  }
  function trimMove(e){
    const t = trim, dx = (e.clientX - t.x0) / PX_PER_SEC;
    if(t.side === 'l') t.clip.ts = clamp(t.ts0 + dx, 0, t.te0 - 0.2);
    else t.clip.te = clamp(t.te0 + dx, t.clip.ts + 0.2, t.clip.dur);
    t.blk.style.width = Math.max(70, clipLen(t.clip) * PX_PER_SEC) + 'px';
    syncTrimPanel(t.clip);
    if(!S.playing) renderAt(S.T, false);
  }
  function trimEnd(){ afterEdit(); }
})();

function selectClip(id){
  S.sel = id;
  document.querySelectorAll('.clip-block').forEach(b => b.classList.toggle('selected', b.dataset.id === id));
  renderClipPanel();
}

$('btn-split').onclick = () => {
  const s = segAt(S.T);
  if(!s) return toast('Move the playhead over a clip first');
  const clip = s.clip, off = S.T - s.start;
  if(off < 0.25 || s.len - off < 0.25) return toast('Too close to the edge to split');
  const i = S.clips.indexOf(clip);
  if(clip.kind === 'image'){
    const b = Object.assign({}, clip, { id: uid(), imgDur: s.len - off });
    clip.imgDur = off;
    S.clips.splice(i + 1, 0, b);
  } else {
    const cut = clip.ts + off;
    const b = Object.assign({}, clip, { id: uid(), ts: cut });
    clip.te = cut;
    S.clips.splice(i + 1, 0, b);
  }
  afterEdit();
  toast('Clip split ✂️');
};
$('btn-del-clip').onclick = () => {
  const c = byId(S.sel);
  if(!c) return toast('Tap a timeline block first');
  S.clips.splice(S.clips.indexOf(c), 1);
  S.sel = null;
  afterEdit();
};
$('btn-move-left').onclick = () => moveSel(-1);
$('btn-move-right').onclick = () => moveSel(1);
function moveSel(d){
  const c = byId(S.sel);
  if(!c) return toast('Tap a timeline block first');
  const i = S.clips.indexOf(c), j = clamp(i + d, 0, S.clips.length - 1);
  if(i === j) return;
  S.clips.splice(i, 1); S.clips.splice(j, 0, c);
  afterEdit();
}

function afterEdit(){
  const total = totalDur();
  S.T = clamp(S.T, 0, total);
  renderTimeline(); renderMediaBin(); renderClipPanel(); updateSeekUI(); updateOverlays();
  if(S.playing) renderAt(S.T, true); else renderAt(S.T, false);
}

/* ---------------- PREVIEW ENGINE ---------------- */
const V = $('preview-video'), IMG = $('preview-img');
let imgTimer = null, seeking = false, playToken = 0;

function waitEvent(el, ev, ms){
  ms = ms || 8000;
  return new Promise((res, rej) => {
    const to = setTimeout(() => { cleanup(); rej(new Error('timeout:' + ev)); }, ms);
    const h = () => { cleanup(); res(); };
    const cleanup = () => { clearTimeout(to); el.removeEventListener(ev, h); };
    el.addEventListener(ev, h, { once: true });
  });
}

/* Render the frame at timeline time t. autoplay=true keeps it playing. */
async function renderAt(t, autoplay){
  const my = ++playToken;
  const s = segAt(t);
  clearTimeout(imgTimer);
  if(!s){ pause(); return; }
  if(s.clip.kind === 'image'){
    V.pause(); V.style.display = 'none'; IMG.hidden = false; IMG.src = s.clip.url;
    if(autoplay){
      const remain = Math.max(80, (s.end - t) * 1000);
      imgTimer = setTimeout(() => {
        if(my !== playToken || !S.playing) return;
        const ns = segAt(s.end + 0.001);
        if(ns){ setT(s.end); renderAt(s.end, true); }
        else { setT(totalDur()); pause(); }
      }, remain);
    }
    return;
  }
  IMG.hidden = true; V.style.display = '';
  try{
    if(V.dataset.cid !== s.clip.id){
      V.dataset.cid = s.clip.id;
      V.src = s.clip.url;
      await waitEvent(V, 'loadedmetadata');
      if(my !== playToken) return;
    }
    seeking = true;
    V.currentTime = clamp(s.clip.ts + Math.max(0, t - s.start), s.clip.ts, Math.max(s.clip.ts, s.clip.te - 0.03));
    try{ await waitEvent(V, 'seeked', 5000); }catch(e){}
    if(my !== playToken) return;
    seeking = false;
    if(autoplay){ try{ await V.play(); }catch(e){ pause(); } }
  }catch(e){ seeking = false; if(autoplay) pause(); }
}

V.addEventListener('timeupdate', () => {
  if(seeking || !S.playing) return;
  const s = segAt(S.T);
  if(!s || s.clip.kind === 'image') return;
  if(V.dataset.cid !== s.clip.id) return; // mid-switch, ignore
  const clip = s.clip;
  S.T = s.start + (V.currentTime - clip.ts);
  if(V.currentTime >= clip.te - 0.12){
    const ns = segAt(s.end + 0.001);
    if(ns){ setT(ns.start); renderAt(ns.start, true); }
    else { setT(totalDur()); pause(); }
    return;
  }
  positionPlayhead(); updateSeekUI(); updateOverlays();
});
V.addEventListener('ended', () => { // safety net
  if(!S.playing) return;
  const s = segAt(S.T);
  if(s){ const ns = segAt(s.end + 0.001); if(ns){ setT(ns.start); renderAt(ns.start, true); return; } }
  setT(totalDur()); pause();
});

async function play(){
  if(totalDur() <= 0) return toast('Add clips to the timeline first');
  if(S.T >= totalDur() - 0.05) setT(0);
  S.playing = true;
  $('btn-play').textContent = '⏸';
  await renderAt(S.T, true);
}
function pause(){
  S.playing = false; playToken++;
  try{ V.pause(); }catch(e){}
  clearTimeout(imgTimer);
  $('btn-play').textContent = '▶';
}
$('btn-play').onclick = () => { S.playing ? pause() : play(); };

$('seek').addEventListener('input', async e => {
  const total = totalDur();
  if(!total) return;
  const t = (e.target.value / 1000) * total;
  setT(t);
  await renderAt(t, S.playing);
});

function setT(t){
  S.T = clamp(t, 0, totalDur());
  positionPlayhead(); updateSeekUI(); updateOverlays();
}
function updateSeekUI(){
  const total = totalDur();
  $('seek').value = total ? Math.round(S.T / total * 1000) : 0;
  $('time-display').textContent = fmtT(S.T) + ' / ' + fmtT(total);
}

/* ---------------- CLIP PANEL ---------------- */
function renderClipPanel(){
  const c = byId(S.sel);
  $('clip-empty').hidden = !!c;
  $('clip-editor').hidden = !c;
  if(!c) return;
  $('clip-name').textContent = c.name;
  $('img-dur-row').hidden = c.kind !== 'image';
  if(c.kind === 'image'){ $('img-dur').value = c.imgDur; }
  syncTrimPanel(c);
  $('clip-len').textContent = fmtT(clipLen(c));
}
function syncTrimPanel(c){
  if(!c || c.kind === 'image'){ if(c) $('clip-len').textContent = fmtT(clipLen(c)); return; }
  const ts = $('trim-start'), te = $('trim-end');
  ts.min = 0; ts.max = c.dur; ts.step = 0.05;
  te.min = 0; te.max = c.dur; te.step = 0.05;
  if(document.activeElement !== ts) ts.value = c.ts;
  if(document.activeElement !== te) te.value = c.te;
  $('ts-val').textContent = fmtT(c.ts);
  $('te-val').textContent = fmtT(c.te);
  $('clip-len').textContent = fmtT(clipLen(c));
}
$('trim-start').addEventListener('input', e => {
  const c = byId(S.sel); if(!c || c.kind === 'image') return;
  c.ts = clamp(parseFloat(e.target.value) || 0, 0, c.te - 0.2);
  syncTrimPanel(c);
  const blk = document.querySelector(`.clip-block[data-id="${c.id}"]`);
  if(blk) blk.style.width = Math.max(70, clipLen(c) * PX_PER_SEC) + 'px';
  positionPlayhead();
});
$('trim-end').addEventListener('input', e => {
  const c = byId(S.sel); if(!c || c.kind === 'image') return;
  c.te = clamp(parseFloat(e.target.value) || 0, c.ts + 0.2, c.dur);
  syncTrimPanel(c);
  const blk = document.querySelector(`.clip-block[data-id="${c.id}"]`);
  if(blk) blk.style.width = Math.max(70, clipLen(c) * PX_PER_SEC) + 'px';
  positionPlayhead();
});
$('trim-start').addEventListener('change', afterEdit);
$('trim-end').addEventListener('change', afterEdit);
$('img-dur').addEventListener('change', e => {
  const c = byId(S.sel); if(!c || c.kind !== 'image') return;
  c.imgDur = clamp(parseFloat(e.target.value) || 3, 0.5, 30);
  afterEdit();
});

/* ---------------- TEXT OVERLAYS ---------------- */
function posClass(o){ return 'pos-' + (typeof o.pos === 'string' ? o.pos : 'bottom'); }
function ovDefaultXY(o){
  if(o.pos && typeof o.pos === 'object') return o.pos;
  return { x: 0.5, y: o.pos === 'top' ? 0.12 : o.pos === 'center' ? 0.5 : 0.8 };
}
function applyOvStyle(d, o){
  const h = $('stage').clientHeight || 480;
  const scale = h / 720;
  d.style.fontSize = Math.max(10, o.size * scale) + 'px';
  d.style.color = o.color;
  if(o.pos && typeof o.pos === 'object'){
    d.classList.remove('pos-top', 'pos-center', 'pos-bottom');
    d.style.left = (o.pos.x * 100) + '%';
    d.style.top = (o.pos.y * 100) + '%';
    d.style.transform = 'translate(-50%,-50%)';
  }
}
function renderOverlays(){
  const layer = $('overlay-layer');
  layer.innerHTML = '';
  S.overlays.forEach(o => {
    const d = document.createElement('div');
    d.className = 'ov ' + posClass(o) + (o.bg ? ' withbg' : '') + (S.editingOv === o.id ? ' selected' : '');
    d.dataset.id = o.id;
    d.textContent = o.text;
    applyOvStyle(d, o);
    d.addEventListener('pointerdown', e => startOvDrag(e, o, d));
    d.addEventListener('click', e => {
      e.stopPropagation();
      if(suppressOvClick){ suppressOvClick = false; return; }
      editOverlay(o.id);
    });
    layer.appendChild(d);
  });
  updateOverlays();
}
function updateOverlays(){
  document.querySelectorAll('#overlay-layer .ov').forEach(d => {
    const o = S.overlays.find(x => x.id === d.dataset.id);
    if(!o) return;
    d.classList.toggle('hidden', !(S.T >= o.start && S.T < o.end));
  });
}
let suppressOvClick = false;
function startOvDrag(e, o, d){
  e.preventDefault(); e.stopPropagation();
  const stageEl = $('stage'), r = stageEl.getBoundingClientRect();
  const p0 = ovDefaultXY(o);
  let px = p0.x, py = p0.y;
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  if(typeof o.pos !== 'object'){ /* keep preset until moved */ }
  const move = ev => {
    const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
    if(Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 6) moved = true;
    if(!moved) return;
    px = clamp(p0.x + dx, 0.06, 0.94);
    py = clamp(p0.y + dy, 0.06, 0.94);
    o.pos = { x: px, y: py };
    d.classList.remove('pos-top', 'pos-center', 'pos-bottom');
    d.style.left = (px * 100) + '%'; d.style.top = (py * 100) + '%';
    d.style.transform = 'translate(-50%,-50%)';
    syncPosButtons();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if(moved) suppressOvClick = true;
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function renderOverlayList(){
  const list = $('overlay-list'); list.innerHTML = '';
  if(!S.overlays.length){ list.innerHTML = '<p class="empty-note">No captions yet.</p>'; return; }
  [...S.overlays].sort((a,b) => a.start - b.start).forEach(o => {
    const d = document.createElement('div');
    d.className = 'ov-item';
    d.innerHTML = `<span>${esc(o.text.slice(0, 28))} <em style="color:var(--dim)">(${o.start.toFixed(1)}–${o.end.toFixed(1)}s)</em></span>`;
    const eb = document.createElement('button');
    eb.className = 'btn'; eb.textContent = 'Edit';
    eb.onclick = () => editOverlay(o.id);
    d.appendChild(eb);
    list.appendChild(d);
  });
}
$('btn-add-text').onclick = () => {
  const o = { id: uid(), text: 'your caption', start: Math.round(S.T * 10) / 10,
              end: Math.round((S.T + 2) * 10) / 10, pos: 'bottom', size: 56, color: '#ffffff', bg: false };
  S.overlays.push(o);
  renderOverlays(); renderOverlayList();
  editOverlay(o.id);
};
function editOverlay(id){
  const o = S.overlays.find(x => x.id === id);
  if(!o) return;
  S.editingOv = id;
  // make sure the Text tab is visible
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'text'));
  ['clip', 'text', 'audio'].forEach(k => { $('tab-' + k).hidden = k !== 'text'; });
  $('text-editor').hidden = false;
  $('ov-text').value = o.text;
  $('ov-start').value = o.start; $('ov-end').value = o.end;
  $('ov-size').value = o.size; $('ov-color').value = o.color;
  $('ov-bg').checked = !!o.bg;
  syncPosButtons();
  renderOverlays();
}
function syncPosButtons(){
  const o = S.overlays.find(x => x.id === S.editingOv);
  document.querySelectorAll('.pos-btn').forEach(b => {
    b.classList.toggle('on', !!o && o.pos === b.dataset.pos);
  });
}
document.querySelectorAll('.pos-btn').forEach(b => {
  b.onclick = () => {
    const o = S.overlays.find(x => x.id === S.editingOv); if(!o) return;
    o.pos = b.dataset.pos;
    syncPosButtons(); renderOverlays();
  };
});
$('ov-text').addEventListener('input', e => { const o = curOv(); if(o){ o.text = e.target.value; renderOverlays(); renderOverlayList(); } });
$('ov-start').addEventListener('change', e => { const o = curOv(); if(o){ o.start = Math.max(0, parseFloat(e.target.value) || 0); if(o.end <= o.start) o.end = o.start + 0.5; renderOverlayList(); updateOverlays(); } });
$('ov-end').addEventListener('change', e => { const o = curOv(); if(o){ o.end = Math.max(0.5, parseFloat(e.target.value) || 1); if(o.end <= o.start) o.start = Math.max(0, o.end - 0.5); renderOverlayList(); updateOverlays(); } });
$('ov-size').addEventListener('input', e => { const o = curOv(); if(o){ o.size = parseInt(e.target.value, 10); renderOverlays(); } });
$('ov-color').addEventListener('input', e => { const o = curOv(); if(o){ o.color = e.target.value; renderOverlays(); } });
$('ov-bg').addEventListener('change', e => { const o = curOv(); if(o){ o.bg = e.target.checked; renderOverlays(); } });
function curOv(){ return S.overlays.find(x => x.id === S.editingOv); }
$('ov-done').onclick = () => { S.editingOv = null; $('text-editor').hidden = true; renderOverlays(); };
$('ov-delete').onclick = () => {
  S.overlays = S.overlays.filter(x => x.id !== S.editingOv);
  S.editingOv = null; $('text-editor').hidden = true;
  renderOverlays(); renderOverlayList();
};

/* ---------------- AUDIO ---------------- */
$('btn-add-music').onclick = () => $('file-music').click();
$('file-music').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if(!f) return;
  if(S.music) URL.revokeObjectURL(S.music.url);
  S.music = { file: f, url: URL.createObjectURL(f), name: f.name };
  renderMusic();
});
function renderMusic(){
  $('music-info').hidden = !S.music;
  if(S.music) $('music-name').textContent = '🎵 ' + S.music.name;
  $('music-vol').value = S.musicVol;
  $('mute-orig').checked = S.muteOrig;
}
$('music-vol').addEventListener('input', e => { S.musicVol = parseFloat(e.target.value); });
$('mute-orig').addEventListener('change', e => { S.muteOrig = e.target.checked; });
$('btn-del-music').onclick = () => {
  if(S.music) URL.revokeObjectURL(S.music.url);
  S.music = null; renderMusic();
};

/* ---------------- SETTINGS / TABS / PROJECT ---------------- */
function applyAspect(){
  const st = $('stage');
  st.classList.remove('ar-169', 'ar-11');
  if(S.aspect === '16:9') st.classList.add('ar-169');
  if(S.aspect === '1:1') st.classList.add('ar-11');
  S.overlays.forEach(o => {
    const d = document.querySelector(`#overlay-layer .ov[data-id="${o.id}"]`);
    if(d) applyOvStyle(d, o);
  });
}
$('sel-aspect').addEventListener('change', e => { S.aspect = e.target.value; applyAspect(); });
$('sel-res').addEventListener('change', e => { S.res = e.target.value; });

document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    ['clip', 'text', 'audio'].forEach(k => { $('tab-' + k).hidden = k !== t.dataset.tab; });
    if(t.dataset.tab === 'text') renderOverlayList();
  };
});

$('btn-new').onclick = () => {
  if(!confirm('Start a new project? Everything will be cleared.')) return;
  pause();
  S.media.forEach(m => URL.revokeObjectURL(m.url));
  if(S.music) URL.revokeObjectURL(S.music.url);
  S.media = []; S.clips = []; S.sel = null; S.overlays = []; S.editingOv = null;
  S.music = null; S.T = 0;
  V.removeAttribute('src'); V.load(); V.dataset.cid = '';
  IMG.hidden = true;
  $('text-editor').hidden = true;
  renderAll();
};

/* ---------------- EXPORT ---------------- */
let exporting = false;
$('btn-export').onclick = async () => {
  if(!S.clips.length) return toast('Add clips to the timeline first');
  if(exporting) return toast('Export already running…');
  exporting = true;
  $('export-modal').hidden = false;
  $('exp-download').hidden = true;
  $('exp-title').textContent = 'Exporting video…';
  $('exp-log').textContent = '';
  setExpProgress(0);
  const ui = {
    status: t => { $('exp-status').textContent = t; },
    progress: p => setExpProgress(p),
    log: m => { const el = $('exp-log'); el.textContent += m + '\n'; el.scrollTop = el.scrollHeight; },
    done: (url, name) => {
      setExpProgress(1);
      $('exp-title').textContent = 'Done! 🎉';
      $('exp-status').textContent = 'Your video is ready.';
      const a = $('exp-download');
      a.href = url; a.download = name; a.hidden = false;
    },
    fail: msg => {
      $('exp-title').textContent = 'Export failed';
      $('exp-status').textContent = msg;
    },
  };
  try{
    pause();
    await window.BismarkCutExport.run(S, ui);
  }catch(err){
    ui.fail((err && err.message) || String(err));
  }finally{
    exporting = false;
  }
};
function setExpProgress(p){ $('exp-bar').style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; }
$('exp-close').onclick = () => {
  if(exporting && !confirm('Export is still running. Close anyway? (It will keep running in the background.)')) return;
  $('export-modal').hidden = true;
};

/* ---------------- INIT ---------------- */
function renderAll(){
  renderMediaBin(); renderTimeline(); renderClipPanel();
  renderOverlays(); renderOverlayList(); renderMusic();
  updateSeekUI(); positionPlayhead(); applyAspect();
}
window.addEventListener('resize', () => {
  S.overlays.forEach(o => {
    const d = document.querySelector(`#overlay-layer .ov[data-id="${o.id}"]`);
    if(d) applyOvStyle(d, o);
  });
});
renderAll();
