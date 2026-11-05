'use strict';

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function updateGlobalBadgeForState(enabled) {
  if (!enabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
  } else {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: '#059669' });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  const todayKey = getTodayKey();
  chrome.storage.local.get(
    {
      enabled: true,
      protectedSince: todayKey,
      totalBlocked: 0,
      totalSearchesProtected: 0,
      dailyCounts: {},
      domainHistory: {}
    },
    (data) => {
      if (!data.protectedSince) {
        data.protectedSince = todayKey;
      }
      chrome.storage.local.set(data);
      updateGlobalBadgeForState(data.enabled);
    }
  );
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'BSR_UPDATE_BADGE' && sender.tab && sender.tab.id) {
    chrome.storage.local.get({ enabled: true }, (data) => {
      if (!data.enabled) return;

      const count = Number(message.count) || 0;
      const badgeText = count > 0 ? String(count) : '';

      chrome.action.setBadgeBackgroundColor({
        color: '#059669',
        tabId: sender.tab.id
      });
      chrome.action.setBadgeText({
        text: badgeText,
        tabId: sender.tab.id
      });
    });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.enabled) {
    updateGlobalBadgeForState(Boolean(changes.enabled.newValue));
  }
});
