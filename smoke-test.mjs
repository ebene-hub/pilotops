// Headless smoke test: load the app in Edge, click through every nav view,
// open the command palette, and report any console/page errors.
import puppeteer from "puppeteer-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const URL = "http://127.0.0.1:5173/";

const VIEWS = [
  "Flight Hub", "Start mission", "Live stream", "Multi-screen ops",
  "Post-flight summary", "Aircraft and Batteries", "Media gallery",
  "Pilot logbook", "Log incident", "Flight log archive",
];

const errors = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem("po:user", JSON.stringify({ email: "a.mensah@pilotops.io", name: "Adaora Mensah", pilotId: "P-014", initials: "AM" })); } catch (e) {} });

page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) => {
  const u = r.url();
  const errText = r.failure()?.errorText || "";
  if (u.includes("fonts.g")) return;
  // Map tile fetches get aborted when a map view unmounts mid-load (we click
  // through every view fast) — that's expected, not a failure.
  if (/basemaps\.cartocdn\.com|arcgisonline\.com|tile\.openstreetmap\.org/.test(u) && /ABORT/i.test(errText)) return;
  errors.push("requestfailed: " + u + " " + errText);
});

await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
await page.waitForSelector("#root .app-shell", { timeout: 15000 });

const rootChildren = await page.$eval("#root", (el) => el.children.length);
console.log("Mounted: #root children =", rootChildren);

// Click each sidebar nav item by its visible label.
for (const label of VIEWS) {
  const clicked = await page.evaluate((lbl) => {
    const btns = Array.from(document.querySelectorAll(".sidebar-nav .nav-item"));
    const b = btns.find((x) => x.textContent.trim().startsWith(lbl));
    if (b) { b.click(); return true; }
    return false;
  }, label);
  await new Promise((r) => setTimeout(r, 350));
  const crumb = await page.$eval(".topbar-crumbs", (el) => el.textContent.trim()).catch(() => "(no crumb)");
  console.log(`  ${clicked ? "✓" : "✗ NOT FOUND"}  ${label}  →  crumb: ${crumb}`);
  if (!clicked) errors.push("nav item not found: " + label);
}

// Command palette (Ctrl-K)
await page.keyboard.down("Control"); await page.keyboard.press("KeyK"); await page.keyboard.up("Control");
await new Promise((r) => setTimeout(r, 300));
const paletteOpen = await page.evaluate(() => {
  // palette overlay is a fixed full-screen div containing .cmdk-row result rows
  return !!document.querySelector(".cmdk-row") ||
    Array.from(document.querySelectorAll("div")).some(
      (d) => d.style.position === "fixed" && d.style.zIndex === "1000"
    );
});
console.log("Command palette opened:", paletteOpen);
if (!paletteOpen) errors.push("command palette did not open on Ctrl-K");
await page.keyboard.press("Escape");

await browser.close();

console.log("\n=== ERRORS (" + errors.length + ") ===");
for (const e of errors) console.log(" - " + e);
process.exit(errors.length ? 1 : 0);
