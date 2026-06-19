// Without a backend, verify the real auth gate behaves: unauthenticated "/"
// redirects to /login.html, and the login form renders (no JS crashes).
import puppeteer from "puppeteer-core";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://127.0.0.1:5173";
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|net::ERR/i.test(m.text())) errors.push("console.error: " + m.text()); });

await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 30000 });
await sleep(800);
console.log("unauth / →", new URL(page.url()).pathname);

await page.goto(BASE + "/login.html", { waitUntil: "networkidle2" });
await sleep(500);
const hasForm = await page.$("#login-form") ? true : false;
const title = await page.$eval("#page-title", (e) => e.textContent).catch(() => "(none)");
console.log("login.html form present:", hasForm, "· title:", title);

await page.goto(BASE + "/admin-login.html", { waitUntil: "networkidle2" });
await sleep(500);
const hasAdminForm = await page.$("#login-form") ? true : false;
console.log("admin-login.html form present:", hasAdminForm);

await browser.close();
console.log("\n=== ERRORS (" + errors.length + ") ===");
for (const e of errors) console.log(" - " + e);
process.exit(errors.length ? 1 : 0);
