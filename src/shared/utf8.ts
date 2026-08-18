export type Utf8Bounded = { value: string; truncated: boolean };

export const takeUtf8Prefix = (value: string, maxBytes: number): string => {
  if (maxBytes <= 0) return "";
  let bytesUsed = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytesUsed + characterBytes > maxBytes) break;
    result += character;
    bytesUsed += characterBytes;
  }
  return result;
};

export const boundUtf8 = (value: string, maxBytes: number): Utf8Bounded => {
  const bounded = takeUtf8Prefix(value, maxBytes);
  return { value: bounded, truncated: bounded.length < value.length };
};
