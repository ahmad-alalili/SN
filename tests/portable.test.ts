import { describe, expect, it } from 'vitest';
import { createPlainPortablePayload, decryptPortablePayload, encryptPortablePayload } from '../src/db/portable';

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

  it('يفتح الملف غير المشفر دون كلمة مرور', async () => {
    const original = JSON.stringify({ trainer: 'خالد', notes: ['بيانات يملكها صاحب الملف'] });
    const plain = createPlainPortablePayload(original, 'خالد');

    expect(plain).toContain('بيانات يملكها صاحب الملف');
    await expect(decryptPortablePayload(plain, '')).resolves.toBe(original);
  });
});
