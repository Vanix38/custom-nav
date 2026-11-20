// Preload des messageries (WhatsApp, Discord). N'expose qu'une seule fonction
// à la page : prévenir le navigateur qu'une notification a été cliquée, pour
// ramener la fenêtre et ouvrir le bon panneau.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__customNavMessenger', {
  notificationClicked: () => ipcRenderer.send('messenger:notification-click'),
});

// Enveloppe `Notification` (dans la page elle-même, avant ses scripts) pour
// savoir quand l'utilisateur clique sur une notification. Le reste du
// comportement est inchangé : la page reçoit aussi le clic.
try {
  contextBridge.executeInMainWorld({
    func: () => {
      const Native = window.Notification;
      if (typeof Native !== 'function') return;
      class CustomNavNotification extends Native {
        constructor(title, options) {
          super(title, options);
          this.addEventListener('click', () => {
            try {
              window.__customNavMessenger.notificationClicked();
            } catch {
              /* ignoré */
            }
          });
        }
      }
      Object.defineProperty(CustomNavNotification, 'name', { value: 'Notification' });
      window.Notification = CustomNavNotification;
    },
  });
} catch {
  /* ancienne version d'Electron : les notifications marchent, sans le retour au panneau */
}
