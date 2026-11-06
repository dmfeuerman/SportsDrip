import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(process.argv[2], "utf8"))) });
const db = getFirestore(); db.settings({ preferRest: true });
const s = await db.collection("moves").get();
console.log("moves docs:", s.size, s.docs.map(d => `${d.id}:${d.get("available")}:${d.get("price")}`).join(" "));
const c = await db.collection("catalog").count().get();
console.log("catalog:", c.data().count);
