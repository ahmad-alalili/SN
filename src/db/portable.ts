import type { Table } from 'dexie';
import { db, type PortableFileLink } from './schema';
import { exportBackup, importBackup } from './backup';
import { saveAs } from '../lib/excel';

interface WritableFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: unknown) => Promise<WritableFileHandle>;
    showOpenFilePicker?: (options?: unknown) => Promise<WritableFileHandle[]>;
  }
}

interface PortableEnvelope {
  app: 'trainer-notes-portable';
  version: 1;
  trainerName: string;
  exportedAt: number;
  encryption: {
    algorithm: 'AES-GCM';
    kdf: 'PBKDF2-SHA-256';
    iterations: number;
    salt: string;
    iv: string;
  };
  ciphertext: string;
}

export interface PickedPortableFile {
  file: File;
  handle?: WritableFileHandle;
}

export type PortableSaveResult = 'saved' | 'downloaded' | 'needs-permission' | 'not-linked';

const ITERATIONS = 250_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const saveQueues = new Map<number, Promise<PortableSaveResult>>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function createEnvelope(plaintext: string, trainerName: string, key: CryptoKey, salt: string): Promise<PortableEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoder.encode(plaintext))
  );
  return {
    app: 'trainer-notes-portable',
    version: 1,
    trainerName,
    exportedAt: Date.now(),
    encryption: {
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA-256',
      iterations: ITERATIONS,
      salt,
      iv: bytesToBase64(iv)
    },
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

async function decryptEnvelope(envelope: PortableEnvelope, key: CryptoKey): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(envelope.encryption.iv)) },
    key,
    toArrayBuffer(base64ToBytes(envelope.ciphertext))
  );
  return decoder.decode(decrypted);
}

async function encryptedTrainerBlob(trainerId: number, trainerName: string, key: CryptoKey, salt: string): Promise<Blob> {
  const backup = await exportBackup(true, trainerId);
  const envelope = await createEnvelope(await backup.text(), trainerName, key, salt);
  return new Blob([JSON.stringify(envelope)], { type: 'application/vnd.trainer-notes+json' });
}

function safeFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  return `ملف-${safe || 'المدرب'}.trainer-notes`;
}

export function supportsDirectPortableFiles(): boolean {
  return typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
}

export async function pickPortableSaveHandle(trainerName: string): Promise<WritableFileHandle | undefined> {
  if (!window.showSaveFilePicker) return undefined;
  return window.showSaveFilePicker({
    suggestedName: safeFileName(trainerName),
    types: [{
      description: 'ملف ملاحظات المدرب المشفر',
      accept: { 'application/vnd.trainer-notes+json': ['.trainer-notes'] }
    }]
  });
}

export async function pickPortableOpenFile(): Promise<PickedPortableFile | null> {
  if (!window.showOpenFilePicker) return null;
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [{
      description: 'ملف ملاحظات المدرب المشفر',
      accept: { 'application/vnd.trainer-notes+json': ['.trainer-notes'] }
    }]
  });
  return { handle, file: await handle.getFile() };
}

export async function linkPortableTrainer(
  trainerId: number,
  trainerName: string,
  password: string,
  handle?: WritableFileHandle
): Promise<PortableFileLink> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const link: PortableFileLink = {
    trainerId,
    fileName: handle?.name || safeFileName(trainerName),
    handle,
    key: await deriveKey(password, saltBytes),
    salt: bytesToBase64(saltBytes),
    direct: !!handle,
    dirty: true,
    lastChangedAt: Date.now()
  };
  await db.portableFiles.put(link);
  return link;
}

