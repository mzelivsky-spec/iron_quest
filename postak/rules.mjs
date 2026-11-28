/* Iron Quest – pravidla databáze. Porovná živá pravidla ve Firebase s firestore.rules v repu
   a při MODE=deploy je nasadí. Klíč je v GitHub secrets. */
import admin from "firebase-admin";
import { readFileSync, writeFileSync } from "node:fs";

if (!process.env.FIREBASE_SA) { console.log("Chybí secret FIREBASE_SA."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const rules = admin.securityRules();
const src = readFileSync("../firestore.rules", "utf8");
const live = await rules.getFirestoreRuleset();
writeFileSync("/tmp/live.rules", live.source[0].content);
console.log("Živá pravidla:", live.name, live.createTime);
if (process.env.MODE === "deploy") {
  const r = await rules.releaseFirestoreRulesetFromSource(src);
  console.log("Nasazeno:", r.name, r.createTime);
}
