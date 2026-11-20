// O S.I.V.E. não é mais instalável. Este arquivo existe só para limpar navegadores que já tinham registrado
// a versão antiga: apaga as cópias guardadas e se desliga. Não guarda nada.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const nome of await caches.keys()) await caches.delete(nome);
  await self.registration.unregister();
})()));
