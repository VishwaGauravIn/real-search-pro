(() => {
  'use strict';

  // Inner/specific containers (#tads, #tadsb) listed before outer wrapper (#tvcap)
  const SPONSORED_SELECTORS = [
    '#tads',
    '#tadsb',
    '[data-text-ad]',
    '.uEierd',
    '.commercial-unit-desktop-top',
    '.commercial-unit-desktop-rhs',
    '.ads-ad',
    '#tvcap'
  ];

  // Selectors representing individual sponsored ad items inside a container like #tads
  const AD_UNIT_SELECTOR = '[data-text-ad], .uEierd, .ads-ad, .pla-unit-container';

  const COMBINED_SELECTOR = SPONSORED_SELECTORS.join(', ');
  const STYLE_ID = 'bsr-shield-style';
  const INTERNAL_HOST_PATTERNS = [
    /(^|\.)google\.[a-z.]+$/i,
    /(^|\.)googleadservices\.com$/i,
    /(^|\.)googlesyndication\.com$/i,
    /(^|\.)gstatic\.com$/i,
    /(^|\.)googleusercontent\.com$/i,
    /(^|\.)doubleclick\.net$/i
  ];

  let isEnabled = true;
  let observer = null;
  let settleTimer = null;
  let pageBlockedCount = 0;
  let lastRecordedSearchUrl = '';
  let storageQueue = Promise.resolve();

  /**
   * Serializes chrome.storage.local read-modify-write operations so concurrent
   * events never overwrite each other's increments.
   */
  function enqueueStorageUpdate(defaults, mutatorFn) {
    storageQueue = storageQueue
      .then(
        () =>
          new Promise((resolve) => {
            chrome.storage.local.get(defaults, (data) => {
              if (chrome.runtime.lastError) {
                resolve();
                return;
              }
              const updates = mutatorFn(data);
              if (!updates) {
                resolve();
                return;
              }
              chrome.storage.local.set(updates, () => {
                resolve();
              });
            });
          })
      )
      .catch(() => {});
  }

  function getLocalDateKey(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getCutoffDateKey(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return getLocalDateKey(d);
  }

  function injectShieldStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `${COMBINED_SELECTOR} { display: none !important; visibility: hidden !important; pointer-events: none !important; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeShieldStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) {
      existing.remove();
    }
  }

  function normalizeHostname(rawHost) {
    if (!rawHost) return null;
    const cleaned = rawHost.trim().toLowerCase().replace(/^www\./, '');
    if (!cleaned || !cleaned.includes('.')) return null;
    for (const pattern of INTERNAL_HOST_PATTERNS) {
      if (pattern.test(cleaned)) return null;
    }
    return cleaned;
  }

  function extractHostFromUrlString(urlStr) {
    if (!urlStr) return null;
    try {
      const parsed = new URL(urlStr, window.location.origin);
      const redirectParams = ['adurl', 'url', 'q', 'dest', 'ds_dest_url'];
      for (const param of redirectParams) {
        const nested = parsed.searchParams.get(param);
        if (nested && /^https?:\/\//i.test(nested)) {
          const nestedHost = extractHostFromUrlString(nested);
          if (nestedHost) return nestedHost;
        }
      }
      return normalizeHostname(parsed.hostname);
    } catch {
      return null;
    }
  }

  function extractDomainFromAdUnit(unitEl) {
    const dtldNode = unitEl.hasAttribute('data-dtld')
      ? unitEl
      : unitEl.querySelector('[data-dtld]');
    if (dtldNode) {
      const host = normalizeHostname(dtldNode.getAttribute('data-dtld'));
      if (host) return host;
    }

    const pcuNode = unitEl.hasAttribute('data-pcu')
      ? unitEl
      : unitEl.querySelector('[data-pcu]');
    if (pcuNode) {
      const pcuAttr = (pcuNode.getAttribute('data-pcu') || '').split(',')[0];
      const host = extractHostFromUrlString(pcuAttr);
      if (host) return host;
    }

    const links = unitEl.querySelectorAll('a[href]');
    for (const link of links) {
      const rwUrl = link.getAttribute('data-rw');
      if (rwUrl) {
        const rwHost = extractHostFromUrlString(rwUrl);
        if (rwHost) return rwHost;
      }
      const hrefHost = extractHostFromUrlString(link.getAttribute('href'));
      if (hrefHost) return hrefHost;
    }

    return null;
  }

  /**
   * Returns top-level ad units inside `el` without double-counting nested matches
   * (e.g., when [data-text-ad] is inside .uEierd or vice versa).
   */
  function getDistinctAdUnits(el) {
    const candidates = Array.from(el.querySelectorAll(AD_UNIT_SELECTOR));
    return candidates.filter(
      (node) => !candidates.some((other) => other !== node && other.contains(node))
    );
  }

  function inspectSponsoredNode(el) {
    const domains = [];

    if (el.matches(AD_UNIT_SELECTOR)) {
      const domain = extractDomainFromAdUnit(el);
      if (domain) domains.push(domain);
      return { count: 1, domains };
    }

    const distinctUnits = getDistinctAdUnits(el);
    if (distinctUnits.length > 0) {
      for (const adUnit of distinctUnits) {
        const domain = extractDomainFromAdUnit(adUnit);
        if (domain) domains.push(domain);
      }
      return { count: distinctUnits.length, domains };
    }

    const hasLinks = el.querySelectorAll('a[href], [role="link"]').length > 0;
    const textLen = (el.textContent || '').trim().length;
    if (hasLinks || textLen > 20) {
      const domain = extractDomainFromAdUnit(el);
      if (domain) domains.push(domain);
      return { count: 1, domains };
    }

    return { count: 0, domains };
  }

  /**
   * Scans the DOM and removes all matching sponsored containers (#tads, #tadsb, etc.)
   * Only runs once the HTML parser has finished the initial stream (or after settle debounce)
   * so containers are never removed while still half-parsed/empty.
   */
  function removeSponsoredNodes() {
    if (!isEnabled) return;

    // Wait until DOMContentLoaded (readyState !== 'loading') so #tads children are fully parsed.
    // The injected CSS shield already hides #tads 100% during 'loading'.
    if (document.readyState === 'loading') return;

    const elements = document.querySelectorAll(COMBINED_SELECTOR);
    if (elements.length === 0) return;

    let newlyBlocked = 0;
    const extractedDomains = [];

    for (const el of elements) {
      if (!el.isConnected) continue;

      const { count, domains } = inspectSponsoredNode(el);
      newlyBlocked += count;
      if (domains.length > 0) {
        extractedDomains.push(...domains);
      }

      el.remove();
    }

    if (newlyBlocked > 0) {
      pageBlockedCount += newlyBlocked;
      recordBlockedStats(newlyBlocked, pageBlockedCount, extractedDomains);
    }
  }

  /**
   * Debounces DOM removal slightly (50ms) on dynamic mutations so Google's scripts
   * finish appending child links/attributes into #tads before we count and remove it.
   */
  function scheduleRemoveSponsoredNodes() {
    if (!isEnabled || document.readyState === 'loading') return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      removeSponsoredNodes();
    }, 50);
  }

  function checkAndRecordSearchQuery() {
    if (!isEnabled) return;
    if (!window.location.pathname.startsWith('/search')) return;

    const params = new URLSearchParams(window.location.search);
    const query = (params.get('q') || '').trim();
    if (!query) return;

    const currentSearchSignature = `${window.location.pathname}?q=${query}`;
    if (currentSearchSignature === lastRecordedSearchUrl) return;
    lastRecordedSearchUrl = currentSearchSignature;

    const todayKey = getLocalDateKey();
    enqueueStorageUpdate(
      {
        totalSearchesProtected: 0,
        protectedSince: todayKey
      },
      (data) => ({
        totalSearchesProtected: (data.totalSearchesProtected || 0) + 1,
        protectedSince: data.protectedSince || todayKey
      })
    );
  }

  function recordBlockedStats(incrementBy, currentTabTotal, domains) {
    const todayKey = getLocalDateKey();
    const dailyCutoff = getCutoffDateKey(35);
    const domainCutoff = getCutoffDateKey(30);

    enqueueStorageUpdate(
      {
        protectedSince: todayKey,
        totalBlocked: 0,
        todayBlocked: 0,
        lastResetDate: todayKey,
        dailyCounts: {},
        domainHistory: {}
      },
      (data) => {
        const isSameDay = data.lastResetDate === todayKey;
        const updatedToday = (isSameDay ? data.todayBlocked : 0) + incrementBy;
        const updatedTotal = (data.totalBlocked || 0) + incrementBy;

        const dailyCounts = { ...(data.dailyCounts || {}) };
        dailyCounts[todayKey] = (dailyCounts[todayKey] || 0) + incrementBy;
        for (const dateKey of Object.keys(dailyCounts)) {
          if (dateKey < dailyCutoff) {
            delete dailyCounts[dateKey];
          }
        }

        const domainHistory = { ...(data.domainHistory || {}) };
        if (domains && domains.length > 0) {
          const todayDomains = { ...(domainHistory[todayKey] || {}) };
          for (const domain of domains) {
            todayDomains[domain] = (todayDomains[domain] || 0) + 1;
          }
          domainHistory[todayKey] = todayDomains;
        }
        for (const dateKey of Object.keys(domainHistory)) {
          if (dateKey < domainCutoff) {
            delete domainHistory[dateKey];
          }
        }

        return {
          protectedSince: data.protectedSince || todayKey,
          totalBlocked: updatedTotal,
          todayBlocked: updatedToday,
          lastResetDate: todayKey,
          dailyCounts,
          domainHistory
        };
      }
    );

    chrome.runtime.sendMessage({
      type: 'BSR_UPDATE_BADGE',
      count: currentTabTotal
    }).catch(() => {});
  }

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver(() => {
      if (isEnabled) {
        checkAndRecordSearchQuery();
        scheduleRemoveSponsoredNodes();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function stopObserver() {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function enableProtection() {
    isEnabled = true;
    injectShieldStyle();
    checkAndRecordSearchQuery();
    removeSponsoredNodes();
    startObserver();
  }

  function disableProtection() {
    isEnabled = false;
    stopObserver();
    removeShieldStyle();
  }

  // Optimistically inject anti-flash CSS at document_start so ads never flash
  injectShieldStyle();

  chrome.storage.local.get({ enabled: true }, (data) => {
    isEnabled = Boolean(data.enabled);
    if (isEnabled) {
      enableProtection();
    } else {
      disableProtection();
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (isEnabled) {
      checkAndRecordSearchQuery();
      removeSponsoredNodes();
    }
  });

  window.addEventListener('load', () => {
    if (isEnabled) {
      checkAndRecordSearchQuery();
      removeSponsoredNodes();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.enabled) {
      const nextState = Boolean(changes.enabled.newValue);
      if (nextState) {
        enableProtection();
      } else {
        disableProtection();
      }
    }
  });
})();
