// Chat Message List & Message Bubble Rendering Module

function renderMessages(preserveScroll = false) {
  if (!chatMessagesEl) return;
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
  const hasDistinctSenders = state.messages.some(m => m.sender === 'user2') && state.messages.some(m => m.sender === 'user1');

  state.messages.forEach((msg, idx) => {
    let isMe;
    let effectiveSender;
    if (hasDistinctSenders && msg.sender) {
      effectiveSender = msg.sender;
      isMe = (msg.sender === state.role);
    } else {
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
    let visibleImageSrc = null;

    if (state.unlocked && msg.encryptedSecret) {
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
          bubble.classList.add('is-secret');
          break;
        }
      }
    }

    // Determine image visibility
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
      const isEmojiOnly = state.unlocked && !visibleImageSrc && isOnlyEmojis(displayText);
      if (isEmojiOnly) {
        bubble.classList.add('bubble-emoji-only');
      }
      contentHtml += `<div class="msg-content ${isEmojiOnly ? 'msg-emoji-large' : ''}">${formatMessageContent(displayText, state.unlocked)}</div>`;
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

    // Swipe handlers: Right-swipe to delete, Left-swipe to reply, Long-press for emoji reaction
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
      if (!state.unlocked) return;
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

      if (Math.abs(diffX) > 8 || Math.abs(diffY) > 8) {
        cancelLongPress();
      }

      if (isHorizontal === null) {
        if (Math.abs(diffX) > 6 || Math.abs(diffY) > 6) {
          isHorizontal = Math.abs(diffX) > Math.abs(diffY);
        }
      }

      if (!isHorizontal) return;

      if (diffX > 0) {
        if (e && e.cancelable) e.preventDefault();
        currentX = x;
        const translateX = Math.min(diffX, 160);
        bubble.style.transform = `translateX(${translateX}px)`;
        const progress = Math.min(diffX / 90, 1);
        deleteBg.style.opacity = progress;
        replyBg.style.opacity = '0';
      } else if (diffX < 0 && state.unlocked) {
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
        bubble.style.transition = 'transform 0.2s ease';
        bubble.style.transform = 'translateX(0)';
        replyBg.style.opacity = '0';
        
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
      if (e.button !== 0) return;
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

