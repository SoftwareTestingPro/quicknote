// Push Notification Service Module using free public relay (ntfy.sh)
// Zero accounts, zero configuration, zero cost.
// Disguised notifications: Never exposes private messages or sender identity.

let ntfyEventSource = null;
let currentListenTopic = null;

// Generate topic name for a given room and user role
function getNtfyTopic(roomId, role) {
  const safeRoom = (roomId || 'our-secret-space').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const safeRole = role || 'user1';
  return `qn_${safeRoom}_${safeRole}`;
}

// Get the topic this device listens to
function getMyTopic() {
  const roomId = state.roomId || 'our-secret-space';
  const role = state.role || 'user1';
  return getNtfyTopic(roomId, role);
}

// Get the partner's topic to send notifications to
function getPartnerTopic() {
  const roomId = state.roomId || 'our-secret-space';
  const role = state.role || 'user1';
  const partnerRole = role === 'user1' ? 'user2' : 'user1';
  return getNtfyTopic(roomId, partnerRole);
}

// Helper to resolve the correct app URL (production domain preferred over localhost)
function getAppUrl() {
  const origin = window.location.origin;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    // If tested on localhost, direct notifications to the public production URL
    return 'https://quicknote.futurelab.co.in/';
  }
  return origin + window.location.pathname;
}

// Send disguised push notification to partner via ntfy.sh public relay
async function sendPushNotification() {
  try {
    const topic = getPartnerTopic();
    const appUrl = getAppUrl();

    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      body: 'Quick list has an update for you',
      headers: {
        'Title': 'Quick Note',
        'Priority': 'high',
        'Tags': 'memo',
        'Click': appUrl
      }
    });
  } catch (err) {
    // Non-blocking fallback; ignore network glitches
    console.warn('Failed to send push notification relay:', err);
  }
}

// Display native disguised notification if app is hidden/backgrounded
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
      url: getAppUrl()
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

// Connect to SSE stream for immediate notification when app is in tab or background
function connectNtfyStream() {
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
          // If the app is currently hidden (user on home screen or another tab), show notification
          if (document.hidden) {
            showDisguisedNotification();
          }
        }
      } catch (e) {}
    };

    ntfyEventSource.onerror = () => {
      // Auto-reconnect managed by EventSource
    };
  } catch (err) {
    console.warn('EventSource connection error:', err);
  }
}

// Open ntfy 1-click web push subscriber for OS background push when app is completely closed
function openBackgroundPushSetup() {
  const topic = getMyTopic();
  const url = `https://ntfy.sh/${topic}`;
  window.open(url, '_blank');
}

// Request permission and start listener
async function initNotifications() {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    // Request permission gracefully on first interaction
    const requestPerm = async () => {
      try {
        await Notification.requestPermission();
      } catch (e) {}
      window.removeEventListener('pointerdown', requestPerm);
      window.removeEventListener('keydown', requestPerm);
      connectNtfyStream();
    };
    window.addEventListener('pointerdown', requestPerm, { once: true });
    window.addEventListener('keydown', requestPerm, { once: true });
  } else {
    connectNtfyStream();
  }
}

// Handle role switches (user1 <-> user2)
function syncPushRoleChange() {
  connectNtfyStream();
}
