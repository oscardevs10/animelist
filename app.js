'use strict';
/* animelist — lista de anime y manga por ver. Datos en Supabase (por usuario); info de títulos vía la API GraphQL pública de AniList. */

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
const STATUS_MANGA = { plan: 'Quiero leer', watching: 'Leyendo', done: 'Completado', dropped: 'Abandonado' };
const FORMAT_ES = { TV_SHORT: 'TV corto', MOVIE: 'Película', SPECIAL: 'Especial', MUSIC: 'Música', MANGA: 'Manga', NOVEL: 'Novela ligera', ONE_SHOT: 'One-shot' };
const RELATION_ES = {
  SEQUEL: 'Secuela', PREQUEL: 'Precuela', SIDE_STORY: 'Historia paralela', SPIN_OFF: 'Spin-off', ALTERNATIVE: 'Versión alternativa',
  ADAPTATION: 'Adaptación', SOURCE: 'Obra original', PARENT: 'Historia principal', SUMMARY: 'Resumen', COMPILATION: 'Compilación', OTHER: 'Relacionado',
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchOnly = matchMedia('(hover: none)');

const svg = p => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  link: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  star: svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>'),
  spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
};

/* ---------- Utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pct = a => (a.episodes ? a.watched / a.episodes : a.status === 'done' ? 1 : 0);
const isManga = a => a.kind === 'manga';
const unit = a => (isManga(a) ? 'caps' : 'eps');
const statusLabel = a => (isManga(a) ? STATUS_MANGA : STATUS)[a.status];
const metaLine = a => [a.type, a.year, a.episodes ? `${a.episodes} ${unit(a)}` : null].filter(Boolean).join(' · ');
const epText = a => (a.episodes ? `${a.watched} / ${a.episodes} ${unit(a)}` : `${a.watched} ${unit(a)} ${isManga(a) ? 'leídos' : 'vistos'}`);
// Día local "2026-10-20": el historial cuenta episodios/capítulos por día.
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

const list = (v, maxLen, maxItems) =>
  [...new Set((Array.isArray(v) ? v : str(v, 1000).split(',')).map(x => str(x, maxLen)).filter(Boolean))].slice(0, maxItems);

// Historial { "2026-10-20": 3 }. shortcut: se guardan los últimos 365 días con actividad por título,
// para no pasar el límite de tamaño por fila de la base; si hiciera falta más, mover a una tabla aparte.
function cleanLog(log) {
  if (!log || typeof log !== 'object' || Array.isArray(log)) return {};
  return Object.fromEntries(Object.entries(log)
    .filter(([d, n]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && int(n, 1, 5000))
    .map(([d, n]) => [d, int(n, 1, 5000)])
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .slice(-365));
}

function sanitize(a) {
  if (!a || typeof a !== 'object') return null;
  const title = str(a.title, 200);
  if (!title) return null;
  const episodes = int(a.episodes, 0, 1e5) || null;
  const score = Number(a.score);
  const status = Object.hasOwn(STATUS, a.status) ? a.status : 'plan';
  return {
    id: str(a.id, 64) || uid(),
    aniId: int(a.aniId, 1, 1e9),
    kind: a.kind === 'manga' ? 'manga' : 'anime',
    title,
    image: safeUrl(a.image),
    status,
    priority: Object.hasOwn(PRIORITY, a.priority) ? a.priority : 'med',
    episodes,
    watched: Math.min(int(a.watched, 0, 1e5) ?? 0, episodes ?? Infinity),
    rating: int(a.rating, 0, 5) ?? 0,
    genres: list(a.genres, 40, 10),
    tags: list(a.tags, 30, 8),
    notes: str(a.notes, 2000),
    review: str(a.review, 280),
    log: cleanLog(a.log),
    // sin fecha de término guardada (datos de antes del historial): se usa la última edición
    doneAt: status === 'done' ? int(a.doneAt, 0, 1e14) || int(a.updatedAt, 0, 1e14) || Date.now() : null,
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
  kind: m.type === 'MANGA' ? 'manga' : 'anime',
  title: m.title?.english || m.title?.romaji,
  image: m.coverImage?.extraLarge || m.coverImage?.large,
  episodes: m.type === 'MANGA' ? m.chapters : m.episodes,
  genres: (m.genres || []).map(g => GENRES_ES[g] || g),
  synopsis: m.description?.replace(/<[^>]*>/g, ''),
  url: m.siteUrl,
  banner: m.bannerImage,
  year: m.seasonYear ?? m.startDate?.year,
  type: FORMAT_ES[m.format] || m.format,
  score: m.averageScore / 10,
});

const FIELDS = 'id type title { romaji english } coverImage { extraLarge large } episodes chapters genres description(asHtml: false) seasonYear startDate { year } format averageScore siteUrl bannerImage';
async function gql(query, variables, signal) {
  const res = await fetch(API, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'rate' : 'http');
  return (await res.json())?.data;
}

async function anilist(filter, { q, perPage = 24, signal, kind = 'anime' } = {}) {
  // GraphQL rechaza variables declaradas y no usadas: $q solo existe cuando hay búsqueda
  const query = `query (${q ? '$q: String, ' : ''}$n: Int) { Page(perPage: $n) { media(type: ${kind === 'manga' ? 'MANGA' : 'ANIME'}, isAdult: false, ${q ? 'search: $q, ' : ''}${filter}) { ${FIELDS} } } }`;
  const data = await gql(query, { q, n: perPage }, signal);
  return (data?.Page?.media || []).map(fromAniList).filter(a => a?.aniId);
}

async function fetchMedia(id) {
  const data = await gql(`query ($id: Int) { Media(id: $id) { ${FIELDS} } }`, { id });
  return data?.Media ? fromAniList(data.Media) : null;
}

// Añade un título de AniList a mi lista (desde la ficha, una secuela o la lista de un amigo).
async function addFromAniList(aniId, base = null) {
  if (!user || hasAni(aniId)) return null;
  const src = base?.aniId === aniId && base.synopsis ? base : await fetchMedia(aniId);
  if (!src || hasAni(aniId)) return null;
  const a = sanitize({ ...src, id: uid(), status: 'plan', priority: 'med', watched: 0, rating: 0, notes: '', review: '', tags: [], log: {}, addedAt: Date.now(), updatedAt: Date.now() });
  items.unshift(a);
  commit(a.id);
  return a;
}

/* ---------- En vivo desde AniList: próximo episodio y dónde verlo (no se guarda, cambia con el tiempo) ---------- */
const live = new Map(); // aniId → { next: { episode, at }, links: [{ site, url, icon, color }] } | null mientras carga
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const liveOf = m => ({
  next: m.nextAiringEpisode
    ? { episode: int(m.nextAiringEpisode.episode, 1, 1e5), at: (int(m.nextAiringEpisode.airingAt, 0, 1e10) || 0) * 1000 }
    : null,
  links: [...new Map((m.externalLinks || [])
    .filter(l => l?.type === 'STREAMING')
    .map(l => [str(l.site, 40), {
      site: str(l.site, 40),
      url: safeUrl(l.url).replace(/^http:/, 'https:'),
      icon: safeUrl(l.icon),
      color: /^#[0-9a-f]{3,8}$/i.test(l.color) ? l.color : '',
    }])).values()].filter(l => l.site && l.url).slice(0, 4),
  // continuaciones del mismo tipo (anime → anime, manga → manga) para avisar "nueva temporada"
  sequels: (m.relations?.edges || [])
    .filter(e => e?.relationType === 'SEQUEL' && e.node?.type === m.type)
    .map(e => ({ aniId: int(e.node.id, 1, 1e9), title: str(e.node.title?.english || e.node.title?.romaji, 200), status: str(e.node.status, 30) }))
    .filter(s => s.aniId && s.title),
});

