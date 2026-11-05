'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const appShell = document.getElementById('appShell');
  const toggleEnabled = document.getElementById('toggleEnabled');
  const statusTitle = document.getElementById('statusTitle');
  const statusText = document.getElementById('statusText');

  const protectedSinceText = document.getElementById('protectedSinceText');
  const todayBlockedEl = document.getElementById('todayBlocked');
  const weekBlockedEl = document.getElementById('weekBlocked');
  const monthBlockedEl = document.getElementById('monthBlocked');
  const totalBlockedEl = document.getElementById('totalBlocked');
  const searchesProtectedEl = document.getElementById('searchesProtected');

  const barsRow = document.getElementById('barsRow');
  const domainsList = document.getElementById('domainsList');

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function getLocalDateKey(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatPrestigeDate(dateKeyStr) {
    if (!dateKeyStr) return 'Since Today';
    const parts = dateKeyStr.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return `Since ${dateKeyStr}`;
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    const formatted = dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    return `Since ${formatted}`;
  }

  function getLastNDaysKeys(n) {
    const result = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      result.push({
        key: getLocalDateKey(d),
        dayName: i === 0 ? 'Now' : DAY_NAMES[d.getDay()],
        shortLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      });
    }
    return result;
  }

  function renderBars(dailyCounts) {
    const last7Days = getLastNDaysKeys(7);
    const values = last7Days.map((item) => dailyCounts[item.key] || 0);
    const maxVal = Math.max(...values, 0);

    barsRow.textContent = '';

    last7Days.forEach((item, idx) => {
      const val = values[idx];
      const heightPct = maxVal > 0 && val > 0 ? Math.max(14, Math.round((val / maxVal) * 100)) : 10;

      const col = document.createElement('div');
      const classes = ['bar-item'];
      if (idx === 6) classes.push('is-today');
      if (val > 0) classes.push('has-activity');
      col.className = classes.join(' ');
      col.title = `${item.shortLabel}: ${val.toLocaleString()} blocked`;

      const countEl = document.createElement('span');
      countEl.className = 'bar-count';
      countEl.textContent = val > 0 ? val.toLocaleString() : '';

      const track = document.createElement('div');
      track.className = 'bar-pill-track';

      const fill = document.createElement('div');
      fill.className = 'bar-pill-fill';
      fill.style.height = `${heightPct}%`;

      const dayLabel = document.createElement('span');
      dayLabel.className = 'bar-day-label';
      dayLabel.textContent = item.dayName;

      track.appendChild(fill);
      col.appendChild(countEl);
      col.appendChild(track);
      col.appendChild(dayLabel);
      barsRow.appendChild(col);
    });
  }

  function renderTopDomains(domainHistory) {
    const last30Keys = new Set(getLastNDaysKeys(30).map((d) => d.key));
    const aggregated = {};

    for (const [dateKey, domainsMap] of Object.entries(domainHistory || {})) {
      if (!last30Keys.has(dateKey) || !domainsMap) continue;
      for (const [host, count] of Object.entries(domainsMap)) {
        aggregated[host] = (aggregated[host] || 0) + (Number(count) || 0);
      }
    }

    const sorted = Object.entries(aggregated)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    domainsList.textContent = '';

    if (sorted.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'domains-empty';
      empty.textContent = 'No sponsored domains blocked yet';
      domainsList.appendChild(empty);
      return;
    }

    const topMax = sorted[0][1];

    sorted.forEach(([host, count], idx) => {
      const item = document.createElement('div');
      item.className = 'domain-item';

      const left = document.createElement('div');
      left.className = 'domain-left';

      const rank = document.createElement('span');
      rank.className = 'domain-rank';
      rank.textContent = String(idx + 1).padStart(2, '0');

      const name = document.createElement('span');
      name.className = 'domain-name';
      name.textContent = host;

      left.appendChild(rank);
      left.appendChild(name);

      const right = document.createElement('div');
      right.className = 'domain-right';

      const miniBar = document.createElement('div');
      miniBar.className = 'domain-mini-bar';

      const miniFill = document.createElement('div');
      miniFill.className = 'domain-mini-fill';
      miniFill.style.width = `${Math.max(12, Math.round((count / topMax) * 100))}%`;

      const hits = document.createElement('span');
      hits.className = 'domain-hits';
      hits.textContent = count.toLocaleString();

      miniBar.appendChild(miniFill);
      right.appendChild(miniBar);
      right.appendChild(hits);

      item.appendChild(left);
      item.appendChild(right);
      domainsList.appendChild(item);
    });
  }

  function renderState(data) {
    const enabled = Boolean(data.enabled);
    const todayKey = getLocalDateKey();

    const dailyCounts = { ...(data.dailyCounts || {}) };
    if (data.lastResetDate === todayKey && (data.todayBlocked || 0) > (dailyCounts[todayKey] || 0)) {
      dailyCounts[todayKey] = data.todayBlocked;
    }

    const todayCount = dailyCounts[todayKey] || 0;
    const weekCount = getLastNDaysKeys(7).reduce((sum, d) => sum + (dailyCounts[d.key] || 0), 0);
    const monthCount = getLastNDaysKeys(30).reduce((sum, d) => sum + (dailyCounts[d.key] || 0), 0);
    const totalCount = Math.max(data.totalBlocked || 0, monthCount);
    const searchesCount = data.totalSearchesProtected || 0;

    toggleEnabled.checked = enabled;
    protectedSinceText.textContent = formatPrestigeDate(data.protectedSince || todayKey);

    todayBlockedEl.textContent = todayCount.toLocaleString();
    weekBlockedEl.textContent = weekCount.toLocaleString();
    monthBlockedEl.textContent = monthCount.toLocaleString();
    totalBlockedEl.textContent = totalCount.toLocaleString();
    searchesProtectedEl.textContent = searchesCount.toLocaleString();

    if (enabled) {
      appShell.classList.remove('is-paused');
      statusTitle.textContent = 'Protection Active';
      statusText.textContent = 'Sponsored search results are hidden';
    } else {
      appShell.classList.add('is-paused');
      statusTitle.textContent = 'Protection Paused';
      statusText.textContent = 'Sponsored search results are visible';
    }

    renderBars(dailyCounts);
    renderTopDomains(data.domainHistory || {});
  }

  function loadStorage() {
    const todayKey = getLocalDateKey();
    chrome.storage.local.get(
      {
        enabled: true,
        protectedSince: todayKey,
        todayBlocked: 0,
        totalBlocked: 0,
        totalSearchesProtected: 0,
        lastResetDate: todayKey,
        dailyCounts: {},
        domainHistory: {}
      },
      (data) => {
        if (!data.protectedSince) {
          chrome.storage.local.set({ protectedSince: todayKey });
        }
        renderState(data);
      }
    );
  }

  toggleEnabled.addEventListener('change', () => {
    const enabled = toggleEnabled.checked;
    chrome.storage.local.set({ enabled });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      loadStorage();
    }
  });

  loadStorage();
});
