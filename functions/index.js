const functions = require('firebase-functions');
const admin = require('firebase-admin');
const webPush = require('web-push');

admin.initializeApp();

// VAPID keys matching the client-side configuration
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BHwTbrXXumIarIOftkyfx49NT0vsLDSbgx5npcHN4YLaQI01htGN42SYZOjkrPD-Rgrk7h9NZC1Qo1dhd0uiQ3Y';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'hIHWo2srspumV57vqt6oV1jRFlAUkDZe_3ECu8IOync';
const VAPID_SUBJECT = 'mailto:support@quicknote.internal';

webPush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

/**
 * Triggered automatically when any message is pushed to /rooms/{roomId}/messages/{msgId}
 * Sends a disguised push notification to the OTHER user (user1 -> user2, user2 -> user1).
 * The notification body NEVER reveals the secret content or sender identity.
 */
exports.onMessageCreated = functions.database
  .ref('/rooms/{roomId}/messages/{msgId}')
  .onCreate(async (snapshot, context) => {
    const msg = snapshot.val();
    if (!msg) return null;

    const roomId = context.params.roomId;
    const sender = msg.sender || 'user1';
    // User1 notifies user2; User2 notifies user1
    const targetUser = (sender === 'user1') ? 'user2' : 'user1';

    console.log(`New message in room [${roomId}] from [${sender}]. Notifying [${targetUser}].`);

    // Fetch the target user's Web Push subscription from Firebase RTDB
    const tokenRef = admin.database().ref(`/rooms/${roomId}/push_tokens/${targetUser}`);
    const tokenSnap = await tokenRef.once('value');

    if (!tokenSnap.exists()) {
      console.log(`No active push subscription token found for [${targetUser}].`);
      return null;
    }

    const subscriptionData = tokenSnap.val();
    if (!subscriptionData || !subscriptionData.endpoint || !subscriptionData.keys) {
      console.log(`Invalid subscription format for [${targetUser}].`);
      return null;
    }

    const pushSubscription = {
      endpoint: subscriptionData.endpoint,
      keys: {
        p256dh: subscriptionData.keys.p256dh,
        auth: subscriptionData.keys.auth
      }
    };

    // Generic disguised payload as required:
    // Notification will show "Quick Note" and "Quick list has an update for you"
    const payload = JSON.stringify({
      title: 'Quick Note',
      body: 'Quick list has an update for you',
      icon: 'icon-192.png',
      badge: 'icon-192.png'
    });

    try {
      await webPush.sendNotification(pushSubscription, payload);
      console.log(`Disguised notification successfully delivered to [${targetUser}].`);
    } catch (err) {
      console.error(`Failed to dispatch web push to [${targetUser}]:`, err);
      // If endpoint is expired or unsubscribed (HTTP 410 or 404), clean up token
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.log(`Subscription for [${targetUser}] has expired. Removing token from database.`);
        await tokenRef.remove();
      }
    }

    return null;
  });

