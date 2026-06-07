const SERVICE_NAMES = [
  { match: /(^|\.)mail\.google\.com$/i, title: "Gmail", theme: "Communication", color: "red", icon: "M" },
  { match: /(^|\.)inbox\.google\.com$/i, title: "Gmail", theme: "Communication", color: "red", icon: "M" },
  { match: /(^|\.)drive\.google\.com$/i, title: "Google Drive", theme: "Files", color: "blue", icon: "D" },
  { match: /(^|\.)docs\.google\.com$/i, title: "Google Docs", theme: "Work", color: "blue", icon: "D" },
  { match: /(^|\.)sheets\.google\.com$/i, title: "Google Sheets", theme: "Work", color: "green", icon: "S" },
  { match: /(^|\.)calendar\.google\.com$/i, title: "Calendar", theme: "Planning", color: "green", icon: "C" },
  { match: /(^|\.)youtube\.com$/i, title: "YouTube", theme: "Media", color: "red", icon: "Y" },
  { match: /(^|\.)github\.com$/i, title: "GitHub", theme: "Development", color: "grey", icon: "G" },
  { match: /(^|\.)slack\.com$/i, title: "Slack", theme: "Communication", color: "purple", icon: "S" },
  { match: /(^|\.)notion\.so$/i, title: "Notion", theme: "Work", color: "grey", icon: "N" },
  { match: /(^|\.)figma\.com$/i, title: "Figma", theme: "Design", color: "purple", icon: "F" },
  { match: /(^|\.)openai\.com$/i, title: "OpenAI", theme: "Research", color: "green", icon: "O" }
];

const DEFAULT_SETTINGS = {
  autoGroup: false,
  minTabs: 2
};

let organizeTimer = null;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
});

chrome.tabs.onCreated.addListener(scheduleAutoOrganize);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    scheduleAutoOrganize();
  }
});
chrome.tabs.onRemoved.addListener(scheduleAutoOrganize);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_TAB_OVERVIEW":
      return getTabOverview();
    case "CLOSE_DUPLICATES":
      return closeDuplicateTabs();
    case "UNBOOKMARK_TAB":
      return unbookmarkTab(message.url);
    case "BOOKMARK_TAB":
      return bookmarkTab(message.url, message.title);
    case "DISABLE_EXTENSION":
      await chrome.management.setEnabled(chrome.runtime.id, false);
      return { disabled: true };
    case "FOCUS_TAB":
      return focusTab(message.tabId, message.windowId);
    case "CLOSE_TAB":
      await chrome.tabs.remove(message.tabId);
      return getTabOverview();
    default:
      throw new Error("Unknown action.");
  }
}

async function scheduleAutoOrganize() {
  clearTimeout(organizeTimer);
  organizeTimer = setTimeout(() => {}, 900);
}

async function getTabOverview() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const tabs = await chrome.tabs.query({});
  const visibleTabs = tabs.filter((tab) => !isDashboardTab(tab.url));
  const bookmarkUrls = await getBookmarkedUrls(visibleTabs);
  const buckets = bucketTabs(visibleTabs, 1);
  const groupedBuckets = buckets.map((bucket) => ({
    key: bucket.key,
    title: bucket.title,
    theme: bucket.theme,
    color: bucket.color,
    icon: bucket.icon,
    tabCount: bucket.tabs.length,
    windowCount: new Set(bucket.tabs.map((tab) => tab.windowId)).size,
    isReadyToGroup: bucket.tabs.length >= settings.minTabs,
    tabs: bucket.tabs.map((tab) => serializeTab(tab, bookmarkUrls))
  }));

  return {
    settings,
    totalTabs: visibleTabs.length,
    totalGroups: groupedBuckets.length,
    bookmarkedTabs: visibleTabs.filter((tab) => bookmarkUrls.has(tab.url)).length,
    duplicateTabs: countDuplicateTabs(visibleTabs),
    frequentPages: await getFrequentPages(),
    activeTabId: tabs.find((tab) => tab.active)?.id ?? null,
    buckets: groupedBuckets.sort(sortBuckets)
  };
}

async function getFrequentPages() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const results = await chrome.history.search({
    text: "",
    startTime: thirtyDaysAgo,
    maxResults: 200
  });

  return results
    .filter((item) => item.url && /^https?:\/\//i.test(item.url))
    .sort((first, second) => (second.visitCount || 0) - (first.visitCount || 0))
    .slice(0, 8)
    .map((item) => ({
      title: item.title || readableUrlForHistory(item.url),
      url: item.url,
      visitCount: item.visitCount || 0,
      lastVisitTime: item.lastVisitTime || 0
    }));
}

