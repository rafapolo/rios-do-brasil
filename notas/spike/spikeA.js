const { coords, inicio, q, N } = window.__buf;
const t0 = performance.now();
const lon = x => x * 360 - 180, lat = y => 360 / Math.PI * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - 90;
const feats = new Array(N);
for (let i = 0; i < N; i++) {
  const a = inicio[i], b = inicio[i + 1], c = [];
  for (let j = a; j < b; j += 2) c.push([lon(coords[j]), lat(coords[j + 1])]);
  feats[i] = { type: 'Feature', properties: { q: q[i], i }, geometry: { type: 'LineString', coordinates: c } };
}
const tMont = performance.now() - t0;
const style = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d1117' } }] };
const map = new maplibregl.Map({ container: 'ml', style, center: [-54, -14], zoom: 3.6, pitch: 0, maxPitch: 60, fadeDuration: 0, attributionControl: false });
window.__map = map; map.__z0 = 3.6; map.__c0 = [-54, -14];
await new Promise(r => map.on('load', r));
const t1 = performance.now();
map.addSource('rios', { type: 'geojson', data: { type: 'FeatureCollection', features: feats }, maxzoom: 11, tolerance: 1, buffer: 16 });
map.addLayer({ id: 'rios', type: 'line', source: 'rios',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': ['interpolate', ['linear'], ['log10', ['max', 0.5, ['get', 'q']]], -0.3, '#cfe3f5', 1.2, '#5b9fd1', 3, '#1f5f9f', 5, '#08306b'],
    'line-width': ['interpolate', ['linear'], ['zoom'], 3, ['+', 0.3, ['*', 0.6, ['log10', ['max', 1, ['get', 'q']]]]], 10, ['+', 0.6, ['*', 1.5, ['log10', ['max', 1, ['get', 'q']]]]]],
  } });
const t2 = performance.now();
await new Promise(r => { const f = () => { if (map.isSourceLoaded('rios') && map.areTilesLoaded()) { map.off('render', f); r(); } }; map.on('render', f); map.triggerRepaint(); });
const t3 = performance.now();
console.log('SPK A', JSON.stringify({ montaFeatures_ms: Math.round(tMont), addSource_ms: Math.round(t2 - t1), ate_tiles_ms: Math.round(t3 - t1) }));
return { montaFeatures_ms: Math.round(tMont), ate_tiles_ms: Math.round(t3 - t1) };
