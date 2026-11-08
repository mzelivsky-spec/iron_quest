/* Iron Quest – pošťák. Běží v GitHub Actions: každou minutu přečte frontu „pushq“,
   komu co poslat, a rozešle oznámení přes Firebase Cloud Messaging. Klíč je v GitHub secrets.
   LOOP_MIN = kolik minut má běžet ve smyčce (0 = jen jednou). */
import admin from "firebase-admin";
import { readFileSync } from "node:fs";

if (!process.env.FIREBASE_SA) { console.log("Chybí secret FIREBASE_SA – nic neposílám."); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore(), fcm = admin.messaging();

const STALE = 3 * 3600e3, KEEP = 14 * 864e5;
const TZ = "Europe/Prague";
const hourIn = t => +new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(t);
const dateIn = t => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(t); // 2026-11-08
const DEF = { chat: true, react: true, train: true, boss: true, event: true, quiet: true };
const KIND = { chat: "chat", react: "react", train: "train", boss10: "boss", bosskill: "boss", event: "event" };

let NOW = 0, QUIET = false, sent = 0;
const memo = new Map();
const once = (k, f) => memo.has(k) ? memo.get(k) : (memo.set(k, f()), memo.get(k));
const player = pid => once("p" + pid, async () => (await db.doc("players/" + pid).get()).data() || null);
const pushOf = pid => once("q" + pid, async () => (await db.doc("push/" + pid).get()).data() || null);
const members = g => once("g" + g, async () => (await db.collection("players").where("guild", "==", g).get()).docs.map(d => d.id));
const nick = async pid => (await player(pid))?.nick || "Hráč";

const BAD = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);
async function sendTo(pid, kind, m) {
  const pd = await pushOf(pid); if (!pd) return;
  const pr = { ...DEF, ...(pd.prefs || {}) };
  if (!pr[kind] || (pr.quiet && QUIET)) return;
  const tokens = Object.keys(pd.tokens || {}); if (!tokens.length) return;
  const data = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v ?? "")]));
  const res = await fcm.sendEachForMulticast({ tokens, data, webpush: { headers: { Urgency: "high", TTL: "21600" } } });
  sent += res.successCount;
  const dead = res.responses.map((r, i) => r.error && BAD.has(r.error.code) ? tokens[i] : null).filter(Boolean);
  if (dead.length) {
    const left = { ...pd.tokens }; dead.forEach(t => delete left[t]); pd.tokens = left;
    await db.doc("push/" + pid).update({ tokens: left });
    console.log(`odebráno ${dead.length} neplatných zařízení u ${pid}`);
  }
}
async function toGuild(g, except, kind, m) { for (const pid of await members(g)) if (pid !== except) await sendTo(pid, kind, m); }

