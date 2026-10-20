'use strict';
/* animelist — lista de animes por ver. Datos en localStorage; búsqueda y descubrimiento vía la API GraphQL pública de AniList. */

const KEY = 'animelist.v1';
const API = 'https://graphql.anilist.co';
const STATUS = { plan: 'Quiero ver', watching: 'Viendo', done: 'Completado', dropped: 'Abandonado' };
const PRIORITY = { high: 'Alta', med: 'Media', low: 'Baja' };
const WEIGHT = { high: 3, med: 2, low: 1 };
const DISCOVER = {
  season: 'status: RELEASING, sort: TRENDING_DESC',
  top: 'sort: SCORE_DESC',
  upcoming: 'status: NOT_YET_RELEASED, sort: POPULARITY_DESC',
};
const GENRES_ES = {
  Action: 'Acción', Adventure: 'Aventura', Comedy: 'Comedia', Fantasy: 'Fantasía', 'Sci-Fi': 'Ciencia ficción',
  'Slice of Life': 'Recuentos de la vida', Sports: 'Deportes', Supernatural: 'Sobrenatural', Mystery: 'Misterio',
  Horror: 'Terror', Thriller: 'Suspenso', Psychological: 'Psicológico', Music: 'Música', 'Mahou Shoujo': 'Mahō shōjo',
};
const FORMAT_ES = { TV_SHORT: 'TV corto', MOVIE: 'Película', SPECIAL: 'Especial', MUSIC: 'Música' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const svg = p => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  link: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  star: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
};

/* ---------- Utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pct = a => (a.episodes ? a.watched / a.episodes : a.status === 'done' ? 1 : 0);
const metaLine = a => [a.type, a.year, a.episodes ? `${a.episodes} eps` : null].filter(Boolean).join(' · ');
const epText = a => (a.episodes ? `${a.watched} / ${a.episodes} eps` : `${a.watched} eps vistos`);
const initial = t => esc(([...String(t || '?').trim()][0] || '?').toUpperCase());
const coverImg = a => (a.image
  ? `<img src="${esc(a.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-ph="${initial(a.title)}">`
  : `<div class="cover-ph" aria-hidden="true">${initial(a.title)}</div>`);

/* ---------- Saneado: todo lo que entra (localStorage, importación, API) pasa por aquí ---------- */
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min = 0, max = 1e6) => {
  if (v === '' || v == null) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
const safeUrl = v => {
  try {
    const u = new URL(str(v, 2000));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
};

function sanitize(a) {
  if (!a || typeof a !== 'object') return null;
  const title = str(a.title, 200);
  if (!title) return null;
  const episodes = int(a.episodes, 0, 1e5) || null;
  const genres = Array.isArray(a.genres) ? a.genres : str(a.genres, 1000).split(',');
  const score = Number(a.score);
  return {
    id: str(a.id, 64) || uid(),
    aniId: int(a.aniId, 1, 1e9),
    title,
    image: safeUrl(a.image),
    status: Object.hasOwn(STATUS, a.status) ? a.status : 'plan',
    priority: Object.hasOwn(PRIORITY, a.priority) ? a.priority : 'med',
    episodes,
    watched: Math.min(int(a.watched, 0, 1e5) ?? 0, episodes ?? Infinity),
    rating: int(a.rating, 0, 5) ?? 0,
    genres: [...new Set(genres.map(g => str(g, 40)).filter(Boolean))].slice(0, 10),
    notes: str(a.notes, 2000),
    synopsis: str(a.synopsis, 4000),
    url: safeUrl(a.url),
    banner: safeUrl(a.banner),
    year: int(a.year, 1900, 2100),
    type: str(a.type, 20),
    score: a.score != null && score > 0 && score <= 10 ? Math.round(score * 100) / 100 : null,
    addedAt: int(a.addedAt, 0, 1e14) || Date.now(),
    updatedAt: int(a.updatedAt, 0, 1e14) || Date.now(),
  };
}
const sanitizeList = list => (Array.isArray(list) ? list.map(sanitize).filter(Boolean) : []);

const fromAniList = m => sanitize({
  aniId: m.id,
  title: m.title?.english || m.title?.romaji,
  image: m.coverImage?.extraLarge || m.coverImage?.large,
  episodes: m.episodes,
  genres: (m.genres || []).map(g => GENRES_ES[g] || g),
  synopsis: m.description?.replace(/<[^>]*>/g, ''),
  url: m.siteUrl,
  banner: m.bannerImage,
  year: m.seasonYear,
  type: FORMAT_ES[m.format] || m.format,
  score: m.averageScore / 10,
});

const FIELDS = 'id title { romaji english } coverImage { extraLarge large } episodes genres description(asHtml: false) seasonYear format averageScore siteUrl bannerImage';
async function anilist(filter, { q, perPage = 24, signal } = {}) {
  // GraphQL rechaza variables declaradas y no usadas: $q solo existe cuando hay búsqueda
  const query = `query (${q ? '$q: String, ' : ''}$n: Int) { Page(perPage: $n) { media(type: ANIME, isAdult: false, ${q ? 'search: $q, ' : ''}${filter}) { ${FIELDS} } } }`;
  const res = await fetch(API, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { q, n: perPage } }),
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'rate' : 'http');
  const json = await res.json();
  return (json?.data?.Page?.media || []).map(fromAniList).filter(a => a?.aniId);
}

/* ---------- Persistencia: Supabase (tabla animes, una fila por anime; RLS = cada quien solo ve lo suyo) ---------- */
const db = typeof SUPABASE_URL === 'string' && SUPABASE_URL && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
let user = null;
let synced = new Map(); // id → JSON del último estado enviado a la base
let saveChain = Promise.resolve();
let unsaved = false;

