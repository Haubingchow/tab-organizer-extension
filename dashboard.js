const board = document.querySelector("#board");
const emptyState = document.querySelector("#emptyState");
const groupTemplate = document.querySelector("#groupTemplate");
const tabTemplate = document.querySelector("#tabTemplate");
const frequentPages = document.querySelector("#frequentPages");
const searchInput = document.querySelector("#searchInput");
const webSearchForm = document.querySelector("#webSearchForm");
const webSearchInput = document.querySelector("#webSearchInput");
const localTime = document.querySelector("#localTime");
const localDate = document.querySelector("#localDate");
const duplicatesButton = document.querySelector("#duplicatesButton");
const themeButton = document.querySelector("#themeButton");
const disableButton = document.querySelector("#disableButton");
const refreshButton = document.querySelector("#refreshButton");
const summary = document.querySelector("#summary");
const tabCount = document.querySelector("#tabCount");
const groupCount = document.querySelector("#groupCount");
const bookmarkedCount = document.querySelector("#bookmarkedCount");
const duplicateCount = document.querySelector("#duplicateCount");

let overview = null;
let filterText = "";

init();

function init() {
  searchInput.addEventListener("input", () => {
    filterText = searchInput.value.trim().toLowerCase();
    render();
  });

  duplicatesButton.addEventListener("click", closeDuplicates);
  themeButton.addEventListener("click", toggleTheme);
  disableButton.addEventListener("click", disableExtension);
  refreshButton.addEventListener("click", loadOverview);
  webSearchForm.addEventListener("submit", openSearchTarget);
  document.querySelectorAll(".quick-link-grid button").forEach((button) => {
    button.addEventListener("click", () => {
      openNewTab(button.dataset.url);
    });
  });
  loadOverview();
  applyTheme(localStorage.getItem("tabOrganizerTheme") || "light");
  updateClock();
  setInterval(updateClock, 30000);
}

async function loadOverview() {
  refreshButton.disabled = true;
  overview = await sendMessage({ type: "GET_TAB_OVERVIEW" });
  refreshButton.disabled = false;
  render();
}

async function closeDuplicates() {
  duplicatesButton.disabled = true;
  overview = await sendMessage({ type: "CLOSE_DUPLICATES" });
  duplicatesButton.disabled = false;
  render();
}

function openSearchTarget(event) {
  event.preventDefault();
  const value = webSearchInput.value.trim();
  if (!value) return;

  openNewTab(resolveSearchTarget(value));
  webSearchInput.value = "";
}

function openNewTab(url) {
  chrome.tabs.create({ url });
}

