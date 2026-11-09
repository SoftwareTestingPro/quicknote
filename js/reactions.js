// Emoji Reactions Module

let activeReactionMsg = null;

const EXTENDED_EMOJIS = [
  '❤️', '😇', '😎', '😏', '😊', '😉', '😈', '😆', '😅', '😄',
  '👍', '👎', '❤', '🔥', '✨', '😂', '❤️',
  '❤', '😢', '😮', '❤', '👏', '❤', '🙏',
  '😊', '😋', '❤', '😍', '❤', '😏',
  '😐', '😑', '❤', '😓', '❤', '😕',
  '😗', '😘', '❤', '😚', '❤', '😜'
];

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

function initReactions() {
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
}

