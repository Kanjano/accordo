/** SPEC §5.9 step 1: resize on the device (long side ≤ 2560 px), JPEG output, orientation applied. */
export const MAX_SIDE = 2560;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export class UnsupportedPhotoError extends Error {
  constructor(readonly reason: 'heic' | 'unsupported') {
    super(reason);
  }
}

export async function prepareForUpload(
  file: Blob & { name?: string },
  rotateDegrees = 0,
): Promise<Blob> {
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? '');
  if (!ACCEPTED.includes(file.type) && !isHeic) throw new UnsupportedPhotoError('unsupported');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Most browsers cannot decode HEIC: ask the user to convert it.
    throw new UnsupportedPhotoError(isHeic ? 'heic' : 'unsupported');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const quarter = ((rotateDegrees % 360) + 360) % 360;
  const swap = quarter === 90 || quarter === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UnsupportedPhotoError('unsupported');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((quarter * Math.PI) / 180);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new UnsupportedPhotoError('unsupported'))),
      'image/jpeg',
      0.88,
    ),
  );
}

/** Uploads with progress via XHR (fetch has no upload progress). */
export function postToStorage(
  url: string,
  fields: Record<string, string>,
  blob: Blob,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', blob);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () =>
      xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
}
