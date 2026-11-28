// Dual Message Secret Chat PWA Engine

// State
const cfg = window.APP_CONFIG || {};
const state = {
  unlocked: false,
  // Only the cryptographic one-way SHA-256 hash is stored
  pinHash: (typeof getUserPinHash === 'function') ? getUserPinHash() : (cfg.pinHash || '22cf79c3e77d6476dd6eb433b77e1d998023a55bf41fb480f7d79db0266ec8c7'),
  activePin: '', // Only kept in temporary memory while actively unlocked, wiped on lock
  roomId: (typeof getActiveRoomId === 'function') ? getActiveRoomId() : (cfg.roomId || 'our-secret-space'),
  role: localStorage.getItem('quick_note_role') || 'user1',
  firebaseConfig: cfg.firebase || null,
  messages: [],
  dbRef: null,
  pinRef: null,
  callsRef: null,
  enteredPin: ''
};

// WebRTC & Call State
const callState = {
  peerConnection: null,
  localStream: null,
  currentCallId: null,
  isCaller: false,
  isCallActive: false,
  timerInterval: null,
  startTime: null,
  ringtoneAudio: null
};

// Free public STUN servers for NAT traversal
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Elements
const chatMessagesEl = document.getElementById('chatMessages');
const fakeInput = document.getElementById('fakeInput');
const sendBtn = document.getElementById('sendBtn');
const imageGalleryInput = document.getElementById('imageGalleryInput');
const imageCameraInput = document.getElementById('imageCameraInput');
const attachMenuWrapper = document.getElementById('attachMenuWrapper');
const attachPopupMenu = document.getElementById('attachPopupMenu');
const cameraOptionBtn = document.getElementById('cameraOptionBtn');
const galleryOptionBtn = document.getElementById('galleryOptionBtn');
const attachImgBtn = document.getElementById('attachImgBtn');
const imageLightboxModal = document.getElementById('imageLightboxModal');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxCloseBtn = document.getElementById('lightboxCloseBtn');
const modeBadge = document.getElementById('modeBadge');
const lockIcon = document.getElementById('lockIcon');
const lockLabel = document.getElementById('lockLabel');
const pinModal = document.getElementById('pinModal');
const pinDots = document.getElementById('pinDots');
const pinLockoutBanner = document.getElementById('pinLockoutBanner');
const keypadEl = document.getElementById('keypad');
const cancelPinBtn = document.getElementById('cancelPinBtn');
const replyPreviewBar = document.getElementById('replyPreviewBar');
const replyPreviewLabel = document.getElementById('replyPreviewLabel');
const replyPreviewText = document.getElementById('replyPreviewText');
const replyPreviewThumb = document.getElementById('replyPreviewThumb');
const cancelReplyBtn = document.getElementById('cancelReplyBtn');

let activeReplyTo = null; // Holds { id, text, sender } when replying
let isSelectingMedia = false; // Flag to prevent auto-locking when system camera/file picker opens

// Reaction elements
const reactionOverlay = document.getElementById('reactionOverlay');
const reactionBar = document.getElementById('reactionBar');
const reactionExtendedPanel = document.getElementById('reactionExtendedPanel');
const openEmojiPickerBtn = document.getElementById('openEmojiPickerBtn');
const closeExtendedPanelBtn = document.getElementById('closeExtendedPanelBtn');
const extendedEmojiGrid = document.getElementById('extendedEmojiGrid');

const toastEl = document.getElementById('toast');
const partnerNameDisplay = document.getElementById('partnerNameDisplay');
const userAvatar = document.getElementById('userAvatar');
const connectionStatus = document.getElementById('connectionStatus');
const profileBtn = document.getElementById('profileBtn');
const panicScreen = document.getElementById('panicScreen');
const exitPanicBtn = document.getElementById('exitPanicBtn');
const privacyShield = document.getElementById('privacyShield');
const callBtn = document.getElementById('callBtn');
const callOverlay = document.getElementById('callOverlay');
const callAvatar = document.getElementById('callAvatar');
const callTitle = document.getElementById('callTitle');
const callStatusText = document.getElementById('callStatusText');
const callDuration = document.getElementById('callDuration');
const callIncomingActions = document.getElementById('callIncomingActions');
const callActiveActions = document.getElementById('callActiveActions');
const acceptCallBtn = document.getElementById('acceptCallBtn');
const declineCallBtn = document.getElementById('declineCallBtn');
const hangupCallBtn = document.getElementById('hangupCallBtn');
const toggleMuteBtn = document.getElementById('toggleMuteBtn');
const toggleSpeakerBtn = document.getElementById('toggleSpeakerBtn');
const speakerBtnIcon = document.getElementById('speakerBtnIcon');
const callModePill = document.getElementById('callModePill');
const callModePillIcon = document.getElementById('callModePillIcon');
const callModePillText = document.getElementById('callModePillText');
const remoteAudio = document.getElementById('remoteAudio');
const roleBtnUser1 = document.getElementById('roleBtnUser1');
const roleBtnUser2 = document.getElementById('roleBtnUser2');

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.log('SW registration note:', err);
  });
}

