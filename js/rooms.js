// Room Management, Invitation & Handshake Reset Module
// Plausible Deniability Architecture for Multi-Pair Users

const ROOM_STORAGE_KEY = 'qn_custom_room_id';
const ROOM_SECRET_KEY = 'qn_room_secret_key';
const USER_PIN_HASH_KEY = 'qn_user_pin_hash';
const DEFAULT_FALLBACK_ROOM = (window.APP_CONFIG && window.APP_CONFIG.roomId) || 'our-secret-space';
const DEFAULT_FALLBACK_PIN_HASH = (window.APP_CONFIG && window.APP_CONFIG.pinHash) || '22cf79c3e77d6476dd6eb433b77e1d998023a55bf41fb480f7d79db0266ec8c7';

// Generate cryptographically secure random alphanumeric string
function generateSecureId(prefix = '', length = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  let result = prefix;
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

// Get active room ID (defaults to saved custom room or default fallback)
function getActiveRoomId() {
  return localStorage.getItem(ROOM_STORAGE_KEY) || DEFAULT_FALLBACK_ROOM;
}

// Get active room shared encryption secret
function getActiveRoomSecret() {
  return localStorage.getItem(ROOM_SECRET_KEY) || (window.APP_CONFIG && window.APP_CONFIG.pinHash ? window.APP_CONFIG.pinHash.substring(0, 16) : '22cf79c3e77d6476');
}

// Get user's local PIN hash (defaults to configured fallback pinHash)
function getUserPinHash() {
  return localStorage.getItem(USER_PIN_HASH_KEY) || DEFAULT_FALLBACK_PIN_HASH;
}

// Save user's local PIN hash
function saveUserPinHash(hash) {
  localStorage.setItem(USER_PIN_HASH_KEY, hash);
  state.pinHash = hash;
}

// Check if user has initialized or joined a custom room
function hasCustomRoom() {
  return Boolean(localStorage.getItem(ROOM_STORAGE_KEY));
}

// Initialize a brand new private space (User 1 initiator)
async function initializeNewSpace(personalPin) {
  if (!personalPin || personalPin.length < 4) {
    throw new Error('Passcode must be at least 4 characters');
  }

  const newRoomId = generateSecureId('rm_', 16);
  const newRoomSecret = generateSecureId('', 24);
  const pinHash = await hashPin(personalPin);

  // Store locally
  localStorage.setItem(ROOM_STORAGE_KEY, newRoomId);
  localStorage.setItem(ROOM_SECRET_KEY, newRoomSecret);
  localStorage.setItem(USER_PIN_HASH_KEY, pinHash);
  localStorage.setItem('quick_note_role', 'user1');

  // Update in-memory state
  state.roomId = newRoomId;
  state.role = 'user1';
  state.pinHash = pinHash;
  state.activePin = personalPin;

  // Initialize Firebase listeners for new room
  if (typeof initFirebase === 'function') {
    initFirebase();
  }
  if (typeof syncPushRoleChange === 'function') {
    syncPushRoleChange();
  }

  return { roomId: newRoomId, roomSecret: newRoomSecret };
}

// Create a disguised 30-minute one-time collaboration link
async function createDisguisedInviteLink() {
  if (!window.firebase || !firebase.apps.length) {
    throw new Error('Database not connected. Please check connection.');
  }

  const roomId = getActiveRoomId();
  const roomSecret = getActiveRoomSecret();
  const db = firebase.database();
  const inviteToken = generateSecureId('list_', 12);
  const now = Date.now();
  const expiresAt = now + (30 * 60 * 1000); // 30 minutes

  const inviteData = {
    roomId: roomId,
    roomSecret: roomSecret,
    creatorRole: state.role || 'user1',
    createdAt: now,
    expiresAt: expiresAt,
    claimed: false
  };

  await db.ref('invites/' + inviteToken).set(inviteData);

  // Build disguised URL
  const origin = window.location.origin;
  const baseUrl = (origin.includes('localhost') || origin.includes('127.0.0.1'))
    ? 'https://quicknote.futurelab.co.in/'
    : origin + window.location.pathname;

  const cleanBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const shareableUrl = `${cleanBase}?note=${inviteToken}`;

  return {
    url: shareableUrl,
    token: inviteToken,
    expiresAt: expiresAt
  };
}

// Inspect if current URL contains an invite token (?note=...)
function getPendingInviteTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const noteParam = params.get('note');
  if (noteParam && noteParam.startsWith('list_')) {
    return noteParam;
  }
  return null;
}