function airingText(at) {
  const s = (at - Date.now()) / 1000;
  if (s <= 0) return 'ya disponible';
  if (s < 3600) return rtf.format(Math.max(1, Math.round(s / 60)), 'minute');
  if (s < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (s < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(at).toLocaleDateString('es', { day: 'numeric', month: 'short' }); // lejos: fecha corta
}

async function loadLive() {
  const ids = [...new Set(items.map(a => a.aniId).filter(id => id && !live.has(id)))];
  if (!ids.length) return;
  ids.forEach(id => live.set(id, null)); // marca como pedidos para no repetir la consulta
  const query = 'query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { id type nextAiringEpisode { episode airingAt } externalLinks { site url type icon color } relations { edges { relationType node { id type status title { romaji english } } } } } } }';
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const data = await gql(query, { ids: ids.slice(i, i + 50) });
      (data?.Page?.media || []).forEach(m => live.set(m.id, liveOf(m)));
    } catch (err) {
      console.error(err);
      ids.slice(i, i + 50).forEach(id => live.delete(id)); // se reintenta en el próximo cambio
    }
  }
  if (user) renderList('none');
  if (document.body.dataset.view === 'friend') renderFriend();
}

// El "dentro de 2 horas" se mantiene al día sin volver a pintar las tarjetas.
setInterval(() => $$('[data-airing]').forEach(el => { el.lastChild.textContent = ` ${airingText(Number(el.dataset.airing))}`; }), 60000);

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
const ui = { status: 'all', kind: 'all', genre: null, tag: null, q: '', sort: 'recent' };
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
      && (ui.kind === 'all' || a.kind === ui.kind)
      && (!ui.genre || a.genres.includes(ui.genre))
      && (!ui.tag || a.tags.includes(ui.tag))
      && (!ui.q || norm(`${a.title} ${a.genres.join(' ')} ${a.tags.join(' ')} ${a.notes} ${a.review}`).includes(ui.q)))
    .sort(sorters[ui.sort]);
}

const SEQUEL_TEXT = { RELEASING: 'Nueva temporada en emisión', FINISHED: 'Hay continuación', NOT_YET_RELEASED: 'Continuación anunciada' };

// Próximo episodio (solo si aún lo estás viendo o quieres verlo) y plataformas donde verlo.
function liveHTML(a) {
  const lv = live.get(a.aniId);
  if (!lv) return '';
  const next = lv.next && (a.status === 'watching' || a.status === 'plan')
    ? `<p class="airing${lv.next.at - Date.now() < 86400000 ? ' is-soon' : ''}" data-airing="${lv.next.at}" title="${esc(new Date(lv.next.at).toLocaleString('es'))}">${ICON.clock}<b>Ep ${lv.next.episode}</b> ${esc(airingText(lv.next.at))}</p>`
    : '';
  const where = lv.links.length
    ? `<div class="where">${lv.links.map(l => `<a class="where__link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="Ver en ${esc(l.site)}" aria-label="Ver en ${esc(l.site)}"${l.color ? ` style="--c:${l.color}"` : ''}>${l.icon ? `<img src="${esc(l.icon)}" alt="" referrerpolicy="no-referrer">` : esc(l.site.slice(0, 1))}</a>`).join('')}</div>`
    : '';
  // Terminaste el título y su continuación aún no está en tu lista
  const sequel = a.status === 'done' && lv.sequels?.find(s => !hasAni(s.aniId));
  const sequelBtn = sequel
    ? `<button class="sequel" type="button" data-act="sequel" data-ani="${sequel.aniId}" title="Añadir “${esc(sequel.title)}” a mi lista">${ICON.spark}<span><b>${SEQUEL_TEXT[sequel.status] || 'Hay continuación'}</b>${esc(sequel.title)}</span></button>`
    : '';
  return sequelBtn + next + where;
}