// Envía solo lo que cambió desde el último guardado; en serie para que no se adelanten escrituras viejas.
function save() {
  saveChain = saveChain.then(pushChanges);
  return saveChain;
}

async function pushChanges() {
  if (!user) return;
  const now = new Map(items.map(a => [a.id, JSON.stringify(a)]));
  const upserts = items.filter(a => synced.get(a.id) !== now.get(a.id));
  const deletes = [...synced.keys()].filter(id => !now.has(id));
  if (!upserts.length && !deletes.length) return;
  synced = now;
  unsaved = true;
  try {
    if (upserts.length) {
      const { error } = await db.from('animes').upsert(upserts.map(a => ({ user_id: user.id, id: a.id, data: a })));
      if (error) throw error;
    }
    if (deletes.length) {
      const { error } = await db.from('animes').delete().in('id', deletes);
      if (error) throw error;
    }
    unsaved = false;
  } catch (err) {
    console.error(err);
    upserts.forEach(a => synced.delete(a.id)); // quedan pendientes y se reintentan en el próximo guardado
    deletes.forEach(id => synced.set(id, ''));
    toast('No se pudo guardar en la nube.', { label: 'Reintentar', run: save });
  }
}

async function loadItems() {
  // shortcut: Supabase devuelve máximo 1000 filas por consulta; paginar si alguien supera los 1000 animes
  const { data, error } = await db.from('animes').select('data');
  if (error) throw error;
  items = sanitizeList(data.map(r => r.data));
  synced = new Map(items.map(a => [a.id, JSON.stringify(a)]));
}

