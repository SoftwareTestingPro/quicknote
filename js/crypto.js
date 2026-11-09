// Crypto & Hash Module
// Native Web Crypto SHA-256 and XOR + Base64 symmetric encryption

const MAGIC_PREFIX = 'QN::';

// Fast native Web Crypto SHA-256 hashing
async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(pin).toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple XOR + Base64 encryption with the shared PIN so secret messages aren't plain text in the cloud
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

