// Background Push Notification Service Module (iOS & Android)
// Completely silent and automated in the background — no UI toggles or prompts in app view.

let pushSubscription = null;
let hasAttemptedAutoPrompt = false;

// Convert base64url string to Uint8Array for PushManager subscription
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Save subscription to Firebase Realtime Database
async function savePushSubscriptionToFirebase(subscription) {
  if (!subscription || !window.APP_CONFIG || !window.APP_CONFIG.firebase) return;
  const role = state.role || 'user1';
  const roomId = state.roomId || 'our-secret-space';

  try {
    if (window.firebase && firebase.apps.length) {
      const db = firebase.database();
      const subJson = subscription.toJSON();
      await db.ref(`rooms/${roomId}/push_tokens/${role}`).set({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        updatedAt: Date.now()
      });
    }
  } catch (err) {
    console.error('Failed to save push subscription to DB:', err);
  }
}

// Silent automatic subscription when permission is already granted or on user interaction
async function ensureBackgroundPushSubscription(allowPrompt = false) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return;
  }

  const permission = Notification.permission;

  if (permission === 'denied') {
    return;
  }

  // If not granted yet, only ask for permission when a user gesture allows it
  if (permission !== 'granted') {
    if (!allowPrompt || hasAttemptedAutoPrompt) return;
    try {
      hasAttemptedAutoPrompt = true;
      const res = await Notification.requestPermission();
      if (res !== 'granted') return;
    } catch (e) {
      return;
    }
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let sub = await registration.pushManager.getSubscription();

    const vapidKey = window.APP_CONFIG && window.APP_CONFIG.vapidPublicKey;
    if (!vapidKey) return;

    if (!sub) {
      const convertedKey = urlBase64ToUint8Array(vapidKey);
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });
    }

    pushSubscription = sub;
    await savePushSubscriptionToFirebase(sub);
  } catch (err) {
    console.error('Background push subscription sync error:', err);
  }
}

// Background sync on role change (e.g. User 1 <-> User 2)
async function syncPushRoleChange() {
  if (pushSubscription) {
    await savePushSubscriptionToFirebase(pushSubscription);
  } else {
    await ensureBackgroundPushSubscription(false);
  }
}

function initNotifications() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

  // Check and silently subscribe if already granted
  navigator.serviceWorker.ready.then(() => {
    ensureBackgroundPushSubscription(false);
  });

  // Seamlessly request permission in the background on the user's first natural tap in the app
  const seamlessBgSubscribe = () => {
    ensureBackgroundPushSubscription(true);
    window.removeEventListener('pointerdown', seamlessBgSubscribe);
    window.removeEventListener('keydown', seamlessBgSubscribe);
  };

  if (Notification.permission === 'default') {
    window.addEventListener('pointerdown', seamlessBgSubscribe, { once: true });
    window.addEventListener('keydown', seamlessBgSubscribe, { once: true });
  }
}