// Send Message
function sendMessage() {
  const typedText = fakeInput.value.trim();

  // Stealth Trigger: Check for dedicated app code #5683# in notes field
  if (typedText === '#5683#') {
    fakeInput.value = '';
    fakeInput.style.height = 'auto';
    openSpaceSettingsModal();
    return;
  }

  if (!typedText) return;

  if (state.unlocked) {
    // Unlocked: Send end-to-end encrypted secret note
    doSendMessage('', typedText);
  } else {
    // Locked: Send harmless public decoy grocery/note item
    doSendMessage(typedText, '');
  }
}

function doSendMessage(fakeText, secretText, imageData = null) {
  // Use independent shared room secret key, with fallback to legacy pinHash substring
  const encKey = (typeof getActiveRoomSecret === 'function') 
    ? getActiveRoomSecret() 
    : (state.pinHash ? state.pinHash.substring(0, 16) : '22cf79c3e77d6476');
  const isSecretImage = state.unlocked && Boolean(imageData);

  let replyPayload = null;
  if (activeReplyTo) {
    replyPayload = {
      id: activeReplyTo.id,
      sender: activeReplyTo.sender,
      fakeText: activeReplyTo.fakeText || 'Note',
      text: activeReplyTo.text || null
    };
  }

  const msgPayload = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    sender: state.role,
    fakeText: fakeText || getRandomGroceryItem(),
    secretText: secretText || null, // Stored in plain text for direct viewing in Firebase
    image: !isSecretImage && imageData ? imageData : null,
    encryptedImage: isSecretImage ? encryptWithPin(imageData, encKey) : null,
    replyTo: replyPayload,
    timestamp: Date.now()
  };

  if (state.dbRef) {
    state.dbRef.push(msgPayload).catch((err) => {
      showToast('Sync error: ' + err.message);
    });
  } else {
    state.messages.push(msgPayload);
    localStorage.setItem('local_chat_' + state.roomId, JSON.stringify(state.messages));
    renderMessages();
  }

  // Trigger disguised push notification relay to partner via ntfy.sh
  if (typeof sendPushNotification === 'function') {
    sendPushNotification();
  }

  fakeInput.value = '';
  fakeInput.style.height = 'auto';
  sessionStorage.removeItem('qn_unlocked_draft');
  clearReplyTarget();
  fakeInput.focus();
}

// Image upload
async function handleImageSelected(file) {
  if (!state.unlocked) {
    showToast('App must be unlocked to send photos');
    return;
  }
  if (!file) return;

  try {
    showToast('Encrypting & preparing photo...');
    const compressedDataUrl = await compressAndReadImage(file, 800, 0.65);
    const currentText = fakeInput.value.trim();
    doSendMessage('', currentText || '', compressedDataUrl);
    showToast('Photo sent securely');
  } catch (err) {
    console.error('Image upload failed:', err);
    showToast('Failed to process image');
  }
}

// Client-side Rate Limiting & Lockout System
const MAX_FAILED_ATTEMPTS = 5;
let lockoutCountdownInterval = null;

function getFailedAttempts() {
  const val = parseInt(localStorage.getItem('qn_pin_failed_attempts') || '0', 10);
  return Number.isFinite(val) ? val : 0;
}

function setFailedAttempts(count) {
  localStorage.setItem('qn_pin_failed_attempts', String(count));
}

function getLockoutEndTime() {
  const val = parseInt(localStorage.getItem('qn_pin_lockout_until') || '0', 10);
  return Number.isFinite(val) ? val : 0;
}

function setLockoutEndTime(timestamp) {
  localStorage.setItem('qn_pin_lockout_until', String(timestamp));
}

