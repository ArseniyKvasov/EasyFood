/** Телефон или планшет: баннер установки нужен только там. */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iphone|ipad|ipod|android/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ представляется как Mac - отличаем по числу точек касания.
  return /macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}
