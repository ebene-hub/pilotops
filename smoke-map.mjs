// Map test: verify Leaflet initializes, tiles load, markers render, and the
// basemap switch swaps tile sources — on Flight Hub, Live stream, Incident.
import puppeteer from "puppeteer-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://127.0.0.1:5173";
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem("po:user", JSON.stringify({ email: "a.mensah@pilotops.io", name: "Adaora Mensah", pilotId: "P-014", initials: "AM" })); } catch (e) {} });
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errors.push("console.error: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

async function nav(label) {
  await page.evaluate((lbl) => {
    const b = Array.from(document.querySelectorAll(".sidebar-nav .nav-item")).find((x) => x.textContent.trim().startsWith(lbl));
    b && b.click();
  }, label);
  await sleep(500);
}

await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
await page.waitForSelector("#root .app-shell", { timeout: 15000 });

// ---- Flight Hub map ----
await nav("Flight Hub");
await page.waitForSelector(".leaflet-container", { timeout: 8000 });
await sleep(1500); // let tiles fetch
const fh = await page.evaluate(() => {
  const tiles = Array.from(document.querySelectorAll("img.leaflet-tile"));
  const loaded = tiles.filter((t) => t.complete && t.naturalWidth > 0);
  return {
    tiles: tiles.length,
    loaded: loaded.length,
    sampleSrc: tiles[0]?.src || "(none)",
    drones: document.querySelectorAll(".map-drone").length,
    pinLabels: document.querySelectorAll(".map-pin-label").length,
    zoomCtl: !!document.querySelector(".leaflet-control-zoom"),
    attribution: (document.querySelector(".leaflet-control-attribution")?.textContent || "").slice(0, 40),
  };
});
console.log("Flight Hub:", JSON.stringify(fh, null, 0));

// ---- basemap switch → Satellite (Esri) ----
const switched = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".basemap-switch button")).find((x) => x.textContent.trim() === "Satellite");
  if (b) { b.click(); return true; } return false;
});
await sleep(1500);
const afterSwitch = await page.evaluate(() => {
  const t = document.querySelector("img.leaflet-tile");
  return t?.src || "(none)";
});
console.log("Switched to Satellite:", switched, "→ tile host:", (afterSwitch.match(/https?:\/\/([^/]+)/) || [])[1]);

// ---- Live stream map ----
await nav("Live stream");
await page.waitForSelector(".leaflet-container", { timeout: 8000 });
await sleep(800);
const ls = await page.evaluate(() => ({ maps: document.querySelectorAll(".leaflet-container").length, drones: document.querySelectorAll(".map-drone").length }));
console.log("Live stream:", JSON.stringify(ls));

// ---- Incident report map ----
await nav("Log incident");
await page.waitForSelector(".leaflet-container", { timeout: 8000 });
await sleep(800);
const inc = await page.evaluate(() => ({ maps: document.querySelectorAll(".leaflet-container").length, circleMarkers: document.querySelectorAll(".leaflet-overlay-pane path").length }));
console.log("Incident:", JSON.stringify(inc));

await browser.close();
console.log("\n=== ERRORS (" + errors.length + ") ===");
for (const e of errors) console.log(" - " + e);
process.exit(errors.length ? 1 : 0);