async function tick() {
NOW = Date.now(); QUIET = hourIn(NOW) >= 22 || hourIn(NOW) < 7; sent = 0; memo.clear();
/* ---- fronta z appky ---- */
const qs = (await db.collection("pushq").where("done", "==", false).get()).docs.sort((a, b) => (a.data().t || 0) - (b.data().t || 0));
const doneIds = [], chats = new Map();
for (const d of qs) {
  const q = d.data(); doneIds.push(d.ref);
  if (NOW - (q.t || 0) > STALE) continue;
  if (q.type === "chat") { const k = q.from + "|" + q.g; chats.set(k, [...(chats.get(k) || []), q]); continue; }
  const who = await nick(q.from);
  if (q.type === "react" && q.to && q.to !== q.from)
    await sendTo(q.to, "react", { title: `${q.e || "🔥"} ${who} reagoval na tvůj trénink`, body: "Ťukni a podívej se do Kroniky.", tag: "react", go: "arena" });
  if (q.type === "train")
    await toGuild(q.g, q.from, "train", { title: `⚔️ ${who} je ve fitku`, body: (q.parts || []).length ? "Dnes " + q.parts.join(" · ").toLowerCase() : "Právě začal trénink.", tag: "train-" + q.from, go: "arena" });
  if (q.type === "boss10") {
    const killed = (await db.doc("pushq/" + d.id.replace(/^boss10_/, "bosskill_")).get()).exists;
    if (!killed) await toGuild(q.g, q.from, "boss", { title: `💀 ${q.b}: zbývá ${q.pct} %`, body: "Kdo dá poslední ránu, bere zlatou truhlu.", tag: "boss-" + q.g, go: "boss" });
  }
  if (q.type === "bosskill")
    await toGuild(q.g, q.from, "boss", { title: `🏆 ${q.b} je poražen!`, body: `Poslední ránu dal ${q.kn || "někdo z party"}.`, tag: "boss-" + q.g, go: "boss" });
}
for (const list of chats.values()) {
  const q = list[list.length - 1], who = await nick(q.from);
  await toGuild(q.g, q.from, "chat", { title: `💬 ${who} v hecovačce`, body: list.length > 1 ? `${q.x} (+${list.length - 1} další)` : q.x, tag: "chat-" + q.g, go: "chat" });
}
for (let i = 0; i < doneIds.length; i += 400) {
  const b = db.batch(); doneIds.slice(i, i + 400).forEach(r => b.update(r, { done: true, sentAt: NOW })); await b.commit();
}

/* ---- začátek eventu: kalendář se čte přímo z appky (index.html) ---- */
try {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const names = Object.fromEntries([...html.matchAll(/(\w+):\{id:"\1", n:"([^"]+)"/g)].map(m => [m[1], m[2]]));
  const EMO = { halloween: "🎃", halloween27: "🎃", krampus: "😈", xmas: "❄️", ny: "🍾", valentyn: "💘", easter: "🐰", witch: "🧹", beach: "🏖️", olymp: "🏅", iron: "🏋️" };
  const today = dateIn(NOW), h = hourIn(NOW);
  for (const m of html.matchAll(/\{id:"(\w+)", n:"([^"]+)", from:D\((\d+),(\d+),(\d+)\), to:D\([^)]*\), boss:"(\w+)"[^\n]*\n[^\n]*\n\s*live:`([^`]+)`/g)) {
    const [, id, n, y, mo, da, boss, live] = m;
    if (`${y}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}` !== today || h < 9 || h >= 22) continue;
    const st = db.doc("pushState/events"), sentEv = (await st.get()).data()?.sent || [];
    if (sentEv.includes(id)) continue;
    await st.set({ sent: [...sentEv, id].slice(-30) });
    const all = (await db.collection("push").get()).docs.map(d => d.id);
    for (const pid of all) await sendTo(pid, "event", { title: `${EMO[id] || "⚔️"} ${n}`, body: `Event začíná! ${names[boss] || "Boss"} ${live}. Do boje!`, tag: "event-" + id, go: "boss" });
    console.log("event", id, "ohlášen");
  }
} catch (e) { console.log("event: ", e.message); }
return { q: qs.length, sent };
}

/* ---- úklid starých záznamů (jednou za běh) ---- */
async function cleanup() {
const NOW = Date.now();
const old = await db.collection("pushq").where("done", "==", true).get();
const rm = old.docs.filter(d => NOW - (d.data().t || 0) > KEEP);
for (let i = 0; i < rm.length; i += 400) { const b = db.batch(); rm.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
return rm.length;
}

const LOOP = +(process.env.LOOP_MIN || 0) * 60e3, EVERY = +(process.env.EVERY_S || 60) * 1e3, START = Date.now();
const stamp = () => new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(Date.now());
console.log(`uklizeno starých: ${await cleanup()}`);
let ticks = 0, total = 0;
do {
  try {
    const r = await tick(); ticks++; total += r.sent;
    if (r.q || r.sent) console.log(`${stamp()} fronta: ${r.q}, odesláno: ${r.sent}, noční klid: ${QUIET}`);
    else if (ticks % 60 === 1) console.log(`${stamp()} běžím, fronta prázdná`);
  } catch (e) { console.log(`${stamp()} chyba: ${e.message}`); }
  if (Date.now() - START + EVERY >= LOOP) break;
  await new Promise(r => setTimeout(r, EVERY));
} while (true);
console.log(`hotovo: ${ticks} kol, odesláno celkem ${total}`);
