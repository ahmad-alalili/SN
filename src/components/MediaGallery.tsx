import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Note } from '../db/schema';
import { fmtDate, kindIcon, kindLabel, fmtSize } from '../lib/media';

/**
 * معرض مرفقات ملاحظة محفوظة — مصغرات من IndexedDB + عارض بالنقر.
 */
export default function MediaGallery({ noteId }: { noteId: number }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const atts = useLiveQuery(
    () => db.attachments.where('noteId').equals(noteId).toArray(),
    [noteId]
  ) ?? [];

  if (!atts.length) return null;

  return (
    <>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 pt-2">
        {atts.map((a, i) => (
          <Tile key={a.id} att={a} onClick={() => setViewer(i)} />
        ))}
      </div>
      {viewer !== null && atts[viewer] && (
        <Lightbox att={atts[viewer]} count={atts.length}
          idx={viewer}
          onNav={d => setViewer(v => ((v ?? 0) + d + atts.length) % atts.length)}
          onClose={() => setViewer(null)}
          onDelete={async () => {
            await db.attachments.delete(atts[viewer].id!);
            setViewer(null);
          }} />
      )}
    </>
  );
}

function Tile({ att, onClick }: { att: { id?: number; thumb?: Blob; blob: Blob; kind: string; size: number }; onClick: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(att.thumb ?? att.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [att]);

  return (
    <button type="button" onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
      {url && att.kind !== 'audio' ? (
        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full grid place-items-center text-xl">{kindIcon(att.kind)}</div>
      )}
      {att.kind === 'video' && url && (
        <span className="absolute inset-0 grid place-items-center text-white drop-shadow">▶️</span>
      )}
    </button>
  );
}

function Lightbox({ att, onClose, onNav, onDelete, idx, count }: {
  att: Note extends never ? never : { id?: number; kind: string; mime: string; name: string; size: number; blob: Blob };
  onClose: () => void; onNav: (d: number) => void; onDelete: () => void; idx: number; count: number;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(att.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [att]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between p-3 text-white" onClick={e => e.stopPropagation()}>
        <span className="text-xs opacity-80">{kindIcon(att.kind)} {kindLabel(att.kind)} • {fmtSize(att.size)} • {idx + 1}/{count}</span>
        <div className="flex gap-2">
          <button className="btn !py-1.5 bg-red-600 text-white text-xs" onClick={onDelete}>🗑️ حذف</button>
          <button className="btn !py-1.5 bg-white/15 text-white text-xs" onClick={onClose}>✕ إغلاق</button>
        </div>
      </div>
      <div className="flex-1 grid place-items-center min-h-0 px-2 pb-2" onClick={onClose}>
        {url && att.kind === 'image' && (
          <img src={url} alt={att.name} className="max-w-full max-h-full object-contain rounded-lg" />
        )}
        {url && att.kind === 'video' && (
          <video src={url} controls autoPlay className="max-w-full max-h-full rounded-lg" />
        )}
        {url && att.kind === 'audio' && (
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-3 text-center">
            <div className="text-5xl">🎙️</div>
            <p className="font-bold text-sm">{att.name}</p>
            <audio src={url} controls autoPlay className="w-full" />
          </div>
        )}
      </div>
      {count > 1 && (
        <div className="flex justify-center gap-4 pb-4" onClick={e => e.stopPropagation()}>
          <button className="btn bg-white/15 text-white text-xs" onClick={() => onNav(1)}>→ التالي</button>
          <button className="btn bg-white/15 text-white text-xs" onClick={() => onNav(-1)}>السابق ←</button>
        </div>
      )}
    </div>
  );
}

export function AttachmentCountBadge({ noteId }: { noteId: number }) {
  const count = useLiveQuery(() => db.attachments.where('noteId').equals(noteId).count(), [noteId]) ?? 0;
  if (!count) return null;
  return <span className="chip bg-blue-100 !text-blue-800">📎 {count}</span>;
}

export function AttachmentSummary({ noteId }: { noteId: number }) {
  const atts = useLiveQuery(() => db.attachments.where('noteId').equals(noteId).toArray(), [noteId]) ?? [];
  if (!atts.length) return null;
  const byKind = atts.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.kind]: (acc[a.kind] || 0) + 1 }), {});
  return (
    <span className="chip bg-blue-100 !text-blue-800">
      📎 {Object.entries(byKind).map(([k, n]) => `${kindIcon(k)}×${n}`).join(' ')}
    </span>
  );
}

export { fmtDate };