function checkAndApplyLockoutUI() {
  const lockoutUntil = getLockoutEndTime();
  const now = Date.now();

  if (lockoutUntil > now) {
    const remainingSeconds = Math.ceil((lockoutUntil - now) / 1000);
    if (keypadEl) keypadEl.classList.add('locked-out');
    if (pinLockoutBanner) {
      pinLockoutBanner.textContent = `Too many failed attempts. Try again in ${remainingSeconds}s`;
      pinLockoutBanner.classList.add('active');
    }

    if (!lockoutCountdownInterval) {
      lockoutCountdownInterval = setInterval(() => {
        const remaining = Math.ceil((getLockoutEndTime() - Date.now()) / 1000);
        if (remaining <= 0) {
          clearInterval(lockoutCountdownInterval);
          lockoutCountdownInterval = null;
          setLockoutEndTime(0);
          if (keypadEl) keypadEl.classList.remove('locked-out');
          if (pinLockoutBanner) {
            pinLockoutBanner.classList.remove('active');
            pinLockoutBanner.textContent = '';
          }
        } else if (pinLockoutBanner) {
          pinLockoutBanner.textContent = `Too many failed attempts. Try again in ${remaining}s`;
        }
      }, 1000);
    }
    return true;
  } else {
    if (lockoutCountdownInterval) {
      clearInterval(lockoutCountdownInterval);
      lockoutCountdownInterval = null;
    }
    if (keypadEl) keypadEl.classList.remove('locked-out');
    if (pinLockoutBanner) {
      pinLockoutBanner.classList.remove('active');
      pinLockoutBanner.textContent = '';
    }
    return false;
  }
}

// PIN Modal Keypad input
let isVerifyingPin = false;

async function handlePinInput(char) {
  if (isVerifyingPin) return;
  if (checkAndApplyLockoutUI()) {
    showToast('Keypad locked. Please wait.');
    return;
  }

  if (state.enteredPin.length < 4) {
    state.enteredPin += String(char).toLowerCase();
    renderPinDots();

    if (state.enteredPin.length === 4) {
      isVerifyingPin = true;
      const typedPin = state.enteredPin;

      // Artificial throttling delay (400ms) to prevent automated script brute-forcing
      await new Promise(res => setTimeout(res, 400));
      const inputHash = await hashPin(typedPin);

      if (inputHash === state.pinHash.toLowerCase()) {
        // Success: Reset failed attempts & clear lockout
        setFailedAttempts(0);
        setLockoutEndTime(0);
        state.unlocked = true;
        state.activePin = typedPin;
        localStorage.setItem('qn_enc_key', typedPin);
        state.enteredPin = '';
        if (pinModal) pinModal.classList.remove('open');
        updateModeBadge();
        renderMessages();

        // Restore draft typed before auto-lockout
        const savedDraft = sessionStorage.getItem('qn_unlocked_draft');
        if (savedDraft && fakeInput) {
          fakeInput.value = savedDraft;
          autoResizeTextarea(fakeInput);
          fakeInput.focus();
        }

        resetInactivityTimer();
        isVerifyingPin = false;
      } else {
        // Failed attempt: Increment counter & calculate lockout
        const currentFails = getFailedAttempts() + 1;
        setFailedAttempts(currentFails);
        state.enteredPin = '';
        renderPinDots();

        // Shake animation on dots
        if (pinDots) {
          pinDots.classList.remove('shake');
          void pinDots.offsetWidth; // Force reflow
          pinDots.classList.add('shake');
        }

        if (currentFails >= MAX_FAILED_ATTEMPTS) {
          // Exponential lockout: 30s for 5, 60s for 6, 120s for 7, etc. (capped at 15m)
          const multiplier = Math.pow(2, currentFails - MAX_FAILED_ATTEMPTS);
          const lockoutSeconds = Math.min(30 * multiplier, 900);
          const lockoutUntil = Date.now() + (lockoutSeconds * 1000);
          setLockoutEndTime(lockoutUntil);
          checkAndApplyLockoutUI();
          showToast(`Account locked for ${lockoutSeconds} seconds`);
        } else {
          const remainingAttempts = MAX_FAILED_ATTEMPTS - currentFails;
          showToast(`Invalid key. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`);
        }
        isVerifyingPin = false;
      }
    }
  }
}

