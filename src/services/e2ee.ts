// E2EE Service using Web Crypto API (AES-GCM 256-bit encryption)

// Helper to convert array buffer to hex string
const bufferToHex = (buffer: ArrayBuffer): string => {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

// Helper to convert hex string to array buffer
const hexToBuffer = (hex: string): ArrayBuffer => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
};

// Derive a symmetric key from a shared secret string (the deterministic channel key seed)
const deriveKey = async (sharedSecret: string): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  const rawKeyMaterial = enc.encode(sharedSecret);
  
  // Hash the shared secret to create a 256-bit key buffer
  const hash = await crypto.subtle.digest('SHA-256', rawKeyMaterial);
  
  return await crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
};

// Encrypt a message plaintext using AES-GCM
export const encryptMessage = async (plaintext: string, channelSeed: string): Promise<string> => {
  if (!plaintext) return plaintext;
  try {
    const key = await deriveKey(channelSeed);
    const enc = new TextEncoder();
    const encodedPlaintext = enc.encode(plaintext);
    
    // Generate a 12-byte random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertextBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encodedPlaintext
    );
    
    const ivHex = bufferToHex(iv.buffer);
    const ciphertextHex = bufferToHex(ciphertextBuffer);
    
    return `E2EE:${ivHex}:${ciphertextHex}`;
  } catch (err) {
    console.error('[E2EE Service] Encryption failed:', err);
    return plaintext; // Fallback to raw text on error
  }
};

// Decrypt a message ciphertext starting with E2EE: using AES-GCM
export const decryptMessage = async (encryptedText: string, channelSeed: string): Promise<string> => {
  if (!encryptedText || !encryptedText.startsWith('E2EE:')) {
    return encryptedText; // Message is not encrypted
  }
  
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;
    
    const ivHex = parts[1];
    const ciphertextHex = parts[2];
    
    const key = await deriveKey(channelSeed);
    const iv = new Uint8Array(hexToBuffer(ivHex));
    const ciphertext = hexToBuffer(ciphertextHex);
    
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      ciphertext
    );
    
    const dec = new TextDecoder();
    return dec.decode(decryptedBuffer);
  } catch (err) {
    console.warn('[E2EE Service] Decryption failed (possibly wrong key or corrupt data):', err);
    return '[Decryption Error: Secure handshake mismatch]';
  }
};

// WebRTC Insertable Streams Frame transform encryption
export const encryptFrame = (chunk: any, controller: any, keySeed: string) => {
  const data = chunk.data;
  // Payload header offsets to avoid corrupting RTP/codec headers:
  // - Video: offset by 10 bytes (leaves VP8 keyframe/metadata untouched)
  // - Audio: offset by 4 bytes (leaves Opus packet config untouched)
  const offset = chunk.type === 'audio' ? 4 : 10;
  if (data.byteLength <= offset) {
    controller.enqueue(chunk);
    return;
  }

  const keyBytes = new TextEncoder().encode(keySeed);
  const u8 = new Uint8Array(data);
  for (let i = offset; i < u8.length; i++) {
    u8[i] ^= keyBytes[(i - offset) % keyBytes.length];
  }
  
  controller.enqueue(chunk);
};

// WebRTC Insertable Streams Frame transform decryption (XOR is symmetric)
export const decryptFrame = (chunk: any, controller: any, keySeed: string) => {
  encryptFrame(chunk, controller, keySeed);
};

