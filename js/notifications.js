// Push Notification Service Module
// Zero accounts, zero cost, completely free.
// Uses Web Push Protocol + high-priority notification delivery with standard PWA integration.
// Disguised notifications: Never exposes private messages or sender identity.

let ntfyEventSource = null;
let currentListenTopic = null;

// Determine stable public application root URL for PWA standalone launching
function getAppUrl() {
  const origin = window.location.origin;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return 'https://quicknote.futurelab.co.in/';
  }
  return origin + '/';
}

// Generate topic name for a given room and user role
function getNtfyTopic(roomId, role) {
  const safeRoom = (roomId || 'our-secret-space').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const safeRole = role || 'user1';
  return `qn_${safeRoom}_${safeRole}`;
}

// Topic this device listens to
function getMyTopic() {
  const roomId = state.roomId || 'our-secret-space';
  const role = state.role || 'user1';
  return getNtfyTopic(roomId, role);
}

// Partner's topic to send notifications to
function getPartnerTopic() {
  const roomId = state.roomId || 'our-secret-space';
  const role = state.role || 'user1';
  const partnerRole = role === 'user1' ? 'user2' : 'user1';
  return getNtfyTopic(roomId, partnerRole);
}

// Send disguised push notification to partner
// Sends click target and view action to instruct Android/iOS PWA to capture and focus standalone app
async function sendPushNotification() {
  try {
    const topic = getPartnerTopic();
    const appUrl = getAppUrl();

    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      body: 'Quick list has an update for you',
      headers: {
        'Title': 'Quick Note',
        'Priority': 'urgent',
        'Tags': 'memo',
        'Click': appUrl,
        'Actions': `view, Open Note, ${appUrl}, clear=true`
      }
    });
  } catch (err) {
    console.warn('Failed to dispatch notification relay:', err);
  }
}

// Display native disguised notification directly through our own Service Worker
function showDisguisedNotification() {
  if (Notification.permission !== 'granted') return;

  const title = 'Quick Note';
  const options = {
    body: 'Quick list has an update for you',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'quick-note-update',
    renotify: true,
    vibrate: [150, 80, 150],
    data: {
      url: '/'
    }
  };

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, options);
    }).catch(() => {
      try { new Notification(title, options); } catch (e) {}
    });
  } else {
    try {
      new Notification(title, options);
    } catch (e) {}
  }
}

// Connect to high-priority stream when app is foregrounded or backgrounded
function connectNotificationStream() {
  const topic = getMyTopic();
  if (ntfyEventSource && currentListenTopic === topic) return;

  if (ntfyEventSource) {
    try { ntfyEventSource.close(); } catch (e) {}
    ntfyEventSource = null;
  }

  currentListenTopic = topic;

  try {
    ntfyEventSource = new EventSource(`https://ntfy.sh/${topic}/sse`);
    ntfyEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'message') {
          // If the app is hidden or backgrounded, display disguised notification through SW
          if (document.hidden) {
            showDisguisedNotification();
          }
        }
      } catch (e) {}
    };

    ntfyEventSource.onerror = () => {
      // Automatic reconnection handled by browser EventSource
    };
  } catch (err) {
    console.warn('EventSource listener error:', err);
  }
}

// Initialize notification permissions and listener
async function initNotifications() {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    const requestPerm = async () => {
      try {
        await Notification.requestPermission();
      } catch (e) {}
      window.removeEventListener('pointerdown', requestPerm);
      window.removeEventListener('keydown', requestPerm);
      connectNotificationStream();
    };
    window.addEventListener('pointerdown', requestPerm, { once: true });
    window.addEventListener('keydown', requestPerm, { once: true });
  } else if (Notification.permission === 'granted') {
    connectNotificationStream();
  }
}

// Synchronize notification topic when user role switches (user1 <-> user2)
function syncPushRoleChange() {
  connectNotificationStream();
}

// 1-Click setup for OS-level background push when app is completely closed
async function openBackgroundPushSetup() {
  try {
    if ('Notification' in window && Notification.permission !== 'granted') {
      await Notification.requestPermission();
    }
  } catch (e) {}

  const topic = getMyTopic();
  const url = `https://ntfy.sh/${topic}`;
  window.open(url, '_blank');
}
