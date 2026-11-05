/* Som do tour: música gerada na hora com Web Audio, sem arquivo de som.
   Tema: água e rio. Tudo segue a câmera, que o tour informa a cada quadro:
     zoom        → brilho da correnteza e a densidade das gotas (de perto, mais gotas)
     inclinação  → quanto vai para o eco da "caverna" e a altura das gotas
     rumo        → posição esquerda/direita dos sinos
     velocidade  → força da correnteza, do vento d'água e dos arpejos nos voos
     vazão       → o bordão: quanto maior o rio da cena, mais grave, cheio e aberto
   Vozes:
     correnteza  ruído filtrado em duas bandas que borbulham (LFOs lentos), mais um rumor grave
     bordão      seno + triângulo + quinta, que respira como a maré e segue a vazão do rio da cena
     colchão     três triângulos desafinados num acorde de cluster aberto, filtro pelo zoom
     gotas       senos com glissando para cima (o "plic" da gota), em eco, nas notas da escala
     sinos       FM de decaimento longo; cascata descendo a escala, como ondas num remanso
   Escala própria: hexatônica lídia aberta sobre mi (0 2 4 6 7 9, a quarta aumentada dá o
   brilho de superfície d'água), 72 bpm. Cada cena muda a raiz do bordão e do colchão.
   Saída sempre com rampa (entrada e saída), para não estalar. O AudioContext só nasce dentro
   de iniciar(), que o tour chama no gesto do leitor. A preferência (ligado/mudo) fica em
   localStorage. */