async function performLinkedSave(
  trainerId: number,
  options: { userInitiated?: boolean; downloadFallback?: boolean } = {}
): Promise<PortableSaveResult> {
  const saveStartedAt = Date.now();
  const link = await db.portableFiles.get(trainerId);
  if (!link) return 'not-linked';
  const trainer = await db.trainers.get(trainerId);
  if (!trainer) return 'not-linked';
  const blob = await encryptedTrainerBlob(trainerId, trainer.name, link.key, link.salt);
  const handle = link.handle as WritableFileHandle | undefined;

  if (handle) {
    let permission: PermissionState = await handle.queryPermission?.({ mode: 'readwrite' }) ?? 'granted';
    if (permission !== 'granted' && options.userInitiated && handle.requestPermission) {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    }
    if (permission !== 'granted') {
      await db.portableFiles.update(trainerId, { dirty: true });
      return 'needs-permission';
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    const current = await db.portableFiles.get(trainerId);
    await db.portableFiles.update(trainerId, {
      dirty: (current?.lastChangedAt ?? 0) > saveStartedAt,
      lastSavedAt: Date.now()
    });
    return 'saved';
  }

  if (options.userInitiated || options.downloadFallback) {
    saveAs(blob, link.fileName);
    const current = await db.portableFiles.get(trainerId);
    await db.portableFiles.update(trainerId, {
      dirty: (current?.lastChangedAt ?? 0) > saveStartedAt,
      lastSavedAt: Date.now()
    });
    return 'downloaded';
  }
  await db.portableFiles.update(trainerId, { dirty: true });
  return 'needs-permission';
}

export function saveLinkedTrainer(
  trainerId: number,
  options: { userInitiated?: boolean; downloadFallback?: boolean } = {}
): Promise<PortableSaveResult> {
  const previous = saveQueues.get(trainerId);
  const queued = (previous ? previous.catch(() => 'not-linked' as const) : Promise.resolve('not-linked' as const))
    .then(() => performLinkedSave(trainerId, options));
  saveQueues.set(trainerId, queued);
  const cleanup = () => {
    if (saveQueues.get(trainerId) === queued) saveQueues.delete(trainerId);
  };
  void queued.then(cleanup, cleanup);
  return queued;
}

function parseEnvelope(text: string): PortableEnvelope {
  const parsed = JSON.parse(text) as Partial<PortableEnvelope>;
  if (parsed.app !== 'trainer-notes-portable' || parsed.version !== 1 ||
      parsed.encryption?.algorithm !== 'AES-GCM' || parsed.encryption.kdf !== 'PBKDF2-SHA-256' ||
      typeof parsed.encryption.salt !== 'string' || typeof parsed.encryption.iv !== 'string' ||
      typeof parsed.ciphertext !== 'string') {
    throw new Error('الملف ليس ملف مدرب صالحاً');
  }
  return parsed as PortableEnvelope;
}

/** Pure helpers used by compatibility tests and future native wrappers. */
export async function encryptPortablePayload(plaintext: string, trainerName: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  return JSON.stringify(await createEnvelope(plaintext, trainerName, key, bytesToBase64(salt)));
}

export async function decryptPortablePayload(contents: string, password: string): Promise<string> {
  const envelope = parseEnvelope(contents);
  const key = await deriveKey(password, base64ToBytes(envelope.encryption.salt));
  try {
    return await decryptEnvelope(envelope, key);
  } catch {
    throw new Error('كلمة المرور غير صحيحة أو الملف تالف');
  }
}

export async function importPortableTrainer(
  picked: PickedPortableFile,
  password: string
): Promise<{ id: number; name: string }> {
  const envelope = parseEnvelope(await picked.file.text());
  const salt = base64ToBytes(envelope.encryption.salt);
  const key = await deriveKey(password, salt);
  let plaintext: string;
  try {
    plaintext = await decryptEnvelope(envelope, key);
  } catch {
    throw new Error('كلمة المرور غير صحيحة أو الملف تالف');
  }
  const backupFile = new File([plaintext], 'trainer-backup.json', { type: 'application/json' });
  await importBackup(backupFile);
  const trainers = await db.trainers.toArray();
  const trainer = trainers[0];
  if (trainers.length !== 1 || !trainer || typeof trainer.id !== 'number') {
    throw new Error('ملف المدرب لا يحتوي على ملف شخصي واحد صالح');
  }
  const trainerId = trainer.id;
  await db.portableFiles.put({
    trainerId,
    fileName: picked.handle?.name || picked.file.name,
    handle: picked.handle,
    key,
    salt: envelope.encryption.salt,
    direct: !!picked.handle,
    dirty: false,
    lastChangedAt: envelope.exportedAt,
    lastSavedAt: envelope.exportedAt
  });
  return { id: trainerId, name: trainer.name };
}

export function watchPortableTrainer(trainerId: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    setTimeout(() => void db.portableFiles.update(trainerId, { dirty: true, lastChangedAt: Date.now() }), 0);
    timer = setTimeout(() => void saveLinkedTrainer(trainerId).catch(() => {
      void db.portableFiles.update(trainerId, { dirty: true });
    }), 1200);
  };
  const tables: Table[] = [
    db.trainers, db.courses, db.studyTerms, db.trainees, db.categories,
    db.academicYears, db.notes, db.attachments, db.importLogs, db.settings
  ];
  for (const table of tables) {
    table.hook('creating').subscribe(schedule);
    table.hook('updating').subscribe(schedule);
    table.hook('deleting').subscribe(schedule);
  }
  return () => {
    clearTimeout(timer);
    for (const table of tables) {
      table.hook('creating').unsubscribe(schedule);
      table.hook('updating').unsubscribe(schedule);
      table.hook('deleting').unsubscribe(schedule);
    }
  };
}
