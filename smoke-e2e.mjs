// END-TO-END against the live local Supabase: real login → real data load.
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

// ---- 1. Pilot sign-in → dashboard loads real data ----
await page.goto(BASE + "/login.html", { waitUntil: "networkidle2", timeout: 30000 });
await page.type("#email", "pilot@local.test");
await page.type("#password", "pilot12345");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
  page.click("#submit"),
]);
await page.waitForSelector("#root .app-shell", { timeout: 20000 });
const pilotName = await page.$eval(".user-name", (e) => e.textContent).catch(() => "(none)");
const navCount = await page.$$eval(".sidebar-nav .nav-item", (els) => els.length).catch(() => 0);
const counts = await page.evaluate(() => ({ pilots: (window.PILOTS||[]).length, roster: (window.TEAM_ROSTER||[]).length, roles: (window.ALL_ROLES||[]).length, sectors: Object.keys(window.SECTORS||{}).length }));
console.log("   store data:", JSON.stringify(counts));
console.log(`1. PILOT login → dashboard mounted · user="${pilotName}" · ${navCount} nav items`);

// navigate to a couple of views to confirm real reads don't crash
for (const label of ["Aircraft and Batteries", "Media gallery", "Flight log archive"]) {
  await page.evaluate((l) => { const b = [...document.querySelectorAll(".sidebar-nav .nav-item")].find((x) => x.textContent.trim().startsWith(l)); b && b.click(); }, label);
  await sleep(400);
  const crumb = await page.$eval(".topbar-crumbs", (e) => e.textContent.trim()).catch(() => "");
  console.log(`   ✓ ${label} → ${crumb}`);
}

// ---- 2. Admin sign-in (no TOTP yet) → console loads ----
await page.goto(BASE + "/admin-login.html", { waitUntil: "networkidle2" });
await page.type("#email", "director@local.test");
await page.type("#password", "admin12345");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
  page.click("#submit"),
]);
await page.waitForSelector("#root .app-shell", { timeout: 20000 });
await sleep(600);
const adminCrumb = await page.$eval(".topbar-crumbs", (e) => e.textContent.trim()).catch(() => "(none)");
console.log(`2. ADMIN login → console mounted · crumb="${adminCrumb}"`);

await browser.close();
console.log("\n=== ERRORS (" + errors.length + ") ===");
for (const e of errors) console.log(" - " + e);
process.exit(errors.length ? 1 : 0);