// Lista que quedó en este navegador de la versión sin cuentas (se ofrece subirla una vez).
function localBackup() {
  try { return sanitizeList(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
}

/* ---------- Estado y DOM ---------- */
let items = [];
const ui = { status: 'all', genre: null, q: '', sort: 'recent' };
let statsSeen = false;
let discoverTab = 'season';
const discoverCache = {};

const nav = $('#nav');
const grid = $('#grid');
const statusTabs = $('#statusTabs');
const chipsEl = $('#genreChips');
const searchInput = $('#search');
const sortSel = $('#sort');
const listCount = $('#listCount');
const emptyStart = $('#emptyStart');
const emptyFilter = $('#emptyFilter');
const genreBars = $('#genreBars');
const discoverEl = $('#discover');
const discoverTabs = $('#discoverTabs');
const editModal = $('#editModal');
const form = $('#editForm');
const F = form.elements;
const lookupResults = $('#lookupResults');
const coverPreview = $('#coverPreview');
const synopsisEl = $('#synopsis');
const formMsgEl = $('#formMsg');
const deleteBtn = $('#deleteBtn');
const formStars = $('#formStars');
const randomModal = $('#randomModal');
const randomCover = $('#randomCover');
const randomTitle = $('#randomTitle');
const randomMeta = $('#randomMeta');
const startBtn = $('#startBtn');
const toastsEl = $('#toasts');
const importInput = $('#importInput');

const find = id => items.find(a => a.id === id);
const hasAni = id => id != null && items.some(a => a.aniId === id);
const cardEl = id => $$('.card', grid).find(el => el.dataset.id === id);

/* ---------- Render: lista ---------- */
function visible() {
  const order = { high: 0, med: 1, low: 2 };
  const sorters = {
    recent: (a, b) => b.addedAt - a.addedAt,
    priority: (a, b) => order[a.priority] - order[b.priority] || b.addedAt - a.addedAt,
    title: (a, b) => a.title.localeCompare(b.title, 'es'),
    rating: (a, b) => b.rating - a.rating || (b.score ?? 0) - (a.score ?? 0),
    progress: (a, b) => pct(b) - pct(a) || b.watched - a.watched,
  };
  return items
    .filter(a => (ui.status === 'all' || a.status === ui.status)
      && (!ui.genre || a.genres.includes(ui.genre))
      && (!ui.q || norm(`${a.title} ${a.genres.join(' ')} ${a.notes}`).includes(ui.q)))
    .sort(sorters[ui.sort]);
}

function cardHTML(a, i, animate) {
  const stars = [1, 2, 3, 4, 5].map(n =>
    `<button class="star${n <= a.rating ? ' is-on' : ''}" type="button" data-act="rate" data-v="${n}" aria-label="Calificar ${n} de 5">${ICON.star}</button>`).join('');
  const meta = metaLine(a);
  return `
  <article class="card${animate ? ' card--enter' : ''}" data-id="${esc(a.id)}" style="--i:${Math.min(i, 12)}">
    <div class="card__cover" title="Editar">
      ${coverImg(a)}
      ${a.synopsis ? `<div class="card__hover"><p>${esc(a.synopsis)}</p></div>` : ''}
      <div class="card__badges">
        <span class="badge status s-${a.status}">${STATUS[a.status]}</span>
        <span class="badge prio prio--${a.priority}">${PRIORITY[a.priority]}</span>
      </div>
      ${a.score ? `<span class="badge card__score">★ ${a.score.toFixed(1)}</span>` : ''}
    </div>
    <div class="card__body">
      <div>
        <h3 class="card__title">${esc(a.title)}</h3>
        ${meta ? `<p class="card__meta">${esc(meta)}</p>` : ''}
      </div>
      ${a.genres.length ? `<div class="tags">${a.genres.slice(0, 2).map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}
      ${a.notes ? `<p class="card__notes">${esc(a.notes)}</p>` : ''}
      <div class="progress">
        <div class="progress__track"><span class="progress__fill" style="width:${pct(a) * 100}%"></span></div>
        <div class="progress__row">
          <button class="icon-btn icon-btn--sm" type="button" data-act="dec" aria-label="Quitar un episodio">${ICON.minus}</button>
          <span class="progress__text">${epText(a)}</span>
          <button class="icon-btn icon-btn--sm" type="button" data-act="inc" aria-label="Sumar un episodio">${ICON.plus}</button>
        </div>
      </div>
      <div class="card__foot">
        <div class="stars" role="group" aria-label="Tu calificación">${stars}</div>
        <div class="card__actions">
          ${a.url ? `<a class="icon-btn icon-btn--sm" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir enlace de ${esc(a.title)}">${ICON.link}</a>` : ''}
          <button class="icon-btn icon-btn--sm" type="button" data-act="edit" aria-label="Editar ${esc(a.title)}">${ICON.edit}</button>
          <button class="icon-btn icon-btn--sm" type="button" data-act="delete" aria-label="Eliminar ${esc(a.title)}">${ICON.trash}</button>
        </div>
      </div>
    </div>
  </article>`;
}

function genreCounts() {
  const m = new Map();
  items.forEach(a => a.genres.forEach(g => m.set(g, (m.get(g) || 0) + 1)));
  return [...m].sort((a, b) => b[1] - a[1]);
}

function renderChips() {
  const counts = genreCounts();
  if (ui.genre && !counts.some(([g]) => g === ui.genre)) ui.genre = null;
  const top = counts.slice(0, 12).map(([g]) => g);
  if (ui.genre && !top.includes(ui.genre)) top.push(ui.genre);
  chipsEl.innerHTML = top.length < 2 ? '' : [null, ...top].map(g =>
    `<button class="chip${ui.genre === g ? ' is-active' : ''}" type="button" data-genre="${esc(g ?? '')}">${esc(g ?? 'Todos los géneros')}</button>`).join('');
}

function updateCounts() {
  $$('[data-status]', statusTabs).forEach(b => {
    const s = b.dataset.status;
    b.querySelector('.count').textContent = s === 'all' ? items.length : items.filter(a => a.status === s).length;
  });
  moveThumb(statusTabs);
  listCount.textContent = items.length ? `${items.length} ${items.length === 1 ? 'anime guardado' : 'animes guardados'}` : '';
}

// animate: 'all' | 'none' | id de la única tarjeta que entra animada
function renderList(animate = 'all') {
  renderChips();
  const list = visible();
  grid.innerHTML = list.map((a, i) => cardHTML(a, i, animate === 'all' || animate === a.id)).join('');
  emptyStart.hidden = items.length > 0;
  emptyFilter.hidden = !items.length || list.length > 0;
  updateCounts();
}

function patchCard(card, a) {
  card.querySelector('.progress__fill').style.width = `${pct(a) * 100}%`;
  card.querySelector('.progress__text').textContent = epText(a);
  const badge = card.querySelector('.status');
  badge.className = `badge status s-${a.status}`;
  badge.textContent = STATUS[a.status];
  $$('.star', card).forEach((s, i) => s.classList.toggle('is-on', i < a.rating));
}

function refresh(animate = 'none') {
  renderList(animate);
  renderStats();
  syncDiscover();
}
function commit(animate = 'none') {
  const saved = save();
  refresh(animate);
  return saved;
}

// Cambios rápidos desde la tarjeta: se parchea en sitio para no re-animar toda la cuadrícula.
function quickSaved(a, card) {
  a.updatedAt = Date.now();
  save();
  patchCard(card, a);
  updateCounts();
  renderStats();
  if (!visible().includes(a)) {
    card.classList.add('is-leaving');
    setTimeout(() => renderList('none'), 320);
  }
}

function moveThumb(seg) {
  const active = seg.querySelector('[aria-pressed="true"]');
  const thumb = seg.querySelector('.segmented__thumb');
  if (!active) return;
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
}
const press = (seg, btn) => $$('button', seg).forEach(b => b.setAttribute('aria-pressed', String(b === btn)));

/* ---------- Muro de pósters (anime en tendencia) y arte de fondo ---------- */
let wallList = [];
// AniList guarda extraLarge en /cover/large/ y large en /cover/medium/: el muro no necesita la grande
const smallCover = a => ({ ...a, image: a.image.replace('/cover/large/', '/cover/medium/') });

async function loadWalls() {
  try { wallList = (await getDiscover('season')).filter(a => a.image); } catch { wallList = []; }
  const rows = [wallList.slice(0, 12), wallList.slice(12, 24)].filter(r => r.length >= 6);
  const html = rows.map(r => {
    const posters = r.map(a => `<button class="poster" type="button" tabindex="-1" data-wall="${a.aniId}">${coverImg(smallCover(a))}<span>${esc(a.title)}</span></button>`).join('');
    return `<div class="wall__row">${posters}${posters}</div>`; // doble para el bucle infinito
  }).join('');
  $$('.wall').forEach(w => { w.innerHTML = html; });
  const banner = wallList.find(a => a.banner)?.banner;
  if (banner) {
    const art = $('#discoverArt');
    art.src = banner;
    art.hidden = false;
  }
}

// Clic en un póster: con sesión abre el editor con ese anime ya cargado; sin sesión invita a crear cuenta.
document.addEventListener('click', e => {
  const p = e.target.closest('[data-wall]');
  const a = p && wallList.find(x => x.aniId === Number(p.dataset.wall));
  if (!a) return;
  if (!user) {
    setAuthMode('signup');
    A.email.focus();
    return;
  }
  openEditor();
  lookupList = [a];
  pick(a, true);
  renderResults();
});

/* ---------- Tema claro / oscuro ---------- */
const THEME_KEY = 'animelist.theme';
const themeBtn = $('#themeToggle');
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (darkMQ.matches ? 'dark' : 'light')) === 'dark';
const syncThemeLabel = () => themeBtn.setAttribute('aria-label', isDark() ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');

themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  const apply = () => { document.documentElement.dataset.theme = next; syncThemeLabel(); };
  if (!document.startViewTransition || reduceMotion) return apply();
  const r = themeBtn.getBoundingClientRect();
  document.documentElement.style.setProperty('--vt-x', `${r.left + r.width / 2}px`);
  document.documentElement.style.setProperty('--vt-y', `${r.top + r.height / 2}px`);
  document.startViewTransition(apply);
});
darkMQ.addEventListener('change', syncThemeLabel);
syncThemeLabel();

const FMT = { int: v => Math.round(v).toLocaleString('es'), pct: v => `${Math.round(v)}%`, dec: v => v.toFixed(1) };
function countTo(el, to) {
  const fmt = FMT[el.dataset.fmt || 'int'];
  const from = Number(el.dataset.v) || 0;
  el.dataset.v = to;
  if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const frame = now => {
    const p = Math.min(1, (now - t0) / 900);
    el.textContent = fmt(from + (to - from) * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function renderStats() {
  if (!statsSeen) return;
  const by = s => items.filter(a => a.status === s).length;
  const eps = items.reduce((n, a) => n + a.watched, 0);
  const rated = items.filter(a => a.rating);
  const active = items.length - by('dropped');
  const values = {
    total: items.length, plan: by('plan'), watching: by('watching'), done: by('done'),
    eps, hours: eps * 24 / 60,
    rate: active ? by('done') / active * 100 : 0,
    avg: rated.length ? rated.reduce((n, a) => n + a.rating, 0) / rated.length : 0,
  };
  $$('[data-stat]').forEach(el => countTo(el, values[el.dataset.stat]));
  Object.keys(STATUS).forEach(s => {
    $(`.dist .d-${s}`).style.flexGrow = by(s);
    $(`[data-legend="${s}"]`).textContent = by(s);
  });
  const top = genreCounts().slice(0, 5);
  genreBars.innerHTML = top.length
    ? top.map(([g, n]) => `<li><span class="bars__name">${esc(g)}</span><span class="bars__track"><i style="width:${n / top[0][1] * 100}%"></i></span><b>${n}</b></li>`).join('')
    : '<li class="bars__empty">Añade animes con géneros para ver tus favoritos.</li>';
}

/* ---------- Acciones sobre tarjetas ---------- */
function step(a, d, card) {
  const w = Math.max(0, Math.min(a.episodes ?? Infinity, a.watched + d));
  if (w === a.watched) return;
  const wasDone = a.status === 'done';
  a.watched = w;
  if (a.status === 'plan' && w > 0) a.status = 'watching';
  if (a.episodes && w === a.episodes) a.status = 'done';
  else if (wasDone && a.episodes) a.status = 'watching';
  quickSaved(a, card);
  if (!wasDone && a.status === 'done') {
    burst(card);
    toast(`¡Terminaste “${a.title}”! 🎉`);
  }
}

function rate(a, v, card) {
  a.rating = a.rating === v ? 0 : v;
  quickSaved(a, card);
}

function remove(a) {
  const idx = items.indexOf(a);
  if (idx < 0) return;
  items.splice(idx, 1);
  const card = cardEl(a.id);
  card?.classList.add('is-leaving');
  setTimeout(() => commit(), card ? 300 : 0);
  toast(`Eliminaste “${a.title}”`, {
    label: 'Deshacer',
    run: () => { items.splice(Math.min(idx, items.length), 0, a); commit(a.id); },
  });
}

function burst(el) {
  if (reduceMotion) return;
  const r = el.getBoundingClientRect();
  const colors = ['#9fe870', '#163300', '#e2f6d5', '#054d28'];
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 3}px;background:${colors[i % 4]}`;
    document.body.append(p);
    const ang = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 150;
    p.animate([
      { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist + 80}px)) rotate(${Math.random() * 720}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 600, easing: 'cubic-bezier(.22,1,.36,1)' }).onfinish = () => p.remove();
  }
}

