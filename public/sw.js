// Service worker: shows web-push notifications for new appointments.
self.addEventListener("push", (event) => {
  let data = { title: "TorNow", body: "", url: "/admin" };
  try {
    data = { ...data, ...event.data.json() };
  } catch (e) {
    // plain text payload
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.ico",
      dir: "rtl",
      lang: "he",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes("/admin") && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
