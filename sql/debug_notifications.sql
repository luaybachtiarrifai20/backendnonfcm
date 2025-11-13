-- Script untuk debug notifikasi aktivitas kelas

-- 1. Cek apakah tabel notifications sudah ada
SHOW TABLES LIKE 'notifications';

-- 2. Cek struktur tabel notifications
DESCRIBE notifications;

-- 3. Cek apakah ada siswa di kelas tertentu (ganti dengan ID kelas Anda)
SELECT 
  s.id,
  s.nama as siswa_nama,
  s.kelas_id,
  k.nama as kelas_nama
FROM siswa s
JOIN kelas k ON s.kelas_id = k.id
ORDER BY k.nama, s.nama;

-- 4. Cek apakah siswa memiliki wali
SELECT 
  s.id as siswa_id,
  s.nama as siswa_nama,
  u.id as wali_user_id,
  u.nama as wali_nama,
  u.email as wali_email
FROM siswa s
LEFT JOIN users u ON u.siswa_id = s.id AND u.role = 'wali'
ORDER BY s.nama;

-- 5. Cek FCM tokens wali (harus ada dan aktif)
SELECT 
  u.id as user_id,
  u.nama as wali_nama,
  u.email as wali_email,
  s.nama as siswa_nama,
  f.token as fcm_token,
  f.device_type,
  f.is_active,
  f.updated_at
FROM users u
LEFT JOIN siswa s ON u.siswa_id = s.id
LEFT JOIN fcm_tokens f ON u.id = f.user_id
WHERE u.role = 'wali'
ORDER BY u.nama;

-- 6. Cek kegiatan_kelas terbaru
SELECT 
  kk.id,
  kk.judul,
  kk.jenis,
  kk.target,
  kk.tanggal,
  k.nama as kelas_nama,
  mp.nama as mata_pelajaran,
  u.nama as guru_nama,
  kk.created_at
FROM kegiatan_kelas kk
JOIN kelas k ON kk.kelas_id = k.id
JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
JOIN users u ON kk.guru_id = u.id
ORDER BY kk.created_at DESC
LIMIT 10;

-- 7. Cek target siswa khusus (jika ada)
SELECT 
  kst.kegiatan_id,
  kk.judul,
  s.nama as siswa_target
FROM kegiatan_siswa_target kst
JOIN kegiatan_kelas kk ON kst.kegiatan_id = kk.id
JOIN siswa s ON kst.siswa_id = s.id
ORDER BY kst.created_at DESC
LIMIT 20;

-- 8. Cek notifikasi yang sudah terkirim
SELECT 
  n.id,
  n.title,
  n.body,
  n.type,
  u.nama as penerima,
  u.email as penerima_email,
  n.is_read,
  n.created_at
FROM notifications n
JOIN users u ON n.user_id = u.id
WHERE n.type = 'class_activity'
ORDER BY n.created_at DESC
LIMIT 20;

-- 9. Summary: Berapa wali yang memiliki FCM token aktif?
SELECT 
  COUNT(DISTINCT u.id) as total_wali,
  COUNT(DISTINCT CASE WHEN f.is_active = 1 THEN u.id END) as wali_with_active_token,
  COUNT(DISTINCT f.id) as total_active_tokens
FROM users u
LEFT JOIN fcm_tokens f ON u.id = f.user_id AND f.is_active = 1
WHERE u.role = 'wali';

-- 10. Test: Wali mana yang seharusnya mendapat notifikasi untuk kelas tertentu?
-- (Ganti '?' dengan ID kelas yang ingin di-test)
-- SELECT 
--   DISTINCT u.id as wali_user_id,
--   u.nama as wali_nama,
--   u.email as wali_email,
--   s.nama as siswa_nama,
--   COUNT(f.id) as fcm_token_count
-- FROM siswa s
-- JOIN users u ON u.siswa_id = s.id AND u.role = 'wali'
-- LEFT JOIN fcm_tokens f ON u.id = f.user_id AND f.is_active = 1
-- WHERE s.kelas_id = '?' -- Ganti dengan ID kelas
-- GROUP BY u.id, u.nama, u.email, s.nama;
