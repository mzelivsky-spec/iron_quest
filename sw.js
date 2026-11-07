/* Iron Quest – service worker: jen zobrazuje oznámení od pošťáka a otevírá appku. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || j || {}; } catch (_) {}
  const title = d.title || "Iron Quest";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "icon-192.png",
    badge: "badge-96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: {go: d.go || ""}
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const go = (e.notification.data && e.notification.data.go) || "";
  const url = new URL("./" + (go ? "?go=" + go : ""), self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    for (const c of all) { if ("focus" in c) { try { await c.navigate(url); } catch (_) {} return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
