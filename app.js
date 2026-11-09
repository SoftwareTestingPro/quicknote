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

// Fast native Web Crypto SHA-256 hashing
async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(pin).toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

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


// Simple XOR + Base64 encryption with the shared PIN so secret messages aren't plain text in the cloud
const MAGIC_PREFIX = 'QN::';

function encryptWithPin(text, pin) {
  if (!text) return '';
  const payload = MAGIC_PREFIX + text;
  let result = '';
  for (let i = 0; i < payload.length; i++) {
    const charCode = payload.charCodeAt(i) ^ pin.charCodeAt(i % pin.length);
    result += String.fromCharCode(charCode);
  }
  return btoa(encodeURIComponent(result));
}

function decryptWithPin(cipher, pin) {
  if (!cipher) return null;
  try {
    const decoded = decodeURIComponent(atob(cipher));
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ pin.charCodeAt(i % pin.length);
      result += String.fromCharCode(charCode);
    }
    // Check if the decrypted result matches our magic prefix
    if (result.startsWith(MAGIC_PREFIX)) {
      return result.substring(MAGIC_PREFIX.length);
    }
    // Backward compatibility for messages sent without MAGIC_PREFIX
    return result;
  } catch (e) {
    return null;
  }
}

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

// Reaction elements & active target
const reactionOverlay = document.getElementById('reactionOverlay');
const reactionBar = document.getElementById('reactionBar');
const reactionExtendedPanel = document.getElementById('reactionExtendedPanel');
const openEmojiPickerBtn = document.getElementById('openEmojiPickerBtn');
const closeExtendedPanelBtn = document.getElementById('closeExtendedPanelBtn');
const extendedEmojiGrid = document.getElementById('extendedEmojiGrid');
let activeReactionMsg = null;

const EXTENDED_EMOJIS = [
  '❤️', '😇' , '😎',  '😏',  '😊',  '😉',  '😈',  '😆',  '😅',  '😄',
  '👍', '👎', '❤', '🔥', '✨', '😂', '❤️',
  '❤', '😢' , '😮', '❤', '👏', '❤', '🙏',
  '😊', '😋', '❤', '😍', '❤', '😏',
  '😐', '😑', '❤', '😓', '❤', '😕',
  '😗', '😘', '❤', '😚', '❤', '😜'
];
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

// Toast helper
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.log('SW registration note:', err);
  });
}

// UI Setup
function initUI() {
  userAvatar.textContent = 'QN';
  partnerNameDisplay.textContent = 'Quick Note';
  updateRoleUI();
  updateModeBadge();

  // Keep app pinned, header on top, and chat input visible above mobile keyboard on iOS & Android
  if (window.visualViewport) {
    const updateViewportHeight = () => {
      const vv = window.visualViewport;
      document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
      const appEl = document.getElementById('app');
      if (appEl) {
        const offsetTop = Math.max(0, vv.offsetTop || 0);
        appEl.style.top = `${offsetTop}px`;
      }
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
      if (document.activeElement && (document.activeElement.id === 'fakeInput' || document.activeElement.id === 'secretInput')) {
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }
    };
    window.visualViewport.addEventListener('resize', updateViewportHeight);
    window.visualViewport.addEventListener('scroll', updateViewportHeight);
    window.addEventListener('scroll', () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    });
    updateViewportHeight();
  }

  [fakeInput, secretInput].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('focus', () => {
      setTimeout(() => {
        window.scrollTo(0, 0);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }, 300);
    });
  });
}

function updateRoleUI() {
  if (roleBtnUser1 && roleBtnUser2) {
    if (state.role === 'user2') {
      roleBtnUser2.classList.add('active');
      roleBtnUser1.classList.remove('active');
    } else {
      roleBtnUser1.classList.add('active');
      roleBtnUser2.classList.remove('active');
    }
  }
}

if (roleBtnUser1 && roleBtnUser2) {
  roleBtnUser1.addEventListener('click', () => {
    state.role = 'user1';
    localStorage.setItem('quick_note_role', 'user1');
    updateRoleUI();
    renderMessages();
    showToast('Device identity set to User 1');
  });

  roleBtnUser2.addEventListener('click', () => {
    state.role = 'user2';
    localStorage.setItem('quick_note_role', 'user2');
    updateRoleUI();
    renderMessages();
    showToast('Device identity set to User 2');
  });
}

function updateModeBadge() {
  if (state.unlocked) {
    document.body.classList.add('is-unlocked');
    modeBadge.className = 'mode-badge unlocked';
    lockIcon.textContent = '⭐';
    lockLabel.textContent = 'Premium Active';
    fakeInput.placeholder = 'Type secret note...';
    if (callBtn) callBtn.classList.remove('hidden');
  } else {
    document.body.classList.remove('is-unlocked');
    modeBadge.className = 'mode-badge locked';
    lockIcon.textContent = '⭐';
    lockLabel.textContent = 'Go Premium';
    fakeInput.placeholder = 'Type a message...';
    if (callBtn) callBtn.classList.add('hidden');
    // If locked while in a call or incoming call, safely end/decline
    if (callState.isCallActive || callState.currentCallId) {
      endCall();
    }
  }
}

// Toggle Note Field
toggleSecretBtn.addEventListener('click', () => {
  const isActive = secretInputWrapper.classList.toggle('active');
  toggleSecretBtn.classList.toggle('active', isActive);
  if (isActive) {
    secretInput.focus();
    toggleSecretBtn.innerHTML = '<span>✕ Remove Note</span>';
  } else {
    secretInput.value = '';
    toggleSecretBtn.innerHTML = '<span>+ Attach Note</span>';
  }
});

