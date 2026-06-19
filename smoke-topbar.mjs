// Verify the Pilot Ops topbar notification bell + settings menu work.
import puppeteer from "puppeteer-core";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://127.0.0.1:5173";
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_|status of 4|status of 5/i.test(m.text())) errors.push("console.error: " + m.text()); });

await page.goto(BASE + "/login.html", { waitUntil: "networkidle2", timeout: 30000 });
await page.type("#email", "pilot@local.test");
await page.type("#password", "pilot12345");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
  page.click("#submit"),
]);
await page.waitForSelector("#root .app-shell", { timeout: 20000 });
await sleep(400);

// --- Bell ---
await page.evaluate(() => { const b = document.querySelector('.topbar button[title="Notifications"]'); b && b.click(); });
await sleep(500);
const bellOpen = await page.evaluate(() => !!Array.from(document.querySelectorAll("div")).find(d => d.textContent.trim() === "Notifications" && d.offsetParent));
console.log(`1. Bell opens dropdown: ${bellOpen}`);
// close
await page.mouse.click(700, 700); await sleep(300);
const bellClosed = await page.evaluate(() => !Array.from(document.querySelectorAll("div")).find(d => d.textContent.trim() === "Notifications" && d.offsetParent));
console.log(`   Bell closes on outside click: ${bellClosed}`);

// --- Settings ---
await page.evaluate(() => { const b = document.querySelector('.topbar button[title="Settings"]'); b && b.click(); });
await sleep(400);
const settingsOpen = await page.evaluate(() => !!Array.from(document.querySelectorAll("div")).find(d => /Appearance/i.test(d.textContent) && d.offsetParent));
console.log(`2. Settings opens dropdown: ${settingsOpen}`);
// toggle theme to dark
const themeChanged = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Dark" && b.offsetParent);
  if (!btn) return "no-dark-button";
  btn.click();
  return document.documentElement.getAttribute("data-theme") || document.body.getAttribute("data-theme") || "(set)";
});
console.log(`   Theme button applied: ${themeChanged}`);

await browser.close();
console.log("\n=== ERRORS (" + errors.length + ") ===");
for (const e of errors) console.log(" - " + e);
process.exit(errors.length || !bellOpen || !settingsOpen ? 1 : 0);
