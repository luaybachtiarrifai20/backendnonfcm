-- Script untuk membersihkan FCM tokens yang invalid atau dari Firebase project lama
-- Jalankan script ini setelah mengganti Firebase project di backend

USE manajemen_sekolah;

-- 1. Lihat semua tokens yang ada sekarang
SELECT 
  u.nama,
  u.email,
  u.role,
  f.device_type,
  f.is_active,
  f.created_at,
  f.updated_at,
  SUBSTRING(f.token, 1, 30) as token_preview
FROM fcm_tokens f
JOIN users u ON f.user_id = u.id
ORDER BY f.updated_at DESC;

-- 2. Nonaktifkan semua tokens yang ada (untuk force refresh)
-- UNCOMMENT baris di bawah jika ingin force refresh semua user
-- UPDATE fcm_tokens SET is_active = 0;

-- 3. Atau, delete semua tokens lama (lebih agresif)
-- UNCOMMENT baris di bawah jika ingin hapus semua tokens
-- DELETE FROM fcm_tokens;

-- 4. Setelah cleanup, user harus login ulang untuk generate token baru
SELECT 
  'Total tokens before cleanup:' as info,
  COUNT(*) as count
FROM fcm_tokens;

-- 5. Cek berapa wali yang perlu login ulang
SELECT 
  COUNT(DISTINCT u.id) as total_wali,
  COUNT(DISTINCT CASE WHEN f.is_active = 1 THEN f.user_id END) as wali_dengan_token_aktif,
  COUNT(DISTINCT CASE WHEN f.is_active = 0 THEN f.user_id END) as wali_perlu_login_ulang
FROM users u
LEFT JOIN fcm_tokens f ON u.id = f.user_id
WHERE u.role = 'wali';
