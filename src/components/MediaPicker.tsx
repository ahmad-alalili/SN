import { useState, useRef, useEffect } from 'react';
import { fmtSize, kindIcon, kindLabel, imageThumbnail, videoThumbnail } from '../lib/media';
import type { AttachmentKind } from '../db/schema';

export interface PendingMedia {
  key: string;
  kind: AttachmentKind;
  mime: string;
  name: string;
  size: number;
  blob: Blob;
  thumb?: Blob;
}

const MAX_FILE = 25 * 1024 * 1024; // 25MB لكل ملف

export default function MediaPicker({
  items, onChange
}: {
  items: PendingMedia[];
  onChange: (items: PendingMedia[]) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    const next = [...items];
    for (const f of Array.from(files)) {
      const kind: AttachmentKind = f.type.startsWith('image/') ? 'image'
        : f.type.startsWith('video/') ? 'video'
        : f.type.startsWith('audio/') ? 'audio' : null!;
      if (!kind) continue;
      if (f.size > MAX_FILE) {
        alert(`الملف «${f.name}» أكبر من 25 م.ب — تجاوزه`);
        continue;
      }
      let thumb: Blob | undefined;
      if (kind === 'image') thumb = await imageThumbnail(f) ?? undefined;
      if (kind === 'video') thumb = await videoThumbnail(f) ?? undefined;
      next.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind, mime: f.type || 'application/octet-stream',
        name: f.name, size: f.size, blob: f, thumb
      });
    }
    onChange(next);
  }

  /* ================= التسجيل الصوتي ================= */
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = e => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        onChange([...items, {
          key: `rec-${Date.now()}`,
          kind: 'audio', mime: blob.type,
          name: `تسجيل-${new Date().toLocaleTimeString('ar-SA')}.webm`,
          size: blob.size, blob,
          thumb: undefined
        }]);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true); setRecSecs(0);
      timerRef.current = setInterval(() => setRecSecs(s => s + 1), 1000);
    } catch {
      alert('تعذر الوصول إلى الميكروفون — تأكد من الإذن');
    }
  }
  function stopRec() {
    recRef.current?.stop();
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost !py-2 text-xs" onClick={() => fileRef.current?.click()}>
          🖼️ صورة
        </button>
        <button type="button" className="btn-ghost !py-2 text-xs" onClick={() => videoFileRef.current?.click()}>
          🎬 فيديو
        </button>
        {!recording ? (
          <button type="button" className="btn-ghost !py-2 text-xs" onClick={startRec}>🎙️ تسجيل صوتي</button>
        ) : (
          <button type="button" className="btn !py-2 text-xs bg-red-600 text-white animate-pulse" onClick={stopRec}>
            ⏹ إيقاف ({fmtTime(recSecs)})
          </button>
        )}
      </div>

      {/* منطقة السحب والإفلات */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        className={`rounded-xl border-2 border-dashed text-center text-xs py-3 transition ${
          dragOver ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-400'}`}>
        اسحب الصور أو الفيديو هنا (أو استخدم الأزرار أعلاه)
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={e => { e.target.files && addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={videoFileRef} type="file" accept="video/*,audio/*" multiple hidden
        onChange={e => { e.target.files && addFiles(e.target.files); e.target.value = ''; }} />

      {items.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {items.map(m => (
            <ThumbTile key={m.key} m={m} onRemove={() => onChange(items.filter(x => x.key !== m.key))} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThumbTile({ m, onRemove }: { m: PendingMedia; onRemove: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const src = m.thumb ?? m.blob;
    const u = URL.createObjectURL(src);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [m]);

  return (
    <div className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
      {url && m.kind !== 'audio' ? (
        <img src={url} alt={m.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full grid place-items-center text-2xl">{kindIcon(m.kind)}</div>
      )}
      {m.kind === 'video' && url && (
        <span className="absolute inset-0 grid place-items-center text-white drop-shadow text-2xl">▶️</span>
      )}
      <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[9px] px-1 py-0.5 truncate">
        {kindLabel(m.kind)} • {fmtSize(m.size)}
      </span>
      <button type="button" onClick={onRemove} title="إزالة"
        className="absolute top-1 left-1 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold opacity-90">
        ✕
      </button>
    </div>
  );
}

function fmtTime(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
