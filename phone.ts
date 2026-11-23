// A US phone number as people read it: "(480) 555-0142". Anything that isn't
// ten digits (after a leading 1) is shown as it was typed.
// Nothing here imports app code, so `npm test` runs it straight under Node.
export function formatPhone(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  let digits = text.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return text;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
