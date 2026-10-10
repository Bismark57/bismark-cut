/* Bismark Cut — export pipeline (FFmpeg.wasm, single-threaded core, no SharedArrayBuffer needed). */
'use strict';

window.BismarkCutExport = (() => {

  const CORE_VER = '0.12.10';
  const CORE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VER}/dist/esm/ffmpeg-core.js`;
  const WASM_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VER}/dist/esm/ffmpeg-core.wasm`;
  const FONT_URLS = [
    'https://cdn.jsdelivr.net/fontsource/fonts/archivo-black@latest/latin-400-normal.ttf',
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/archivoblack/ArchivoBlack-Regular.ttf',
  ];

  function dims(aspect, res){
    const L = res === '1080p' ? 1080 : 720;
    if(aspect === '9:16') return { w: Math.round(L * 9 / 16), h: L };
    if(aspect === '1:1') return { w: L, h: L };
    return { w: Math.round(L * 16 / 9), h: L };
  }
  function clipLen(c){ return c.kind === 'image' ? c.imgDur : Math.max(0.1, c.te - c.ts); }
  function totalDur(S){ return S.clips.reduce((a, c) => a + clipLen(c), 0); }
  function extOf(name, kind){
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    if(m) return m[1].toLowerCase();
    return kind === 'image' ? 'png' : kind === 'audio' ? 'mp3' : 'mp4';
  }
  /* Escape user text for the drawtext filter (filtergraph level; argv passed directly, no shell). */
  function dtEscape(s){
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/\r?\n/g, '\\n');
  }
  function ovFilter(o, H){
    const fs = Math.max(12, Math.round(o.size * (H / 720)));
    const bw = Math.max(2, Math.round(fs / 14));
    let x = '(w-text_w)/2', y;
    const yTop = Math.round(60 * H / 720), yBot = Math.round(170 * H / 720);
    if(o.pos === 'top') y = String(yTop);
    else if(o.pos === 'center') y = '(h-text_h)/2';
    else if(o.pos && typeof o.pos === 'object'){
      x = `w*${(+o.pos.x).toFixed(4)}-text_w/2`;
      y = `h*${(+o.pos.y).toFixed(4)}-text_h/2`;
    }
    else y = `h-text_h-${yBot}`;
    let f = `drawtext=fontfile=/font.ttf:text='${dtEscape(o.text)}'` +
            `:fontsize=${fs}:fontcolor=${o.color || '#ffffff'}` +
            `:borderw=${bw}:bordercolor=black`;
    if(o.bg) f += `:box=1:boxcolor=black@0.55:boxborderw=${Math.round(fs * 0.35)}`;
    f += `:x=${x}:y=${y}:enable='between(t,${(+o.start).toFixed(2)},${(+o.end).toFixed(2)})'`;
    return f;
  }

  async function run(S, ui){
    const clips = S.clips;
    if(!clips.length) throw new Error('Timeline is empty.');
    const total = totalDur(S);
    if(total <= 0) throw new Error('Timeline has no duration.');

    ui.status('Loading video engine… (first time takes a moment)');
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { fetchFile } = await import('@ffmpeg/util');
    const ffmpeg = new FFmpeg();
    let phaseBase = 0, phaseSpan = 0.7, phaseTotal = total;
    ffmpeg.on('log', ({ message }) => ui.log(message));
    ffmpeg.on('progress', ({ time }) => {
      const p = phaseBase + phaseSpan * Math.min(1, (time / 1e6) / Math.max(0.01, phaseTotal));
      ui.progress(p);
    });
    await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
    ui.log('Engine loaded (single-threaded core, no special browser headers needed).');

    /* exec() resolves with the exit code (0 = ok) — it does not throw on ffmpeg errors. */
    async function x(args, what){
      let code;
      try{ code = await ffmpeg.exec(args); }
      catch(e){ throw new Error(what + ' failed: ' + ((e && e.message) || e)); }
      if(code !== 0) throw new Error(what + ' failed (exit code ' + code + '). See log above.');
      return code;
    }

    ui.status('Loading caption font…');
    let fontOk = false;
    for(const u of FONT_URLS){
      try{
        const r = await fetch(u);
        if(!r.ok) continue;
        await ffmpeg.writeFile('/font.ttf', new Uint8Array(await r.arrayBuffer()));
        fontOk = true; break;
      }catch(e){ /* try next */ }
    }
    if(!fontOk) throw new Error('Could not download the caption font. Check your connection and retry.');

    /* ---- write inputs ---- */
    for(let i = 0; i < clips.length; i++){
      const c = clips[i];
      ui.status(`Reading clip ${i + 1}/${clips.length}…`);
      const ext = extOf(c.file && c.file.name, c.kind);
      const data = await fetchFile(c.file);
      const inName = `in${i}.${ext}`;
      await ffmpeg.writeFile(inName, data);
      c._in = inName;
    }
    let musicIn = null;
    if(S.music){
      ui.status('Reading music…');
      const ext = extOf(S.music.file && S.music.file.name, 'audio');
      musicIn = 'music.' + ext;
      await ffmpeg.writeFile(musicIn, await fetchFile(S.music.file));
    }

    const { w: W, h: H } = dims(S.aspect, S.res);

    /* ---- VIDEO: trim + scale/pad each clip, concat, burn captions ---- */
    const vchains = clips.map((c, i) => {
      const base = `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
                   `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,` +
                   `setsar=1,fps=30,format=yuv420p`;
      if(c.kind === 'image') return `[${i}:v]${base}[v${i}]`;
      return `[${i}:v]trim=start=${c.ts.toFixed(3)}:end=${c.te.toFixed(3)},` +
             `setpts=PTS-STARTPTS,${base}[v${i}]`;
    });
    let fc = vchains.join(';') + ';' +
             clips.map((_, i) => `[v${i}]`).join('') +
             `concat=n=${clips.length}:v=1:a=0[cv]`;
    let last = '[cv]';
    if(S.overlays.length){
      S.overlays.forEach((o, k) => {
        const lbl = k === S.overlays.length - 1 ? '[outv]' : `[cv${k}]`;
        fc += `;${last}${ovFilter(o, H)}${lbl}`;
        last = lbl;
      });
    } else {
      fc += ';[cv]null[outv]';
    }

    const inArgs = [];
    clips.forEach((c, i) => {
      if(c.kind === 'image') inArgs.push('-loop', '1', '-framerate', '30', '-t', clipLen(c).toFixed(3));
      inArgs.push('-i', c._in);
    });
    ui.status('Rendering video… (this is the slow part, keep this tab open)');
    phaseBase = 0; phaseSpan = 0.72; phaseTotal = total;
    await x([...inArgs,
      '-filter_complex', fc,
      '-map', '[outv]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-an', 'v.mp4'], 'Video render');
    ui.log('Video track done.');

    /* ---- AUDIO: trimmed clip audio (or silence) per clip, concatenated ---- */
    ui.status('Rendering audio…');
    phaseBase = 0.72; phaseSpan = 0.14; phaseTotal = total;
    for(let i = 0; i < clips.length; i++){
      const c = clips[i], len = clipLen(c).toFixed(3);
      let ok = false;
      if(c.kind !== 'image'){
        const code = await ffmpeg.exec(['-ss', c.ts.toFixed(3), '-t', len, '-i', c._in,
                                        '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'aac', `ca${i}.m4a`])
                                .catch(() => 1);
        ok = (code === 0);
      }
      if(!ok){
        await x(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
                 '-t', len, '-c:a', 'aac', `ca${i}.m4a`], 'Silence track');
      }
    }
    await ffmpeg.writeFile('alist.txt', clips.map((_, i) => `file 'ca${i}.m4a'`).join('\n'));
    await x(['-f', 'concat', '-safe', '0', '-i', 'alist.txt', '-c', 'copy', 'abig.m4a'], 'Audio join');
    ui.log('Audio track done.');

    /* ---- FINAL MUX ---- */
    ui.status('Mixing and finishing…');
    phaseBase = 0.86; phaseSpan = 0.14; phaseTotal = total;
    const vol = Math.min(1, Math.max(0, S.musicVol == null ? 0.5 : S.musicVol));
    if(!musicIn){
      await x(['-i', 'v.mp4', '-i', 'abig.m4a',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart', '-shortest', 'out.mp4'], 'Final mix');
    } else if(S.muteOrig){
      await x(['-i', 'v.mp4', '-stream_loop', '-1', '-i', musicIn,
        '-filter_complex', `[1:a]volume=${vol},atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart', '-t', total.toFixed(3), 'out.mp4'], 'Final mix');
    } else {
      await x(['-i', 'v.mp4', '-i', 'abig.m4a', '-stream_loop', '-1', '-i', musicIn,
        '-filter_complex', `[2:a]volume=${vol}[mv];[1:a][mv]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart', '-shortest', 'out.mp4'], 'Final mix');
    }

    const data = await ffmpeg.readFile('out.mp4');
    const blob = new Blob([data], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    ui.progress(1);
    ui.done(url, `bismark-cut-${stamp}.mp4`);
    try{ ffmpeg.terminate(); }catch(e){}
  }

  return { run };
})();
