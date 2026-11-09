// UI Helpers & Disguise Mode Module

// Toast helper
function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

// Escape HTML for safe display
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

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function setReplyTarget(target) {
  if (!state.unlocked) return;
  activeReplyTo = target;
  if (!replyPreviewBar) return;
  if (target) {
    const isMe = typeof target.isMe === 'boolean' ? target.isMe : (target.sender === state.role);
    replyPreviewLabel.textContent = isMe ? 'Replying to yourself' : 'Replying to Note';
    replyPreviewText.textContent = target.text || (target.hasImage ? '📷 Photo' : 'Note');
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

function renderPinDots() {
  if (!pinDots) return;
  const dots = pinDots.querySelectorAll('.dot');
  dots.forEach((dot, idx) => {
    if (idx < state.enteredPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

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

// Inactivity Auto-Lock: if user stops touching/typing for 20 seconds while unlocked, lock automatically
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

// UI Setup & Viewport management
function initUI() {
  if (userAvatar) userAvatar.textContent = 'QN';
  if (partnerNameDisplay) partnerNameDisplay.textContent = 'Quick Note';
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

  // Role button switchers
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

  // Textarea input auto-expansion
  if (fakeInput) {
    fakeInput.addEventListener('input', () => autoResizeTextarea(fakeInput));
    fakeInput.addEventListener('keydown', () => {
      setTimeout(() => autoResizeTextarea(fakeInput), 0);
    });
  }
  if (secretInput) {
    secretInput.addEventListener('input', () => autoResizeTextarea(secretInput));
    secretInput.addEventListener('keydown', () => {
      setTimeout(() => autoResizeTextarea(secretInput), 0);
    });
  }

  // Toggle secret field button
  if (toggleSecretBtn) {
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
  }

  // Lightbox handlers
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

  // Cancel reply preview button
  if (cancelReplyBtn) {
    cancelReplyBtn.addEventListener('click', () => {
      clearReplyTarget();
    });
  }

  // Subscription / Mode badge trigger
  if (modeBadge) {
    modeBadge.addEventListener('click', () => {
      if (state.unlocked) {
        state.unlocked = false;
        updateModeBadge();
        renderMessages();
      } else {
        state.enteredPin = '';
        renderPinDots();
        if (pinModal) pinModal.classList.add('open');
      }
    });
  }

  // PIN modal cancel
  if (cancelPinBtn) {
    cancelPinBtn.addEventListener('click', () => {
      if (pinModal) pinModal.classList.remove('open');
      state.enteredPin = '';
    });
  }

  // Panic screen trigger and exit
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      if (panicScreen) panicScreen.classList.add('active');
      lockToDisguiseMode();
    });
  }
  if (exitPanicBtn) {
    exitPanicBtn.addEventListener('click', () => {
      if (panicScreen) panicScreen.classList.remove('active');
    });
  }

  // Auto-lock listeners
  window.addEventListener('blur', () => {
    if (isSelectingMedia) return;
    lockToDisguiseMode();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || document.visibilityState !== 'visible') {
      if (isSelectingMedia) return;
      lockToDisguiseMode();
    } else {
      if (!state.unlocked) {
        updateModeBadge();
        renderMessages();
      }
    }
  });

  window.addEventListener('focus', () => {
    if (isSelectingMedia) {
      setTimeout(() => { isSelectingMedia = false; }, 500);
      resetInactivityTimer();
      return;
    }
    if (!state.unlocked) {
      updateModeBadge();
      renderMessages();
    }
  });

  window.addEventListener('pageshow', () => {
    if (isSelectingMedia) {
      setTimeout(() => { isSelectingMedia = false; }, 500);
      return;
    }
    lockToDisguiseMode();
  });

  window.addEventListener('pagehide', () => {
    lockToDisguiseMode();
  });

  document.addEventListener('freeze', () => {
    lockToDisguiseMode();
  });

  // Inactivity touch/keypress listeners
  ['touchstart', 'mousedown', 'keydown', 'scroll'].forEach(evt => {
    window.addEventListener(evt, resetInactivityTimer, { passive: true });
  });
}