function updateClock() {
  const now = new Date();
  localTime.textContent = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
  localDate.textContent = now.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("tabOrganizerTheme", nextTheme);
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeButton.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

async function disableExtension() {
  disableButton.disabled = true;
  disableButton.textContent = "Turning off...";
  await sendMessage({ type: "DISABLE_EXTENSION" });
}

function render() {
  if (!overview) return;

  const visibleBuckets = overview.buckets
    .map((bucket) => ({
      ...bucket,
      tabs: bucket.tabs.filter((tab) => matchesFilter(bucket, tab))
    }))
    .filter((bucket) => bucket.tabs.length > 0);

  summary.textContent = `${overview.totalTabs} tabs across ${overview.totalGroups} visual groups`;
  tabCount.textContent = overview.totalTabs;
  groupCount.textContent = overview.totalGroups;
  bookmarkedCount.textContent = overview.bookmarkedTabs;
  duplicateCount.textContent = overview.duplicateTabs;
  duplicatesButton.disabled = overview.duplicateTabs === 0;

  board.innerHTML = "";
  frequentPages.innerHTML = "";
  emptyState.hidden = visibleBuckets.length > 0;

  for (const bucket of visibleBuckets) {
    board.appendChild(renderGroup(bucket));
  }

  for (const page of overview.frequentPages || []) {
    frequentPages.appendChild(renderFrequentPage(page));
  }
}

function renderGroup(bucket) {
  const group = groupTemplate.content.firstElementChild.cloneNode(true);
  group.classList.add(`is-${bucket.color}`);
  group.querySelector(".group-icon").textContent = bucket.icon;
  group.querySelector("h2").textContent = bucket.title;
  group.querySelector("p").textContent = `${bucket.theme} - ${bucket.tabs.length} tab${bucket.tabs.length === 1 ? "" : "s"} - ${bucket.windowCount} window${bucket.windowCount === 1 ? "" : "s"}`;

  const tabList = group.querySelector(".tab-list");
  for (const tab of bucket.tabs) {
    tabList.appendChild(renderTab(bucket, tab));
  }

  return group;
}

function renderTab(bucket, tab) {
  const card = tabTemplate.content.firstElementChild.cloneNode(true);
  card.classList.toggle("active", tab.active);

  const mainButton = card.querySelector(".tab-main");
  const favicon = card.querySelector(".favicon");
  const title = card.querySelector("strong");
  const url = card.querySelector("small");
  const bookmarkNote = card.querySelector(".bookmark-note");
  const loadNote = card.querySelector(".load-note");
  const loadBar = card.querySelector(".load-bar span");
  const bookmarkAction = card.querySelector(".bookmark-action");
  const closeButton = card.querySelector(".close-button");

  if (tab.favIconUrl) {
    const image = document.createElement("img");
    image.src = tab.favIconUrl;
    image.alt = "";
    favicon.appendChild(image);
  } else {
    favicon.textContent = bucket.icon;
  }

  title.textContent = tab.title;
  url.textContent = readableUrl(tab.url);
  bookmarkNote.hidden = !tab.bookmarked;
  loadNote.textContent = `${tab.loadPercent}% loaded`;
  loadBar.style.width = `${tab.loadPercent}%`;
  bookmarkAction.textContent = tab.bookmarked ? "Unbookmark" : "Bookmark";
  bookmarkAction.classList.toggle("is-saved", tab.bookmarked);
  bookmarkAction.addEventListener("click", async () => {
    bookmarkAction.disabled = true;
    overview = await sendMessage({
      type: tab.bookmarked ? "UNBOOKMARK_TAB" : "BOOKMARK_TAB",
      url: tab.url,
      title: tab.title
    });
    render();
  });
  mainButton.title = `Open ${tab.title}`;
  mainButton.addEventListener("click", () => {
    sendMessage({ type: "FOCUS_TAB", tabId: tab.id, windowId: tab.windowId });
  });

  closeButton.title = `Close ${tab.title}`;
  closeButton.addEventListener("click", async () => {
    card.style.opacity = "0.45";
    overview = await sendMessage({ type: "CLOSE_TAB", tabId: tab.id });
    render();
  });

  return card;
}

function renderFrequentPage(page) {
  const button = document.createElement("button");
  button.className = "frequent-page";
  button.type = "button";
  button.innerHTML = `
    <span>
      <strong></strong>
      <small></small>
    </span>
    <em></em>
  `;
  button.querySelector("strong").textContent = page.title;
  button.querySelector("small").textContent = readableUrl(page.url);
  button.querySelector("em").textContent = `${page.visitCount} visits`;
  button.addEventListener("click", () => openNewTab(page.url));
  return button;
}

function matchesFilter(bucket, tab) {
  if (!filterText) return true;
  return [bucket.title, bucket.theme, tab.title, tab.url]
    .join(" ")
    .toLowerCase()
    .includes(filterText);
}

function readableUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.hostname.replace(/^www\./, "") + url.pathname;
  } catch {
    return rawUrl;
  }
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Extension action failed.");
  }
  return response.result;
}

function resolveSearchTarget(value) {
  if (looksLikeUrl(value)) {
    return value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value) || /^[^\s]+\.[^\s]{2,}/.test(value);
}
