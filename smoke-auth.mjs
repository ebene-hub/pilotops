// Full multi-page flow: login → dashboard, admin-login (2FA) → admin console.
import puppeteer from "puppeteer-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://127.0.0.1:5173";
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push("console.error: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

// ---- 0. Unauthenticated dashboard should bounce to /login.html ----
await page.evaluate(() => {}).catch(() => {});
await page.goto(BASE + "/", { waitUntil: "networkidle2" });
await sleep(400);
console.log("0. unauth / →", new URL(page.url()).pathname);

// ---- 1. Pilot login ----
await page.goto(BASE + "/login.html", { waitUntil: "networkidle2" });
await page.click("#demo-fill");
await page.click("#submit");
await page.waitForFunction(() => location.pathname === "/" || location.pathname === "/index.html", { timeout: 8000 });
await page.waitForSelector("#root .app-shell", { timeout: 10000 });
const pilotName = await page.$eval(".user-name", (e) => e.textContent).catch(() => "(none)");
console.log("1. pilot login → dashboard mounted, user:", pilotName);

// ---- 2. Admin login with 2FA ----
await page.goto(BASE + "/admin-login.html", { waitUntil: "networkidle2" });
await page.click("#demo-fill");
await page.click("#submit");
await page.waitForSelector("#step-2.active", { timeout: 6000 });
for (const d of "123456") {
  await page.type(".twofa-digit[data-idx='" + "123456".indexOf(d) + "']", d).catch(() => {});
}
// type sequentially by index to be safe
await page.evaluate(() => { document.querySelectorAll(".twofa-digit").forEach((el, i) => { el.value = "123456"[i]; }); });
await page.click("#submit-2fa");
await page.waitForFunction(() => location.pathname === "/admin.html", { timeout: 8000 });
await page.waitForSelector("#root .app-shell, #root .admin-shell, #root > *", { timeout: 10000 });
await sleep(500);
const adminCrumb = await page.$eval(".topbar-crumbs", (e) => e.textContent.trim()).catch(() => "(no crumb)");
console.log("2. admin login (2FA) → console mounted, crumb:", adminCrumb);

// ---- 3. Click through admin nav ----
const adminViews = ["Pilot performance", "Emergency reviews", "Members & invites", "Team roster", "Roles & permissions", "Aircraft registry", "Mission form fields", "Notification rules", "Sectors & presets", "API & integrations", "Audit log"];
for (const label of adminViews) {
  const ok = await page.evaluate((lbl) => {
    const b = Array.from(document.querySelectorAll(".sidebar-nav .nav-item")).find((x) => x.textContent.trim().startsWith(lbl));
    if (b) { b.click(); return true; } return false;
  }, label);
  await sleep(300);
  const crumb = await page.$eval(".topbar-crumbs", (e) => e.textContent.trim()).catch(() => "");
  console.log(`   ${ok ? "✓" : "✗"} ${label} → ${crumb}`);
  if (!ok) errors.push("admin nav not found: " + label);
}

await browser.close();
console.log("\n=== ERRORS (" + errors.length + ") ===");
for (const e of errors) console.log(" - " + e);
process.exit(errors.length ? 1 : 0);
