/** Ужимает фото до разумного размера перед отправкой на распознавание. */
export async function fileToImageBlob(
  file: File,
  maxEdge = 1024,
  quality = 0.82,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('CANVAS_FAILED'))),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Запасной путь: фото уходит на сервер прямо в теле запроса.
 * Используется только когда S3 не настроен.
 */
export async function fileToDataUrl(file: File, maxEdge = 1024, quality = 0.82): Promise<string> {
  const blob = await fileToImageBlob(file, maxEdge, quality);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.readAsDataURL(blob);
  });
}
