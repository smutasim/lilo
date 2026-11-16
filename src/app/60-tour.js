/* ================= optional guided tour ================= */
/* On the first visit a small card offers a short tour; "No thanks" or finishing it is remembered in this browser
   (localStorage lwb.tour.v1). The Tour button in the title bar starts it again. Display only. */
var TOUR_KEY = 'lwb.tour.v1';
var TOUR = [
  { el: '#pSite', t: 'Pick a landing site', b: 'Choose a site near the lunar south pole. Each site has its own skyline, computed from NASA LOLA laser-altimeter terrain.' },
  { el: '#pTime', t: 'Choose the dates', b: 'Set when the analysis starts and how many days the timeline covers.' },
  { el: '#pLim', t: 'Say what counts', b: 'Choose how much of the Sun must be visible, how high Earth must be above the skyline, and how high your antenna or solar array stands. A moment meets the constraints when the Sun counts and there is a link to Earth.' },
  { el: '#pSat', t: 'Add relay satellites', b: 'Tick a lunar orbiter to draw it in the sky and to use it as a relay to Earth. Orbits are propagated with a lunar gravity model and checked against JPL Horizons.' },
  { el: 'section[aria-label="View from the site"]', t: 'Look around', b: 'This is the sky from the site, with the Sun and Earth labelled. Drag to look around, click and scroll to zoom, or use Look at. The tabs switch to a sky plot, the terrain in 3D, or the Moon as seen from a place on Earth.' },
  { el: 'section[aria-label="Timeline"]', t: 'Move through time', b: 'Press Play, drag along the timeline, or use the left and right arrow keys. The Window buttons jump to the previous or next time the constraints are met. Each row shows when the Sun, Earth or a satellite is visible.' },
  { el: '.report', t: 'Read the numbers', b: 'Status says what is visible at the current time. Statistics and the list of windows sum up the period.' },
  { el: 'section.lower', t: 'Dig deeper', b: 'The skyline all the way round, what changes if the landing date moves, maps of the area, and how sure the terrain data is.' },
  { el: '.views button[data-view="list"]', t: 'Compare sites', b: 'Every site in one table; tick two to compare them side by side for one day.' },
  { el: '.views button[data-view="find"]', t: 'Find a site', b: 'The Site finder evaluates 3,600 surveyed points for your landing date and stay, and filters them by sunlight, Earth link and slope.' },
  { el: '.views button[data-view="method"]', t: 'How it works', b: 'Data sources, models and how each one was checked. You can run this tour again from the Tour button at the top.' }
];
var tourI = -1, tourHi = null, tourCard = null;
function tourSeen(v) { try { if (v) localStorage.setItem(TOUR_KEY, v); else return localStorage.getItem(TOUR_KEY); } catch (e) { return null; } }
function tourEnd() {
  tourI = -1; tourSeen('done');
  if (tourHi) tourHi.remove(); if (tourCard) tourCard.remove(); tourHi = tourCard = null;
  window.removeEventListener('resize', tourPlace); window.removeEventListener('scroll', tourPlace, true);
}
function tourPlace() {
  if (tourI < 0) return;
  var el = document.querySelector(TOUR[tourI].el); if (!el) return;
  var r = el.getBoundingClientRect(), pad = 6, vw = window.innerWidth, vh = window.innerHeight;
  tourHi.style.left = (r.left - pad) + 'px'; tourHi.style.top = (r.top - pad) + 'px';
  tourHi.style.width = (r.width + pad * 2) + 'px'; tourHi.style.height = (r.height + pad * 2) + 'px';
  var cw = tourCard.offsetWidth, ch = tourCard.offsetHeight, gap = 12, x, y;
  // beside the target if it fits, else below, else above, else over the bottom of the screen
  if (r.right + gap + cw < vw - 8 && r.height < vh) { x = r.right + gap; y = clamp(r.top, 8, vh - ch - 8); }
  else if (r.bottom + gap + ch < vh - 8) { x = clamp(r.left, 8, vw - cw - 8); y = r.bottom + gap; }
  else if (r.top - gap - ch > 8) { x = clamp(r.left, 8, vw - cw - 8); y = r.top - gap - ch; }
  else { x = clamp((vw - cw) / 2, 8, vw - cw - 8); y = vh - ch - 8; }
  tourCard.style.left = x + 'px'; tourCard.style.top = y + 'px';
}
function tourShow(i) {
  tourI = i; var s = TOUR[i], el = document.querySelector(s.el);
  if (!el) { if (i + 1 < TOUR.length) tourShow(i + 1); else tourEnd(); return; }
  if (S.view !== 'site' && s.el.indexOf('data-view') < 0) setView('site');
  if (el.tagName === 'DETAILS') el.open = true;
  tourCard.innerHTML = '<p class="tour-n">' + (i + 1) + ' of ' + TOUR.length + '</p><h3>' + s.t + '</h3><p>' + s.b + '</p>' +
    '<div class="btnrow"><button type="button" data-t="end">Close</button><span class="sp"></span>' +
    (i > 0 ? '<button type="button" data-t="back">Back</button>' : '') +
    '<button type="button" class="primary" data-t="next">' + (i + 1 < TOUR.length ? 'Next' : 'Finish') + '</button></div>';
  el.scrollIntoView({ block: 'center', behavior: 'auto' });
  tourPlace(); tourCard.querySelector('[data-t="next"]').focus();
}
function tourStart() {
  var p = document.getElementById('tourAsk'); if (p) p.remove();
  if (tourI >= 0) return;
  tourHi = document.createElement('div'); tourHi.className = 'tour-hi';
  tourCard = document.createElement('div'); tourCard.className = 'tour-card'; tourCard.setAttribute('role', 'dialog'); tourCard.setAttribute('aria-label', 'Tour');
  tourCard.addEventListener('click', function (e) {
    var b = e.target.closest('[data-t]'); if (!b) return; var a = b.getAttribute('data-t');
    if (a === 'end') tourEnd(); else if (a === 'back') tourShow(tourI - 1); else if (tourI + 1 < TOUR.length) tourShow(tourI + 1); else tourEnd();
  });
  tourCard.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') tourEnd(); });
  document.body.appendChild(tourHi); document.body.appendChild(tourCard);
  window.addEventListener('resize', tourPlace); window.addEventListener('scroll', tourPlace, true);
  tourShow(0);
}
function tourAsk() {
  var d = document.createElement('div'); d.className = 'tour-card tour-ask'; d.id = 'tourAsk'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Tour');
  d.innerHTML = '<h3>New here?</h3><p>Take a short tour of the page: eleven steps, and you can close it at any time.</p>' +
    '<div class="btnrow"><button type="button" data-a="no">No thanks</button><span class="sp"></span><button type="button" class="primary" data-a="yes">Show me around</button></div>';
  d.addEventListener('click', function (e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    if (b.getAttribute('data-a') === 'yes') tourStart(); else { tourSeen('done'); d.remove(); }
  });
  document.body.appendChild(d);
}
$('tourBtn').addEventListener('click', tourStart);
if (!tourSeen() && !/[?&]notour\b/.test(location.search)) setTimeout(tourAsk, 600);
