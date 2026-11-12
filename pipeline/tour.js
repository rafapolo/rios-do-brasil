  /* ---------- tour ----------
     Um passeio de ~2 minutos por fatos conferidos no banco (design/tour.json, com as notas de
     verificação em design/tour.md). Mora dentro da IIFE porque ele dirige a página pelos mesmos
     pontos de entrada do leitor: aplicaModo, os interruptores de camada, define3D, realcar e a
     câmera da biblioteca. Esc e "✕ esc" param e devolvem tudo como estava; ?tour=1 abre um
     convite (o navegador só libera o som depois de um gesto); ?tour=en faz o mesmo com a legenda
     em inglês (kicker_en, frase_en e fonte_en do roteiro); ?rapido=N acelera o relógio do
     tour N vezes (para a suíte). O som é o SomRio (som_tour.js), que segue a câmera. */
  const TOUR = (() => {
    const $ = id => document.getElementById(id);
    const ROTEIRO = JSON.parse($('roteiro').textContent);
    const CAMADAS = { fluxo: 'btFluxo', estacoes: 'btEst', reservatorios: 'btRes', satelite: 'btSat', etes: 'btEtes' };
    const q0 = new URLSearchParams(BUSCA0);
    const RAPIDO = Math.min(60, Math.max(1, parseFloat(q0.get('rapido')) || 1));
    /* a língua da legenda vale para a visita inteira: o ?tour=en sai do endereço, mas o botão Tour
       aberto depois segue em inglês */
    const EN = q0.get('tour') === 'en';
    const txt = (c, k) => (EN && c[k + '_en']) || c[k] || '';
    const som = window.SomRio || null;
    const lim = (v, a, b) => Math.max(a, Math.min(b, v));

    let ativo = false, inicio = 0, TOTAL = 120000, raf = 0, salvo = null, cenaAtual = 0;
    let PAD = { top: 0, bottom: 0, left: 0, right: 0 }, quemChamou = null;
    const pendentes = new Set();
    class Parado extends Error {}

    /* espera que o "parar" interrompe na hora */
    const espera = ms => new Promise((ok, falha) => {
      const p = { falha };
      p.id = setTimeout(() => { pendentes.delete(p); ok(); }, Math.max(0, ms));
      pendentes.add(p);
    });

    /* ---- o rio de uma cena ----
       O nome casa EXATO (sem acento) com o índice da busca. Há dezenas de "Rio Formoso" e
       "Rio Preto" no país; vale o que fica a menos de 1,5° do centro da cena e, entre esses, o
       de maior vazão. Em cena larga (zoom < 5) não há essa restrição. */
    function acharRio(nome, centro, zoom) {
      const ix = montaBusca();
      const alts = nome.split(/\s+ou\s+/).map(s => s.trim());
      const cx = projX(centro[0]), cy = merc(centro[1]);
      const margem = Math.abs(projX(centro[0] + 1.5) - cx), margemY = Math.abs(merc(centro[1] + 1.5) - cy);
      let melhor = null;
      const veja = (k, alt) => {
        for (let j = ix.nomeIni[k]; j < ix.nomeIni[k + 1]; j++) {
          const i = ix.repr[ix.nomeLista[j]];
          let minx = 1, miny = 1, maxx = 0, maxy = 0;
          for (const t of trechosDoRio(i)) {
            const b = t * 4;
            if (bbox[b] < minx) minx = bbox[b]; if (bbox[b + 1] < miny) miny = bbox[b + 1];
            if (bbox[b + 2] > maxx) maxx = bbox[b + 2]; if (bbox[b + 3] > maxy) maxy = bbox[b + 3];
          }
          const dx = Math.max(minx - cx, 0, cx - maxx), dy = Math.max(miny - cy, 0, cy - maxy);
          const perto = zoom < 5 || (dx < margem && dy < margemY);
          const d = Math.hypot(dx / margem, dy / margemY);
          // em cena de perto vale o curso mais longo (o Paranapanema vem em três pedaços, o maior é o do meio);
          // em cena larga, o de maior vazão
          let km = 0;
          if (comps) for (const t of trechosDoRio(i)) km += comps[t];
          const c = { i, q: q[i], perto, d, alt, peso: zoom < 5 || !comps ? q[i] : km };
          if (!melhor || (c.perto && !melhor.perto) ||
              (c.perto === melhor.perto && (c.perto ? c.peso > melhor.peso : c.d < melhor.d))) melhor = c;
        }
      };
      for (const alt of alts) {
        const chave = semAcento(alt);
        for (let k = 0; k < ix.chaves.length; k++) if (ix.chaves[k] === chave) veja(k, alt);
      }
      return melhor && { i: melhor.i, nome: D.nomes[nomeIdx[melhor.i]], uf: ufDoRio(melhor.i), q: melhor.q };
    }

    /* o que o realce acende: um rio (o curso inteiro) ou, em "Sobradinho", o reservatório */
    function realcaDe(nome, centro, zoom) {
      const res = RES.find(u => u.nome && semAcento(u.nome) === semAcento(nome));
      if (res) return { alvo: { u: res }, vazao: res.turb || 0, nome: res.nome };
      const r = acharRio(nome, centro, zoom);
      if (!r) return null;
      return { alvo: { i: r.i }, vazao: r.q, nome: r.nome, uf: r.uf };
    }
    const vazaoNorm = v => lim((Math.log10(Math.max(v, 0.01)) + 0.5) / 5.8, 0, 1);

    /* ---- a janela do mapa: o que as faixas deixam livre ----
       No desktop são as faixas de cinema (a legenda mora na de baixo); no celular, uma faixa fina
       em cima e a legenda embaixo. O padding da biblioteca tira a câmera de baixo delas, para o
       assunto da cena ficar no meio do que se vê. */
    function medeJanela() {
      const cap = $('tour-cap'), kick = $('tour-kicker'), lin = $('tour-line'), fon = $('tour-fonte');
      let alto = 0;
      $('tour-baixo').style.minHeight = '';
      cap.style.visibility = 'hidden';
      for (const c of ROTEIRO) {
        kick.textContent = txt(c, 'kicker'); lin.textContent = txt(c, 'frase'); fon.textContent = txt(c, 'fonte');
        alto = Math.max(alto, $('tour-baixo').offsetHeight);
      }
      cap.style.visibility = '';
      // a faixa fica na altura da maior legenda: não pula de uma cena para a outra
      $('tour-baixo').style.minHeight = alto + 'px';
      kick.textContent = lin.textContent = fon.textContent = '';
      PAD = { top: $('tour-topo').offsetHeight, bottom: Math.max(alto, $('tour-baixo').offsetHeight), left: 0, right: 0 };
      document.documentElement.style.setProperty('--tour-baixo', PAD.bottom + 'px');
      return PAD;
    }
    /* os zooms do roteiro foram enquadrados num desktop de 1280 × 800 (janela livre de 1280 × 544);
       em tela menor o mesmo zoom cortaria o assunto, então desconta o que falta */
    const dzTela = () => {
      const vis = Math.max(200, H - PAD.top - PAD.bottom);
      return lim(Math.log2(Math.min(W / 1280, vis / 544)), -1.7, 0.7);
    };

    /* ---- câmera ---- */
    const camDe = c => ({ center: c.camera.centro, zoom: c.camera.zoom + dzTela(), pitch: c.camera.pitch,
                          bearing: c.camera.bearing, padding: PAD });
    function voo(c, i, dur) {
      const alvo = camDe(c);
      alvo.zoom = lim(alvo.zoom, map.getMinZoom(), map.getMaxZoom());
      if (semMovimento.matches) { map.jumpTo(alvo); return; }
      const subida = Math.min(4200 / RAPIDO, dur * 0.45);
      map.flyTo({ ...alvo, duration: subida, essential: true, curve: 1.25 });
      // chegou: devagar, o rumo gira um pouco e a câmera chega mais perto, até o fim da cena
      const resto = dur - subida;
      const deriva = (i % 2 ? -1 : 1) * (alvo.pitch > 5 ? 12 : 0);
      espera(subida).then(() => {
        if (!ativo || cenaAtual !== i) return;
        map.easeTo({ bearing: alvo.bearing + deriva, zoom: alvo.zoom + 0.14, duration: resto,
                     easing: t => t, essential: true, padding: PAD });
      }, () => {});
    }

    /* ---- painéis em uso ----
       Na cena `painel` o tour mostra a hud (no celular sobe o painel de cima da legenda) e aperta os
       botões de verdade, um a um, com um aro que pisca: "modo:outorga", "camada:estacoes". */
    const ALVO_PAINEL = { 'modo': v => document.querySelector('.modo[data-modo="' + v + '"]'),
      'camada': v => document.getElementById(CAMADAS[v]) };
    function painelAberto(on, nome) {
      document.body.classList.toggle('tour-painel', on);
      if (!ehCelular()) return;
      if (on) abrirPainel(nome || 'modo'); else fecharPainel();
    }
    function usaPainel(c, i, dur) {
      const passos = c.painel;
      passos.forEach((p, k) => {
        const [tipo, v] = p.split(':');
        espera(dur * (k + 1) / (passos.length + 1) - 300 / RAPIDO).then(async () => {
          if (!ativo || cenaAtual !== i) return;
          if (ehCelular()) abrirPainel(tipo === 'modo' ? 'modo' : 'camadas');
          const b = ALVO_PAINEL[tipo](v);
          if (!b) return;
          b.classList.add('tour-toque');
          await espera(600 / RAPIDO);
          if (!ativo || cenaAtual !== i) { b.classList.remove('tour-toque'); return; }
          b.click();
          await espera(500 / RAPIDO);
          b.classList.remove('tour-toque');
        }).catch(() => {});
      });
    }

    /* ---- modo e camadas ---- */
    function aplicaCena(c) {
      if (modo !== c.modo && botoesModo.some(b => b.isConnected && b.dataset.modo === c.modo)) aplicaModo(c.modo);
      // só depois do modo: ele mesmo apaga ou acende Estações e Reservatórios
      painelAberto(!!c.painel);
      const quer = new Set((c.camadas || []).map(n => CAMADAS[n]));
      for (const id of Object.values(CAMADAS)) defineCamada(id, quer.has(id));
    }

    /* ---- legenda ---- */
    function escreveLegenda(c) {
      $('tour-kicker').textContent = txt(c, 'kicker');
      $('tour-line').textContent = txt(c, 'frase');
      $('tour-fonte').textContent = txt(c, 'fonte');
    }

    function progresso() {
      const t = Math.min(1, (performance.now() - inicio) / TOTAL);
      document.querySelector('#tour-progress i').style.transform = 'scaleX(' + t + ')';
      const resta = Math.ceil(TOTAL * (1 - t) * RAPIDO / 1000);
      $('tour-left').textContent = resta >= 60
        ? String(Math.floor(resta / 60)).padStart(2, '0') + ':' + String(resta % 60).padStart(2, '0')
        : resta + ' s';
      sigaCamera();
      if (ativo) raf = requestAnimationFrame(progresso);
    }

    /* proximidade de rio de verdade: os trechos grandes de todo o país (q >= 300 m³/s, lista feita uma vez)
       mais os que o índice espacial acha em volta do centro da janela. Vale o melhor de q / (1 + d / 8 km),
       d em metros pela caixa do trecho. Devolve a força em escala log (5,4 décadas = 1), a proximidade
       pura e o lado da tela do rio vencedor. */
    let GRANDES = null;
    function proximidade() {
      if (!GRANDES) { const l = []; for (let i = 0; i < N; i++) if (q[i] >= 300) l.push(i); GRANDES = Int32Array.from(l); }
      lerCamera();
      const c = map.getCenter();
      const [sx0, sy0] = [W / 2, (PAD.top + (H - PAD.bottom)) / 2];
      const [wx, wy] = paraMundo(sx0, sy0);
      const m = 40075016 * Math.cos(c.lat * Math.PI / 180);
      let melhor = -1, ms = 0, md = 1e9;
      const vê = i => {
        const b = i * 4;
        const dx = Math.max(bbox[b] - wx, 0, wx - bbox[b + 2]) * m, dy = Math.max(bbox[b + 1] - wy, 0, wy - bbox[b + 3]) * m;
        const d = Math.hypot(dx, dy), s = q[i] / (1 + d / 8000);
        if (s > ms) { ms = s; melhor = i; md = d; }
      };
      for (let k = 0; k < GRANDES.length; k++) vê(GRANDES[k]);
      const cx = Math.floor((wx - bounds.minx) / spanX * (GRID - 1)), cy = Math.floor((wy - bounds.miny) / spanY * (GRID - 1));
      for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) {
        if (cx + dx < 0 || cx + dx >= GRID || cy + dy < 0 || cy + dy >= GRID) continue;
        const k = chave(cx + dx, cy + dy);
        for (let e = celIni[k]; e < celIni[k + 1]; e++) vê(celLista[e]);
      }
      if (melhor < 0) return { forca: 0, perto: 0, pan: 0 };
      const b = melhor * 4, [tx] = paraTela((bbox[b] + bbox[b + 2]) / 2, (bbox[b + 1] + bbox[b + 3]) / 2);
      return { forca: lim(Math.log10(1 + ms) / 5.4, 0, 1), perto: 1 / (1 + md / 20000),
               pan: tx === tx ? lim((tx - W / 2) / (W / 2), -1, 1) : 0 };
    }

    /* câmera → som: velocidade em px de tela, de zoom e de giro por segundo (0 a 1) */
    let ult = null, vel = 0, prox = { forca: 0, perto: 0, pan: 0 }, proxEm = 0;
    function sigaCamera() {
      if (!som) return;
      const agora = performance.now(), c = map.getCenter(), z = map.getZoom(), b = map.getBearing();
      if (ult) {
        const dt = Math.max(0.001, (agora - ult.t) / 1000);
        const pt = map.project(ult.c);
        const px = Math.hypot(pt.x - W / 2, pt.y - H / 2);
        const giro = ((b - ult.b + 540) % 360) - 180;
        const alvo = lim(Math.sqrt((px + Math.abs(z - ult.z) * 800 + Math.abs(giro) * 4) / dt / 1500), 0, 1);
        vel += (alvo - vel) * (alvo > vel ? 0.25 : 0.05);
      }
      ult = { t: agora, c, z, b };
      if (agora - proxEm > 100) { proxEm = agora; prox = proximidade(); }
      som.camera({ zoom: z, pitch: map.getPitch(), bearing: b, vel, ...prox });
    }

    async function iniciar(quem, congelado) {
      if (ativo) return;
      ativo = true;
      quemChamou = quem || document.activeElement;
      // o AudioContext nasce AQUI, de forma síncrona dentro do gesto do leitor, antes de qualquer await
      if (som && !congelado) som.iniciar();
      fechaConvite();
      salvo = {
        modo, camadas: Object.values(CAMADAS).map(id => [id, { btFluxo: animando, btEst: mostrarEst, btRes: mostrarRes,
          btEtes: mostrarEtes, btSat: mostrarSat }[id]]),
        hud: [hud.dataset.aberto, hud.classList.contains('recolhido')],
        antes: camadasAntes && [...camadasAntes], em3D, urlPronta, camMexida,
        cam: { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() },
      };
      // a URL não acompanha o passeio: voltaria a abrir o que a pessoa não pediu
      urlPronta = false;
      abrirGaveta(false);
      document.body.classList.add('touring');
      $('tour').hidden = false;
      $('tour').classList.remove('saindo');
      document.querySelector('#tour-progress i').style.transform = 'scaleX(0)';
      marcaSom();
      medeJanela();
      requestAnimationFrame(() => $('tour').classList.add('on'));
      TOTAL = ROTEIRO.reduce((s, c) => s + c.duracao_ms, 0) / RAPIDO;
      inicio = performance.now(); ult = null; vel = 0;
      define3D(true, { animar: false, manterCamera: true });
      map.setMaxPitch(PITCH_MAX);
      if (congelado) return;     // enquadramento estático (ferramenta de ajuste das câmeras): sem relógio
      raf = requestAnimationFrame(progresso);
      try {
        let fim = 0;
        for (const [i, c] of ROTEIRO.entries()) {
          const t0 = performance.now(), dur = c.duracao_ms / RAPIDO;
          cenaAtual = i; fim += dur;
          $('tour-cap').classList.remove('on');
          aplicaCena(c);
          const rc = c.realce ? realcaDe(c.realce, c.camera.centro, c.camera.zoom) : null;
          if (rc) realcar(rc.alvo); else realcar(null);
          repintar();
          voo(c, i, dur);
          if (c.painel) usaPainel(c, i, dur);
          if (som) som.cena(i, { vazao: rc ? vazaoNorm(rc.vazao) : 0.5 });
          // a legenda troca com a câmera já em voo, como num corte de cinema
          await espera(450 / RAPIDO);
          escreveLegenda(c);
          $('tour-cap').classList.add('on');
          if (som) som.legenda();
          await espera(t0 + dur - performance.now());
        }
        cancelAnimationFrame(raf);
        $('tour').classList.add('saindo');
        await espera(800 / RAPIDO);
        parar(true);
      } catch (e) {
        if (!(e instanceof Parado)) { console.error(e); parar(false); }
      }
    }

    /* fim natural: cadência de sinos; parado no meio: o som some rápido */
    function parar(natural = false) {
      if (!ativo) return;
      ativo = false;
      cancelAnimationFrame(raf);
      for (const p of pendentes) { clearTimeout(p.id); p.falha(new Parado()); }
      pendentes.clear();
      if (som) som.parar(natural);
      map.stop();
      document.body.classList.remove('tour-painel');
      document.querySelectorAll('.tour-toque').forEach(b => b.classList.remove('tour-toque'));
      document.documentElement.style.removeProperty('--tour-baixo');
      hud.dataset.aberto = salvo.hud[0]; hud.classList.toggle('recolhido', salvo.hud[1]); marcarHud();
      // devolve tudo como estava: modo, camadas, 3D, limites e padding da página, câmera, seleção
      if (modo !== salvo.modo) aplicaModo(salvo.modo);
      camadasAntes = salvo.antes;
      for (const [id, v] of salvo.camadas) defineCamada(id, v);
      define3D(salvo.em3D, { animar: false, manterCamera: true });
      limitesDeZoom();
      map.jumpTo({ ...salvo.cam, padding: { top: 0, left: 0, right: 0, bottom: rodapeHud() } });
      camMexida = salvo.camMexida;
      realcar(selecao);
      repintar();
      urlPronta = salvo.urlPronta;
      escreveURL();
      $('tour').classList.add('saindo');
      $('tour').classList.remove('on');
      $('tour-cap').classList.remove('on');
      document.body.classList.remove('touring');
      setTimeout(() => { if (!ativo) $('tour').hidden = true; }, 900 / RAPIDO + 50);
      if (quemChamou && quemChamou.isConnected && quemChamou !== document.body) { try { quemChamou.focus({ preventScroll: true }); } catch (e) { /* sem foco */ } }
    }

    /* ---- som: botão, preferência em localStorage ---- */
    const botaoSom = $('tour-som');
    function marcaSom() {
      const on = !!som && som.ligado();
      botaoSom.classList.toggle('mudo', !on);
      botaoSom.setAttribute('aria-pressed', String(on));
      botaoSom.setAttribute('aria-label', on ? 'Som do tour: ligado' : 'Som do tour: desligado');
      botaoSom.title = on ? 'Desligar o som' : 'Ligar o som';
    }
    botaoSom.addEventListener('click', () => {
      if (!som) return;
      som.alternar();                        // grava a preferência e, se ficou mudo, apaga com rampa
      if (som.ligado() && ativo) { som.iniciar(); som.cena(cenaAtual); }   // o clique é o gesto
      marcaSom();
    });
    if (!som) botaoSom.hidden = true;

    /* ---- convite (?tour=1) ---- */
    const convite = $('tour-convite');
    function fechaConvite() { convite.hidden = true; }
    function convida() {
      convite.hidden = false;
      marcaSomConvite();
      convite.querySelector('button').focus({ preventScroll: true });
    }
    function marcaSomConvite() {
      $('tour-convite-sub').textContent = som && som.ligado()
        ? (EN ? '♪ 2 minutes, with sound: turn the volume up' : '♪ 2 minutos, com som: ligue o volume')
        : (EN ? '2 minutes, no sound (you turned it off before)' : '2 minutos, sem som (você o desligou antes)');
    }
    convite.addEventListener('click', e => {
      if (e.target.closest('button')) iniciar(); else fechaConvite();   // fora do botão: fica só o mapa
    });
    // Esc é do tour: para o passeio ou fecha o convite, e não chega às gavetas e painéis
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (ativo) { e.stopPropagation(); e.preventDefault(); parar(false); }
      else if (!convite.hidden) { e.stopPropagation(); fechaConvite(); }
    }, true);
    $('tour-parar').addEventListener('click', () => parar(false));
    $('btTour').addEventListener('click', e => iniciar(e.currentTarget));
    $('btTourBarra').addEventListener('click', e => iniciar(e.currentTarget));

    /* a cena i parada, sem voo nem relógio: o que as câmeras do roteiro enquadram quando o voo termina.
       Serve para ajustar os enquadramentos olhando prints, e à suíte. */
    async function mostra(i) {
      if (!ativo) await iniciar(null, true);
      const c = ROTEIRO[i];
      cenaAtual = i;
      aplicaCena(c);
      const rc = c.realce ? realcaDe(c.realce, c.camera.centro, c.camera.zoom) : null;
      realcar(rc ? rc.alvo : null); repintar();
      map.stop(); map.jumpTo(camDe(c));
      escreveLegenda(c);
      $('tour-cap').classList.add('on');
      return rc && rc.nome;
    }

    /* a barra de endereço do celular e o girar da tela mudam as faixas no meio do passeio */
    function aoRedimensionar() {
      if (!ativo) return;
      const antes = PAD.bottom + PAD.top;
      medeJanela();
      if (PAD.bottom + PAD.top !== antes) map.easeTo({ padding: PAD, duration: 0 });
    }

    /* ?tour=1 (ou =en) só vale uma vez: sai do endereço, para o recarregar abrir o mapa */
    function entrada() {
      if (EN) {
        $('tour-cap').lang = 'en';
        const b = $('tour-convite').querySelector('button span');
        b.firstChild.textContent = 'Press to start';
        $('tour-convite').setAttribute('aria-label', '2-minute tour');
        $('tour-parar').setAttribute('aria-label', 'Stop the tour and return to the map');
      }
      if (q0.get('tour') !== '1' && !EN) return;
      try {
        const u = new URL(location.href);
        u.searchParams.delete('tour');
        history.replaceState(null, '', u);
      } catch (e) { /* file:// */ }
      convida();
    }

    return { iniciar, parar, ativo: () => ativo, cena: () => cenaAtual, aoRedimensionar, entrada,
             total: () => ROTEIRO.length, mostra, rapido: RAPIDO, acha: acharRio, realcaDe };
  })();
  window.tour = TOUR;