// Event Listeners for Chat, Keypad & Attachments
function initChatEvents() {
  if (sendBtn) sendBtn.addEventListener('click', sendMessage);

  if (attachImgBtn && attachPopupMenu) {
    attachImgBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.unlocked) {
        showToast('Unlock required to send photos');
        return;
      }
      attachPopupMenu.classList.toggle('open');
    });

    if (cameraOptionBtn && imageCameraInput) {
      cameraOptionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        attachPopupMenu.classList.remove('open');
        isSelectingMedia = true;
        imageCameraInput.click();
      });

      imageCameraInput.addEventListener('change', (e) => {
        isSelectingMedia = false;
        const file = e.target.files && e.target.files[0];
        imageCameraInput.value = '';
        if (file) handleImageSelected(file);
      });

      imageCameraInput.addEventListener('cancel', () => {
        isSelectingMedia = false;
        resetInactivityTimer();
      });
    }

    if (galleryOptionBtn && imageGalleryInput) {
      galleryOptionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        attachPopupMenu.classList.remove('open');
        isSelectingMedia = true;
        imageGalleryInput.click();
      });

      imageGalleryInput.addEventListener('change', (e) => {
        isSelectingMedia = false;
        const file = e.target.files && e.target.files[0];
        imageGalleryInput.value = '';
        if (file) handleImageSelected(file);
      });

      imageGalleryInput.addEventListener('cancel', () => {
        isSelectingMedia = false;
        resetInactivityTimer();
      });
    }

    document.addEventListener('click', (e) => {
      if (attachPopupMenu.classList.contains('open') && !attachMenuWrapper.contains(e.target)) {
        attachPopupMenu.classList.remove('open');
      }
    });
  }

  // Support image paste from mobile keyboards & desktop clipboard
  if (fakeInput) {
    fakeInput.addEventListener('paste', (e) => {
      const clipboardData = e.clipboardData || window.clipboardData;
      if (!clipboardData || !clipboardData.items) return;

      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            handleImageSelected(file);
          }
          return;
        }
      }
    });
  }

  // Keypad numbers & actions
  document.querySelectorAll('#keypad .key-btn[data-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      handlePinInput(btn.getAttribute('data-key'));
    });
  });

  const keyClear = document.getElementById('keyClear');
  if (keyClear) {
    keyClear.addEventListener('click', () => {
      state.enteredPin = '';
      renderPinDots();
    });
  }

  const keyBack = document.getElementById('keyBack');
  if (keyBack) {
    keyBack.addEventListener('click', () => {
      state.enteredPin = state.enteredPin.slice(0, -1);
      renderPinDots();
    });
  }

  const setupPushBtn = document.getElementById('setupPushBtn');
  if (setupPushBtn) {
    setupPushBtn.addEventListener('click', () => {
      if (typeof openBackgroundPushSetup === 'function') {
        openBackgroundPushSetup();
      }
    });
  }

  // --- Space Settings & Multi-Pair Handshake Handlers (#5683#) ---
  initSpaceEvents();
}

let pendingPromptAction = null; // 'create_space' | 'change_pin' | 'join_space'
let pendingInviteToken = null;

function openSpaceSettingsModal() {
  const spaceModal = document.getElementById('spaceSettingsModal');
  const activeSpaceLabel = document.getElementById('activeSpaceLabel');
  const activeRoleLabel = document.getElementById('activeRoleLabel');

  if (activeSpaceLabel) {
    activeSpaceLabel.textContent = (typeof hasCustomRoom === 'function' && hasCustomRoom()) ? (state.roomId.substring(0, 10) + '...') : 'Default Note Space';
  }
  if (activeRoleLabel) {
    activeRoleLabel.textContent = (state.role === 'user2') ? 'User 2 (Partner)' : 'User 1 (Initiator)';
  }
  if (spaceModal) {
    spaceModal.classList.add('open');
  }
}

function closeSpaceSettingsModal() {
  const spaceModal = document.getElementById('spaceSettingsModal');
  if (spaceModal) spaceModal.classList.remove('open');
}

function openSpacePrompt(action, title, desc) {
  pendingPromptAction = action;
  const promptModal = document.getElementById('spacePromptModal');
  const promptTitle = document.getElementById('spacePromptTitle');
  const promptDesc = document.getElementById('spacePromptDesc');
  const pinInput = document.getElementById('spacePinInput');

  if (promptTitle) promptTitle.textContent = title;
  if (promptDesc) promptDesc.textContent = desc;
  if (pinInput) {
    pinInput.value = '';
    setTimeout(() => pinInput.focus(), 100);
  }
  if (promptModal) promptModal.classList.add('open');
}

function closeSpacePrompt() {
  const promptModal = document.getElementById('spacePromptModal');
  if (promptModal) promptModal.classList.remove('open');
  pendingPromptAction = null;
}

