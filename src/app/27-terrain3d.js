/* ================= 3D terrain (display only) ================= */
/* A square of LOLA heights around the selected site (data/terrain3d/<id>.json, built by
   tools/imagery/make_imagery.py: 24 km at 100 m from the 20 m mosaic, or 29 km at 240 m north of 80.6 S),
   on a local east/north grid, drawn true to scale with the Moon's curvature (drop d^2 / 2R).
   Two surfaces:
     "Sunlight now"  grey ground lit by the Sun of the current time. A node is lit when the Sun's centre clears its
                     horizon toward the Sun: the terrain inside the square, plus, where the site's LOLA skyline
                     toward the Sun lies beyond the square, that far point seen from the node (its height is
                     reconstructed from the site's mask and distance). The Sun's elevation is corrected for the
                     node's offset (curvature: s / R). The page's numbers never use this view.
     "LROC image"    the WAC south-pole summer mosaic draped on the same nodes (shadows of Sep-Oct 2010).
   Sun and Earth are drawn as lines from the site in their true direction. */
var T3 = { cv: $('sky3d'), gl: null, fail: '', rec: null, id: null, wait: {}, mesh: null, tex: null, surf: 'sun', cam: { yaw: 0, pitch: 24, dist: 15 }, litStep: -1, litAt: 0, aimed: null, pts: {}, lastD: 0 };
window.LWB_T3D = function (rec) { var w = rec && T3.wait[rec.id]; if (w) w(rec); };
function t3Has(s) { return !s.custom && s.id && T3D_IDS.indexOf(s.id) >= 0; }
function t3Load(s) {
  if (s.t3d) return Promise.resolve(s.t3d);
  return new Promise(function (res) {
    var done = false, sc = document.createElement('script');
    function fail() { if (!done) { done = true; res(null); } }
    T3.wait[s.id] = function (rec) {
      if (done) return; done = true;
      gunzipB64(rec.z_gz).then(function (bytes) {
        if (!bytes) { res(null); return; }
        var z = new Int16Array(bytes.buffer, bytes.byteOffset, rec.n * rec.n), im = new Image();
        im.onload = function () { s.t3d = { n: rec.n, d: rec.d_m, z: z, img: im, dem: rec.dem, imgSrc: rec.img_src }; res(s.t3d); };
        im.onerror = function () { res(null); };
        im.src = 'data:image/jpeg;base64,' + rec.img;
      });
    };
    sc.src = 'terrain3d/' + s.id + '.js'; sc.onerror = fail; document.head.appendChild(sc);
    setTimeout(fail, 8000);
  });
}

/* ---------- WebGL ---------- */
var T3VS = 'attribute vec3 p;attribute vec3 nm;attribute vec2 uv;attribute float lit;uniform mat4 M;varying vec3 vn;varying vec2 vuv;varying float vl;varying float vd;' +
  'void main(){gl_Position=M*vec4(p,1.0);vn=nm;vuv=uv;vl=lit;vd=gl_Position.w;}';
var T3FS = 'precision mediump float;varying vec3 vn;varying vec2 vuv;varying float vl;varying float vd;uniform sampler2D tex;uniform int surf;uniform vec3 sun;' +
  'void main(){vec3 n=normalize(vn);vec3 c;' +
  'if(surf==1){c=texture2D(tex,vuv).rgb;}else{float d=max(dot(n,sun),0.0);float k=0.035+vl*(0.25+1.6*d);c=pow(vec3(0.62,0.6,0.57)*k,vec3(1.0/1.6));}' +
  'float f=clamp((vd-25.0)/60.0,0.0,0.6);c=mix(c,vec3(0.008,0.012,0.02),f);gl_FragColor=vec4(c,1.0);}';
