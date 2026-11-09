// Dual Message Secret Chat PWA Engine

// State
const cfg = window.APP_CONFIG || {};
const state = {
  unlocked: false,
  // Only the cryptographic one-way SHA-256 hash is stored
  pinHash: cfg.pinHash || '22cf79c3e77d6476dd6eb433b77e1d998023a55bf41fb480f7d79db0266ec8c7',
  activePin: '', // Only kept in temporary memory while actively unlocked, wiped on lock
  roomId: cfg.roomId || 'our-secret-space',
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
const secretInput = document.getElementById('secretInput');
const secretInputWrapper = document.getElementById('secretInputWrapper');
const toggleSecretBtn = document.getElementById('toggleSecretBtn');
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
const cancelPinBtn = document.getElementById('cancelPinBtn');
const replyPreviewBar = document.getElementById('replyPreviewBar');
const replyPreviewLabel = document.getElementById('replyPreviewLabel');
const replyPreviewText = document.getElementById('replyPreviewText');
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
  if (state.unlocked) {
    const noteText = fakeInput.value.trim();
    if (!noteText) return;
    doSendMessage('', noteText);
    return;
  }

  const fakeText = fakeInput.value.trim();
  const secretText = secretInput.value.trim();

  if (!fakeText && !secretText) return;

  doSendMessage(fakeText, secretText);
}

function doSendMessage(fakeText, secretText, imageData = null) {
  const encKey = state.pinHash ? state.pinHash.substring(0, 16) : '22cf79c3e77d6476';
  const isSecretImage = state.unlocked && Boolean(imageData);

  let replyPayload = null;
  let encryptedReplyText = null;
  if (activeReplyTo) {
    replyPayload = {
      id: activeReplyTo.id,
      sender: activeReplyTo.sender,
      fakeText: activeReplyTo.fakeText || 'Note'
    };
    if (activeReplyTo.text) {
      encryptedReplyText = encryptWithPin(activeReplyTo.text, encKey);
    }
  }

  const msgPayload = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    sender: state.role,
    fakeText: fakeText || getRandomGroceryItem(),
    encryptedSecret: secretText ? encryptWithPin(secretText, encKey) : null,
    image: !isSecretImage && imageData ? imageData : null,
    encryptedImage: isSecretImage ? encryptWithPin(imageData, encKey) : null,
    replyTo: replyPayload,
    encryptedReplyToText: encryptedReplyText,
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

  fakeInput.value = '';
  fakeInput.style.height = 'auto';
  secretInput.value = '';
  secretInput.style.height = 'auto';
  secretInputWrapper.classList.remove('active');
  toggleSecretBtn.classList.remove('active');
  toggleSecretBtn.innerHTML = '<span>+ Attach Note</span>';
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

// PIN Modal Keypad input
async function handlePinInput(char) {
  if (state.enteredPin.length < 4) {
    state.enteredPin += String(char).toLowerCase();
    renderPinDots();

    if (state.enteredPin.length === 4) {
      const typedPin = state.enteredPin;
      const inputHash = await hashPin(typedPin);

      setTimeout(() => {
        if (inputHash === state.pinHash.toLowerCase()) {
          state.unlocked = true;
          state.activePin = typedPin;
          localStorage.setItem('qn_enc_key', typedPin);
          state.enteredPin = '';
          if (pinModal) pinModal.classList.remove('open');
          updateModeBadge();
          renderMessages();
          resetInactivityTimer();
        } else {
          showToast('Invalid subscription key');
          state.enteredPin = '';
          renderPinDots();
        }
      }, 150);
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
}

// App Initialization
initUI();
initReactions();
initCalls();
initChatEvents();
initFirebase();
renderMessages();
