/** Recognize conventional temp locations without querying the host OS. */
export function isTemporaryPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (/^(?:[a-z]:\/|\/\/)/i.test(normalized)) {
    return /^(?:[a-z]:\/Users\/[^/]+\/AppData\/Local\/Temp|[a-z]:\/Windows\/Temp|[a-z]:\/Temp)(?:\/|$)/i.test(normalized);
  }
  return /^(?:\/tmp|\/var\/tmp|\/private\/tmp|\/private\/var\/tmp)(?:\/|$)/.test(normalized)
    || /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T(?:\/|$)/.test(normalized)
    || /^%te?mp%(?:\/|$)/i.test(normalized);
}
