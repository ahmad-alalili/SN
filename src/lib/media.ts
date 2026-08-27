export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ب`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

export function fmtDate(ts: number): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString('ar');
  }
}

export function kindIcon(kind: string): string {
  return kind === 'image' ? '🖼️' : kind === 'video' ? '🎬' : '🎙️';
}

export function kindLabel(kind: string): string {
  return kind === 'image' ? 'صورة' : kind === 'video' ? 'فيديو' : 'صوت';
}

/** توليد مصغّرة لصورة عبر canvas */
export async function imageThumbnail(blob: Blob, maxW = 320): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxW / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob | undefined>(res =>
      c.toBlob(b => res(b ?? undefined), 'image/jpeg', 0.75)
    );
  } catch { return undefined; }
}

/** توليد مصغّرة لفيديو عبر التقاط إطار */
export async function videoThumbnail(blob: Blob): Promise<Blob | undefined> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    const done = (out?: Blob) => { URL.revokeObjectURL(url); resolve(out); };
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.5, v.duration / 2);
        v.onseeked = async () => {
          const c = document.createElement('canvas');
          c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext('2d')!.drawImage(v, 0, 0);
          c.toBlob(b => done(b ?? undefined), 'image/jpeg', 0.7);
        };
      } catch { done(); }
    };
    v.onerror = () => done();
    setTimeout(() => done(), 5000);
  });
}

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

export function base64ToBlob(dataUrl: string, mime: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || head?.match(/data:(.*?);/)?.[1] });
}