var T3LVS = 'attribute vec3 p;uniform mat4 M;uniform float ps;void main(){gl_Position=M*vec4(p,1.0);gl_PointSize=ps;}';
var T3LFS = 'precision mediump float;uniform vec3 col;uniform float al;uniform int round;void main(){if(round==1){vec2 d=gl_PointCoord-vec2(0.5);if(dot(d,d)>0.25)discard;}gl_FragColor=vec4(col,al);}';
function t3Prog(gl, vs, fs) {
  function sh(t, src) { var o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function t3Init() {
  if (T3.gl || T3.fail) return !!T3.gl;
  try {
    var gl = T3.cv.getContext('webgl', { antialias: true }) || T3.cv.getContext('experimental-webgl');
    if (!gl) { T3.fail = 'This browser has no WebGL, so the 3D view cannot be drawn.'; return false; }
    if (!gl.getExtension('OES_element_index_uint')) { T3.fail = 'This browser lacks 32-bit WebGL indices, so the 3D view cannot be drawn.'; return false; }
    T3.gl = gl; T3.prog = t3Prog(gl, T3VS, T3FS); T3.lprog = t3Prog(gl, T3LVS, T3LFS);
    T3.lbuf = gl.createBuffer();
    return true;
  } catch (x) { T3.fail = '3D view unavailable: ' + x.message; return false; }
}
/* Geometry in km: x east, y up (curvature applied), z south. Heights true scale. */
function t3Build(s, P) {
  var gl = T3.gl, n = P.n, N = n * n, c = (n - 1) / 2, d = P.d / 1000, R = RM, pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3), uv = new Float32Array(N * 2), i, j, k;
  var zc = new Float32Array(N);
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
    k = i * n + j; var e = (j - c) * d, no = (c - i) * d;
    zc[k] = P.z[k] / 1000 - (e * e + no * no) / (2 * R);
    pos[k * 3] = e; pos[k * 3 + 1] = zc[k]; pos[k * 3 + 2] = -no;
    uv[k * 2] = (j + 0.5) / n; uv[k * 2 + 1] = (i + 0.5) / n;
  }
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
    k = i * n + j;
    var dzx = (zc[i * n + Math.min(n - 1, j + 1)] - zc[i * n + Math.max(0, j - 1)]) / ((Math.min(n - 1, j + 1) - Math.max(0, j - 1)) * d);
    var dzn = (zc[Math.max(0, i - 1) * n + j] - zc[Math.min(n - 1, i + 1) * n + j]) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * d);
    var vx = -dzx, vy = 1, vz = dzn, L = Math.hypot(vx, vy, vz); nrm[k * 3] = vx / L; nrm[k * 3 + 1] = vy / L; nrm[k * 3 + 2] = vz / L;
  }
  var idx = new Uint32Array((n - 1) * (n - 1) * 6), q = 0;
  for (i = 0; i < n - 1; i++) for (j = 0; j < n - 1; j++) { k = i * n + j; idx[q++] = k; idx[q++] = k + n; idx[q++] = k + 1; idx[q++] = k + 1; idx[q++] = k + n; idx[q++] = k + n + 1; }
  function buf(type, data) { var b = gl.createBuffer(); gl.bindBuffer(type, b); gl.bufferData(type, data, gl.STATIC_DRAW); return b; }
  if (T3.mesh) ['bp', 'bn', 'bu', 'bl', 'bi'].forEach(function (b) { gl.deleteBuffer(T3.mesh[b]); });
  T3.mesh = { s: s, n: n, d: d, zc: zc, nIdx: idx.length, lit: new Float32Array(N), half: c * d,
    bp: buf(gl.ARRAY_BUFFER, pos), bn: buf(gl.ARRAY_BUFFER, nrm), bu: buf(gl.ARRAY_BUFFER, uv), bl: buf(gl.ARRAY_BUFFER, new Float32Array(N)), bi: buf(gl.ELEMENT_ARRAY_BUFFER, idx) };
  if (T3.tex) gl.deleteTexture(T3.tex);
  T3.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, T3.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, P.img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  T3.litStep = -1;
}
/* Which nodes see the Sun's centre now. */
function t3Lit(s, Lk) {
  var M = T3.mesh, n = M.n, c = (n - 1) / 2, d = M.d, zc = M.zc, lit = M.lit, R = RM;
  var az = Lk.sunAz * D2R, sx = Math.sin(az), sn = Math.cos(az), rad = Lk.sunRad;
  // far skyline toward the Sun, from the site's own mask (2 m observer) where it lies beyond the square
  var far = null, g = s.geo;
  if (g.mask && s.terr && s.terr.dist && maskHeight(s) === TERRAIN.meta.hobs_m[0]) {
    var dd = s.terr.dd || (s.terr.dd = LWB.b64u16(s.terr.dist)), nb = g.mask.length, b = Math.round(Lk.sunAz / 360 * nb) % nb, D = dd[b] * 10 / 1000;
    if (D > M.half * 1.05) { var el0 = g.mask[b] / 100 * D2R; far = { D: D, H: maskHeight(s) / 1000 + D * Math.tan(el0) + D * D / (2 * R) }; }
  }
  var steps = Math.ceil(M.half * 2.9 / d);
  for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
    var k = i * n + j, e = (j - c) * d, no = (c - i) * d, z0 = zc[k] + 0.002, best = -1e9;
    for (var t = 1; t <= steps; t++) {
      var jj = Math.round(j + sx * t), ii = Math.round(i - sn * t);
      if (jj < 0 || ii < 0 || jj >= n || ii >= n) break;
      var sd = t * d, a = (zc[ii * n + jj] - z0) / sd; if (a > best) best = a;
    }
    var hor = Math.atan(best) * R2D;
    if (far) { var Dp = far.D - (e * sx + no * sn); if (Dp > 0.2) { var ha = Math.atan2(far.H - (zc[k] + (e * e + no * no) / (2 * R)) - Dp * Dp / (2 * R), Dp) * R2D; if (ha > hor) hor = ha; } }
    var elv = Lk.sunEl + (e * sx + no * sn) / R * R2D;
    lit[k] = clamp((elv - hor) / (2 * rad) + 0.5, 0, 1);
  }
  var gl = T3.gl; gl.bindBuffer(gl.ARRAY_BUFFER, M.bl); gl.bufferData(gl.ARRAY_BUFFER, lit, gl.DYNAMIC_DRAW);
}
/* ---------- matrices ---------- */
function m4mul(a, b) { var o = new Float32Array(16); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
function m4persp(fy, asp, nr, fr) { var f = 1 / Math.tan(fy / 2), o = new Float32Array(16); o[0] = f / asp; o[5] = f; o[10] = (fr + nr) / (nr - fr); o[11] = -1; o[14] = 2 * fr * nr / (nr - fr); return o; }
function m4look(e, t, u) {
  var z = unit(sub(e, t)), x = unit(cross(u, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}
function t3Dir(az, el) { az *= D2R; el *= D2R; return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]; }
/* ---------- drawing ---------- */
function render3D() {
  var s = SITES[S.sel], sz = skySize(), W = sz[0], H = sz[1], dpr = Math.min(window.devicePixelRatio || 1, 2), msg = $('t3Read');
  if (T3.cv.width !== Math.round(W * dpr) || T3.cv.height !== Math.round(H * dpr)) { T3.cv.width = Math.round(W * dpr); T3.cv.height = Math.round(H * dpr); }
  var Lk = LWB.look(s.geo, S.tMs);
  lastSky = { sun: { az: Lk.sunAz, alt: Lk.sunEl }, earth: { az: Lk.earthAz, alt: Lk.earthEl }, earthFrac: (1 + dot(frame(S.tMs).sunGeoU, frame(S.tMs).xr)) / 2, L: Lk };
  updateHud(); t3HideLabels();
  if (!t3Init()) { msg.textContent = T3.fail; return; }
  var gl = T3.gl;
  gl.viewport(0, 0, T3.cv.width, T3.cv.height); gl.clearColor(0.008, 0.012, 0.024, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!t3Has(s)) { msg.textContent = '3D terrain is available for the listed sites south of 60°S. This site has ' + (s.terr ? 'a skyline but no 3D square' : 'no LOLA terrain in the page') + '.'; return; }
  if (!s.t3d) {
    msg.textContent = 'Loading the LOLA terrain…';
    if (T3.id !== s.id) { T3.id = s.id; t3Load(s).then(function (P) { if (!P) { msg.textContent = 'The 3D terrain file did not load (dist/terrain3d/' + s.id + '.js must sit next to the page).'; return; } if (SITES[S.sel] === s && S.skyMode === '3d') kick(); }); }
    return;
  }
  if (!T3.mesh || T3.mesh.s !== s) { t3Build(s, s.t3d); T3.cam.yaw = (Lk.sunAz + 140) % 360; T3.cam.pitch = 24; T3.cam.dist = 15; }
  var step = stepOf(S.tMs), now = performance.now();
  if (step !== T3.litStep && (!S.playing || now - T3.litAt > 250)) { t3Lit(s, Lk); T3.litStep = step; T3.litAt = now; }
  var M0 = T3.mesh, cp = T3.cam.pitch * D2R, cy = T3.cam.yaw * D2R, tgt = [0, 0.3, 0];
  var eye = [tgt[0] + T3.cam.dist * Math.cos(cp) * Math.sin(cy), tgt[1] + T3.cam.dist * Math.sin(cp), tgt[2] - T3.cam.dist * Math.cos(cp) * Math.cos(cy)];
  var MVP = m4mul(m4persp(45 * D2R, W / Math.max(1, H), 0.05, 200), m4look(eye, tgt, [0, 1, 0]));
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(T3.prog);
  function attr(prog, name, b, size) { var l = gl.getAttribLocation(prog, name); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); return l; }
  var la = [attr(T3.prog, 'p', M0.bp, 3), attr(T3.prog, 'nm', M0.bn, 3), attr(T3.prog, 'uv', M0.bu, 2), attr(T3.prog, 'lit', M0.bl, 1)];
  gl.uniformMatrix4fv(gl.getUniformLocation(T3.prog, 'M'), false, MVP);
  gl.uniform1i(gl.getUniformLocation(T3.prog, 'surf'), T3.surf === 'img' ? 1 : 0);
  var sd = t3Dir(Lk.sunAz, Lk.sunEl); gl.uniform3f(gl.getUniformLocation(T3.prog, 'sun'), sd[0], sd[1], sd[2]);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T3.tex); gl.uniform1i(gl.getUniformLocation(T3.prog, 'tex'), 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M0.bi); gl.drawElements(gl.TRIANGLES, M0.nIdx, gl.UNSIGNED_INT, 0);
  la.forEach(function (l) { gl.disableVertexAttribArray(l); });
  /* The site, its skyline and the lines of sight to the Sun and Earth. The observer sits its true height (2 m or 10 m)
     above the centre node. Terrain beyond the 24 km square is not in the mesh, so the site's full LOLA skyline (terrain
     out to 400 km) is drawn as a ring just outside the square, at the height that subtends the mask elevation from
     the observer. A line of sight is bright up to the terrain that blocks it (the mask's distance for that azimuth,
     where known) and faint beyond; the Sun and Earth are drawn as disks 40 km out along their true direction,
     faint when the body is below the skyline. Display only. */
  var c = (M0.n - 1) / 2, z0 = M0.zc[c * M0.n + c], hob = (maskHeight(s) === null ? S.hobs : maskHeight(s)) / 1000, obs = [0, z0 + hob, 0];
  var ed = t3Dir(Lk.earthAz, Lk.earthEl), g = s.geo, Rk = M0.half * 1.08, FAR = 40;
  var dd = s.terr && s.terr.dist && maskHeight(s) === TERRAIN.meta.hobs_m[0] ? (s.terr.dd || (s.terr.dd = LWB.b64u16(s.terr.dist))) : null;
  function draw(pts, col, mode, alpha, size, depth) {
    gl.useProgram(T3.lprog); if (depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, T3.lbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    var l = gl.getAttribLocation(T3.lprog, 'p'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(T3.lprog, 'M'), false, MVP); gl.uniform3f(gl.getUniformLocation(T3.lprog, 'col'), col[0], col[1], col[2]);
    gl.uniform1f(gl.getUniformLocation(T3.lprog, 'al'), alpha); gl.uniform1f(gl.getUniformLocation(T3.lprog, 'ps'), size || 1);
    gl.uniform1i(gl.getUniformLocation(T3.lprog, 'round'), mode === gl.POINTS ? 1 : 0);
    gl.drawArrays(mode, 0, pts.length / 3); gl.disableVertexAttribArray(l); gl.disable(gl.BLEND);
  }
  function at(d, km) { return [obs[0] + d[0] * km, obs[1] + d[1] * km, obs[2] + d[2] * km]; }
  // skyline ring from the mask
  if (g.mask) {
    var ring = [], nb = g.mask.length;
    for (var k = 0; k <= 360; k++) { var az = k % 360, el = LWB.horizonAt(g, az), dv = t3Dir(az, 0); ring.push(dv[0] * Rk, obs[1] + Rk * Math.tan(el * D2R), dv[2] * Rk); }
    var rl = []; for (k = 0; k < ring.length / 3 - 1; k++) rl.push(ring[k * 3], ring[k * 3 + 1], ring[k * 3 + 2], ring[k * 3 + 3], ring[k * 3 + 4], ring[k * 3 + 5]);
    draw(rl, [0.86, 0.88, 0.92], gl.LINES, 0.55, 1, true);
  }
  // the observer: a short white post so it can be found, and a dot at the true observer height
  draw([0, z0, 0, 0, z0 + 0.25, 0], [1, 1, 1], gl.LINES, 0.9, 1, false);
  draw(obs, [1, 1, 1], gl.POINTS, 1, 5, false);
  function sight(dv, el, hor, az, col, rad) {
    var up = el >= hor, b = g.mask ? Math.round(az / 360 * g.mask.length) % g.mask.length : 0;
    var block = up ? FAR : dd ? Math.max(0.05, dd[b] * 10 / 1000) : Rk;
    if (block > FAR) block = FAR;
    draw(obs.concat(at(dv, block)), col, gl.LINES, 1, 1, false);
    if (block < FAR) draw(at(dv, block).concat(at(dv, FAR)), col, gl.LINES, 0.25, 1, false);
    // marker size is symbolic (Earth drawn larger than the Sun, as in the sky: 1.9 deg against 0.53 deg)
    draw(at(dv, FAR), col, gl.POINTS, up ? 1 : 0.3, (rad > 0.5 ? 18 : 13) * Math.min(window.devicePixelRatio || 1, 2), false);
    return { up: up, block: block };
  }
  var sS = sight(sd, Lk.sunEl, Lk.sunHor, Lk.sunAz, [1, 0.78, 0.33], Lk.sunRad);
  var sE = sight(ed, Lk.earthEl, Lk.earthHor, Lk.earthAz, [0.44, 0.7, 0.95], Lk.earthRad);
  // labels next to the disks
  function label(id, p, txt, col) {
    var el = $(id); if (!el) { el = document.createElement('span'); el.id = id; el.className = 't3lab'; document.querySelector('.hero').appendChild(el); }
    var v = [p[0], p[1], p[2], 1], o = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) o[i] += MVP[j * 4 + i] * v[j];
    if (o[3] <= 0 || S.skyMode !== '3d') { el.hidden = true; return; }
    var x = (o[0] / o[3] * 0.5 + 0.5) * W, y = (0.5 - o[1] / o[3] * 0.5) * H;
    el.hidden = x < -40 || x > W + 40 || y < -20 || y > H + 20; el.style.left = Math.round(x + 10) + 'px'; el.style.top = Math.round(y - 8) + 'px'; el.style.color = col; el.textContent = txt;
  }
  function why(r, el, hor) { return r.up ? deg2(el - hor) + ' above the skyline' : deg2(hor - el) + ' below the skyline' + (dd ? ', blocked ' + (r.block < 1 ? Math.round(r.block * 1000) + ' m' : r.block.toFixed(1) + ' km') + ' away' : ''); }
  label('t3LabSun', at(sd, FAR), 'Sun: ' + why(sS, Lk.sunEl, Lk.sunHor), '#FFD27A');
  label('t3LabEarth', at(ed, FAR), 'Earth: ' + why(sE, Lk.earthEl, Lk.earthHor), '#8CC4F5');
  msg.textContent = 'LOLA ' + s.t3d.dem + ', ' + ((M0.n - 1) * M0.d).toFixed(0) + ' km square, true scale. ' +
    (T3.surf === 'img' ? 'Surface: ' + s.t3d.imgSrc + ' (shadows of Sep–Oct 2010).' : 'Lit ground sees the centre of the Sun now. At the site ' + pct(Lk.sunFrac) + ' of the Sun is visible.') +
    ' White dot: the observer, ' + Math.round(hob * 1000) + ' m above the site. Amber / blue: lines of sight to the Sun / Earth, bright up to the terrain that blocks them, faint beyond. Grey ring: the full LOLA skyline (terrain to 400 km, most of it outside this square). Drag to turn.';
}
function t3HideLabels() { ['t3LabSun', 't3LabEarth'].forEach(function (id) { var el = $(id); if (el) el.hidden = true; }); }
/* Check hook for tests/screenshot.py: across the dial, does the 3D view's centre node agree with the page's own
   skyline about whether the Sun's centre is up? Times within 0.3 deg of the skyline are counted separately. */
