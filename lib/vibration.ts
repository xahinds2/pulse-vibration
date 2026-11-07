export function requestVibration(pattern: number | number[]) {
  if (typeof navigator.vibrate !== "function" || navigator.userActivation?.hasBeenActive === false) return false;
  return navigator.vibrate(pattern);
}
