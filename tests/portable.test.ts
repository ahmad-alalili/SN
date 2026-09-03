import { describe, expect, it } from 'vitest';
import { decryptPortablePayload, encryptPortablePayload } from '../src/db/portable';

describe('ملف المدرب المحمول', () => {
  it('يشفر البيانات ويعيدها كاملة بكلمة المرور الصحيحة', async () => {
    const original = JSON.stringify({ trainer: 'أحمد', notes: ['ملاحظة أولى'], createdAt: 123 });
    const encrypted = await encryptPortablePayload(original, 'أحمد', 'secret-123');

    expect(encrypted).not.toContain('ملاحظة أولى');
    await expect(decryptPortablePayload(encrypted, 'secret-123')).resolves.toBe(original);
  });

  it('يرفض كلمة المرور الخاطئة', async () => {
    const encrypted = await encryptPortablePayload('{"ok":true}', 'مدرب', 'correct-password');
    await expect(decryptPortablePayload(encrypted, 'wrong-password')).rejects.toThrow('كلمة المرور غير صحيحة');
  });
});