/* ---------- Toasts ---------- */
function toast(msg, action, ms = action ? 6000 : 3200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.append(Object.assign(document.createElement('span'), { textContent: msg }));
  const close = () => { t.classList.add('is-out'); setTimeout(() => t.remove(), 250); };
  if (action) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: action.label });
    b.onclick = () => { b.onclick = null; action.run(); close(); };
    t.append(b);
  }
  toastsEl.append(t);
  setTimeout(close, ms);
}

/* ---------- Editor (añadir / editar) ---------- */
let editingId = null;
let meta = {};
let lookupCtl;
let lookupTimer;
let lookupList = [];
let lookupFor = null; // texto cuya búsqueda ya terminó
let picked = null;    // coincidencia de AniList elegida (sola o a mano)
let saving = false;
let previewTimer;

function setRating(v) {
  F.rating.value = v;
  $$('.star', formStars).forEach((s, i) => s.classList.toggle('is-on', i < v));
}
function updatePreview() {
  coverPreview.innerHTML = coverImg({ image: safeUrl(F.image.value), title: F.title.value || '?' });
}
function showSynopsis() {
  synopsisEl.hidden = !meta.synopsis;
  synopsisEl.querySelector('p').textContent = meta.synopsis || '';
}
const formMsg = text => { formMsgEl.textContent = text; };

function openEditor(a = null) {
  editingId = a?.id ?? null;
  clearTimeout(lookupTimer);
  lookupCtl?.abort(); // una búsqueda de la sesión anterior no debe pintar resultados aquí
  form.reset();
  formMsg('');
  lookupResults.innerHTML = '';
  lookupResults.classList.remove('is-loading');
  lookupList = [];
  lookupFor = null;
  picked = null;
  const src = a ?? { status: 'plan', priority: 'med', rating: 0, genres: [] };
  meta = a ? { aniId: a.aniId, synopsis: a.synopsis, year: a.year, type: a.type, score: a.score } : {};
  F.title.value = src.title ?? '';
  F.image.value = src.image ?? '';
  F.status.value = src.status;
  F.priority.value = src.priority;
  F.episodes.value = src.episodes ?? '';
  F.watched.value = src.watched || '';
  F.genres.value = src.genres.join(', ');
  F.url.value = src.url ?? '';
  F.notes.value = src.notes ?? '';
  setRating(src.rating);
  $('#editHeading').textContent = a ? 'Editar anime' : 'Añadir anime';
  deleteBtn.hidden = !a;
  updatePreview();
  showSynopsis();
  editModal.showModal();
  F.title.focus();
}