async function closeDuplicateTabs() {
  const tabs = await chrome.tabs.query({});
  const seenUrls = new Set();
  const duplicateIds = [];

  for (const tab of tabs.filter((item) => !isDashboardTab(item.url))) {
    const key = normalizeUrl(tab.url);
    if (!key) continue;

    if (seenUrls.has(key)) {
      duplicateIds.push(tab.id);
    } else {
      seenUrls.add(key);
    }
  }

  if (duplicateIds.length > 0) {
    await chrome.tabs.remove(duplicateIds);
  }

  return getTabOverview();
}

async function unbookmarkTab(url) {
  const matches = await chrome.bookmarks.search({ url });
  for (const match of matches) {
    await chrome.bookmarks.remove(match.id);
  }
  return getTabOverview();
}

async function bookmarkTab(url, title) {
  const matches = await chrome.bookmarks.search({ url });
  if (matches.length === 0) {
    await chrome.bookmarks.create({
      title: title || url,
      url
    });
  }
  return getTabOverview();
}

async function focusTab(tabId, windowId) {
  await chrome.windows.update(windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return { tabId, windowId };
}

function bucketTabs(tabs, minTabs) {
  const buckets = new Map();

  for (const tab of tabs) {
    const site = getSiteInfo(tab.url);
    if (!site) continue;

    if (!buckets.has(site.key)) {
      buckets.set(site.key, { ...site, tabs: [] });
    }

    buckets.get(site.key).tabs.push(tab);
  }

  return [...buckets.values()].filter((bucket) => bucket.tabs.length >= minTabs);
}

function getSiteInfo(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol)) return null;

  const hostname = url.hostname.replace(/^www\./i, "");
  const service = SERVICE_NAMES.find((entry) => entry.match.test(hostname));

  if (service) {
    return {
      key: service.title.toLowerCase().replace(/\s+/g, "-"),
      title: service.title,
      theme: service.theme,
      color: service.color,
      icon: service.icon
    };
  }

  return {
    key: hostname,
    title: readableDomain(hostname),
    theme: inferTheme(hostname),
    color: colorForDomain(hostname),
    icon: readableDomain(hostname).charAt(0)
  };
}

function serializeTab(tab, bookmarkUrls) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || "Untitled tab",
    url: tab.url,
    favIconUrl: tab.favIconUrl || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    bookmarked: bookmarkUrls.has(tab.url),
    loadPercent: getLoadPercent(tab),
    status: tab.status || "complete"
  };
}

async function getBookmarkedUrls(tabs) {
  const urls = new Set();
  const uniqueUrls = [...new Set(tabs.map((tab) => tab.url).filter(Boolean))];

  for (const url of uniqueUrls) {
    const matches = await chrome.bookmarks.search({ url });
    if (matches.length > 0) urls.add(url);
  }

  return urls;
}

function getLoadPercent(tab) {
  if (tab.status === "complete") return 100;
  const seed = `${tab.id}${tab.url || ""}`.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return 35 + (seed % 45);
}

function countDuplicateTabs(tabs) {
  const counts = new Map();
  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function inferTheme(hostname) {
  if (hostname.includes("mail") || hostname.includes("chat")) return "Communication";
  if (hostname.includes("docs") || hostname.includes("office")) return "Work";
  if (hostname.includes("news") || hostname.includes("wikipedia")) return "Reading";
  if (hostname.includes("shop") || hostname.includes("amazon")) return "Shopping";
  return "Browsing";
}

function readableDomain(hostname) {
  const parts = hostname.split(".");
  const core = parts.length > 2 ? parts.at(-2) : parts[0];
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function readableUrlForHistory(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return rawUrl;
  }
}

function colorForDomain(hostname) {
  const colors = ["blue", "green", "yellow", "orange", "red", "purple", "grey"];
  const hash = [...hostname].reduce((total, char) => total + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function sortBuckets(first, second) {
  return second.tabCount - first.tabCount || first.title.localeCompare(second.title);
}

function isDashboardTab(url = "") {
  return url.startsWith(`chrome-extension://${chrome.runtime.id}/dashboard.html`);
}
