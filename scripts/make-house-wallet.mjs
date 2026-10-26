// Create the house hot wallet keypair file (same format as `solana-keygen`).
//
//   node scripts/make-house-wallet.mjs /opt/vanta/house.keypair.json
//
// Prints the public address to fund. The file holds the SECRET key: chmod 600,
// never commit it, back it up offline, and keep only what you can lose in it.
import { Keypair } from "@solana/web3.js";
import { existsSync, writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/make-house-wallet.mjs <path/to/house.keypair.json>");
  process.exit(1);
}
if (existsSync(out)) {
  console.error(`${out} already exists — refusing to overwrite a wallet key.`);
  process.exit(1);
}
const kp = Keypair.generate();
writeFileSync(out, JSON.stringify([...kp.secretKey]), { mode: 0o600 });
console.log(`House wallet written to ${out}`);
console.log(`Public address (fund this, set HOUSE_KEYPAIR_FILE to the path): ${kp.publicKey.toBase58()}`);
