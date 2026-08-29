import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedToken = {
  ciphertext: string;
  iv: string;
  tag: string;
};

const keyFrom = (encodedKey: string): Buffer => {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("Invalid token encryption key");
  return key;
};

export const encryptToken = (
  token: string,
  encodedKey: string,
): EncryptedToken => {
  const ivBytes = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(encodedKey), ivBytes);
  const iv = ivBytes.toString("base64");
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]).toString("base64");
  return { ciphertext, iv, tag: cipher.getAuthTag().toString("base64") };
};

export const decryptToken = (
  encrypted: EncryptedToken,
  encodedKey: string,
): string => {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFrom(encodedKey),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
};