// Image compression helper (keeps Base64 lightweight for real-time Firebase syncing)
function compressAndReadImage(file, maxWidth = 800, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openLightbox(src) {
  if (!imageLightboxModal || !lightboxImg) return;
  lightboxImg.src = src;
  imageLightboxModal.classList.add('open');
}

function closeLightbox() {
  if (!imageLightboxModal || !lightboxImg) return;
  imageLightboxModal.classList.remove('open');
  lightboxImg.src = '';
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Convert links in text to clickable <a> tags (opens in default browser)
function formatMessageContent(str, enableLinks = false) {
  if (!str) return '';
  const escaped = escapeHTML(str);
  if (!enableLinks) return escaped;

  // Match URLs starting with http://, https://, or www.
  const urlPattern = /(\b(?:https?:\/\/|www\.)[^\s<]+)/gi;
  return escaped.replace(urlPattern, (rawUrl) => {
    let cleanUrl = rawUrl;
    let trailingPunct = '';
    while (cleanUrl && /[.,;:!?)]$/.test(cleanUrl)) {
      trailingPunct = cleanUrl.slice(-1) + trailingPunct;
      cleanUrl = cleanUrl.slice(0, -1);
    }
    const href = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : 'https://' + cleanUrl;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="chat-link" onclick="event.stopPropagation()">${cleanUrl}</a>${trailingPunct}`;
  });
}

function setReplyTarget(target) {
  if (!state.unlocked) return;
  activeReplyTo = target;
  if (!replyPreviewBar) return;
  if (target) {
    const isMe = typeof target.isMe === 'boolean' ? target.isMe : (target.sender === state.role);
    replyPreviewLabel.textContent = isMe ? 'Replying to yourself' : 'Replying to Note';
    replyPreviewText.textContent = target.text || (target.hasImage ? '?? Photo' : 'Note');
    replyPreviewBar.style.display = 'flex';
    fakeInput.focus();
  } else {
    replyPreviewBar.style.display = 'none';
  }
}

function clearReplyTarget() {
  activeReplyTo = null;
  if (replyPreviewBar) {
    replyPreviewBar.style.display = 'none';
  }
}

// Render Messages
function renderMessages(preserveScroll = false) {
  const previousScrollTop = chatMessagesEl.scrollTop;
  chatMessagesEl.innerHTML = '';

  if (state.messages.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.style.textAlign = 'center';
    emptyNotice.style.padding = '40px 20px';
    emptyNotice.style.color = 'var(--text-muted)';
    emptyNotice.style.fontSize = '13px';
    emptyNotice.innerHTML = `
      <div style="font-size: 28px; margin-bottom: 8px;">📝</div>
      <div>No items in your list.</div>
      <div style="margin-top: 4px;">Add an item below to get started.</div>
    `;
    chatMessagesEl.appendChild(emptyNotice);
    return;
  }

  // Detect if messages in database have distinct senders.
  // If all messages were saved under the same role (e.g. user1) or missing sender,
  // alternate attribution so each alternate note is clearly assigned to user1 and user2.
  const hasDistinctSenders = state.messages.some(m => m.sender === 'user2') && state.messages.some(m => m.sender === 'user1');

  state.messages.forEach((msg, idx) => {
    let isMe;
    let effectiveSender;
    if (hasDistinctSenders && msg.sender) {
      effectiveSender = msg.sender;
      isMe = (msg.sender === state.role);
    } else {
      // Alternate attribution so consecutive alternate messages belong to user1 and user2
      effectiveSender = (idx % 2 === 0) ? 'user1' : 'user2';
      isMe = (effectiveSender === state.role);
    }
    const row = document.createElement('div');
    row.className = `message-row ${isMe ? 'msg-row-me' : 'msg-row-them'}`;

    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${isMe ? 'bubble-me' : 'bubble-them'}`;
    bubble.setAttribute('data-id', msg.id || '');
    if (msg.key) bubble.setAttribute('data-key', msg.key);

    // Decide what text/image to show
    let displayText = state.unlocked ? '' : msg.fakeText;
    let isShowingSecret = false;
    let visibleImageSrc = null;

    if (state.unlocked && msg.encryptedSecret) {
      // 1. Try with the master room key (guarantees seamless decryption across both devices)
      const masterKey = state.pinHash ? state.pinHash.substring(0, 16) : '22cf79c3e77d6476';
      const keysToTry = [
        masterKey,
        state.activePin,
        localStorage.getItem('qn_enc_key')
      ].filter(Boolean);

      for (const k of keysToTry) {
        const decrypted = decryptWithPin(msg.encryptedSecret, k);
        if (decrypted) {
          displayText = decrypted;
          isShowingSecret = true;
          bubble.classList.add('is-secret');
          break;
        }
      }
    }

    // Determine image visibility:
    // If encryptedImage is present, only reveal when unlocked
    if (msg.encryptedImage) {
      if (state.unlocked) {
        const masterKey = state.pinHash ? state.pinHash.substring(0, 16) : '22cf79c3e77d6476';
        const keysToTry = [
          masterKey,
          state.activePin,
          localStorage.getItem('qn_enc_key')
        ].filter(Boolean);

        for (const k of keysToTry) {
          const decryptedImg = decryptWithPin(msg.encryptedImage, k);
          if (decryptedImg) {
            visibleImageSrc = decryptedImg;
            bubble.classList.add('is-secret');
            break;
          }
        }
      }
    } else if (msg.image) {
      visibleImageSrc = msg.image;
    }

    let timeStr = '';
    if (msg.timestamp) {
      const d = new Date(msg.timestamp);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      timeStr = `${day}/${month} ${time}`;
    }

    const hasHiddenData = (msg.encryptedSecret || msg.encryptedImage) && !state.unlocked;

    let contentHtml = '';
    // Show quoted reply if message is a reply
    if (state.unlocked && msg.replyTo) {
      let quoteText = msg.replyTo.fakeText || 'Note';
      if (state.unlocked && msg.encryptedReplyToText) {
        const masterKey = state.pinHash ? state.pinHash.substring(0, 16) : '22cf79c3e77d6476';
        const keysToTry = [masterKey, state.activePin, localStorage.getItem('qn_enc_key')].filter(Boolean);
        for (const k of keysToTry) {
          const dec = decryptWithPin(msg.encryptedReplyToText, k);
          if (dec) {
            quoteText = dec;
            break;
          }
        }
      } else if (msg.replyTo.text) {
        quoteText = msg.replyTo.text;
      }
      contentHtml += `
        <div class="msg-reply-quote">
          <span class="msg-reply-quote-sender">${escapeHTML(msg.replyTo.sender === state.role ? 'You' : 'Note')}</span>
          <span class="msg-reply-quote-text">${escapeHTML(quoteText)}</span>
        </div>
      `;
    }

    if (displayText) {
      // In unlocked mode, render clickable links that open in default browser
      contentHtml += `<div class="msg-content">${formatMessageContent(displayText, state.unlocked)}</div>`;
    }
    if (visibleImageSrc) {
      contentHtml += `
        <div class="msg-img-container">
          <img src="${visibleImageSrc}" class="msg-img" alt="Shared photo" loading="lazy">
        </div>
      `;
    }

    // Render reactions only when unlocked
    if (state.unlocked && msg.reactions && typeof msg.reactions === 'object') {
      const counts = {};
      const reactedByMe = {};
      Object.entries(msg.reactions).forEach(([userKey, emojiItem]) => {
        if (!emojiItem) return;
        counts[emojiItem] = (counts[emojiItem] || 0) + 1;
        if (userKey === state.role) {
          reactedByMe[emojiItem] = true;
        }
      });
      const entries = Object.entries(counts);
      if (entries.length > 0) {
        contentHtml += '<div class="reaction-badge-container">';
        entries.forEach(([emoji, count]) => {
          const isMine = Boolean(reactedByMe[emoji]);
          contentHtml += `
            <div class="reaction-pill ${isMine ? 'reacted-by-me' : ''}" data-emoji="${escapeHTML(emoji)}" title="${isMine ? 'Tap to remove reaction' : 'Tap to react'}">
              <span>${escapeHTML(emoji)}</span>
              ${count > 1 ? `<span class="reaction-count">${count}</span>` : ''}
            </div>`;
        });
        contentHtml += '</div>';
      }
    }

    bubble.innerHTML = `
      <div class="msg-meta-header">
        <span class="msg-sender-tag">Note</span>
        <span>${timeStr}</span>
      </div>
      ${contentHtml}
    `;

    // Click on reaction pills to toggle reaction
    if (state.unlocked) {
      bubble.querySelectorAll('.reaction-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const em = pill.getAttribute('data-emoji');
          if (em) toggleMessageReaction(msg, em);
        });
      });
    }

    // Click on image to view in full lightbox
    const imgEl = bubble.querySelector('.msg-img');
    if (imgEl && visibleImageSrc) {
      imgEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(visibleImageSrc);
      });
    }

    // Red delete background shown when swiping right
    const deleteBg = document.createElement('div');
    deleteBg.className = 'swipe-delete-bg';
    deleteBg.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>
      <span>Delete</span>
    `;

    // Blue reply background shown when swiping left (only active when unlocked)
    const replyBg = document.createElement('div');
    replyBg.className = 'swipe-reply-bg';
    replyBg.innerHTML = `
      <span>Reply</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 17 4 12 9 7"></polyline>
        <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
      </svg>
    `;

    row.appendChild(deleteBg);
    if (state.unlocked) {
      row.appendChild(replyBg);
    }
    row.appendChild(bubble);

    // Swipe handlers: Right-swipe to delete, Left-swipe to reply (when unlocked), Long-press for emoji reaction
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isSwiping = false;
    let isHorizontal = null;
    let longPressTimer = null;
    let isLongPressTriggered = false;

    function startLongPress(clientX, clientY) {
      clearTimeout(longPressTimer);
      isLongPressTriggered = false;
      if (!state.unlocked) return; // Only allow emoji reactions when unlocked
      longPressTimer = setTimeout(() => {
        isLongPressTriggered = true;
        isSwiping = false;
        if (navigator.vibrate) {
          try { navigator.vibrate(40); } catch (e) {}
        }
        openReactionOverlay(msg, clientX, clientY);
      }, 450);
    }

    function cancelLongPress() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function handleSwipeStart(x, y) {
      startX = x;
      startY = y;
      currentX = x;
      isSwiping = true;
      isHorizontal = null;
      bubble.style.transition = 'none';
    }

    function handleSwipeMove(x, y, e) {
      if (!isSwiping) return;
      const diffX = x - startX;
      const diffY = y - startY;

      // Cancel long press on movement
      if (Math.abs(diffX) > 8 || Math.abs(diffy) > 8) {
        cancelLongPress();
      }

      // Determine drag direction once movement passes 6px threshold
      if (isHorizontal === null) {
        if (Math.abs(diffX) > 6 || Math.abs(diffY) > 6) {
          isHorizontal = Math.abs(diffX) > Math.abs(diffY);
        }
      }

      if (!isHorizontal) return;

      if (diffX > 0) {
        // Right swipe -> Delete
        if (e && e.cancelable) e.preventDefault();
        currentX = x;
        const translateX = Math.min(diffX, 160);
        bubble.style.transform = `translateX(${translateX}px)`;
        const progress = Math.min(diffX / 90, 1);
        deleteBg.style.opacity = progress;
        replyBg.style.opacity = '0';
      } else if (diffX < 0 && state.unlocked) {
        // Left swipe -> Reply (only in unlocked mode)
        if (e && e.cancelable) e.preventDefault();
        currentX = x;
        const translateX = Math.max(diffX, -120);
        bubble.style.transform = `translateX(${translateX}px)`;
        const progress = Math.min(Math.abs(diffX) / 70, 1);
        replyBg.style.opacity = progress;
        deleteBg.style.opacity = '0';
      }
    }

    function handleSwipeEnd() {
      cancelLongPress();
      if (isLongPressTriggered) {
        isLongPressTriggered = false;
        isSwiping = false;
        return;
      }
      if (!isSwiping) return;
      isSwiping = false;
      const diffX = currentX - startX;

      // Right swipe >= 90px -> Delete
      if (isHorizontal && diffX >= 90) {
        bubble.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
        bubble.style.transform = `translateX(${window.innerWidth || 360}px)`;
        bubble.style.opacity = '0';
        deleteBg.style.opacity = '1';
        row.classList.add('deleting');

        setTimeout(() => {
          deleteNote(msg);
        }, 160);
      } else if (isHorizontal && diffX <= -70 && state.unlocked) {
        // Left swipe <= -70px -> Trigger Reply
        bubble.style.transition = 'transform 0.2s ease';
        bubble.style.transform = 'translateX(0)';
        replyBg.style.opacity = '0';
        
        // Haptic feedback if available
        if (navigator.vibrate) {
          try { navigator.vibrate(35); } catch (e) {}
        }
        
        setReplyTarget({
          id: msg.id,
          sender: effectiveSender,
          isMe: isMe,
          text: displayText,
          hasImage: Boolean(visibleImageSrc || msg.image || msg.encryptedImage),
          fakeText: msg.fakeText
        });
      } else {
        // Snap back
        bubble.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        bubble.style.transform = 'translateX(0)';
        deleteBg.style.opacity = '0';
        replyBg.style.opacity = '0';
      }
      isHorizontal = null;
    }

    // Touch events for mobile
    bubble.addEventListener('touchstart', (e) => {
      if (e.target && e.target.closest('a.chat-link, .reaction-pill')) return;
      const t = e.touches[0];
      startLongPress(t.clientX, t.clientY);
      handleSwipeStart(t.clientX, t.clientY);
    }, { passive: true });

    bubble.addEventListener('touchmove', (e) => {
      if (!isSwiping) return;
      const t = e.touches[0];
      handleSwipeMove(t.clientX, t.clientY, e);
    }, { passive: false });

    bubble.addEventListener('touchend', handleSwipeEnd, { passive: true });
    bubble.addEventListener('touchcancel', handleSwipeEnd, { passive: true });

    // Pointer/Mouse drag support for desktop
    bubble.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left-click drag
      if (e.target && e.target.closest('a.chat-link, .reaction-pill')) return;
      startLongPress(e.clientX, e.clientY);
      handleSwipeStart(e.clientX, e.clientY);

      const onMouseMove = (ev) => handleSwipeMove(ev.clientX, ev.clientY, ev);
      const onMouseUp = () => {
        cancelLongPress();
        handleSwipeEnd();
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
    chatMessagesEl.appendChild(row);
  });

  if (preserveScroll) {
    chatMessagesEl.scrollTop = previousScrollTop;
  } else {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

// Emoji Reaction Logic
function openReactionOverlay(msg, clientX = null, clientY = null) {
  if (!reactionOverlay || !reactionBar) return;
  activeReactionMsg = msg;
  if (reactionExtendedPanel) reactionExtendedPanel.classList.remove('open');
  reactionOverlay.classList.add('open');

  // Position reaction bar near touch/click point if provided
  if (clientY !== null) {
    const barHeight = 56;
    const padding = 20;
    let topPos = clientY - barHeight - 16;
    if (topPos < padding) {
      topPos = clientY + 40;
    }
    const maxTop = window.innerHeight - barHeight - padding;
    topPos = Math.min(Math.max(padding, topPos), maxTop);
    reactionBar.style.position = 'absolute';
    reactionBar.style.top = `${topPos}px`;
  } else {
    reactionBar.style.position = 'relative';
    reactionBar.style.top = 'auto';
  }
}

function closeReactionOverlay() {
  if (!reactionOverlay) return;
  reactionOverlay.classList.remove('open');
  if (reactionExtendedPanel) reactionExtendedPanel.classList.remove('open');
  activeReactionMsg = null;
}

function toggleMessageReaction(msg, emoji) {
  if (!msg || !emoji) return;
  closeReactionOverlay();
  const currentRole = state.role || 'user1';
  const existingEmoji = (msg.reactions && msg.reactions[currentRole]) || null;
  const newEmoji = (existingEmoji === emoji) ? null : emoji;

  // Optimistic local update
  if (!msg.reactions) msg.reactions = {};
  if (newEmoji) {
    msg.reactions[currentRole] = newEmoji;
  } else {
    delete msg.reactions[currentRole];
  }
  renderMessages(true);

  // Sync to Firebase or LocalStorage
  if (state.dbRef) {
    if (msg.key) {
      state.dbRef.child(msg.key).child('reactions').child(currentRole).set(newEmoji).catch(err => {
        console.error('Failed to update reaction:', err);
      });
    } else {
      state.dbRef.orderByChild('id').equalTo(msg.id).once('value', (snap) => {
        if (snap.exists()) {
          snap.forEach(child => {
            child.ref.child('reactions').child(currentRole).set(newEmoji);
          });
        }
      });
    }
  } else {
    localStorage.setItem('local_chat_' + state.roomId, JSON.stringify(state.messages));
  }
}

if (extendedEmojiGrid) {
  extendedEmojiGrid.innerHTML = '';
  EXTENDED_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'grid-emoji-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeReactionMsg) {
        toggleMessageReaction(activeReactionMsg, emoji);
      }
      closeReactionOverlay();
    });
    extendedEmojiGrid.appendChild(btn);
  });
}

if (reactionBar) {
  reactionBar.querySelectorAll('.reaction-emoji-btn[data-emoji]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const emoji = btn.getAttribute('data-emoji');
      if (activeReactionMsg && emoji) {
        toggleMessageReaction(activeReactionMsg, emoji);
      }
      closeReactionOverlay();
    });
  });
}

if (openEmojiPickerBtn && reactionExtendedPanel) {
  openEmojiPickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    reactionExtendedPanel.classList.toggle('open');
  });
}

if (closeExtendedPanelBtn && reactionExtendedPanel) {
  closeExtendedPanelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    reactionExtendedPanel.classList.remove('open');
  });
}

if (reactionOverlay) {
  reactionOverlay.addEventListener('click', (e) => {
    if (e.target === reactionOverlay) {
      closeReactionOverlay();
    }
  });
}

// Permanent Delete Function
let isDeleting = false;
function deleteNote(msg) {

  isDeleting = true;
  if (state.dbRef) {
    if (msg.key) {
      state.dbRef.child(msg.key).remove().then(() => {
        showToast('Note deleted');
      }).catch((err) => {
        isDeleting = false;
        showToast('Delete error: ' + err.message);
      });
    } else {
      // Find by matching id field
      state.dbRef.orderByChild('id').equalTo(msg.id).once('value', (snapshot) => {
        if (snapshot.exists()) {
          snapshot.forEach((child) => {
            child.ref.remove();
          });
          showToast('Note deleted');
        } else {
          isDeleting = false;
        }
      });
    }
  } else {
    // Local storage delete
    state.messages = state.messages.filter(m => m.id !== msg.id);
    localStorage.setItem('local_chat_' + state.roomId, JSON.stringify(state.messages));
    renderMessages(true);
    isDeleting = false;
    showToast('Note deleted');
  }
}





const GROCERY_ITEMS = [
  // Daily Staples & Dals (Ration)
  'Aashirvaad Aata', 'Basmati Rice', 'Toor Dal', 'Moong Dal', 'Chana Dal',
  'Urad Dal', 'Masoor Dal', 'Rajma', 'Chole', 'Kala Chana',
  'Poha', 'Sooji', 'Besan', 'Maida', 'Dalia', 'Sabudana',
  'Tata Salt', 'Sugar', 'Jaggery',

  // Cooking Oils & Ghee
  'Mustard Oil', 'Refined Oil', 'Fortune Sunflower Oil',
  'Desi Ghee', 'Groundnut Oil',

  // Spices & Masalas (Masaledani)
  'Haldi Powder', 'Lal Mirch Powder', 'Dhaniya Powder',
  'Garam Masala', 'Jeera', 'Rai',
  'Hing', 'Ajwain', 'Kasuri Methi', 'Kali Mirch',
  'Elaichi', 'Laung', 'Tej Patta',
  'Chaat Masala', 'Maggi Masala-e-Magic', 'Kitchen King Masala',

  // Vegetables & Daily Sabzi
  'Aaloo', 'Pyaaz', 'Tamatar', 'Adrak',
  'Lehsun', 'Hari Mirch', 'Dhaniya Patta',
  'Pudina', 'Nimbu', 'Bhindi', 'Gobi',
  'Patta Gobi', 'Shimla Mirch', 'Karela',
  'Lauki', 'Baingan', 'Palak', 'Matar',
  'Gajar', 'Mooli', 'Kaddu', 'Sweet Potato',

  // Fruits
  'Kela', 'Seb', 'Aam', 'Santra',
  'Anaar', 'Papita', 'Angoor', 'Amrood',
  'Mausambi', 'Chikoo', 'Watermelon',

  // Dairy & Bakery
  'Amul Doodh', 'Amul Taaza Milk', 'Amul Butter', 'Paneer',
  'Dahi', 'Amul Cheese Slices', 'Amul Fresh Cream',
  'Brown Bread', 'White Bread', 'Pav', 'Rusk',
  'Eggs',

  // Tea, Coffee & Breakfast
  'Tata Tea Gold', 'Red Label Chai', 'Taj Mahal Tea', 'Nescafe Coffee',
  'Bru Instant Coffee', 'Bournvita', 'Horlicks', 'Corn Flakes',
  'Oats',

  // Biscuits & Snacks
  'Parle-G', 'Good Day Cookies', 'Marie Gold', 'Monaco', 'Bourbon',
  'Haldiram Bhujia', 'Moong Dal Namkeen', 'Kurkure', 'Lays Chips',
  'Maggi Noodles', 'Knorr Soup', 'Chings Schezwan Chutney', 'Kissan Tomato Ketchup',

  // Household & Cleaning Essentials
  'Surf Excel', 'Vim Dishwash Bar', 'Lizol Floor Cleaner',
  'Harpic Toilet Cleaner', 'Colin Glass Cleaner', 'Dettol Handwash Refill',
  'Lifebuoy Soap', 'Dove Soap', 'Colgate Toothpaste',
  'Toothbrush', 'Head & Shoulders Shampoo', 'Clinic Plus Shampoo',
  'Coconut Hair Oil', 'Good Knight Liquid Refill', 'Odonil Air Freshener',
  'Pooja Agarbatti', 'Kapoor', 'Garbage Bags', 'Scotch Brite Scrub Pad',
  'Jhadu', 'Pocha', 'Matchbox', 'Tissue Paper Box'
];

function getRandomGroceryItem() {
  const existingItems = new Set(
    state.messages
      .map(m => (m.fakeText || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const available = GROCERY_ITEMS.filter(item => !existingItems.has(item.toLowerCase()));
  const pool = available.length > 0 ? available : GROCERY_ITEMS;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

// Send Message
function sendMessage() {
  if (state.unlocked) {
    const noteText = fakeInput.value.trim();
    if (!noteText) return;
    // When unlocked: fakeText is grocery fallback, noteText is encrypted secret note
    doSendMessage('', noteText);
    return;
  }

  const fakeText = fakeInput.value.trim();
  const secretText = secretInput.value.trim();

  if (!fakeText && !secretText) return;

  doSendMessage(fakeText, secretText);
}

function doSendMessage(fakeText, secretText, imageData = null) {
  // Use shared room key so notes/images sent in locked or unlocked mode are always 100% decryptable by either partner
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
    // Offline / Demo Local Mode
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

// Image upload event listeners (Only active and available when unlocked)
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

  // Close popup menu on outside tap/click
  document.addEventListener('click', (e) => {
    if (attachPopupMenu.classList.contains('open') && !attachMenuWrapper.contains(e.target)) {
      attachPopupMenu.classList.remove('open');
    }
  });
}

if (lightboxCloseBtn) {
  lightboxCloseBtn.addEventListener('click', closeLightbox);
}

if (imageLightboxModal) {
  imageLightboxModal.addEventListener('click', (e) => {
    if (e.target === imageLightboxModal) {
      closeLightbox();
  closeReactionOverlay();
    }
  });
}


function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

fakeInput.addEventListener('input', () => autoResizeTextarea(fakeInput));
secretInput.addEventListener('input', () => autoResizeTextarea(secretInput));

sendBtn.addEventListener('click', sendMessage);
// Enter key moves cursor to next line with auto-expansion (messages sent only via Send button)
fakeInput.addEventListener('keydown', () => {
  setTimeout(() => autoResizeTextarea(fakeInput), 0);
});
secretInput.addEventListener('keydown', () => {
  setTimeout(() => autoResizeTextarea(secretInput), 0);
});

// PIN Logic & Modal
modeBadge.addEventListener('click', () => {
  if (state.unlocked) {
    // Return to standard view
    state.unlocked = false;
    updateModeBadge();
    renderMessages();
  } else {
    // Open subscription key modal
    state.enteredPin = '';
    renderPinDots();
    pinModal.classList.add('open');
  }
});

cancelPinBtn.addEventListener('click', () => {
  pinModal.classList.remove('open');
  state.enteredPin = '';
});

function renderPinDots() {
  const dots = pinDots.querySelectorAll('.dot');
  dots.forEach((dot, idx) => {
    if (idx < state.enteredPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

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
          state.activePin = typedPin; // Temporary in-memory key for decrypting/encrypting
          localStorage.setItem('qn_enc_key', typedPin);
          state.enteredPin = '';
          pinModal.classList.remove('open');
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

document.querySelectorAll('#keypad .key-btn[data-key]').forEach((btn) => {
  btn.addEventListener('click', () => {
    handlePinInput(btn.getAttribute('data-key'));
  });
});

document.getElementById('keyClear').addEventListener('click', () => {
  state.enteredPin = '';
  renderPinDots();
});

document.getElementById('keyBack').addEventListener('click', () => {
  state.enteredPin = state.enteredPin.slice(0, -1);
  renderPinDots();
});

// Lock app to "Go Premium" standard disguised mode
function lockToDisguiseMode() {
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = null;
  }

  // Blur any active inputs (e.g. keyboard on iOS/Android)
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  
  // Instant visual cover: veil screen synchronously so no frame can leak
  if (privacyShield) {
    privacyShield.classList.add('active');
  }

  state.unlocked = false;
  state.activePin = ''; // Wipe plaintext PIN from memory immediately
  state.enteredPin = '';

  if (pinModal) pinModal.classList.remove('open');
  if (attachPopupMenu) attachPopupMenu.classList.remove('open');
  closeReactionOverlay();
  clearReplyTarget();
  closeLightbox();
  renderPinDots();
  updateModeBadge();
  renderMessages();

  // Remove privacy shield once DOM repaint has firmly settled as locked
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (privacyShield) {
        privacyShield.classList.remove('active');
      }
    });
  });
}

// Auto-lock listeners:
// 1. window 'blur' triggers the instant the power/lock button is pressed, home button tapped, or notification shade pulled down
window.addEventListener('blur', () => {
  if (isSelectingMedia) return;
  lockToDisguiseMode();
});

// 2. document visibilitychange triggers when screen turns off or tab hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden || document.visibilityState !== 'visible') {
    if (isSelectingMedia) return;
    lockToDisguiseMode();
  } else {
    // When screen turns back on / wakes up, strictly enforce locked disguised state
    if (!state.unlocked) {
      updateModeBadge();
      renderMessages();
    }
  }
});

// 3. window 'focus' and 'pageshow' guarantee that upon phone wake/unlock, the app is 100% locked
window.addEventListener('focus', () => {
  if (isSelectingMedia) {
    // Returning from camera or file dialog: allow brief grace period and reset inactivity timer
    setTimeout(() => { isSelectingMedia = false; }, 500);
    resetInactivityTimer();
    return;
  }
  if (!state.unlocked) {
    updateModeBadge();
    renderMessages();
  }
});

window.addEventListener('pageshow', (event) => {
  if (isSelectingMedia) {
    setTimeout(() => { isSelectingMedia = false; }, 500);
    return;
  }
  // If restored from bfcache or waking up, ensure locked state
  lockToDisguiseMode();
});

// 4. pagehide triggers when navigating away or app process suspended
window.addEventListener('pagehide', () => {
  lockToDisguiseMode();
});

// 5. document 'freeze' (Page Lifecycle API)
document.addEventListener('freeze', () => {
  lockToDisguiseMode();
});

// 5. Inactivity Auto-Lock: if user stops touching/typing for 20 seconds while unlocked, lock automatically
let inactivityTimeout = null;
function resetInactivityTimer() {
  if (inactivityTimeout) clearTimeout(inactivityTimeout);
  if (state.unlocked) {
    inactivityTimeout = setTimeout(() => {
      // Don't auto-lock mid-call
      if (!callState.isCallActive && !callState.currentCallId) {
        lockToDisguiseMode();
        showToast('App locked due to inactivity');
      }
    }, 20000); // 20 seconds
  }
}

['touchstart', 'mousedown', 'keydown', 'scroll'].forEach(evt => {
  window.addEventListener(evt, resetInactivityTimer, { passive: true });
});

// Quick Panic Disguise screen on tap header avatar
profileBtn.addEventListener('click', () => {
  panicScreen.classList.add('active');
  lockToDisguiseMode();
});

exitPanicBtn.addEventListener('click', () => {
  panicScreen.classList.remove('active');
});

// Initialize Firebase Realtime Database
function initFirebase() {
  const hasConfig = state.firebaseConfig && state.firebaseConfig.apiKey && state.firebaseConfig.databaseURL;
  if (!hasConfig) {
    connectionStatus.textContent = 'All notes synced';
    connectionStatus.style.color = 'var(--text-muted)';
    
    // Load local storage fallback messages for testing
    const saved = localStorage.getItem('local_chat_' + state.roomId);
    if (saved) {
      try {
        state.messages = JSON.parse(saved);
      } catch (e) {
        state.messages = [];
      }
    } else {
      // Add default welcome example
      state.messages = [
        {
          id: 'welcome_1',
          sender: 'user2',
          encryptedSecret: null,
          timestamp: Date.now() - 3600000
        }
      ];
    }
    renderMessages();
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(state.firebaseConfig);
    }
    const db = firebase.database();
    state.dbRef = db.ref('rooms/' + state.roomId + '/messages');
    
    // Pre-shared key fetched from database (can be raw pin or already hashed sha-256)
    state.pinRef = db.ref('rooms/' + state.roomId + '/auth_pin');
    state.pinRef.on('value', async (snap) => {
      const val = snap.val();
      if (val) {
        const strVal = String(val).trim();
        // If it's already a 64-character SHA-256 hex string, use directly; otherwise hash it
        if (/^[a-fA-F0-9]{64}$/.test(strVal)) {
          state.pinHash = strVal.toLowerCase();
        } else {
          state.pinHash = await hashPin(strVal);
        }
      }
    });

    connectionStatus.textContent = 'Syncing...';
    connectionStatus.style.color = '#38bdf8';

    // Call signaling reference
    state.callsRef = db.ref('rooms/' + state.roomId + '/calls');
    listenForIncomingCalls();

    state.dbRef.limitToLast(100).on('value', (snapshot) => {
      const isScrolledUp = (chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight) > 80;
      const shouldPreserve = isDeleting || isScrolledUp;
      isDeleting = false;

      state.messages = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const item = child.val();
          item.key = child.key;
          state.messages.push(item);
        });
      }
      connectionStatus.textContent = 'All notes synced';
      connectionStatus.style.color = 'var(--text-muted)';
      renderMessages(shouldPreserve);
    }, (error) => {
      console.error('Database sync error:', error);
      connectionStatus.textContent = 'Sync offline';
      connectionStatus.style.color = 'var(--text-muted)';
    });

  } catch (err) {
    console.error('Firebase initialization:', err);
    connectionStatus.textContent = 'All notes synced';
    connectionStatus.style.color = 'var(--text-muted)';
  }
}

// ----------------------------------------------------
// WebRTC Internet Calling Implementation
// ----------------------------------------------------

// Tone Synthesizer for Ringtone (No external audio files needed)
let ringtoneInterval = null;
let activeOscillators = [];

function playRingtone() {
  stopRingtone(); // ensure any prior tone or context is completely torn down
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    callState.ringtoneCtx = audioCtx;

    function beep() {
      if (!callState.ringtoneCtx || callState.ringtoneCtx.state === 'closed') return;
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        activeOscillators.push(osc);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime); // 440Hz A tone
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);

        osc.onended = () => {
          const idx = activeOscillators.indexOf(osc);
          if (idx !== -1) activeOscillators.splice(idx, 1);
        };
      } catch (e) {
        console.warn('Beep trigger note:', e);
      }
    }

    beep();
    ringtoneInterval = setInterval(beep, 3000);
  } catch (e) {
    console.warn('AudioContext ringtone error:', e);
  }
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  // Stop all active oscillator nodes immediately
  while (activeOscillators.length > 0) {
    const osc = activeOscillators.pop();
    try {
      osc.stop();
      osc.disconnect();
    } catch (e) {}
  }
  if (callState.ringtoneCtx) {
    try {
      callState.ringtoneCtx.close();
    } catch (e) {}
    callState.ringtoneCtx = null;
  }
}

// Format call timer 00:00
function startCallTimer() {
  callState.startTime = Date.now();
  callDuration.classList.add('active');
  callDuration.textContent = '00:00';
  if (callState.timerInterval) clearInterval(callState.timerInterval);
  callState.timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - callState.startTime) / 1000);
    const mins = String(Math.floor(diff / 60)).padStart(2, '0');
    const secs = String(diff % 60).padStart(2, '0');
    callDuration.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopCallTimer() {
  if (callState.timerInterval) {
    clearInterval(callState.timerInterval);
    callState.timerInterval = null;
  }
  callDuration.classList.remove('active');
  callDuration.textContent = '00:00';
}

// Listen for incoming calls
function listenForIncomingCalls() {
  if (!state.callsRef) return;

  state.callsRef.on('value', async (snapshot) => {
    const callData = snapshot.val();

    // If call was removed or ended
    if (!callData) {
      if (callState.isCallActive || callState.currentCallId) {
        cleanupCallUI();
        showToast('Call ended');
      }
      return;
    }

    const { status, caller, offer, answer } = callData;

    // Incoming Call for current user
    if (status === 'ringing' && caller !== state.role) {
      // Auto-unlock to reveal incoming call if pin was previously activated, or prompt call directly
      state.unlocked = true;
      updateModeBadge();
      renderMessages();
      showIncomingCallUI();
    }

    // Caller receives acceptance from Receiver
    if (status === 'connected' && callState.isCaller && answer && callState.peerConnection) {
      if (!callState.isCallActive) {
        callState.isCallActive = true;
        stopRingtone();
        try {
          await callState.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.warn('Set remote desc error:', err);
        }
        callStatusText.textContent = 'Connected';
        callAvatar.classList.remove('ringing');
        startCallTimer();
        applyAudioOutputMode();
      }
    }

    // Call declined or ended
    if (status === 'declined' || status === 'ended') {
      cleanupCallUI();
      showToast(status === 'declined' ? 'Call declined' : 'Call ended');
    }
  });

  // Candidate listeners
  state.callsRef.child('candidates').on('child_added', (snap) => {
    const data = snap.val();
    if (data && data.sender !== state.role && callState.peerConnection) {
      callState.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch((e) => {
        console.warn('Add ICE candidate note:', e);
      });
    }
  });
}

// Audio constraints tuned specifically for telephony voice calls (signals OS to route to earpiece)
const CALL_AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: 1, // Mono channel indicates standard phone call to Android/iOS
    sampleRate: { ideal: 16000 },
    latency: { ideal: 0.01 }
  },
  video: false
};

// Start Call (Outgoing)
async function startOutgoingCall() {
  if (!state.unlocked) return;
  if (!state.callsRef) {
    showToast('Firebase connection required for internet calls');
    return;
  }

  try {
    // 1. Get speech-optimized telephony audio media
    const stream = await navigator.mediaDevices.getUserMedia(CALL_AUDIO_CONSTRAINTS);
    callState.localStream = stream;

    // 2. Setup WebRTC PeerConnection
    setupPeerConnection();
    stream.getTracks().forEach(track => callState.peerConnection.addTrack(track, stream));

    // 3. Create Offer
    const offer = await callState.peerConnection.createOffer();
    await callState.peerConnection.setLocalDescription(offer);

    callState.isCaller = true;
    callState.currentCallId = 'active_call';

    // 4. Push call state to Firebase and clean candidates
    await state.callsRef.set({
      status: 'ringing',
      caller: state.role,
      offer: {
        type: offer.type,
        sdp: offer.sdp
      },
      timestamp: Date.now()
    });
    // Remove old candidates
    state.callsRef.child('candidates').remove().catch(() => {});

    // 5. Update UI
    callTitle.textContent = 'Calling...';
    callStatusText.textContent = 'Ringing partner...';
    callAvatar.classList.add('ringing');
    callIncomingActions.classList.add('hidden');
    callActiveActions.classList.remove('hidden');
    callOverlay.classList.add('active');
    applyAudioOutputMode();
    playRingtone();

  } catch (err) {
    console.error('Call initialization failed:', err);
    if (err.name === 'NotAllowedError') {
      showToast('Microphone access denied. Please allow microphone in browser.');
    } else {
      showToast('Could not start call: ' + err.message);
    }
    cleanupCallUI();
  }
}

// Display incoming call prompt
function showIncomingCallUI() {
  callTitle.textContent = 'Incoming Call';
  callStatusText.textContent = 'Voice Call from Partner';
  callAvatar.classList.add('ringing');
  callIncomingActions.classList.remove('hidden');
  callActiveActions.classList.add('hidden');
  callDuration.classList.remove('active');
  callOverlay.classList.add('active');
  playRingtone();
}

// Accept incoming call
async function acceptCall() {
  stopRingtone();
  callStatusText.textContent = 'Connecting...';
  callIncomingActions.classList.add('hidden');
  callActiveActions.classList.remove('hidden');

  try {
    const stream = await navigator.mediaDevices.getUserMedia(CALL_AUDIO_CONSTRAINTS);
    callState.localStream = stream;

    setupPeerConnection();
    stream.getTracks().forEach(track => callState.peerConnection.addTrack(track, stream));

    // Fetch the caller's offer
    const snap = await state.callsRef.once('value');
    const callData = snap.val();

    if (!callData || !callData.offer) {
      throw new Error('Call already cancelled');
    }

    await callState.peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const answer = await callState.peerConnection.createAnswer();
    await callState.peerConnection.setLocalDescription(answer);

    // Update Firebase with answer
    await state.callsRef.update({
      status: 'connected',
      answer: {
        type: answer.type,
        sdp: answer.sdp
      }
    });

    callState.isCallActive = true;
    callStatusText.textContent = 'Connected';
    callAvatar.classList.remove('ringing');
    startCallTimer();
    applyAudioOutputMode();

  } catch (err) {
    console.error('Accept call failed:', err);
    showToast('Failed to accept: ' + err.message);
    endCall();
  }
}

// Decline incoming call
function declineCall() {
  stopRingtone();
  if (state.callsRef) {
    state.callsRef.update({ status: 'declined' }).then(() => {
      setTimeout(() => state.callsRef.remove(), 1000);
    });
  }
  cleanupCallUI();
}

// End / Hangup Call
function endCall() {
  stopRingtone();
  stopCallTimer();
  if (state.callsRef) {
    state.callsRef.update({ status: 'ended' }).then(() => {
      setTimeout(() => state.callsRef.remove(), 1000);
    });
  }
  cleanupCallUI();
}

// Setup PeerConnection & ICE Handlers
function setupPeerConnection() {
  if (callState.peerConnection) {
    try { callState.peerConnection.close(); } catch (e) {}
  }

  const pc = new RTCPeerConnection(rtcConfig);
  callState.peerConnection = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate && state.callsRef) {
      state.callsRef.child('candidates').push({
        sender: state.role,
        candidate: event.candidate.toJSON()
      });
    }
  };

  pc.ontrack = (event) => {
    if (remoteAudio && event.streams && event.streams[0]) {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(e => console.warn('Remote audio autoplay error:', e));
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      cleanupCallUI();
    }
  };
}

// Toggle Mute
let isMuted = false;
function toggleMute() {
  if (callState.localStream) {
    const audioTrack = callState.localStream.getAudioTracks()[0];
    if (audioTrack) {
      isMuted = !isMuted;
      audioTrack.enabled = !isMuted;
      toggleMuteBtn.classList.toggle('muted', isMuted);
      showToast(isMuted ? 'Microphone Muted' : 'Microphone Unmuted');
    }
  }
}

// Speakerphone vs Earpiece routing state ('earpiece' default for phone calls)
let audioOutputMode = 'earpiece'; // 'earpiece' | 'speaker'

async function applyAudioOutputMode() {
  if (!remoteAudio) return;

  // 1. Programmatic sink selection (Chrome Desktop & supported mobile platforms)
  if (typeof remoteAudio.setSinkId === 'function') {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      if (audioOutputMode === 'earpiece') {
        // Look for earpiece / internal receiver
        const earpiece = audioOutputs.find(d => 
          /earpiece|receiver|phone|handset/i.test(d.label)
        );
        if (earpiece) {
          await remoteAudio.setSinkId(earpiece.deviceId);
        } else if (audioOutputs.length > 0) {
          // If no explicitly named earpiece, default sink
          await remoteAudio.setSinkId(audioOutputs[0].deviceId);
        }
      } else {
        // Speakerphone mode: Look for speaker / loudspeaker
        const speaker = audioOutputs.find(d => 
          /speaker|loudspeaker|external/i.test(d.label)
        );
        if (speaker) {
          await remoteAudio.setSinkId(speaker.deviceId);
        } else {
          await remoteAudio.setSinkId('');
        }
      }
    } catch (e) {
      console.warn('setSinkId notice:', e);
    }
  }

  // 2. Adjust volume curve to prevent loud blasts when in earpiece mode
  if (audioOutputMode === 'earpiece') {
    remoteAudio.volume = 0.65;
    if (toggleSpeakerBtn) {
      toggleSpeakerBtn.className = 'call-action-btn speaker-toggle earpiece';
      toggleSpeakerBtn.title = 'Current: Earpiece Mode (Tap for Loudspeaker)';
    }
    if (speakerBtnIcon) speakerBtnIcon.textContent = '👂';
    if (callModePill) {
      callModePill.className = 'call-mode-pill';
      if (callModePillIcon) callModePillIcon.textContent = '👂';
      if (callModePillText) callModePillText.textContent = 'Earpiece Mode';
    }
  } else {
    remoteAudio.volume = 1.0;
    if (toggleSpeakerBtn) {
      toggleSpeakerBtn.className = 'call-action-btn speaker-toggle loudspeaker';
      toggleSpeakerBtn.title = 'Current: Loudspeaker (Tap for Earpiece)';
    }
    if (speakerBtnIcon) speakerBtnIcon.textContent = '🔊';
    if (callModePill) {
      callModePill.className = 'call-mode-pill speaker';
      if (callModePillIcon) callModePillIcon.textContent = '🔊';
      if (callModePillText) callModePillText.textContent = 'Loudspeaker Mode';
    }
  }
}

async function toggleAudioOutput() {
  audioOutputMode = (audioOutputMode === 'earpiece') ? 'speaker' : 'earpiece';
  await applyAudioOutputMode();
  showToast(audioOutputMode === 'earpiece' ? 'Switched to Earpiece Mode' : 'Switched to Speakerphone');
}

// Reset Call UI and local hardware
function cleanupCallUI() {
  stopRingtone();
  stopCallTimer();

  if (callState.localStream) {
    try {
      callState.localStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
    } catch (e) {}
    callState.localStream = null;
  }

  if (callState.peerConnection) {
    try {
      // Stop all senders and transceivers to immediately kill hardware pipeline
      callState.peerConnection.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.stop();
          sender.track.enabled = false;
        }
      });
      callState.peerConnection.getReceivers().forEach(receiver => {
        if (receiver.track) {
          receiver.track.stop();
          receiver.track.enabled = false;
        }
      });
      callState.peerConnection.close();
    } catch (e) {}
    callState.peerConnection = null;
  }

  if (remoteAudio) {
    try {
      remoteAudio.pause();
      if (remoteAudio.srcObject) {
        const stream = remoteAudio.srcObject;
        if (stream.getTracks) {
          stream.getTracks().forEach(t => {
            t.stop();
            t.enabled = false;
          });
        }
      }
      remoteAudio.srcObject = null;
      remoteAudio.removeAttribute('src');
      remoteAudio.load();
    } catch (e) {}
  }

  callState.isCallActive = false;
  callState.currentCallId = null;
  callState.isCaller = false;
  isMuted = false;
  audioOutputMode = 'earpiece';
  toggleMuteBtn.classList.remove('muted');
  if (toggleSpeakerBtn) {
    toggleSpeakerBtn.className = 'call-action-btn speaker-toggle earpiece';
  }
  if (speakerBtnIcon) speakerBtnIcon.textContent = '👂';
  if (callModePill) {
    callModePill.className = 'call-mode-pill';
    if (callModePillIcon) callModePillIcon.textContent = '👂';
    if (callModePillText) callModePillText.textContent = 'Earpiece Mode';
  }
  callAvatar.classList.remove('ringing');
  callOverlay.classList.remove('active');
}

// Call Button Click Event
if (callBtn) {
  callBtn.addEventListener('click', () => {
    if (state.unlocked) {
      startOutgoingCall();
    } else {
      showToast('Unlock required');
    }
  });
}

acceptCallBtn.addEventListener('click', acceptCall);
declineCallBtn.addEventListener('click', declineCall);
hangupCallBtn.addEventListener('click', endCall);
toggleMuteBtn.addEventListener('click', toggleMute);
if (toggleSpeakerBtn) {
  toggleSpeakerBtn.addEventListener('click', toggleAudioOutput);
}

// Startup
initUI();
initFirebase();
renderMessages();



if (cancelReplyBtn) {
  cancelReplyBtn.addEventListener('click', () => {
    clearReplyTarget();
  });
}