const flash = el => el.animate?.([{ backgroundColor: '#e2f6d5' }, { backgroundColor: '#ffffff' }], { duration: 900, easing: 'ease-out' });

// Carga la info de una coincidencia en el formulario. explicit = la eligió la persona (no la automática).
function pick(a, explicit = false) {
  picked = a;
  meta = { aniId: a.aniId, synopsis: a.synopsis, year: a.year, type: a.type, score: a.score };
  if (explicit) {
    F.title.value = a.title;
    lookupFor = a.title;
  }
  const fill = { image: a.image, episodes: a.episodes ?? '', genres: a.genres.join(', '), url: a.url };
  Object.entries(fill).forEach(([k, v]) => {
    if (F[k].value === String(v)) return;
    F[k].value = v;
    flash(F[k]);
  });
  updatePreview();
  showSynopsis();
  formMsg(!editingId && hasAni(a.aniId) ? 'Este anime ya está en tu lista.' : '');
}

function unpick() {
  if (!picked) return;
  picked = null;
  meta = {};
  ['image', 'episodes', 'genres', 'url'].forEach(k => { F[k].value = ''; });
  updatePreview();
  showSynopsis();
  formMsg('');
}

function renderResults() {
  lookupResults.classList.remove('is-loading');
  if (!lookupList.length) {
    lookupResults.innerHTML = `<p class="hint">No encontré “${esc(lookupFor)}” en AniList. Se guardará solo con el nombre.</p>`;
    return;
  }
  const rows = lookupList.map((a, i) => {
    const on = picked?.aniId === a.aniId;
    return `
    <button class="result${on ? ' is-picked' : ''}" type="button" data-i="${i}" aria-pressed="${on}">
      ${coverImg(a)}
      <span class="result__text"><strong>${esc(a.title)}</strong><small>${esc(metaLine(a) || 'Sin datos')}${hasAni(a.aniId) ? ' · <span class="in-list">✓ En tu lista</span>' : ''}</small></span>
      ${on ? '<span class="result__check" aria-hidden="true">✓</span>' : ''}
    </button>`;
  }).join('');
  lookupResults.innerHTML = `<p class="hint">${picked ? '✓ Info cargada de AniList. ¿No es este? Elige otro:' : 'Elige uno para cargar su info:'}</p>${rows}${
    picked && !editingId ? '<button class="btn-link result__none" type="button" data-none>Ninguno, guardar solo con mi texto</button>' : ''}`;
}

async function searchTitle(q) {
  lookupCtl?.abort();
  const ctl = lookupCtl = new AbortController();
  try {
    lookupList = await anilist('sort: SEARCH_MATCH', { q, perPage: 6, signal: ctl.signal });
  } catch (err) {
    if (err.name === 'AbortError') return;
    lookupResults.classList.remove('is-loading');
    lookupResults.innerHTML = `<p class="hint">${err.message === 'rate'
      ? 'AniList pide una pausa; espera un segundo y vuelve a escribir.'
      : 'No pude conectar con AniList. Puedes guardarlo solo con el nombre.'}</p>`;
    return;
  }
  lookupFor = q;
  if (!editingId) lookupList[0] ? pick(lookupList[0]) : unpick(); // al añadir, la mejor coincidencia se carga sola
  renderResults();
}

function runLookup() {
  clearTimeout(lookupTimer);
  const q = F.title.value.trim();
  if (q.length < 2) {
    lookupCtl?.abort();
    lookupResults.innerHTML = '';
    lookupFor = null;
    return;
  }
  if (!lookupResults.querySelector('.result')) lookupResults.innerHTML = '<p class="hint">Buscando en AniList…</p>';
  lookupResults.classList.add('is-loading');
  lookupTimer = setTimeout(() => searchTitle(q), 400);
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (saving) return;
  const prev = editingId ? find(editingId) : null;
  const q = F.title.value.trim();
  // Enter antes de que termine la búsqueda: se espera para guardar con la info completa
  if (!prev && q.length >= 2 && lookupFor !== q) {
    saving = true;
    clearTimeout(lookupTimer);
    lookupResults.classList.add('is-loading');
    await searchTitle(q);
    saving = false;
    if (!editModal.open) return;
  }
  const a = sanitize({
    ...meta,
    id: prev?.id,
    title: !prev && picked ? picked.title : F.title.value,
    image: F.image.value,
    status: F.status.value,
    priority: F.priority.value,
    episodes: F.episodes.value,
    watched: F.watched.value,
    genres: F.genres.value,
    url: F.url.value,
    notes: F.notes.value,
    rating: F.rating.value,
    addedAt: prev?.addedAt,
  });
  if (!a) return formMsg('Ponle un título.');
  if (!prev && a.aniId && hasAni(a.aniId)) return formMsg('Este anime ya está en tu lista.');
  if (a.status === 'done' && a.episodes) a.watched = a.episodes;
  if (prev) items[items.indexOf(prev)] = a; else items.unshift(a);
  editModal.close();
  commit(prev ? 'none' : a.id);
  toast(prev ? 'Cambios guardados' : `“${a.title}” añadido a tu lista`);
});

