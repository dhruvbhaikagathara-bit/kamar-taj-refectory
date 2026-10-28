import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",

  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },

  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
});

const privateBase64 = Buffer.from(
  privateKey,
  "utf8"
).toString("base64");

const publicBase64 = Buffer.from(
  publicKey,
  "utf8"
).toString("base64");

console.log(
  "\nCopy these three lines into your local .env.local:\n"
);

console.log("QR_SIGNING_KEY_ID=qr-es256-v1");
console.log(`QR_PRIVATE_KEY_BASE64=${privateBase64}`);
console.log(`QR_PUBLIC_KEY_BASE64=${publicBase64}`);

console.log(
  "\nKeep the private key secret. Do not share this output or commit .env.local."
);