window.LWB_T3CHECK = function () {
  var s = SITES[S.sel], M = T3.mesh; if (!M || M.s !== s) return null;
  var c = (M.n - 1) / 2 * M.n + (M.n - 1) / 2, n = 0, agree = 0, near = 0, worst = 0;
  for (var i = 0; i < S.N; i += 18) {
    var Lk = LWB.look(s.geo, stepMs(i)), m = Lk.sunEl - Lk.sunHor;
    t3Lit(s, Lk);
    if (Math.abs(m) < 0.3) { near++; continue; }
    n++; if ((M.lit[c] > 0.5) === (m > 0)) agree++; else worst = Math.max(worst, Math.abs(m));
  }
  T3.litStep = -1; kick();
  return { samples: n, agree: agree, within_0p3_deg_skipped: near, largest_disagreeing_margin_deg: +worst.toFixed(2) };
};
/* ---------- camera controls ---------- */
(function () {
  var cv = T3.cv;
  cv.addEventListener('pointerdown', function (e) { T3.pts[e.pointerId] = [e.clientX, e.clientY]; try { cv.setPointerCapture(e.pointerId); } catch (x) {} if (e.pointerType === 'mouse') cv.focus({ preventScroll: true }); });
  cv.addEventListener('pointermove', function (e) {
    if (!T3.pts[e.pointerId]) return;
    var ids = Object.keys(T3.pts);
    if (ids.length === 2) {
      T3.pts[e.pointerId] = [e.clientX, e.clientY];
      var a = T3.pts[ids[0]], b = T3.pts[ids[1]], dd = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (T3.lastD) T3.cam.dist = clamp(T3.cam.dist * T3.lastD / dd, 1.5, 60);
      T3.lastD = dd; kick(); return;
    }
    var p = T3.pts[e.pointerId];
    T3.cam.yaw = (T3.cam.yaw - (e.clientX - p[0]) * 0.3 + 360) % 360; T3.cam.pitch = clamp(T3.cam.pitch + (e.clientY - p[1]) * 0.25, 3, 88);
    T3.pts[e.pointerId] = [e.clientX, e.clientY]; kick();
  });
  function up(e) { delete T3.pts[e.pointerId]; T3.lastD = 0; }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && document.activeElement !== cv) return;
    e.preventDefault(); T3.cam.dist = clamp(T3.cam.dist * Math.exp(e.deltaY * 0.0012), 1.5, 60); kick();
  }, { passive: false });
  cv.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') T3.cam.yaw = (T3.cam.yaw + 356) % 360; else if (e.key === 'ArrowRight') T3.cam.yaw = (T3.cam.yaw + 4) % 360;
    else if (e.key === 'ArrowUp') T3.cam.pitch = clamp(T3.cam.pitch + 3, 3, 88); else if (e.key === 'ArrowDown') T3.cam.pitch = clamp(T3.cam.pitch - 3, 3, 88);
    else if (e.key === '+' || e.key === '=') T3.cam.dist = clamp(T3.cam.dist / 1.2, 1.5, 60); else if (e.key === '-') T3.cam.dist = clamp(T3.cam.dist * 1.2, 1.5, 60);
    else return;
    e.preventDefault(); kick();
  });
  $('t3Surf').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    T3.surf = b.getAttribute('data-surf');
    Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    kick();
  });
  $('t3ZoomIn').addEventListener('click', function () { T3.cam.dist = clamp(T3.cam.dist / 1.4, 1.5, 60); kick(); });
  $('t3ZoomOut').addEventListener('click', function () { T3.cam.dist = clamp(T3.cam.dist * 1.4, 1.5, 60); kick(); });
})();
