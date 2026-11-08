/* Iron Quest – zkušební oznámení. Pošle jedno oznámení vybranému hráči (podle přezdívky),
   i v nočním klidu a bez ohledu na jeho nastavení. Spouští se ručně v GitHub → Actions. */
import admin from "firebase-admin";

if (!process.env.FIREBASE_SA) { console.log("Chybí secret FIREBASE_SA."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore(), fcm = admin.messaging();
const NICK = (process.env.KOMU || "MilusPCZ").trim().toLowerCase();

const pl = (await db.collection("players").get()).docs.find(d => (d.data().nick || "").trim().toLowerCase() === NICK);
if (!pl) { console.log(`Hráč „${process.env.KOMU}“ nenalezen.`); process.exit(1); }
const pd = (await db.doc("push/" + pl.id).get()).data();
const tokens = Object.keys(pd?.tokens || {});
if (!tokens.length) { console.log(`${pl.data().nick} nemá zapnutá oznámení na žádném zařízení.`); process.exit(1); }
const time = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" }).format(Date.now());
const res = await fcm.sendEachForMulticast({ tokens,
  data: { title: "🔔 Zkušební oznámení", body: `Pošťák funguje (${time}). Ťukni a otevře se hecovačka.`, tag: "test", go: "chat" },
  webpush: { headers: { Urgency: "high", TTL: "3600" } } });
console.log(`${pl.data().nick}: zařízení ${tokens.length}, doručeno ${res.successCount}`);
res.responses.forEach((r, i) => r.error && console.log(`  zařízení ${i + 1}: ${r.error.code}`));
if (!res.successCount) process.exit(1);