/* ---------- Ruleta ---------- */
let spin = 0;
function pickRandom() {
  const pool = items.filter(a => a.status === 'plan' || a.status === 'watching');
  if (!pool.length) return toast('Primero añade animes a “Quiero ver” y la ruleta elegirá por ti.');
  const weighted = pool.flatMap(a => Array(WEIGHT[a.priority]).fill(a));
  const winner = weighted[Math.floor(Math.random() * weighted.length)];
  if (!randomModal.open) randomModal.showModal();
  const id = ++spin;
  const frames = reduceMotion || pool.length < 2 ? 0 : 16;
  let n = 0;
  (function tick() {
    if (id !== spin) return;
    const final = n >= frames;
    showPick(final ? winner : pool[Math.floor(Math.random() * pool.length)], final);
    if (!final) { n++; setTimeout(tick, 40 + n * n); } // se va frenando como una ruleta
  })();
}

function showPick(a, final) {
  randomCover.innerHTML = coverImg(a);
  randomCover.classList.toggle('is-final', final);
  randomTitle.textContent = a.title;
  randomMeta.textContent = final ? [metaLine(a), `Prioridad ${PRIORITY[a.priority].toLowerCase()}`].filter(Boolean).join(' · ') : 'Girando…';
  startBtn.disabled = !final;
  startBtn.dataset.id = a.id;
  startBtn.textContent = a.status === 'watching' ? 'Seguir viéndolo' : '¡Empezar a verlo!';
}

startBtn.addEventListener('click', () => {
  const a = find(startBtn.dataset.id);
  randomModal.close();
  if (!a) return;
  if (a.status === 'plan') { a.status = 'watching'; a.updatedAt = Date.now(); commit(); }
  toast(`¡A disfrutar “${a.title}”! 🍿`);
});
randomModal.addEventListener('close', () => spin++);
randomModal.addEventListener('click', e => { if (e.target === randomModal) randomModal.close(); });

/* ---------- Descubrir ---------- */
function dcardHTML(a, i) {
  return `
  <article class="dcard" style="--i:${Math.min(i, 10)}">
    <div class="dcard__cover">${coverImg(a)}${a.score ? `<span class="badge dcard__score">★ ${a.score.toFixed(1)}</span>` : ''}</div>
    <h3 class="dcard__title">${esc(a.title)}</h3>
    <p class="dcard__meta">${esc(metaLine(a) || 'Próximamente')}</p>
    <button class="btn btn--sm btn--on-dark" type="button" data-ani="${a.aniId}"></button>
  </article>`;
}

function syncDiscover() {
  $$('[data-ani]', discoverEl).forEach(b => {
    const added = hasAni(Number(b.dataset.ani));
    b.disabled = added;
    b.textContent = added ? '✓ En tu lista' : '+ Añadir a mi lista';
  });
}

// Una sola petición por pestaña: la comparten "Descubrir" y el muro de pósters. Si falla, se puede reintentar.
const getDiscover = tab => (discoverCache[tab] ??= anilist(DISCOVER[tab]).catch(err => {
  delete discoverCache[tab];
  throw err;
}));
let discoverList = [];

async function loadDiscover(tab) {
  discoverTab = tab;
  press(discoverTabs, $(`[data-tab="${tab}"]`, discoverTabs));
  moveThumb(discoverTabs);
  discoverEl.innerHTML = '<div class="dcard dcard--skeleton"><div class="dcard__cover"></div><div class="sk-line"></div><div class="sk-line sk-line--short"></div></div>'.repeat(8);
  let list;
  try {
    list = await getDiscover(tab);
  } catch (err) {
    if (discoverTab === tab) {
      discoverEl.innerHTML = `<div class="discover__msg"><p>${err.message === 'rate' ? 'AniList pide una pausa. Intenta en unos segundos.' : 'No pude conectar con AniList.'}</p><button class="btn btn--primary btn--sm" type="button" data-retry="${tab}">Reintentar</button></div>`;
    }
    return;
  }
  if (discoverTab !== tab) return;
  discoverList = list;
  discoverEl.innerHTML = list.length ? list.map(dcardHTML).join('') : '<div class="discover__msg"><p>Nada por aquí todavía.</p></div>';
  discoverEl.scrollLeft = 0;
  syncDiscover();
}

discoverEl.addEventListener('click', e => {
  const retry = e.target.closest('[data-retry]');
  if (retry) return loadDiscover(retry.dataset.retry);
  const b = e.target.closest('[data-ani]');
  if (!b || b.disabled) return;
  const src = discoverList.find(a => a.aniId === Number(b.dataset.ani));
  if (!src || hasAni(src.aniId)) return;
  const a = { ...src, id: uid(), addedAt: Date.now(), updatedAt: Date.now() };
  items.unshift(a);
  commit(a.id);
  b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 350, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  toast(`“${a.title}” añadido a tu lista`, { label: 'Editar', run: () => { const x = find(a.id); if (x) openEditor(x); } });
});

