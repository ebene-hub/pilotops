// Interaction smoke test: exercise the modal-driven flows (emergency launch,
// pilot-code auth, log-new-flight, media upload, battery update) to confirm the
// cross-file modules mount on interaction without errors.
import puppeteer from "puppeteer-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const URL = "http://127.0.0.1:5173/";
const errors = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem("po:user", JSON.stringify({ email: "a.mensah@pilotops.io", name: "Adaora Mensah", pilotId: "P-014", initials: "AM" })); } catch (e) {} });
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push("console.error: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
await page.waitForSelector("#root .app-shell", { timeout: 15000 });

async function nav(label) {
  await page.evaluate((lbl) => {
    const b = Array.from(document.querySelectorAll(".sidebar-nav .nav-item")).find((x) => x.textContent.trim().startsWith(lbl));
    b && b.click();
  }, label);
  await sleep(350);
}
async function clickText(txt) {
  return page.evaluate((t) => {
    const el = Array.from(document.querySelectorAll("button, a")).find((x) => x.textContent.trim().toLowerCase().includes(t.toLowerCase()) && x.offsetParent !== null);
    if (el) { el.click(); return el.textContent.trim(); }
    return null;
  }, txt);
}
async function modalCount() { return page.evaluate(() => document.querySelectorAll(".modal-backdrop, .modal").length + Array.from(document.querySelectorAll("div")).filter((d) => d.style.position === "fixed" && +d.style.zIndex >= 900).length); }

// 1. Flight Hub → Emergency launch modal
await nav("Flight Hub");
const emg = await clickText("Emergency");
await sleep(400);
console.log(`Emergency launch: clicked=${JSON.stringify(emg)} overlays=${await modalCount()}`);
await page.keyboard.press("Escape"); await sleep(200);

// 2. Flight Hub → Log new flight should route to Start mission
await nav("Flight Hub");
await clickText("Log new flight");
await sleep(400);
let crumb = await page.$eval(".topbar-crumbs", (e) => e.textContent.trim()).catch(() => "");
console.log(`Log new flight → crumb: ${crumb}`);

// 3. Start mission → attempt to start (should surface pilot-code auth or validation)
await nav("Start mission");
const startBtn = await clickText("Start mission");
await sleep(400);
console.log(`Start mission button: ${JSON.stringify(startBtn)} overlays=${await modalCount()}`);
await page.keyboard.press("Escape"); await sleep(200);

// 4. Aircraft and Batteries → Batteries tab → Update battery modal
await nav("Aircraft and Batteries");
await clickText("Batteries"); await sleep(300);
const upd = await clickText("Update");
await sleep(400);
console.log(`Battery update: clicked=${JSON.stringify(upd)} overlays=${await modalCount()}`);
await page.keyboard.press("Escape"); await sleep(200);

// 5. Media gallery → open upload
await nav("Media gallery");
const up = await clickText("Upload");
await sleep(400);
console.log(`Media upload: clicked=${JSON.stringify(up)} overlays=${await modalCount()}`);

await browser.close();
console.log("\n=== ERRORS (" + errors.length + ") ===");
for (const e of errors) console.log(" - " + e);
process.exit(errors.length ? 1 : 0);
