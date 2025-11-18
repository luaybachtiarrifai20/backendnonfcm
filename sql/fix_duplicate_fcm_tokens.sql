-- Fix: Hapus duplicate FCM tokens
-- Masalah: 1 user punya multiple tokens dengan token berbeda

USE manajemen_sekolah;

-- ==================== DIAGNOSIS ====================

-- 1. Cek users yang punya multiple tokens
SELECT 
  '1. Users dengan multiple tokens' as info,
  u.nama,
  u.email,
  u.role,
  ft.user_id,
  ft.device_type,
  COUNT(*) as total_tokens
FROM fcm_tokens ft
JOIN users u ON ft.user_id = u.id
GROUP BY ft.user_id, ft.device_type
HAVING COUNT(*) > 1
ORDER BY total_tokens DESC;

-- 2. Detail tokens untuk user yang duplicate
SELECT 
  '2. Detail duplicate tokens' as info,
  u.nama,
  ft.user_id,
  ft.device_type,
  SUBSTRING(ft.token, 1, 30) as token_preview,
  ft.is_active,
  ft.created_at,
  ft.updated_at
FROM fcm_tokens ft
JOIN users u ON ft.user_id = u.id
WHERE ft.user_id IN (
  SELECT user_id 
  FROM fcm_tokens 
  GROUP BY user_id, device_type 
  HAVING COUNT(*) > 1
)
ORDER BY ft.user_id, ft.updated_at DESC;

-- 3. Total tokens per user
SELECT 
  '3. Summary tokens' as info,
  COUNT(DISTINCT user_id) as total_users,
  COUNT(*) as total_tokens,
  COUNT(*) - COUNT(DISTINCT user_id) as duplicate_tokens
FROM fcm_tokens;

-- ==================== SOLUSI ====================

-- SOLUSI 1: Hapus duplicate tokens, simpan hanya yang terbaru
-- Ini akan menghapus token lama dan menyimpan hanya token dengan updated_at terbaru

-- BACKUP terlebih dahulu (UNCOMMENT untuk backup)
/*
CREATE TABLE fcm_tokens_backup AS SELECT * FROM fcm_tokens;
SELECT 'Backup berhasil dibuat!' as result;
*/

-- Hapus duplicate tokens (simpan hanya yang terbaru per user per device_type)
DELETE t1 FROM fcm_tokens t1
INNER JOIN fcm_tokens t2 
WHERE t1.user_id = t2.user_id 
  AND t1.device_type = t2.device_type
  AND t1.updated_at < t2.updated_at;

SELECT 'Duplicate tokens berhasil dihapus!' as result;

-- SOLUSI 2: Tambahkan UNIQUE constraint untuk mencegah duplicate di masa depan
-- Ini akan error jika masih ada duplicate, jadi jalankan SOLUSI 1 terlebih dahulu

ALTER TABLE fcm_tokens
DROP INDEX IF EXISTS unique_user_device;

ALTER TABLE fcm_tokens
ADD UNIQUE KEY unique_user_device (user_id, device_type);

SELECT 'UNIQUE constraint berhasil ditambahkan!' as result;

-- ==================== VERIFIKASI ====================

-- Cek lagi apakah masih ada duplicate
SELECT 
  'Verifikasi: Masih ada duplicate?' as info,
  COUNT(*) as users_with_multiple_tokens
FROM (
  SELECT user_id, device_type
  FROM fcm_tokens
  GROUP BY user_id, device_type
  HAVING COUNT(*) > 1
) as duplicates;

-- Summary setelah cleanup
SELECT 
  'Summary setelah cleanup' as info,
  COUNT(DISTINCT user_id) as total_users,
  COUNT(*) as total_tokens,
  COUNT(*) - COUNT(DISTINCT user_id) as should_be_zero
FROM fcm_tokens;

-- Tokens per user (harus 1 per device_type)
SELECT 
  u.nama,
  u.email,
  u.role,
  ft.device_type,
  COUNT(*) as tokens,
  MAX(ft.updated_at) as last_updated
FROM fcm_tokens ft
JOIN users u ON ft.user_id = u.id
GROUP BY ft.user_id, ft.device_type
ORDER BY tokens DESC, u.nama;

-- ==================== CATATAN ====================

/*
PENJELASAN:

1. Kenapa ada duplicate?
   - User logout-login berkali-kali
   - Token FCM di-refresh/regenerate
   - App reinstall atau clear data
   - Token lama tidak dihapus otomatis

2. Dampak duplicate:
   - User dapat notifikasi multiple kali
   - Boros resources (kirim notif ke banyak token)
   - Beberapa token mungkin sudah invalid

3. Solusi yang diterapkan:
   a. Hapus token lama, simpan hanya terbaru
   b. Tambah UNIQUE constraint (user_id, device_type)
   c. Update backend logic untuk auto-delete token lama

4. Setelah fix ini:
   - 1 user hanya punya 1 token per device_type
   - Ketika token baru didaftarkan, token lama otomatis dihapus
   - Tidak akan ada duplicate lagi

5. Cara testing:
   - User logout dan login ulang beberapa kali
   - Cek database: harus tetap 1 token per user
   - Backend log akan tampilkan: "🗑️ Menghapus X token lama"

PENTING: 
- Jalankan script ini saat backend TIDAK sedang running
- Atau restart backend setelah menjalankan script
- Users harus login ulang untuk generate token baru
*/
