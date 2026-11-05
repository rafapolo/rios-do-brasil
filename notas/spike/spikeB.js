const { coords, inicio, q, N } = window.__buf;
const t0 = performance.now();
// ids por vértice (float32) — o segmento j liga o vértice j ao j+1; se os ids diferem é a emenda entre trechos
const NV = coords.length >> 1;
const ids = new Float32Array(NV);
for (let i = 0; i < N; i++) for (let j = inicio[i] >> 1; j < inicio[i + 1] >> 1; j++) ids[j] = i;
const cores = new Uint8Array(N * 4), larg = new Uint8Array(N);
const ramp = [[207,227,245],[158,202,225],[107,174,214],[66,146,198],[33,113,181],[8,81,156],[8,48,107]];
for (let i = 0; i < N; i++) {
  const t = (Math.log10(Math.max(0.5, Math.min(120000, q[i]))) + 0.301) / (5.079 + 0.301);
  const c = ramp[Math.round(t * 6)];
  cores[4*i] = c[0]; cores[4*i+1] = c[1]; cores[4*i+2] = c[2]; cores[4*i+3] = 255;
  larg[i] = Math.round((0.35 + 3.4 * Math.pow(t, 2.1)) / 4 * 255);
}
const tPrep = performance.now() - t0;
const VS = `#version 300 es
precision highp float;
uniform mat4 uM; uniform vec2 uVp; uniform float uZf; uniform highp sampler2D uCor; uniform highp sampler2D uLar;
in vec2 aA; in vec2 aB; in float aIa; in float aIb; in vec2 aQ; // aQ = (t, lado)
out vec4 vCor;
void main(){
  vec4 c = vec4(0.);
  if (aIa != aIb) { gl_Position = vec4(2., 2., 2., 1.); return; }
  int id = int(aIa); ivec2 uv = ivec2(id & 1023, id >> 10);
  vCor = texelFetch(uCor, uv, 0);
  float w = texelFetch(uLar, uv, 0).r * 4. * uZf;
  vec4 pa = uM * vec4(aA, 0., 1.), pb = uM * vec4(aB, 0., 1.);
  if (pa.w <= 0.01 || pb.w <= 0.01 || vCor.a == 0.) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec2 sa = pa.xy / pa.w * uVp * .5, sb = pb.xy / pb.w * uVp * .5;
  vec2 d = sb - sa; float L = length(d); d = L > 1e-6 ? d / L : vec2(1., 0.);
  vec4 p = mix(pa, pb, aQ.x);
  float esc = clamp(0.9 / p.w * uVp.y * .0 + 1., 0.4, 1.);
  vec2 ndc = p.xy / p.w;
  vec2 off = (vec2(-d.y, d.x) * aQ.y + d * (aQ.x * 2. - 1.)) * w * .5 / (uVp * .5);
  gl_Position = vec4(ndc + off, p.z / p.w, 1.);
}`;
const FS = `#version 300 es
precision mediump float; in vec4 vCor; out vec4 o; void main(){ o = vec4(vCor.rgb * vCor.a, vCor.a); }`;
let prog, vao, bufC, bufI, bufQ, texC, texL, uni = {};
const camada = {
  id: 'rios3d', type: 'custom', renderingMode: '2d',
  onAdd(map, gl) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    for (const n of ['uM','uVp','uZf','uCor','uLar']) uni[n] = gl.getUniformLocation(prog, n);
    bufC = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufC); gl.bufferData(gl.ARRAY_BUFFER, coords, gl.STATIC_DRAW);
    bufI = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufI); gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    bufQ = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufQ);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,-1, 0,1, 1,-1, 1,1].flatMap((v,k,a)=>[v]).length ? [0,-1, 0,1, 1,-1, 1,1] : []), gl.STATIC_DRAW);
    vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const at = (n) => gl.getAttribLocation(prog, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufC);
    gl.enableVertexAttribArray(at('aA')); gl.vertexAttribPointer(at('aA'), 2, gl.FLOAT, false, 8, 0); gl.vertexAttribDivisor(at('aA'), 1);
    gl.enableVertexAttribArray(at('aB')); gl.vertexAttribPointer(at('aB'), 2, gl.FLOAT, false, 8, 8); gl.vertexAttribDivisor(at('aB'), 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufI);
    gl.enableVertexAttribArray(at('aIa')); gl.vertexAttribPointer(at('aIa'), 1, gl.FLOAT, false, 4, 0); gl.vertexAttribDivisor(at('aIa'), 1);
    gl.enableVertexAttribArray(at('aIb')); gl.vertexAttribPointer(at('aIb'), 1, gl.FLOAT, false, 4, 4); gl.vertexAttribDivisor(at('aIb'), 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufQ);
    gl.enableVertexAttribArray(at('aQ')); gl.vertexAttribPointer(at('aQ'), 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const tex = (fmt, ifmt, data) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const pad = new Uint8Array(1024 * 453 * (fmt === gl.RGBA ? 4 : 1)); pad.set(data);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, 1024, 453, 0, fmt, gl.UNSIGNED_BYTE, pad);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
    texC = tex(gl.RGBA, gl.RGBA8, cores); texL = tex(gl.RED, gl.R8, larg);
  },
  render(gl, matrix) {
    const map = window.__map, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uni.uM, false, matrix); gl.uniform2f(uni.uVp, W, H);
    const dpr = W / map.getCanvas().clientWidth;
    gl.uniform1f(uni.uZf, dpr * (1 + 0.5 * Math.log2(Math.pow(2, map.getZoom() - 3.6))));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texC); gl.uniform1i(uni.uCor, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texL); gl.uniform1i(uni.uLar, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, NV - 1);
    gl.bindVertexArray(null);
  },
};
const style = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d1117' } }] };
const map = new maplibregl.Map({ container: 'ml', style, center: [-54, -14], zoom: 3.6, pitch: 0, maxPitch: 60, fadeDuration: 0, attributionControl: false });
window.__map = map; map.__z0 = 3.6; map.__c0 = [-54, -14];
await new Promise(r => map.on('load', r));
const t1 = performance.now();
map.addLayer(camada);
await new Promise(r => { map.once('idle', r); map.triggerRepaint(); });
const t2 = performance.now();
console.log('SPK B', JSON.stringify({ prep_ms: Math.round(tPrep), ate_idle_ms: Math.round(t2 - t1) }));
return { prep_ms: Math.round(tPrep), ate_idle_ms: Math.round(t2 - t1) };