function cardHTML(a, i, animate) {
  const stars = [1, 2, 3, 4, 5].map(n =>
    `<button class="star${n <= a.rating ? ' is-on' : ''}" type="button" data-act="rate" data-v="${n}" aria-label="Calificar ${n} de 5">${ICON.star}</button>`).join('');
  const meta = metaLine(a);
  return `
  <article class="card${animate ? ' card--enter' : ''}" data-id="${esc(a.id)}" style="--i:${Math.min(i, 12)}">
    <div class="card__cover" title="Ver ficha">
      ${coverImg(a)}
      ${a.synopsis ? `<div class="card__hover"><p>${esc(a.synopsis)}</p></div>` : ''}
      <div class="card__badges">
        <span class="badge status s-${a.status}">${statusLabel(a)}</span>
        <span class="badge prio prio--${a.priority}">${PRIORITY[a.priority]}</span>
      </div>
      ${a.score ? `<span class="badge card__score">★ ${a.score.toFixed(1)}</span>` : ''}
    </div>
    <div class="card__body">
      <div>
        <h3 class="card__title">${esc(a.title)}</h3>
        ${meta ? `<p class="card__meta">${esc(meta)}</p>` : ''}
      </div>
      ${a.genres.length || a.tags.length ? `<div class="tags">${a.tags.slice(0, 2).map(t => `<span class="tag tag--mine">#${esc(t)}</span>`).join('')}${a.genres.slice(0, 2).map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}
      ${liveHTML(a)}
      ${a.notes ? `<p class="card__notes">${esc(a.notes)}</p>` : ''}
      <div class="progress">
        <div class="progress__track"><span class="progress__fill" style="width:${pct(a) * 100}%"></span></div>
        <div class="progress__row">
          <button class="icon-btn icon-btn--sm" type="button" data-act="dec" aria-label="Quitar uno (${unit(a) === "caps" ? "capítulo" : "episodio"})">${ICON.minus}</button>
          <span class="progress__text">${epText(a)}</span>
          <button class="icon-btn icon-btn--sm" type="button" data-act="inc" aria-label="Sumar uno (${unit(a) === "caps" ? "capítulo" : "episodio"})">${ICON.plus}</button>
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

const allTags = () => [...new Set(items.flatMap(a => a.tags))].sort((a, b) => a.localeCompare(b, 'es'));

// Fila de filtros: tus listas (#) primero y luego los géneros más comunes.
function renderChips() {
  const counts = genreCounts();
  const tags = allTags();
  if (ui.genre && !counts.some(([g]) => g === ui.genre)) ui.genre = null;
  if (ui.tag && !tags.includes(ui.tag)) ui.tag = null;
  const top = counts.slice(0, 12).map(([g]) => g);
  if (ui.genre && !top.includes(ui.genre)) top.push(ui.genre);
  if (top.length + tags.length < 2) { chipsEl.innerHTML = ''; return; }
  chipsEl.innerHTML = [
    `<button class="chip${!ui.genre && !ui.tag ? ' is-active' : ''}" type="button" data-genre="">Todo</button>`,
    ...tags.map(t => `<button class="chip chip--tag${ui.tag === t ? ' is-active' : ''}" type="button" data-tag="${esc(t)}">#${esc(t)}</button>`),
    ...top.map(g => `<button class="chip${ui.genre === g ? ' is-active' : ''}" type="button" data-genre="${esc(g)}">${esc(g)}</button>`),
  ].join('');
}

// Historial: suma (o resta, si fue un error) lo marcado hoy.
function logProgress(a, delta) {
  if (!delta) return;
  const k = dayKey();
  const n = (a.log[k] || 0) + delta;
  if (n > 0) a.log[k] = n;
  else delete a.log[k];
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
  badge.textContent = statusLabel(a);
  $$('.star', card).forEach((s, i) => s.classList.toggle('is-on', i < a.rating));
}

function refresh(animate = 'none') {
  renderList(animate);
  renderStats();
  syncDiscover();
  checkBadges();
}
function commit(animate = 'none') {
  const saved = save();
  refresh(animate);
  loadLive();
  return saved;
}

// Cambios rápidos desde la tarjeta: se parchea en sitio para no re-animar toda la cuadrícula.
function quickSaved(a, card) {
  a.updatedAt = Date.now();
  save();
  patchCard(card, a);
  updateCounts();
  renderStats();
  checkBadges();
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

// Clic en un póster: abre su ficha (con sesión se puede añadir desde ahí).
document.addEventListener('click', e => {
  const p = e.target.closest('[data-wall]');
  const a = p && wallList.find(x => x.aniId === Number(p.dataset.wall));
  if (a) openDetail(a);
});

/* ---------- Tema claro / oscuro ---------- */
const THEME_KEY = 'animelist.theme';
const themeBtn = $('#themeToggle');
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (darkMQ.matches ? 'dark' : 'light')) === 'dark';
const syncThemeLabel = () => themeBtn.setAttribute('aria-label', isDark() ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');

let themeWanted = null; // lo último que se pidió: así clics rápidos alternan bien aunque la animación vaya atrasada
themeBtn.addEventListener('click', () => {
  const next = (themeWanted || (isDark() ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark';
  themeWanted = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  const apply = () => { document.documentElement.dataset.theme = next; syncThemeLabel(); };
  if (!document.startViewTransition || reduceMotion) return apply();
  const r = themeBtn.getBoundingClientRect();
  document.documentElement.style.setProperty('--vt-x', `${r.left + r.width / 2}px`);
  document.documentElement.style.setProperty('--vt-y', `${r.top + r.height / 2}px`);
  document.startViewTransition(() => { if (themeWanted === next) apply(); });
  setTimeout(() => { if (themeWanted === next) apply(); }, 400); // si el navegador tarda en animar, el cambio no espera
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
  const s = badgeStats();
  renderBadges(s);
  if (!statsSeen) return;
  const by = st => items.filter(a => a.status === st).length;
  const rated = items.filter(a => a.rating);
  const active = items.length - by('dropped');
  const values = {
    total: items.length, plan: by('plan'), watching: by('watching'), done: by('done'),
    eps: s.eps, hours: s.eps * 24 / 60, caps: s.chapters,
    rate: active ? by('done') / active * 100 : 0,
    avg: rated.length ? rated.reduce((n, a) => n + a.rating, 0) / rated.length : 0,
  };
  $$('[data-stat]').forEach(el => countTo(el, values[el.dataset.stat]));
  Object.keys(STATUS).forEach(st => {
    $(`.dist .d-${st}`).style.flexGrow = by(st);
    $(`[data-legend="${st}"]`).textContent = by(st);
  });
  const top = genreCounts().slice(0, 5);
  genreBars.innerHTML = top.length
    ? top.map(([g, n]) => `<li><span class="bars__name">${esc(g)}</span><span class="bars__track"><i style="width:${n / top[0][1] * 100}%"></i></span><b>${n}</b></li>`).join('')
    : '<li class="bars__empty">Añade animes con géneros para ver tus favoritos.</li>';
}

/* ---------- Logros ---------- */
const BADGES = [
  { id: 'first', icon: '🌱', name: 'Primer paso', desc: 'Guarda tu primer título', goal: 1, val: s => s.total },
  { id: 'collector', icon: '📚', name: 'Coleccionista', desc: 'Guarda 25 títulos', goal: 25, val: s => s.total },
  { id: 'eps100', icon: '📺', name: '100 episodios', desc: 'Mira 100 episodios', goal: 100, val: s => s.eps },
  { id: 'eps500', icon: '🔥', name: '500 episodios', desc: 'Mira 500 episodios', goal: 500, val: s => s.eps },
  { id: 'eps1000', icon: '👑', name: 'Mil episodios', desc: 'Mira 1000 episodios', goal: 1000, val: s => s.eps },
  { id: 'done10', icon: '🏁', name: 'Completista', desc: 'Termina 10 títulos', goal: 10, val: s => s.done },
  { id: 'marathon', icon: '⚡', name: 'Maratonero', desc: '10 episodios en un día', goal: 10, val: s => s.bestDay },
  { id: 'streak', icon: '📅', name: 'Constante', desc: '7 días seguidos viendo o leyendo', goal: 7, val: s => s.bestStreak },
  { id: 'explorer', icon: '🧭', name: 'Explorador', desc: 'Prueba 5 géneros distintos', goal: 5, val: s => s.genres },
  { id: 'reader', icon: '📖', name: 'Lector', desc: 'Lee 100 capítulos de manga', goal: 100, val: s => s.chapters },
  { id: 'critic', icon: '⭐', name: 'Crítico', desc: 'Califica 10 títulos', goal: 10, val: s => s.rated },
  { id: 'reviewer', icon: '✍️', name: 'Reseñista', desc: 'Escribe 3 reseñas', goal: 3, val: s => s.reviews },
  { id: 'classic', icon: '🎞️', name: 'Clásico', desc: 'Termina uno anterior al 2000', goal: 1, val: s => s.classics },
];

// Racha más larga de días consecutivos con actividad (días "AAAA-MM-DD").
function longestStreak(days) {
  const t = [...new Set(days)].map(d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).sort((x, y) => x - y);
  let best = 0;
  let run = 0;
  t.forEach((v, i) => { run = i && v - t[i - 1] === 86400000 ? run + 1 : 1; best = Math.max(best, run); });
  return best;
}

function badgeStats() {
  const animeDays = new Map();
  const allDays = new Set();
  items.forEach(a => Object.entries(a.log).forEach(([d, n]) => {
    allDays.add(d);
    if (!isManga(a)) animeDays.set(d, (animeDays.get(d) || 0) + n);
  }));
  return {
    total: items.length,
    eps: items.filter(a => !isManga(a)).reduce((n, a) => n + a.watched, 0),
    chapters: items.filter(isManga).reduce((n, a) => n + a.watched, 0),
    done: items.filter(a => a.status === 'done').length,
    bestDay: Math.max(0, ...animeDays.values()),
    bestStreak: longestStreak([...allDays]),
    genres: new Set(items.filter(a => a.status !== 'plan').flatMap(a => a.genres)).size,
    rated: items.filter(a => a.rating).length,
    reviews: items.filter(a => a.review).length,
    classics: items.filter(a => a.status === 'done' && a.year && a.year < 2000).length,
  };
}

function renderBadges(s = badgeStats()) {
  const got = BADGES.filter(b => b.val(s) >= b.goal).length;
  $('#badgeCount').textContent = `${got} / ${BADGES.length}`;
  $('#badges').innerHTML = BADGES.map(b => {
    const v = Math.min(b.val(s), b.goal);
    const on = v >= b.goal;
    return `<li class="badge-card${on ? ' is-on' : ''}" title="${esc(b.desc)}">
      <span class="badge-card__icon" aria-hidden="true">${b.icon}</span>
      <span class="badge-card__name">${esc(b.name)}</span>
      <span class="badge-card__desc">${esc(b.desc)}</span>
      ${on ? '<span class="badge-card__done">¡Logrado!</span>' : `<span class="badge-card__bar" role="img" aria-label="${v} de ${b.goal}"><i style="width:${v / b.goal * 100}%"></i></span><span class="badge-card__num">${v} / ${b.goal}</span>`}
    </li>`;
  }).join('');
}

// Avisa los logros nuevos. Los ya vistos se recuerdan por usuario en este navegador.
function checkBadges() {
  if (!user) return;
  const key = `animelist.badges.${user.id}`;
  const s = badgeStats();
  const now = BADGES.filter(b => b.val(s) >= b.goal).map(b => b.id);
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(key)); } catch {}
  try { localStorage.setItem(key, JSON.stringify(now)); } catch {}
  if (!Array.isArray(seen)) return; // primera vez en este navegador: no felicitar por lo que ya tenía
  BADGES.filter(b => now.includes(b.id) && !seen.includes(b.id)).forEach(b => {
    toast(`🏆 Logro desbloqueado: ${b.icon} ${b.name}`, null, 5000);
    burst($('#nav'));
  });
}

/* ---------- Resumen anual ("Wrapped") ---------- */
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function wrappedData(year) {
  const prefix = `${year}-`;
  const byMonth = Array(12).fill(0);
  const byGenre = new Map();
  const days = new Map();
  const animeDays = new Map(); // para "tu mejor día" en episodios (sin mezclar capítulos de manga)
  const byTitle = [];
  let eps = 0;
  let caps = 0;
  items.forEach(a => {
    let n = 0;
    Object.entries(a.log).forEach(([d, c]) => {
      if (!d.startsWith(prefix)) return;
      n += c;
      byMonth[+d.slice(5, 7) - 1] += c;
      days.set(d, (days.get(d) || 0) + c);
      if (!isManga(a)) animeDays.set(d, (animeDays.get(d) || 0) + c);
    });
    if (!n) return;
    if (isManga(a)) caps += n; else eps += n;
    a.genres.forEach(g => byGenre.set(g, (byGenre.get(g) || 0) + n));
    byTitle.push([a, n]);
  });
  const finished = items.filter(a => a.doneAt && new Date(a.doneAt).getFullYear() === year);
  const most = byTitle.sort((x, y) => y[1] - x[1])[0]?.[0] || null;
  const fav = [...finished].sort((x, y) => y.rating - x.rating || (y.score ?? 0) - (x.score ?? 0))[0] || most;
  const peak = Math.max(...byMonth);
  const bestDay = [...animeDays].sort((x, y) => y[1] - x[1])[0] || null;
  return {
    year, eps, caps, hours: Math.round(eps * 24 / 60), finished: finished.length,
    genre: [...byGenre].sort((x, y) => y[1] - x[1])[0]?.[0] || null,
    fav, most,
    month: peak ? MONTHS[byMonth.indexOf(peak)] : null,
    bestDay: bestDay && { day: new Date(`${bestDay[0]}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long' }), n: bestDay[1] },
    activeDays: days.size,
    streak: longestStreak([...days.keys()]),
  };
}

function openWrapped() {
  const w = wrappedData(new Date().getFullYear());
  const empty = !w.eps && !w.caps && !w.finished;
  const tile = (num, label, cls = '') => `<div class="wrap-tile ${cls}"><b>${esc(num)}</b><span>${esc(label)}</span></div>`;
  $('#wrappedBody').innerHTML = empty
    ? `<p class="wrapped__empty">Aún no hay actividad en ${w.year}. Cada episodio o capítulo que marques con <b>+</b> desde hoy cuenta para tu resumen.</p>`
    : `
      <div class="wrapped__grid">
        ${tile(w.hours.toLocaleString('es'), 'horas de anime', 'wrap-tile--big')}
        ${tile(w.eps.toLocaleString('es'), 'episodios')}
        ${w.caps ? tile(w.caps.toLocaleString('es'), 'capítulos de manga') : ''}
        ${tile(w.finished, w.finished === 1 ? 'título terminado' : 'títulos terminados')}
        ${w.genre ? tile(w.genre, 'tu género del año', 'wrap-tile--word') : ''}
        ${w.month ? tile(w.month, 'tu mes más intenso', 'wrap-tile--word') : ''}
        ${w.bestDay ? tile(`${w.bestDay.n} eps`, `tu mejor día: ${w.bestDay.day}`) : ''}
        ${w.streak > 1 ? tile(`${w.streak} días`, 'tu racha más larga') : ''}
        ${tile(w.activeDays, 'días con anime')}
      </div>
      ${w.fav ? `<div class="wrapped__fav">${coverImg(w.fav)}<div><span>Tu favorito del año</span><b>${esc(w.fav.title)}</b>${w.fav.rating ? `<em>${'★'.repeat(w.fav.rating)}</em>` : ''}</div></div>` : ''}`;
  $('#wrappedYear').textContent = w.year;
  $('#wrappedShare').hidden = empty;
  $('#wrappedModal').showModal();
  $('#wrappedShare').onclick = () => shareWrapped(w);
}

// Imagen 1080×1350 lista para historias / WhatsApp. Solo texto (las portadas externas bloquearían el canvas).
async function shareWrapped(w) {
  const c = Object.assign(document.createElement('canvas'), { width: 1080, height: 1350 });
  const g = c.getContext('2d');
  await Promise.all(['900 120px Inter', '600 40px Inter', '900 60px "Noto Sans JP"'].map(f => document.fonts.load(f).catch(() => {})));
  g.fillStyle = '#163300';
  g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = 'rgba(159,232,112,.13)';
  for (let y = 10; y < 1350; y += 26) for (let x = 10; x < 1080; x += 26) { g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); }
  g.fillStyle = '#9fe870';
  g.font = '900 60px "Noto Sans JP", Inter';
  g.fillText('アニメ', 80, 140);
  g.font = '900 130px Inter';
  g.fillText(`MI ${w.year}`, 72, 290);
  g.fillText('EN ANIME', 72, 410);
  const rows = [
    [w.hours.toLocaleString('es'), 'horas de anime'],
    [w.eps.toLocaleString('es'), 'episodios'],
    [w.finished, w.finished === 1 ? 'título terminado' : 'títulos terminados'],
    w.genre && [w.genre, 'género del año'],
    w.fav && [w.fav.title, 'favorito del año'],
  ].filter(Boolean).slice(0, 5);
  rows.forEach(([v, label], i) => {
    const y = 560 + i * 150;
    g.fillStyle = '#ffffff';
    g.font = '900 84px Inter';
    let text = String(v);
    while (g.measureText(text).width > 920 && text.length > 4) text = `${text.slice(0, -2)}…`;
    g.fillText(text, 80, y);
    g.fillStyle = '#9fe870';
    g.font = '600 38px Inter';
    g.fillText(label, 84, y + 50);
  });
  g.fillStyle = '#e2f6d5';
  g.font = '600 32px Inter';
  g.fillText('animelist · oscardevs10.github.io/animelist', 80, 1290);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], `mi-${w.year}-en-anime.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Mi ${w.year} en anime` }); return; } catch {}
  }
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ---------- Acciones sobre tarjetas ---------- */
function step(a, d, card) {
  const w = Math.max(0, Math.min(a.episodes ?? Infinity, a.watched + d));
  if (w === a.watched) return;
  const wasDone = a.status === 'done';
  logProgress(a, w - a.watched);
  a.watched = w;
  if (a.status === 'plan' && w > 0) a.status = 'watching';
  if (a.episodes && w === a.episodes) a.status = 'done';
  else if (wasDone && a.episodes) a.status = 'watching';
  a.doneAt = a.status === 'done' ? (wasDone ? a.doneAt : Date.now()) : null;
  quickSaved(a, card);
  if (!wasDone && a.status === 'done') {
    burst(card);
    toast(`¡Terminaste “${a.title}”! 🎉`);
  }
}

async function addSequel(btn) {
  btn.disabled = true;
  const a = await addFromAniList(Number(btn.dataset.ani)).catch(() => null);
  if (a) toast(`“${a.title}” añadido a tu lista`, { label: 'Ver ficha', run: () => openDetail(a) });
  else btn.disabled = false;
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
  const src = a ?? { status: 'plan', priority: 'med', rating: 0, genres: [], tags: [], kind: ui.kind === 'manga' ? 'manga' : 'anime' };
  meta = a ? metaOf(a) : {};
  F.kind.value = src.kind;
  F.title.value = src.title ?? '';
  F.image.value = src.image ?? '';
  F.status.value = src.status;
  F.priority.value = src.priority;
  F.episodes.value = src.episodes ?? '';
  F.watched.value = src.watched || '';
  F.genres.value = src.genres.join(', ');
  F.tags.value = src.tags.join(', ');
  F.url.value = src.url ?? '';
  F.notes.value = src.notes ?? '';
  F.review.value = src.review ?? '';
  $('#tagOptions').innerHTML = allTags().map(t => `<option value="${esc(t)}">`).join('');
  setRating(src.rating);
  syncKindLabels();
  $('#editHeading').textContent = a ? `Editar ${isManga(src) ? 'manga' : 'anime'}` : 'Añadir';
  deleteBtn.hidden = !a;
  updatePreview();
  showSynopsis();
  editModal.showModal();
  F.title.focus();
}

const flash = el => el.animate?.([{ backgroundColor: '#e2f6d5' }, { backgroundColor: '#ffffff' }], { duration: 900, easing: 'ease-out' });
// Datos de AniList que el formulario no muestra pero se guardan con el título.
const metaOf = a => ({ aniId: a.aniId, synopsis: a.synopsis, year: a.year, type: a.type, score: a.score, banner: a.banner });

// "Episodios" o "Capítulos" según se esté añadiendo anime o manga.
function syncKindLabels() {
  const manga = F.kind.value === 'manga';
  $('#lblTotal').textContent = manga ? 'Capítulos totales' : 'Episodios totales';
  $('#lblWatched').textContent = manga ? 'Capítulos leídos' : 'Episodios vistos';
  F.title.placeholder = manga ? 'Escribe el nombre: One Piece, Berserk, Solo Leveling…' : 'Escribe el nombre: Frieren, Haikyuu, One Piece…';
}

// Carga la info de una coincidencia en el formulario. explicit = la eligió la persona (no la automática).
function pick(a, explicit = false) {
  picked = a;
  meta = metaOf(a);
  F.kind.value = a.kind;
  syncKindLabels();
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
  formMsg(!editingId && hasAni(a.aniId) ? 'Ya está en tu lista.' : '');
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
    lookupList = await anilist('sort: SEARCH_MATCH', { q, perPage: 6, signal: ctl.signal, kind: F.kind.value });
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
    kind: F.kind.value,
    title: !prev && picked ? picked.title : F.title.value,
    image: F.image.value,
    status: F.status.value,
    priority: F.priority.value,
    episodes: F.episodes.value,
    watched: F.watched.value,
    genres: F.genres.value,
    tags: F.tags.value,
    url: F.url.value,
    notes: F.notes.value,
    review: F.review.value,
    rating: F.rating.value,
    log: prev?.log,
    doneAt: prev?.status === 'done' ? prev.doneAt : Date.now(), // si pasó a "Completado" ahora, termina hoy
    addedAt: prev?.addedAt,
  });
  if (!a) return formMsg('Ponle un título.');
  if (!prev && a.aniId && hasAni(a.aniId)) return formMsg('Ya está en tu lista.');
  if (a.status === 'done' && a.episodes) a.watched = a.episodes;
  if (prev) logProgress(a, a.watched - prev.watched); // al añadir no se cuenta: no lo viste hoy
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
  startBtn.textContent = isManga(a) ? (a.status === 'watching' ? 'Seguir leyéndolo' : '¡Empezar a leerlo!') : (a.status === 'watching' ? 'Seguir viéndolo' : '¡Empezar a verlo!');
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
    <button class="dcard__cover" type="button" data-detail="${a.aniId}" aria-label="Ver ficha de ${esc(a.title)}">${coverImg(a)}${a.score ? `<span class="badge dcard__score">★ ${a.score.toFixed(1)}</span>` : ''}</button>
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
  const card = e.target.closest('[data-detail]');
  if (card) return openDetail(discoverList.find(a => a.aniId === Number(card.dataset.detail)));
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

/* ---------- Ficha de un título: tráiler, personajes, estudio, temporadas y relacionados ---------- */
const detailModal = $('#detailModal');
const detailBody = $('#detailBody');
const MEDIA_STATUS = { RELEASING: 'En emisión', FINISHED: 'Finalizado', NOT_YET_RELEASED: 'Próximamente', CANCELLED: 'Cancelado', HIATUS: 'En pausa' };
const SEASON_ES = { WINTER: 'Invierno', SPRING: 'Primavera', SUMMER: 'Verano', FALL: 'Otoño' };
const REL_ORDER = ['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'ADAPTATION', 'SOURCE', 'SUMMARY', 'COMPILATION', 'OTHER'];
const DETAIL_Q = `query ($id: Int) { Media(id: $id) { ${FIELDS} status duration season title { native }
  studios(isMain: true) { nodes { name } } trailer { id site }
  characters(sort: [ROLE, RELEVANCE], perPage: 8) { edges { role node { name { full } image { medium } } voiceActors(language: JAPANESE) { name { full } } } }
  relations { edges { relationType node { id type format status title { romaji english } coverImage { large } } } } } }`;

const detailOf = m => ({
  info: fromAniList(m),
  native: str(m.title?.native, 200),
  status: str(m.status, 30),
  duration: int(m.duration, 1, 1000),
  season: str(m.season, 10),
  studio: str(m.studios?.nodes?.[0]?.name, 80),
  trailer: m.trailer?.site === 'youtube' && /^[\w-]{6,20}$/.test(m.trailer.id || '') ? m.trailer.id : null,
  chars: (m.characters?.edges || []).map(e => ({
    name: str(e?.node?.name?.full, 80),
    img: safeUrl(e?.node?.image?.medium),
    role: e?.role === 'MAIN' ? 'Principal' : 'Secundario',
    va: str(e?.voiceActors?.[0]?.name?.full, 80),
  })).filter(c => c.name),
  rels: (m.relations?.edges || [])
    .filter(e => e?.node && RELATION_ES[e.relationType])
    .map(e => ({
      aniId: int(e.node.id, 1, 1e9),
      key: e.relationType,
      rel: RELATION_ES[e.relationType],
      title: str(e.node.title?.english || e.node.title?.romaji, 200),
      image: safeUrl(e.node.coverImage?.large),
      type: FORMAT_ES[e.node.format] || str(e.node.format, 20),
    }))
    .filter(r => r.aniId && r.title)
    .sort((x, y) => REL_ORDER.indexOf(x.key) - REL_ORDER.indexOf(y.key))
    .slice(0, 12),
});

let detailToken = 0;
let detailInfo = null; // datos completos del título abierto, para añadirlo sin volver a pedirlos
let detailMine = null; // mi copia del título abierto (si está en mi lista)

async function openDetail(src, from = null) {
  if (!src) return;
  const mine = (src.id && find(src.id)) || (src.aniId && items.find(x => x.aniId === src.aniId)) || null;
  const token = ++detailToken;
  detailMine = mine;
  detailInfo = src.synopsis ? src : null;
  const other = from && src.review ? { name: from, review: src.review } : null;
  renderDetail(mine || src, null, mine, other);
  if (!detailModal.open) detailModal.showModal();
  detailModal.scrollTop = 0;
  if (!src.aniId) return;
  try {
    const data = await gql(DETAIL_Q, { id: src.aniId });
    if (token !== detailToken || !data?.Media) return;
    const d = detailOf(data.Media);
    detailInfo = d.info;
    renderDetail(mine || src, d, mine, other);
  } catch (err) {
    console.error(err);
    if (token === detailToken) $('#detailExtra').innerHTML = '<p class="hint">No pude cargar más información de AniList.</p>';
  }
}

const addBtn = (aniId, cls = '') => (hasAni(aniId)
  ? '<span class="rel__in">✓ En tu lista</span>'
  : `<button class="btn btn--primary ${cls}" type="button" data-dact="add" data-ani="${aniId}">+ Añadir a mi lista</button>`);

function renderDetail(base, d, mine, other = null) {
  const info = d?.info || base;
  const lv = live.get(info.aniId);
  const facts = [
    info.type,
    d?.season && info.year ? `${SEASON_ES[d.season] || ''} ${info.year}`.trim() : info.year,
    info.episodes && `${info.episodes} ${unit(info)}`,
    d?.duration && !isManga(info) && `${d.duration} min por ep.`,
    d?.studio,
    d?.status && MEDIA_STATUS[d.status],
  ].filter(Boolean);
  const review = other?.review || mine?.review || (!mine && base.review);
  const reviewTitle = other ? `Reseña de ${other.name}` : mine ? 'Tu reseña' : 'Su reseña';
  let action = '';
  if (mine) {
    action = `<span class="badge status s-${mine.status}">${statusLabel(mine)}</span>
      <span class="detail__progress">${esc(epText(mine))}</span>
      <button class="btn btn--outline btn--sm" type="button" data-dact="edit">Editar</button>`;
  } else if (user && info.aniId) {
    action = addBtn(info.aniId);
  } else if (!user) {
    action = `<a class="btn btn--primary" href="${esc(appUrl)}">Crea tu cuenta para guardarlo</a>`;
  }
  detailBody.innerHTML = `
    <header class="detail__hero">
      ${info.banner ? `<img class="detail__banner" src="${esc(info.banner)}" alt="" referrerpolicy="no-referrer">` : ''}
      <button class="icon-btn icon-btn--dark modal__x" type="button" data-close aria-label="Cerrar">${svg('<path d="M6 6l12 12M18 6 6 18"/>')}</button>
      <div class="detail__head">
        <div class="detail__cover">${coverImg(info)}</div>
        <div class="detail__titles">
          <p class="eyebrow eyebrow--dark">${isManga(info) ? '漫画 · Manga' : 'アニメ · Anime'}</p>
          <h2 class="detail__title" id="detailTitle">${esc(info.title)}</h2>
          ${d?.native ? `<p class="detail__native" lang="ja">${esc(d.native)}</p>` : ''}
          <p class="detail__facts">${facts.map(esc).join(' · ')}</p>
        </div>
      </div>
    </header>
    <div class="detail__content">
      <div class="detail__actions">
        ${info.score ? `<span class="badge detail__score">★ ${info.score.toFixed(1)}</span>` : ''}
        ${action}
        ${info.url ? `<a class="btn-link" href="${esc(info.url)}" target="_blank" rel="noopener noreferrer">Ver en AniList</a>` : ''}
      </div>
      ${lv ? `<div class="detail__live">${liveHTML({ ...info, status: 'plan' })}</div>` : ''}
      ${d?.trailer ? `<button class="trailer" type="button" data-trailer="${d.trailer}" aria-label="Reproducir tráiler">
        <img src="https://i.ytimg.com/vi/${d.trailer}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span class="trailer__play">${ICON.play}</span><span class="trailer__label">Ver tráiler</span></button>` : ''}
      ${info.synopsis ? `<section class="detail__sec"><h3>Sinopsis</h3><p class="detail__syn">${esc(info.synopsis)}</p></section>` : ''}
      ${review ? `<section class="detail__sec"><h3>${esc(reviewTitle)}</h3><blockquote class="review">${esc(review)}</blockquote></section>` : ''}
      ${mine?.tags.length ? `<div class="tags">${mine.tags.map(t => `<span class="tag tag--mine">#${esc(t)}</span>`).join('')}</div>` : ''}
      <div id="detailExtra">${d ? detailExtraHTML(d) : info.aniId ? '<p class="hint">Cargando personajes y temporadas…</p>' : ''}</div>
    </div>`;
}

function detailExtraHTML(d) {
  const chars = d.chars.length ? `
    <section class="detail__sec"><h3>Personajes</h3>
      <ul class="chars">${d.chars.map(c => `
        <li class="char">
          ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="char__ph" aria-hidden="true"></span>'}
          <b>${esc(c.name)}</b><small>${esc(c.role)}${c.va ? ` · 🎙 ${esc(c.va)}` : ''}</small>
        </li>`).join('')}</ul>
    </section>` : '';
  const rels = d.rels.length ? `
    <section class="detail__sec"><h3>Temporadas y relacionados</h3>
      <div class="rels">${d.rels.map(r => `
        <article class="rel${r.key === 'SEQUEL' ? ' rel--sequel' : ''}">
          <button class="rel__cover" type="button" data-dact="open" data-ani="${r.aniId}" aria-label="Ver ficha de ${esc(r.title)}">${coverImg(r)}</button>
          <span class="rel__kind">${esc(r.rel)}</span>
          <b class="rel__title">${esc(r.title)}</b>
          <small>${esc(r.type)}</small>
          ${user ? addBtn(r.aniId, 'btn--xs') : ''}
        </article>`).join('')}</div>
    </section>` : '';
  return chars + rels || '<p class="hint">AniList no tiene más información de este título.</p>';
}

detailBody.addEventListener('click', async e => {
  const trailer = e.target.closest('[data-trailer]');
  if (trailer) {
    trailer.outerHTML = `<div class="trailer trailer--on"><iframe src="https://www.youtube-nocookie.com/embed/${trailer.dataset.trailer}?autoplay=1" title="Tráiler" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    return;
  }
  const b = e.target.closest('[data-dact]');
  if (!b) return;
  const id = Number(b.dataset.ani);
  if (b.dataset.dact === 'edit') {
    const mine = detailMine && find(detailMine.id);
    detailModal.close();
    if (mine) openEditor(mine);
  } else if (b.dataset.dact === 'open') {
    openDetail({ aniId: id });
  } else if (b.dataset.dact === 'add') {
    b.disabled = true;
    b.textContent = 'Añadiendo…';
    const a = await addFromAniList(id, detailInfo).catch(() => null);
    b.outerHTML = a || hasAni(id) ? '<span class="rel__in">✓ En tu lista</span>' : '<span class="hint">No se pudo añadir</span>';
  }
});

detailModal.addEventListener('close', () => {
  detailToken++;
  detailBody.innerHTML = ''; // detiene el tráiler si estaba sonando
});
detailModal.addEventListener('click', e => { if (e.target === detailModal) detailModal.close(); });

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
  setView(friendHandle ? 'friend' : 'app');
  try {
    await loadItems();
  } catch (err) {
    console.error(err);
    items = [];
    synced = new Map();
    toast('No pude cargar tu lista. Revisa tu conexión y recarga la página.', null, 8000);
  }
  if (user !== u) return; // cerró sesión mientras cargaba
  if (friendHandle) {
    renderFriend(); // estaba viendo la lista de un amigo: solo se actualiza "en común"
    return;
  }
  refresh('all');
  loadLive();
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
  if (friendHandle) {
    setView('friend');
    renderFriend();
  } else {
    setView('auth');
  }
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
      // Solo pasa si la base aún exige el código de invitación viejo (falta supabase/003)
      if (res.error && /invite_code_invalid|database error/i.test(res.error.message)) return authNote('El registro está cerrado por ahora. Avísale a quien te pasó el enlace.');
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

/* ---------- Compartir mi lista y ver la de un amigo (?lista=handle) ---------- */
const params = new URLSearchParams(location.search);
const friendHandle = str(params.get('lista'), 40);
const shareModal = $('#shareModal');
const shareForm = $('#shareForm');
const S = shareForm.elements;
const friendGrid = $('#friendGrid');
const friendChips = $('#friendChips');
let friend = null; // { name, items, missing }
let friendFilter = 'all';
const shareUrl = handle => `${appUrl}?lista=${encodeURIComponent(handle)}`;
const sameAnime = (a, b) => (a.aniId && a.aniId === b.aniId) || norm(a.title) === norm(b.title);
const inMyList = a => items.some(x => sameAnime(x, a));
const shareMsg = (text, bad = false) => {
  const el = $('#shareMsg');
  el.textContent = text;
  el.classList.toggle('is-bad', bad);
};

async function openShare() {
  shareForm.reset();
  shareMsg('');
  $('#shareLinkRow').hidden = true;
  shareModal.showModal();
  const { data, error } = await db.from('profiles').select('handle, name, share').eq('id', user.id).maybeSingle();
  if (error || !data) return shareMsg('Esta función aún no está activada en la base de datos (README → supabase/002).', true);
  S.name.value = data.name || '';
  S.share.checked = data.share;
  S.link.value = shareUrl(data.handle);
  $('#shareLinkRow').hidden = !data.share;
}

async function saveShare() {
  const { error } = await db.from('profiles').update({ name: str(S.name.value, 40) || null, share: S.share.checked }).eq('id', user.id);
  if (error) return shareMsg('No se pudo guardar. Intenta de nuevo.', true);
  $('#shareLinkRow').hidden = !S.share.checked;
  shareMsg(S.share.checked ? 'Listo: cualquiera con el enlace puede ver tu lista (sin tus notas).' : 'Tu lista ya no se puede ver con el enlace.');
}

shareForm.addEventListener('submit', e => { e.preventDefault(); saveShare(); });
S.share.addEventListener('change', saveShare);
$('#copyLink').addEventListener('click', async () => {
  if (navigator.share && touchOnly.matches) {
    try { await navigator.share({ title: 'Mi lista de anime', url: S.link.value }); return; } catch {}
  }
  try {
    await navigator.clipboard.writeText(S.link.value);
    shareMsg('Enlace copiado. Pégalo en WhatsApp o donde quieras.');
  } catch {
    S.link.select();
  }
});

async function showFriend() {
  setView('friend');
  $('#friendName').textContent = 'Cargando…';
  try {
    const { data, error } = await db.rpc('shared_list', { p_handle: friendHandle });
    if (error) throw error;
    friend = data ? { name: str(data.name, 40), items: sanitizeList(data.items) } : { missing: true, items: [] };
  } catch (err) {
    console.error(err);
    friend = { missing: true, items: [] };
  }
  renderFriend();
}

function friendCardHTML(a, i) {
  const mine = user && inMyList(a);
  const meta = metaLine(a);
  return `
  <article class="card card--ro card--enter" data-fid="${esc(a.id)}" style="--i:${Math.min(i, 12)}">
    <div class="card__cover">
      ${coverImg(a)}
      ${a.synopsis ? `<div class="card__hover"><p>${esc(a.synopsis)}</p></div>` : ''}
      <div class="card__badges">
        <span class="badge status s-${a.status}">${statusLabel(a)}</span>
        ${mine ? '<span class="badge badge--common">✓ En común</span>' : ''}
      </div>
      ${a.score ? `<span class="badge card__score">★ ${a.score.toFixed(1)}</span>` : ''}
    </div>
    <div class="card__body">
      <div>
        <h3 class="card__title">${esc(a.title)}</h3>
        ${meta ? `<p class="card__meta">${esc(meta)}</p>` : ''}
      </div>
      ${a.genres.length ? `<div class="tags">${a.genres.slice(0, 2).map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>` : ''}
      <div class="progress">
        <div class="progress__track"><span class="progress__fill" style="width:${pct(a) * 100}%"></span></div>
        <p class="progress__text">${epText(a)}</p>
      </div>
      <div class="card__foot">
        <div class="stars" role="img" aria-label="Calificación ${a.rating} de 5">${[1, 2, 3, 4, 5].map(n => `<span class="star${n <= a.rating ? ' is-on' : ''}">${ICON.star}</span>`).join('')}</div>
        ${user && !mine ? `<button class="btn btn--primary btn--xs" type="button" data-fadd="${esc(a.id)}">+ Añadir</button>` : ''}
      </div>
    </div>
  </article>`;
}

function renderFriend() {
  if (!friend) return;
  $('#friendCta').textContent = user ? 'Ir a mi lista' : 'Crear mi cuenta gratis';
  if (friend.missing) {
    $('#friendName').textContent = 'Lista no disponible';
    $('#friendSummary').textContent = 'Este enlace no existe o su dueño dejó de compartir la lista.';
    friendChips.innerHTML = '';
    friendGrid.innerHTML = '';
    $('#friendEmpty').hidden = true;
    return;
  }
  const order = { watching: 0, plan: 1, done: 2, dropped: 3 };
  const all = [...friend.items].sort((a, b) => order[a.status] - order[b.status] || b.addedAt - a.addedAt);
  const common = all.filter(inMyList).length;
  $('#friendName').textContent = friend.name ? `La lista de ${friend.name}` : 'Lista compartida';
  $('#friendSummary').textContent = `${all.length} ${all.length === 1 ? 'anime' : 'animes'}${user ? ` · ${common} en común contigo` : ''}`;
  friendChips.innerHTML = user
    ? [['all', `Todos (${all.length})`], ['common', `En común (${common})`], ['new', `No los tienes (${all.length - common})`]]
      .map(([k, label]) => `<button class="chip${friendFilter === k ? ' is-active' : ''}" type="button" data-ffilter="${k}">${label}</button>`).join('')
    : '';
  const list = all.filter(a => friendFilter === 'all' || (friendFilter === 'common') === inMyList(a));
  friendGrid.innerHTML = list.map(friendCardHTML).join('');
  $('#friendEmpty').hidden = list.length > 0;
}

friendChips.addEventListener('click', e => {
  const b = e.target.closest('[data-ffilter]');
  if (!b) return;
  friendFilter = b.dataset.ffilter;
  renderFriend();
});

friendGrid.addEventListener('click', e => {
  const cover = e.target.closest('.card__cover');
  if (cover) return openDetail(friend?.items.find(a => a.id === cover.closest('.card').dataset.fid), friend?.name || 'tu amigo');
  const b = e.target.closest('[data-fadd]');
  const src = b && user && friend?.items.find(a => a.id === b.dataset.fadd);
  if (!src || inMyList(src)) return;
  const a = sanitize({ ...src, id: uid(), status: 'plan', priority: 'med', watched: 0, rating: 0, notes: '', review: '', tags: [], log: {}, addedAt: Date.now(), updatedAt: Date.now() });
  items.unshift(a);
  commit(a.id);
  renderFriend();
  toast(`“${a.title}” añadido a tu lista`);
});

/* ---------- App instalable (PWA) ---------- */
let installPrompt = null;
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.error(err));
}
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); // se muestra nuestro botón en lugar del aviso del navegador
  installPrompt = e;
  $$('[data-action="install"]').forEach(b => { b.hidden = false; });
});
async function install() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $$('[data-action="install"]').forEach(b => { b.hidden = true; });
}

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
  share: () => openShare(),
  wrapped: openWrapped,
  install,
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
  else if (act === 'edit') openEditor(a);
  else if (act === 'sequel') addSequel(btn);
  else if (e.target.closest('a, button')) return;
  else if (e.target.closest('.card__cover, .card__title')) openDetail(a);
});

statusTabs.addEventListener('click', e => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  ui.status = b.dataset.status;
  press(statusTabs, b);
  renderList();
});

chipsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-genre], [data-tag]');
  if (!b) return;
  ui.tag = b.dataset.tag ?? null;
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
// Cambiar entre anime y manga: otras etiquetas y se vuelve a buscar en el tipo correcto
form.addEventListener('change', e => {
  if (e.target.name !== 'kind') return;
  syncKindLabels();
  unpick();
  lookupFor = null;
  if (F.title.value.trim().length >= 2) runLookup();
});
$('#kindFilter').addEventListener('change', e => {
  ui.kind = e.target.value;
  renderList();
});
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
}, { rootMargin: '0px 0px -25% 0px' }).observe($('#stats'));

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
if (params.has('invitacion') || params.has('registro')) setAuthMode('signup'); // enlaces para invitar abren "Crear cuenta"
loadWalls();
if (friendHandle && db) showFriend();

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
        if (!u && !recovering) setView(friendHandle ? 'friend' : 'auth');
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