// Clean URL query params without triggering page reload
function clearUrlInviteParams() {
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
}

// Fetch invite record from Firebase
async function fetchInviteRecord(token) {
  if (!window.firebase || !firebase.apps.length) {
    if (window.APP_CONFIG && window.APP_CONFIG.firebase) {
      if (!firebase.apps.length) firebase.initializeApp(window.APP_CONFIG.firebase);
    }
  }
  const db = firebase.database();
  const snap = await db.ref('invites/' + token).once('value');
  if (!snap.exists()) {
    return { valid: false, reason: 'This list link is invalid or no longer exists.' };
  }

  const data = snap.val();
  if (data.claimed) {
    return { valid: false, reason: 'This shared list has already been joined.' };
  }

  if (Date.now() > data.expiresAt) {
    return { valid: false, reason: 'This shared list invitation has expired (30-minute limit).' };
  }

  return { valid: true, data: data };
}

// Accept invite & connect Partner (User 2) with their own personal PIN
async function acceptInviteAndPair(token, personalPin) {
  if (!personalPin || personalPin.length < 4) {
    throw new Error('Passcode must be at least 4 characters');
  }

  const check = await fetchInviteRecord(token);
  if (!check.valid) {
    throw new Error(check.reason);
  }

  const inviteData = check.data;
  const db = firebase.database();

  // Atomically claim the invite token so it can never be used again
  await db.ref('invites/' + token + '/claimed').set(true);
  await db.ref('invites/' + token + '/claimedAt').set(Date.now());

  // Determine partner role (opposite of creator)
  const myRole = inviteData.creatorRole === 'user1' ? 'user2' : 'user1';
  const pinHash = await hashPin(personalPin);

  // Store room and independent personal PIN locally
  localStorage.setItem(ROOM_STORAGE_KEY, inviteData.roomId);
  localStorage.setItem(ROOM_SECRET_KEY, inviteData.roomSecret);
  localStorage.setItem(USER_PIN_HASH_KEY, pinHash);
  localStorage.setItem('quick_note_role', myRole);

  // Update in-memory state
  state.roomId = inviteData.roomId;
  state.role = myRole;
  state.pinHash = pinHash;
  state.activePin = personalPin;

  // Clean URL
  clearUrlInviteParams();

  // Re-initialize database sync & notifications
  if (typeof initFirebase === 'function') {
    initFirebase();
  }
  if (typeof syncPushRoleChange === 'function') {
    syncPushRoleChange();
  }

  return { roomId: inviteData.roomId, role: myRole };
}

// Update local PIN (does not change room secret or disrupt encryption)
async function changePersonalPin(newPin) {
  if (!newPin || newPin.length < 4) {
    throw new Error('New passcode must be at least 4 characters');
  }
  const pinHash = await hashPin(newPin);
  saveUserPinHash(pinHash);
  state.activePin = newPin;
}

// Reset/wipe local space data on this device
function wipeLocalSpaceData() {
  localStorage.removeItem(ROOM_STORAGE_KEY);
  localStorage.removeItem(ROOM_SECRET_KEY);
  localStorage.removeItem(USER_PIN_HASH_KEY);
  localStorage.removeItem('qn_enc_key');
  state.roomId = DEFAULT_FALLBACK_ROOM;
  state.pinHash = DEFAULT_FALLBACK_PIN_HASH;
  state.activePin = '';
  state.unlocked = false;
  if (typeof initFirebase === 'function') {
    initFirebase();
  }
  if (typeof renderMessages === 'function') {
    renderMessages();
  }
  if (typeof updateModeBadge === 'function') {
    updateModeBadge();
  }
}
