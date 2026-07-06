const pageCache = new Map();
let currentPath = location.pathname + location.search;
let currentTitle = document.title;

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-spa-link]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto')) return;
  e.preventDefault();
  if (href === '/') {
    window.location.href = href;
    return;
  }
  spaNavigate(href);
});

window.addEventListener('popstate', async (e) => {
  const path = e.state?.path || '/';
  if (path !== currentPath) {
    if (path === '/') {
      window.location.href = path;
      return;
    }
    await loadContent(path, true);
  }
});

window.spaNavigate = async function spaNavigate(path) {
  if (path === currentPath) return;
  await loadContent(path);
  history.pushState({ path }, '', path);
};

async function loadContent(path, isPop) {
  const container = document.getElementById('app-content');
  if (!container) { window.location.href = path; return; }
  const html = await fetchCached(path);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const newContent = doc.getElementById('app-content');
  if (!newContent) { window.location.href = path; return; }
  container.innerHTML = newContent.innerHTML;
  currentPath = path;
  const title = doc.querySelector('title')?.textContent || 'Synthrun Mail';
  if (!isPop) document.title = title;
  doc.querySelectorAll('script').forEach(s => {
    const src = s.getAttribute('src');
    if (src) {
      if (s.type === 'module' && !document.querySelector(`script[src="${src}"]`)) {
        const ns = document.createElement('script');
        ns.type = 'module'; ns.src = src;
        document.head.appendChild(ns);
      }
    } else if (s.type === 'module') {
      const existing = document.querySelector('script[data-spa-inline]');
      if (existing) existing.remove();
      const ns = document.createElement('script');
      ns.type = 'module';
      ns.setAttribute('data-spa-inline', '');
      ns.textContent = s.textContent;
      document.head.appendChild(ns);
    }
  });
  updateNavActive(path);
  window.dispatchEvent(new CustomEvent('spa-loaded', { detail: { path } }));
}

async function fetchCached(path) {
  if (pageCache.has(path)) return pageCache.get(path);
  const resp = await fetch(path);
  if (!resp.ok) throw new Error('Fetch failed');
  const html = await resp.text();
  pageCache.set(path, html);
  return html;
}

function updateNavActive(path) {
  document.querySelectorAll('[data-spa-link]').forEach(l => {
    const h = l.getAttribute('href');
    const isMail = !h || h === '/';
    const isSettings = h === '/profile.html';
    const isCustomize = h === '/wvf052wc/';
    const curIsMail = !path || path === '/' || path.startsWith('/?');
    const curIsSettings = path.startsWith('/profile');
    const curIsCustomize = path.startsWith('/wvf052wc');
    l.classList.toggle('active',
      (isMail && curIsMail) || (isSettings && curIsSettings) || (isCustomize && curIsCustomize)
    );
  });
}

function initUserChip() {
  const chip = document.getElementById('userChip');
  if (!chip || chip.dataset.spaInit) return;
  chip.dataset.spaInit = '1';
  chip.addEventListener('click', (e) => {
    if (e.target.closest('[data-spa-link]')) return;
    const menu = document.getElementById('userMenu');
    if (!menu) return;
    const open = !menu.classList.contains('show');
    menu.classList.toggle('show', open);
    chip.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('userMenu');
    if (menu && !chip.contains(e.target)) {
      menu.classList.remove('show');
      chip.setAttribute('aria-expanded', 'false');
    }
  });
  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    if (window.__signOut) window.__signOut();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateNavActive(currentPath);
  initUserChip();
});