/* ---------- Importar / exportar ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'animelist', version: 1, exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `mis-animes-${new Date().toISOString().slice(0, 10)}.json`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast(`Respaldo descargado (${items.length} animes)`);
}

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  if (file.size > 5e6) return toast('El archivo es demasiado grande.');
  try {
    const data = JSON.parse(await file.text());
    const incoming = sanitizeList(Array.isArray(data) ? data : data?.items);
    if (!incoming.length) return toast('No encontré animes en ese archivo.');
    mergeItems(incoming);
    toast(`Importados ${incoming.length} animes`);
  } catch {
    toast('Ese archivo no es un respaldo válido.');
  }
});

// Une una lista entrante con la actual (mismo id o mismo anime de AniList → gana la entrante).
function mergeItems(incoming) {
  const byId = new Map(items.map(a => [a.id, a]));
  incoming.forEach(a => {
    const dup = a.aniId && [...byId.values()].find(x => x.aniId === a.aniId && x.id !== a.id);
    if (dup) byId.delete(dup.id);
    byId.set(a.id, a);
  });
  items = [...byId.values()];
  return commit('all');
}

/* ---------- Cuentas (Supabase Auth: correo + contraseña) ---------- */
const authForm = $('#authForm');
const A = authForm.elements;
const authTabs = $('#authTabs');
const authMsg = $('#authMsg');
const authSubmit = $('#authSubmit');
const appUrl = location.href.split('#')[0].split('?')[0];
const AUTH_UI = {
  login: { title: 'Entra a tu lista', submit: 'Entrar', email: true, pass: true },
  signup: { title: 'Crea tu cuenta', submit: 'Crear cuenta', email: true, pass: true },
  forgot: { title: 'Recupera tu acceso', submit: 'Enviarme un enlace', email: true, pass: false },
  recovery: { title: 'Nueva contraseña', submit: 'Guardar contraseña', email: false, pass: true },
};
const AUTH_ERRORS = {
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed: 'Confirma tu correo antes de entrar (revisa también spam).',
  user_already_exists: 'Ya existe una cuenta con ese correo. Inicia sesión.',
  weak_password: 'Contraseña muy débil: usa al menos 6 caracteres.',
  same_password: 'La nueva contraseña debe ser distinta a la anterior.',
  over_email_send_rate_limit: 'Se enviaron demasiados correos. Intenta más tarde.',
  over_request_rate_limit: 'Demasiados intentos. Espera un momento.',
};
let authMode = 'login';
let recovering = false;

function setView(view) {
  document.body.dataset.view = view;
  if (view === 'auth') requestAnimationFrame(() => moveThumb(authTabs));
}

function setAuthMode(mode) {
  authMode = mode;
  const cfg = AUTH_UI[mode];
  $('#authTitle').textContent = cfg.title;
  authSubmit.textContent = cfg.submit;
  A.email.closest('.field').hidden = !cfg.email;
  A.email.required = cfg.email;
  A.password.closest('.field').hidden = !cfg.pass;
  A.password.required = cfg.pass;
  A.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  authTabs.hidden = mode === 'forgot' || mode === 'recovery';
  $('#forgotBtn').hidden = mode !== 'login';
  $('#backBtn').hidden = mode !== 'forgot';
  const tab = $(`[data-mode="${mode}"]`, authTabs);
  if (tab) { press(authTabs, tab); moveThumb(authTabs); }
  authNote('');
}

function authNote(text, ok = false) {
  authMsg.textContent = text;
  authMsg.classList.toggle('is-ok', ok);
}

async function enter(u) {
  user = u;
  $('#userEmail').textContent = u.email;
  setView('app');
  try {
    await loadItems();
  } catch (err) {
    console.error(err);
    items = [];
    synced = new Map();
    toast('No pude cargar tu lista. Revisa tu conexión y recarga la página.', null, 8000);
  }
  if (user !== u) return; // cerró sesión mientras cargaba
  refresh('all');
  const local = localBackup();
  if (local.length) {
    toast(`Hay ${local.length} animes guardados en este navegador.`, {
      label: 'Subirlos a mi cuenta',
      run: async () => {
        await mergeItems(local);
        if (!unsaved) try { localStorage.removeItem(KEY); } catch {}
        toast('Lista subida a tu cuenta');
      },
    }, 20000);
  }
}

function leave() {
  user = null;
  items = [];
  synced = new Map();
  $$('dialog[open]').forEach(d => d.close());
  refresh('none');
  setAuthMode('login');
  setView('auth');
}

async function logout() {
  if (unsaved && !confirm('Hay cambios que no se han guardado en la nube. ¿Salir de todos modos?')) return;
  await db.auth.signOut();
}

authTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b) setAuthMode(b.dataset.mode);
});
$('#forgotBtn').addEventListener('click', () => setAuthMode('forgot'));
$('#backBtn').addEventListener('click', () => setAuthMode('login'));

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!db) return;
  const email = A.email.value.trim();
  const password = A.password.value;
  authSubmit.disabled = true;
  authNote('');
  try {
    let res;
    if (authMode === 'login') {
      res = await db.auth.signInWithPassword({ email, password });
    } else if (authMode === 'signup') {
      res = await db.auth.signUp({ email, password, options: { emailRedirectTo: appUrl } });
      if (!res.error && !res.data.session) return authNote('Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego inicia sesión.', true);
    } else if (authMode === 'forgot') {
      res = await db.auth.resetPasswordForEmail(email, { redirectTo: appUrl });
      if (!res.error) return authNote('Si ese correo tiene cuenta, te llegará un enlace para cambiar la contraseña.', true);
    } else {
      res = await db.auth.updateUser({ password });
      if (!res.error) {
        recovering = false;
        history.replaceState(null, '', appUrl);
        A.password.value = '';
        enter(res.data.user);
        toast('Contraseña actualizada');
        return;
      }
    }
    if (res.error) authNote(AUTH_ERRORS[res.error.code] || res.error.message);
  } catch (err) {
    console.error(err);
    authNote('No pude conectar con el servidor. Revisa tu internet.');
  } finally {
    authSubmit.disabled = false;
  }
});

addEventListener('beforeunload', e => { if (unsaved) e.preventDefault(); });

/* ---------- Eventos ---------- */
function clearFilters() {
  Object.assign(ui, { status: 'all', genre: null, q: '' });
  searchInput.value = '';
  press(statusTabs, $('[data-status="all"]', statusTabs));
  renderList();
}

const ACTIONS = {
  add: () => openEditor(),
  random: pickRandom,
  export: exportData,
  import: () => importInput.click(),
  'clear-filters': clearFilters,
  logout,
};

document.addEventListener('click', e => {
  const action = e.target.closest('[data-action]');
  if (action) ACTIONS[action.dataset.action]?.();
  const close = e.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});

