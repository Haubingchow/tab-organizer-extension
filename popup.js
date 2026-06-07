const openDashboardButton = document.querySelector("#openDashboardButton");
const statusText = document.querySelector("#status");

openDashboardButton.addEventListener("click", openDashboard);

async function openDashboard() {
  openDashboardButton.disabled = true;
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  openDashboardButton.disabled = false;
  statusText.textContent = "Opened the tab board.";
}
