/**
 * Minimal base58 (Bitcoin/Solana alphabet) encode/decode — no dependencies.
 * Solana public keys and signatures are base58 strings; we need the raw bytes
 * to verify ed25519 signatures with Node's crypto.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET[i]] = i;
  return m;
})();

export function base58Decode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  const bytes: number[] = [0];
  for (const ch of str) {
    const value = MAP[ch];
    if (value === undefined) throw new Error("Invalid base58 character: " + ch);
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // leading '1's are leading zero bytes
  for (let k = 0; k < str.length && str[k] === "1"; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}
