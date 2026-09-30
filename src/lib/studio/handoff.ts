let pending: File | "demo" | null = null;

export function setHandoff(value: File | "demo") {
  pending = value;
}

export function takeHandoff(): File | "demo" | null {
  const v = pending;
  pending = null;
  return v;
}
