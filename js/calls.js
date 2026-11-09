// WebRTC Internet Voice Calling Module

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
  if (callDuration) {
    callDuration.classList.add('active');
    callDuration.textContent = '00:00';
  }
  if (callState.timerInterval) clearInterval(callState.timerInterval);
  callState.timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - callState.startTime) / 1000);
    const mins = String(Math.floor(diff / 60)).padStart(2, '0');
    const secs = String(diff % 60).padStart(2, '0');
    if (callDuration) callDuration.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopCallTimer() {
  if (callState.timerInterval) {
    clearInterval(callState.timerInterval);
    callState.timerInterval = null;
  }
  if (callDuration) {
    callDuration.classList.remove('active');
    callDuration.textContent = '00:00';
  }
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
        if (callStatusText) callStatusText.textContent = 'Connected';
        if (callAvatar) callAvatar.classList.remove('ringing');
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
    if (callTitle) callTitle.textContent = 'Calling...';
    if (callStatusText) callStatusText.textContent = 'Ringing partner...';
    if (callAvatar) callAvatar.classList.add('ringing');
    if (callIncomingActions) callIncomingActions.classList.add('hidden');
    if (callActiveActions) callActiveActions.classList.remove('hidden');
    if (callOverlay) callOverlay.classList.add('active');
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
  if (callTitle) callTitle.textContent = 'Incoming Call';
  if (callStatusText) callStatusText.textContent = 'Voice Call from Partner';
  if (callAvatar) callAvatar.classList.add('ringing');
  if (callIncomingActions) callIncomingActions.classList.remove('hidden');
  if (callActiveActions) callActiveActions.classList.add('hidden');
  if (callDuration) callDuration.classList.remove('active');
  if (callOverlay) callOverlay.classList.add('active');
  playRingtone();
}

// Accept incoming call
async function acceptCall() {
  stopRingtone();
  if (callStatusText) callStatusText.textContent = 'Connecting...';
  if (callIncomingActions) callIncomingActions.classList.add('hidden');
  if (callActiveActions) callActiveActions.classList.remove('hidden');

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
    if (callStatusText) callStatusText.textContent = 'Connected';
    if (callAvatar) callAvatar.classList.remove('ringing');
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
      if (toggleMuteBtn) toggleMuteBtn.classList.toggle('muted', isMuted);
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
  if (toggleMuteBtn) toggleMuteBtn.classList.remove('muted');
  if (toggleSpeakerBtn) {
    toggleSpeakerBtn.className = 'call-action-btn speaker-toggle earpiece';
  }
  if (speakerBtnIcon) speakerBtnIcon.textContent = '👂';
  if (callModePill) {
    callModePill.className = 'call-mode-pill';
    if (callModePillIcon) callModePillIcon.textContent = '👂';
    if (callModePillText) callModePillText.textContent = 'Earpiece Mode';
  }
  if (callAvatar) callAvatar.classList.remove('ringing');
  if (callOverlay) callOverlay.classList.remove('active');
}

function initCalls() {
  if (callBtn) {
    callBtn.addEventListener('click', () => {
      if (state.unlocked) {
        startOutgoingCall();
      } else {
        showToast('Unlock required');
      }
    });
  }

  if (acceptCallBtn) acceptCallBtn.addEventListener('click', acceptCall);
  if (declineCallBtn) declineCallBtn.addEventListener('click', declineCall);
  if (hangupCallBtn) hangupCallBtn.addEventListener('click', endCall);
  if (toggleMuteBtn) toggleMuteBtn.addEventListener('click', toggleMute);
  if (toggleSpeakerBtn) {
    toggleSpeakerBtn.addEventListener('click', toggleAudioOutput);
  }
}