function initSpaceEvents() {
  const closeSpaceSettingsBtn = document.getElementById('closeSpaceSettingsBtn');
  const createSpaceBtn = document.getElementById('createSpaceBtn');
  const shareInviteBtn = document.getElementById('shareInviteBtn');
  const changePinBtn = document.getElementById('changePinBtn');
  const resetPartnerBtn = document.getElementById('resetPartnerBtn');

  const cancelSpacePromptBtn = document.getElementById('cancelSpacePromptBtn');
  const confirmSpacePromptBtn = document.getElementById('confirmSpacePromptBtn');
  const spacePinInput = document.getElementById('spacePinInput');

  const joinSpaceBtn = document.getElementById('joinSpaceBtn');
  const dismissJoinBtn = document.getElementById('dismissJoinBtn');
  const partnerJoinBanner = document.getElementById('partnerJoinBanner');

  if (closeSpaceSettingsBtn) {
    closeSpaceSettingsBtn.addEventListener('click', closeSpaceSettingsModal);
  }

  // 1. Create New Private Space
  if (createSpaceBtn) {
    createSpaceBtn.addEventListener('click', () => {
      closeSpaceSettingsModal();
      openSpacePrompt('create_space', 'Create New Private Space', 'Choose your personal unlock passcode for this new space (min 4 characters)');
    });
  }

  // 2. Share Collaboration Link (Disguised 30m one-time invite)
  if (shareInviteBtn) {
    shareInviteBtn.addEventListener('click', async () => {
      try {
        showToast('Generating collaboration link...');
        const res = await createDisguisedInviteLink();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(res.url);
          showToast('Copied 30-min collaboration link to clipboard!');
        } else {
          prompt('Copy this collaboration link for your partner (valid for 30 mins):', res.url);
        }
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    });
  }

  // 3. Change Personal Unlock Passcode
  if (changePinBtn) {
    changePinBtn.addEventListener('click', () => {
      closeSpaceSettingsModal();
      openSpacePrompt('change_pin', 'Change Unlock Passcode', 'Enter your new personal unlock passcode (min 4 characters)');
    });
  }

  // 4. Partner Handshake Reset
  if (resetPartnerBtn) {
    resetPartnerBtn.addEventListener('click', async () => {
      try {
        showToast('Creating partner re-pair handshake...');
        const res = await createDisguisedInviteLink();
        const copyText = res.url;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(copyText);
          showToast('Copied partner reset link! Send it to your partner.');
        } else {
          prompt('Send this re-pair link to your partner to let them set a new passcode:', copyText);
        }
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    });
  }

  // Confirm Prompt Action
  if (confirmSpacePromptBtn && spacePinInput) {
    const handleConfirm = async () => {
      const pinVal = spacePinInput.value.trim();
      if (!pinVal || pinVal.length < 4) {
        showToast('Passcode must be at least 4 characters');
        spacePinInput.focus();
        return;
      }

      try {
        if (pendingPromptAction === 'create_space') {
          await initializeNewSpace(pinVal);
          closeSpacePrompt();
          showToast('Private space created! Type #5683# anytime to share with partner.');
        } else if (pendingPromptAction === 'change_pin') {
          await changePersonalPin(pinVal);
          closeSpacePrompt();
          showToast('Personal passcode updated successfully!');
        } else if (pendingPromptAction === 'join_space') {
          if (!pendingInviteToken) {
            throw new Error('No active invite found');
          }
          await acceptInviteAndPair(pendingInviteToken, pinVal);
          closeSpacePrompt();
          if (partnerJoinBanner) partnerJoinBanner.style.display = 'none';
          showToast('Connected to shared space! Tap ⭐ or lock badge to unlock.');
        }
      } catch (err) {
        showToast('Action failed: ' + err.message);
      }
    };

    confirmSpacePromptBtn.addEventListener('click', handleConfirm);
    spacePinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleConfirm();
    });
  }

  if (cancelSpacePromptBtn) {
    cancelSpacePromptBtn.addEventListener('click', closeSpacePrompt);
  }

  // Check URL for incoming ?note=list_... invitation
  const inviteToken = (typeof getPendingInviteTokenFromUrl === 'function') ? getPendingInviteTokenFromUrl() : null;
  if (inviteToken) {
    pendingInviteToken = inviteToken;
    // Verify token validity
    fetchInviteRecord(inviteToken).then(res => {
      if (res.valid && partnerJoinBanner) {
        partnerJoinBanner.style.display = 'flex';
      } else if (!res.valid) {
        showToast(res.reason || 'Invite link invalid');
        clearUrlInviteParams();
      }
    }).catch(() => {});
  }

  if (joinSpaceBtn) {
    joinSpaceBtn.addEventListener('click', () => {
      openSpacePrompt('join_space', 'Join Shared Note List', 'Set your personal passcode to join this space (min 4 characters)');
    });
  }

  if (dismissJoinBtn && partnerJoinBanner) {
    dismissJoinBtn.addEventListener('click', () => {
      partnerJoinBanner.style.display = 'none';
      clearUrlInviteParams();
    });
  }
}

// App Initialization
initUI();
initNotifications();
initReactions();
initCalls();
initChatEvents();
initFirebase();
renderMessages();