(() => {
  const CHAVE = 'rios-tour-som';
  const ESCALA = [0, 2, 4, 6, 7, 9];
  const MI = 82.41;                      // mi 2
  const BPM = 72, BATIDA = 60 / BPM, PASSO = BATIDA / 2;
  // raiz de cada cena, em semitons sobre o mi (fora da escala de propósito: o tour modula)
  const RAIZ = [0, 7, 2, 4, -3, 9, -5, 2, 6, 0, 4, 0];

  let ctx = null, saida, bus, sala, ruido, an = null;
  let corr, rumor, bordao, colchao;
  let tocando = false, ligado = true, timer = 0, prox = 0, passo = 0, raiz = 0, fala = 0;
  let vazao = 0.5;                       // 0 (fio d'água) a 1 (Amazonas)
  const cam = { zoom: 4, pitch: 0, bearing: 0, vel: 0 };
  let parouEm = 0;

  try { ligado = localStorage.getItem(CHAVE) !== 'off'; } catch (e) { /* sem storage */ }

  const hz = (semi, oit = 0) => MI * 2 ** ((semi + 12 * oit) / 12);
  const lim = (v, a, b) => Math.max(a, Math.min(b, v));
  const sorte = a => a[Math.floor(Math.random() * a.length)];
  const nota = (grau, oit) => ESCALA[((grau % 6) + 6) % 6] + 12 * (oit + Math.floor(grau / 6));

  function montar() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (navigator.audioSession) { try { navigator.audioSession.type = 'ambient'; } catch (e) { /* iOS antigo */ } }
    // mestre: passa-altas, compressor, teto suave e a saída com ganho 0 (sobe com rampa)
    const pa = ctx.createBiquadFilter(); pa.type = 'highpass'; pa.frequency.value = 32;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    const teto = ctx.createWaveShaper();
    const curva = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curva[i] = Math.tanh((i / 511.5 - 1) * 1.15) / Math.tanh(1.15);
    teto.curve = curva;
    saida = ctx.createGain(); saida.gain.value = 0;
    bus = ctx.createGain(); bus.gain.value = 0.85;
    bus.connect(pa); pa.connect(comp); comp.connect(teto); teto.connect(saida); saida.connect(ctx.destination);

    // caverna: 3,2 s de ruído morrendo, os agudos primeiro
    const n = Math.floor(ctx.sampleRate * 3.2), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, k = 0.1 + 0.85 * t;
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * (1 - t) ** 2.2 * 0.55;
      }
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const pre = ctx.createDelay(); pre.delayTime.value = 0.02;
    sala = ctx.createGain(); sala.gain.value = 0.3;
    sala.connect(pre); pre.connect(conv); conv.connect(bus);

    ruido = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const r = ruido.getChannelData(0);
    for (let i = 0; i < r.length; i++) r[i] = Math.random() * 2 - 1;
    const fonteRuido = () => { const s = ctx.createBufferSource(); s.buffer = ruido; s.loop = true; s.start(0, Math.random() * 1.5); return s; };
    const lfo = (f, prof, alvo) => {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = prof; o.connect(g); g.connect(alvo); o.start(); return o;
    };

    // correnteza: duas bandas que borbulham, mais o rugido largo e o sub-grave da cascata.
    // A cadeia toda passa por um filtro que abre com a proximidade, por uma saturação suave e
    // por um par seco/eco: perto, seco e presente; longe, abafado e cheio de sala.
    const cg = ctx.createGain(); cg.gain.value = 0;
    const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.Q.value = 1.4; b1.frequency.value = 420;
    const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.Q.value = 3.2; b2.frequency.value = 1500;
    const s1 = fonteRuido(), s2 = fonteRuido();
    s1.connect(b1); s2.connect(b2); b1.connect(cg); b2.connect(cg);
    lfo(0.17, 160, b1.frequency); lfo(0.43, 520, b2.frequency); lfo(0.9, 0.7, b2.Q);
    // rugido: faixa larga (Q baixo) + sub-grave; só cresce com a força do rio (escala log)
    const rgG = ctx.createGain(); rgG.gain.value = 0;
    const rgB = ctx.createBiquadFilter(); rgB.type = 'bandpass'; rgB.Q.value = 0.25; rgB.frequency.value = 600;
    const rs0 = fonteRuido(); rs0.connect(rgB); rgB.connect(rgG);
    const subF = ctx.createBiquadFilter(); subF.type = 'lowpass'; subF.frequency.value = 90; subF.Q.value = 0.7;
    const subS = fonteRuido(); subS.playbackRate.value = 0.7; subS.connect(subF); subF.connect(rgG);
    lfo(0.23, 0.25, rgG.gain);
    // espuma: grãos de agudo (ruído picotado), só acima de ~50 mil m³/s
    const grãos = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), gd = grãos.getChannelData(0);
    for (let i = 0; i < gd.length;) {
      const n = 20 + Math.floor(Math.random() * 90), nivel = Math.random() < 0.45 ? Math.random() : 0;
      for (let k = 0; k < n && i < gd.length; k++, i++) gd[i] = (Math.random() * 2 - 1) * nivel * (1 - k / n);
    }
    const espS = ctx.createBufferSource(); espS.buffer = grãos; espS.loop = true; espS.start();
    const espF = ctx.createBiquadFilter(); espF.type = 'highpass'; espF.frequency.value = 4200;
    const espG = ctx.createGain(); espG.gain.value = 0;
    espS.connect(espF); espF.connect(espG);
    const soma = ctx.createGain(); cg.connect(soma); rgG.connect(soma); espG.connect(soma);
    const cl = ctx.createBiquadFilter(); cl.type = 'lowpass'; cl.Q.value = 0.5; cl.frequency.value = 700;
    const sat = ctx.createWaveShaper(), cv = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) cv[i] = Math.tanh((i / 511.5 - 1) * 1.6) / Math.tanh(1.6);
    sat.curve = cv;
    const pan = ctx.createStereoPanner(); pan.pan.value = 0;
    soma.connect(cl); cl.connect(sat); sat.connect(pan);
    const seco = ctx.createGain(); seco.gain.value = 0.4; pan.connect(seco); seco.connect(bus);
    const cs = ctx.createGain(); cs.gain.value = 0.7; pan.connect(cs); cs.connect(sala);
    corr = { g: cg, b1, b2, rg: rgG, rgB, esp: espG, cl, pan, seco, eco: cs, soma };

    // rumor grave da massa d'água
    const rg = ctx.createGain(); rg.gain.value = 0;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 150; rf.Q.value = 0.5;
    const rs = fonteRuido(); rs.connect(rf); rf.connect(rg); rg.connect(bus);
    lfo(0.11, 0.35, rg.gain);
    rumor = { g: rg, f: rf };

    // bordão: seno + triângulo na oitava + quinta, que respira
    const bg = ctx.createGain(); bg.gain.value = 0;
    const bf = ctx.createBiquadFilter(); bf.type = 'lowpass'; bf.Q.value = 0.6; bf.frequency.value = 260;
    const o1 = ctx.createOscillator(); o1.type = 'sine';
    const o2 = ctx.createOscillator(); o2.type = 'triangle';
    const o3 = ctx.createOscillator(); o3.type = 'sine';
    const g2 = ctx.createGain(); g2.gain.value = 0.28; const g3 = ctx.createGain(); g3.gain.value = 0.16;
    o1.connect(bg); o2.connect(g2); g2.connect(bg); o3.connect(g3); g3.connect(bg);
    bg.connect(bf); bf.connect(bus);
    const be = ctx.createGain(); be.gain.value = 0.4; bf.connect(be); be.connect(sala);
    lfo(0.08, 0.04, bg.gain);            // a maré: sobe e desce devagar sobre o nível-base
    [o1, o2, o3].forEach(o => o.start());
    bordao = { g: bg, f: bf, o1, o2, o3 };

    // colchão: acorde aberto (raiz, 2ª, 5ª), três triângulos desafinados cada
    const cg2 = ctx.createGain(); cg2.gain.value = 0;
    const cf = ctx.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 700; cf.Q.value = 0.4;
    const oscs = [0, 2, 7].flatMap(semi => [-7, 0, 6].map(det => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.detune.value = det; o.start();
      const g = ctx.createGain(); g.gain.value = 0.33; o.connect(g); g.connect(cg2);
      return { o, semi };
    }));
    cg2.connect(cf); cf.connect(bus);
    const ce = ctx.createGain(); ce.gain.value = 0.6; cf.connect(ce); ce.connect(sala);
    colchao = { g: cg2, f: cf, oscs };
    afinar(0);
  }

  function afinar(deslize) {
    const t = ctx.currentTime, k = Math.max(0.001, deslize);
    bordao.o1.frequency.setTargetAtTime(hz(raiz), t, k);
    bordao.o2.frequency.setTargetAtTime(hz(raiz, 1), t, k);
    bordao.o3.frequency.setTargetAtTime(hz(raiz + 7), t, k);
    colchao.oscs.forEach(c => c.o.frequency.setTargetAtTime(hz(raiz + c.semi, 2), t, k));
  }

  // ---------- vozes curtas ----------

  // a gota: seno cujo tom sobe depressa (o "plic"), com um segundo toque fraco, mais grave
  function gota(t, f, v, pan) {
    const dur = 0.11 + Math.random() * 0.07;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 0.78, t); o.frequency.exponentialRampToValueAtTime(f * 1.32, t + 0.05);
    const g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = lim(pan, -1, 1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(p); p.connect(bus);
    const e = ctx.createGain(); e.gain.value = 0.9; p.connect(e); e.connect(sala);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // sino de água: FM com modulador inarmônico que morre antes da portadora
  function sino(t, f, v, pan, dur = 2.2) {
    const c = ctx.createOscillator(); c.type = 'sine'; c.frequency.value = f;
    const m = ctx.createOscillator(); m.type = 'sine'; m.frequency.value = f * 3.51;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.6, t); mg.gain.exponentialRampToValueAtTime(f * 0.02, t + dur * 0.5);
    m.connect(mg); mg.connect(c.frequency);
    const g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = lim(pan, -1, 1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    c.connect(g); g.connect(p); p.connect(bus);
    const e = ctx.createGain(); e.gain.value = 0.8; p.connect(e); e.connect(sala);
    [c, m].forEach(x => { x.start(t); x.stop(t + dur + 0.1); });
  }

  // maré subindo: ruído em banda que varre para cima e cai, na troca de cena
  function onda(t, dur = 1.8, v = 1) {
    const s = ctx.createBufferSource(); s.buffer = ruido; s.start(t, Math.random());
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.7);
    f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22 * v, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    const e = ctx.createGain(); e.gain.value = 0.6; g.connect(e); e.connect(sala);
    s.stop(t + dur + 0.05);
  }

  // cascata: o sino desce a escala em colcheias, como ondas num remanso
  function cascata(t0 = ctx.currentTime + 0.05, n = 4 + Math.floor(Math.random() * 3)) {
    const perto = lim((cam.zoom - 4) / 5, 0, 1);
    const pan = Math.sin(cam.bearing * Math.PI / 180) * 0.5;
    let grau = 5 + Math.floor(Math.random() * 3 + perto * 3);
    let t = t0;
    for (let i = 0; i < n; i++) {
      const semi = nota(grau, 2) + raiz;
      sino(t, hz(semi), 0.55 + Math.random() * 0.35 - i * 0.04, pan + (Math.random() - 0.5) * 0.3, i === n - 1 ? 3.4 : 1.8);
      grau -= sorte([1, 1, 1, 2]);
      t += PASSO * sorte([1, 1, 1.5]);
    }
    fala = performance.now() + (t - t0) * 1000 + 1500;
  }

  // ---------- agendador ----------
  function agendar() {
    if (!ctx || !tocando) return;
    while (prox < ctx.currentTime + 0.15) {
      const t = prox;
      const perto = lim((cam.zoom - 4) / 5, 0, 1), v = cam.vel;
      // gotas: um processo de Poisson, mais denso de perto e em movimento; mais agudas com a câmera inclinada
      const taxa = (0.9 + 2.2 * perto + 4 * v) * PASSO;
      if (Math.random() < taxa) {
        const grau = 4 + Math.floor(Math.random() * 7) + Math.round(cam.pitch / 35);
        gota(t + Math.random() * PASSO, hz(nota(grau, 2) + raiz), 0.4 + Math.random() * 0.6,
          (Math.random() - 0.5) * 1.6 + Math.sin(cam.bearing * Math.PI / 180) * 0.3);
      }
      // nos voos rápidos, arpejo subindo (a correnteza acelera)
      if (v > 0.35 && passo % 2 === 0 && Math.random() < v) {
        sino(t, hz(nota(passo / 2 % 6 + 6, 2) + raiz), 0.3 * v, Math.sin(cam.bearing * Math.PI / 180) * 0.6, 1.2);
      }
      passo++; prox += PASSO;
    }
    // câmera calma: a cascata volta sozinha
    if (cam.vel < 0.3 && performance.now() > fala) cascata();
  }

  // câmera → som. `forca` (0 a 1) é o rio mais forte perto do centro da tela em ESCALA LOG da vazão,
  // ponderada pela distância (q / (1 + d / 8 km)): 1 m³/s dá ~0,05 (fio d'água), 1.800 (São Francisco)
  // ~0,6 e 198 mil (Amazonas) ~1. `perto` (0 a 1) é a proximidade pura, 1 / (1 + d / 20 km). O tour
  // as recalcula a cada ~100 ms pelo índice espacial; `pan` é o lado da tela em que o rio está.
  const sm = (a, b, x) => { const u = lim((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  function camera(c) {
    Object.assign(cam, c);
    if (!ctx || !tocando) return;
    const t = ctx.currentTime, v = cam.vel, f = cam.forca || 0, p = cam.perto || 0;
    const T = 0.35;
    corr.g.gain.setTargetAtTime(0.012 + 0.05 * f * f + 0.06 * v * f + 0.015 * v, t, T);
    corr.rg.gain.setTargetAtTime(0.18 * Math.pow(f, 3.2), t, T);                  // rugido: só os grandes
    corr.rgB.frequency.setTargetAtTime(250 + 700 * p, t, T);
    corr.esp.gain.setTargetAtTime(0.12 * sm(0.84, 0.96, f), t, 0.5);                // espuma > ~50 mil m³/s
    corr.b1.frequency.setTargetAtTime(260 + 500 * v + 900 * p, t, T);
    corr.b2.Q.setTargetAtTime(2 + 2.5 * p, t, T);
    corr.cl.frequency.setTargetAtTime(450 + 9500 * Math.pow(p, 0.8), t, T);         // longe abafado, perto claro
    corr.seco.gain.setTargetAtTime(0.25 + 0.75 * p, t, T);
    corr.eco.gain.setTargetAtTime(0.95 - 0.75 * p, t, T);
    corr.pan.pan.setTargetAtTime(lim(cam.pan || 0, -0.85, 0.85), t, 0.5);
    rumor.g.gain.setTargetAtTime(0.01 + 0.1 * f, t, 0.6);                           // o rumor cresce e abre
    rumor.f.frequency.setTargetAtTime(90 + 260 * f, t, 0.6);
    sala.gain.setTargetAtTime(0.2 + (cam.pitch / 70) * 0.35, t, 0.3);
    colchao.f.frequency.setTargetAtTime(lim(500 * 2 ** (cam.zoom / 3.2), 380, 2600), t, 0.3);
  }

  // o bordão segue a vazão do rio da cena
  function segueVazao(alvo) {
    vazao = lim(alvo, 0, 1);
    if (!ctx || !tocando) return;
    const t = ctx.currentTime;
    bordao.g.gain.setTargetAtTime(0.045 + 0.1 * vazao, t, 0.9);
    bordao.f.frequency.setTargetAtTime(150 + 520 * vazao, t, 0.9);
    colchao.g.gain.setTargetAtTime(0.02 + 0.015 * vazao, t, 1.2);
  }

  // ---------- API usada pelo tour ----------
  function iniciar() {
    if (!ligado) return false;
    if (!ctx) montar();
    ctx.resume();
    clearTimeout(parouEm);
    tocando = true;
    const t = ctx.currentTime;
    saida.gain.cancelScheduledValues(t);
    saida.gain.setValueAtTime(saida.gain.value, t);
    saida.gain.linearRampToValueAtTime(1, t + 0.6);
    prox = t + 0.1; passo = 0; fala = performance.now() + 1200;
    segueVazao(vazao);
    camera(cam);
    clearInterval(timer); timer = setInterval(agendar, 25);
    return true;
  }

  function cena(i, o = {}) {
    if (!tocando) return;
    raiz = RAIZ[i % RAIZ.length];
    if (o.vazao !== undefined) segueVazao(o.vazao); else segueVazao(vazao);
    afinar(0.9);
    const t = ctx.currentTime + 0.03;
    onda(t, 1.8, 0.9);
    sino(t + 1.1, hz(raiz, 3), 0.8, 0, 3.4);
    fala = performance.now() + 2500;
  }

  function legenda() {
    if (!tocando || !ctx) return;
    if (performance.now() > fala - 400) cascata(ctx.currentTime + 0.25);
  }

  // saída: rampa até zero (sem estalo), cadência opcional e só então suspende
  function parar(cadencia = false) {
    if (!ctx || !tocando) return;
    tocando = false;
    clearInterval(timer);
    const t = ctx.currentTime;
    let atraso = 0, fade = 0.35;
    if (cadencia) {
      [9, 7, 4, 0].forEach((s, i) => sino(t + i * 0.45, hz(s, 3), 0.8, (i - 1.5) * 0.3, i === 3 ? 4 : 1.6));
      atraso = 1.6; fade = 2.8;
    }
    saida.gain.cancelScheduledValues(t);
    saida.gain.setValueAtTime(saida.gain.value, t);
    if (atraso) saida.gain.setValueAtTime(saida.gain.value, t + atraso);
    saida.gain.linearRampToValueAtTime(0, t + atraso + fade);
    for (const x of [corr.g, corr.rg, corr.esp, rumor.g, bordao.g, colchao.g]) x.gain.setTargetAtTime(0, t + atraso, fade / 4);
    clearTimeout(parouEm);
    parouEm = setTimeout(() => { if (!tocando && ctx.state === 'running') ctx.suspend(); }, (atraso + fade + 0.4) * 1000);
  }

  function alternar() {
    ligado = !ligado;
    try { localStorage.setItem(CHAVE, ligado ? 'on' : 'off'); } catch (e) { /* sem storage */ }
    if (!ligado) parar(false);
    return ligado;
  }

  // a aba escondida cala; ao voltar, o som volta sozinho
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !tocando) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  // nível de saída (RMS, 0 a 1): só serve à suíte e a quem queira conferir que há som
  function nivel() {
    if (!ctx || !saida) return null;
    if (!an) { an = ctx.createAnalyser(); an.fftSize = 2048; saida.connect(an); }
    const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
    let q = 0; for (const x of d) q += x * x;
    return Math.sqrt(q / d.length);
  }

  window.SomRio = { iniciar, cena, legenda, camera, parar, alternar, nivel,
    ligado: () => ligado, criado: () => !!ctx, estado: () => (ctx ? ctx.state : 'nenhum') };
})();