grid.addEventListener('click', e => {
  const card = e.target.closest('.card');
  const a = card && find(card.dataset.id);
  if (!a) return;
  const btn = e.target.closest('[data-act]');
  const act = btn?.dataset.act;
  if (act === 'inc') step(a, 1, card);
  else if (act === 'dec') step(a, -1, card);
  else if (act === 'rate') rate(a, Number(btn.dataset.v), card);
  else if (act === 'delete') remove(a);
  else if (act === 'edit' || (!e.target.closest('a, button') && e.target.closest('.card__cover, .card__title'))) openEditor(a);
});

statusTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  ui.status = b.dataset.status;
  press(statusTabs, b);
  renderList();
});

chipsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-genre]');
  if (!b) return;
  ui.genre = b.dataset.genre || null;
  renderList();
});

searchInput.addEventListener('input', () => {
  ui.q = norm(searchInput.value.trim());
  renderList('none');
});
sortSel.addEventListener('change', () => {
  ui.sort = sortSel.value;
  renderList();
});

discoverTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b && b.dataset.tab !== discoverTab) loadDiscover(b.dataset.tab);
});
$$('[data-scroll]').forEach(b => b.addEventListener('click', () =>
  discoverEl.scrollBy({ left: Number(b.dataset.scroll) * discoverEl.clientWidth * 0.8, behavior: reduceMotion ? 'auto' : 'smooth' })));

F.title.addEventListener('input', runLookup);
lookupResults.addEventListener('click', e => {
  if (e.target.closest('[data-none]')) { unpick(); renderResults(); F.title.focus(); return; }
  const b = e.target.closest('.result');
  if (!b) return;
  pick(lookupList[Number(b.dataset.i)], true);
  renderResults();
});
formStars.addEventListener('click', e => {
  const b = e.target.closest('.star');
  if (b) setRating(Number(F.rating.value) === Number(b.dataset.v) ? 0 : Number(b.dataset.v));
});
form.addEventListener('input', e => {
  if (e.target.name !== 'image' && e.target.name !== 'title') return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 300);
});
deleteBtn.addEventListener('click', () => {
  const a = find(editingId);
  editModal.close();
  if (a) remove(a);
});

// Portadas rotas → letra inicial
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.ph) return;
  img.replaceWith(Object.assign(document.createElement('div'), { className: 'cover-ph', textContent: img.dataset.ph }));
}, true);

// Atajos: N añadir · / buscar · R ruleta
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); searchInput.focus(); searchInput.scrollIntoView({ block: 'center' }); }
  else if (k === 'n') { e.preventDefault(); openEditor(); }
  else if (k === 'r') pickRandom();
});

addEventListener('scroll', () => nav.classList.toggle('is-scrolled', scrollY > 8), { passive: true });
// El thumb lima se re-mide cuando cambia el tamaño del control (carga de fuente, ventana, cambio de vista)
const thumbRO = new ResizeObserver(entries => new Set(entries.map(en => en.target.closest('.segmented'))).forEach(moveThumb));
$$('.segmented button').forEach(b => thumbRO.observe(b));

/* ---------- Observadores (scroll) ---------- */
const revealIO = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  en.target.classList.add('is-in');
  revealIO.unobserve(en.target);
}), { threshold: 0.12 });
$$('.reveal').forEach(el => revealIO.observe(el));

const navLinks = $$('.nav__pill');
const sectionIO = new IntersectionObserver(entries => entries.forEach(en => {
  if (en.isIntersecting) navLinks.forEach(l => l.classList.toggle('is-active', l.getAttribute('href') === `#${en.target.id}`));
}), { rootMargin: '-45% 0px -50% 0px' });
['inicio', 'lista', 'stats', 'descubrir'].forEach(id => sectionIO.observe(document.getElementById(id)));

new IntersectionObserver(([en], io) => {
  if (!en.isIntersecting) return;
  statsSeen = true;
  renderStats();
  io.disconnect();
}, { threshold: 0.2 }).observe($('#stats'));

new IntersectionObserver(([en], io) => {
  if (!en.isIntersecting) return;
  loadDiscover('season');
  io.disconnect();
}, { rootMargin: '400px' }).observe($('#descubrir'));

/* ---------- Inicio ---------- */
formStars.innerHTML = [1, 2, 3, 4, 5].map(n => `<button class="star" type="button" data-v="${n}" aria-label="${n} de 5">${ICON.star}</button>`).join('');
const track = $('.marquee__track');
track.append(track.firstElementChild.cloneNode(true)); // segunda copia para el bucle infinito
setAuthMode('login');
loadWalls();

if (!db) {
  setView('auth');
  authNote('Falta conectar la base de datos: pon la URL y la clave de Supabase en config.js (ver README).');
  authSubmit.disabled = true;
} else {
  db.auth.onAuthStateChange((event, session) => {
    // Supabase pide no llamar a la base dentro de este callback: se difiere con setTimeout
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        setAuthMode('recovery');
        setView('auth');
        return;
      }
      const u = session?.user ?? null;
      if (recovering || u?.id === user?.id) {
        if (!u) setView('auth');
        return;
      }
      if (u) enter(u);
      else leave();
    }, 0);
  });
}

// Autocomprobación de sanitize (frontera de confianza para importaciones y API)
{
  const t = sanitize({ title: '  Frieren ', status: 'toString', episodes: 3, watched: 9, image: 'javascript:alert(1)', genres: 'A, ,B,A' });
  console.assert(t.title === 'Frieren' && t.status === 'plan' && t.watched === 3 && t.image === '' && t.genres.join() === 'A,B', 'sanitize', t);
  console.assert(sanitize({ title: '' }) === null && sanitize(null) === null && sanitize({ title: 'x', episodes: 0 }).episodes === null, 'sanitize vacío');
}
