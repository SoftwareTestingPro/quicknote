// Realtime Database & Storage Sync Module

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

// Initialize Firebase Realtime Database
function initFirebase() {
  const hasConfig = state.firebaseConfig && state.firebaseConfig.apiKey && state.firebaseConfig.databaseURL;
  if (!hasConfig) {
    if (connectionStatus) {
      connectionStatus.textContent = 'All notes synced';
      connectionStatus.style.color = 'var(--text-muted)';
    }
    
    const saved = localStorage.getItem('local_chat_' + state.roomId);
    if (saved) {
      try {
        state.messages = JSON.parse(saved);
      } catch (e) {
        state.messages = [];
      }
    } else {
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
    
    state.pinRef = db.ref('rooms/' + state.roomId + '/auth_pin');
    state.pinRef.on('value', async (snap) => {
      const val = snap.val();
      if (val) {
        const strVal = String(val).trim();
        if (/^[a-fA-F0-9]{64}$/.test(strVal)) {
          state.pinHash = strVal.toLowerCase();
        } else {
          state.pinHash = await hashPin(strVal);
        }
      }
    });

    if (connectionStatus) {
      connectionStatus.textContent = 'Syncing...';
      connectionStatus.style.color = '#38bdf8';
    }

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
      if (connectionStatus) {
        connectionStatus.textContent = 'All notes synced';
        connectionStatus.style.color = 'var(--text-muted)';
      }
      renderMessages(shouldPreserve);
    }, (error) => {
      console.error('Database sync error:', error);
      if (connectionStatus) {
        connectionStatus.textContent = 'Sync offline';
        connectionStatus.style.color = 'var(--text-muted)';
      }
    });

  } catch (err) {
    console.error('Firebase initialization:', err);
    if (connectionStatus) {
      connectionStatus.textContent = 'All notes synced';
      connectionStatus.style.color = 'var(--text-muted)';
    }
  }
}

