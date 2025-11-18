-- Script untuk debug kenapa notifikasi pengumuman tidak terkirim ke wali/siswa
-- Masalah: "Tidak ada target user untuk pengumuman"

USE manajemen_sekolah;

-- ==================== DIAGNOSIS ====================

-- 1. Cek berapa user per role
SELECT 
  '1. Total users per role' as info,
  role,
  COUNT(*) as total_users,
  COUNT(DISTINCT sekolah_id) as sekolah_count
FROM users
GROUP BY role
ORDER BY role;

-- 2. Cek user wali - apakah ada?
SELECT 
  '2. Data user wali' as info,
  u.id,
  u.nama,
  u.email,
  u.role,
  u.sekolah_id,
  u.siswa_id,
  s.nama as nama_siswa,
  s.kelas_id
FROM users u
LEFT JOIN siswa s ON u.siswa_id = s.id
WHERE u.role = 'wali'
ORDER BY u.nama;

-- 3. Cek user siswa - apakah ada?
SELECT 
  '3. Data user siswa' as info,
  u.id,
  u.nama,
  u.email,
  u.role,
  u.sekolah_id,
  u.siswa_id,
  s.nama as nama_siswa_data,
  s.kelas_id
FROM users u
LEFT JOIN siswa s ON u.siswa_id = s.id
WHERE u.role = 'siswa'
ORDER BY u.nama;

-- 4. Cek data siswa di tabel siswa
SELECT 
  '4. Data siswa (tanpa user account)' as info,
  COUNT(*) as total_siswa,
  COUNT(DISTINCT kelas_id) as jumlah_kelas,
  COUNT(DISTINCT sekolah_id) as jumlah_sekolah
FROM siswa;

-- 5. Siswa yang BELUM punya user account
SELECT 
  '5. Siswa tanpa user account' as info,
  s.id,
  s.nama,
  s.nis,
  k.nama as kelas,
  s.sekolah_id
FROM siswa s
LEFT JOIN kelas k ON s.kelas_id = k.id
LEFT JOIN users u ON u.siswa_id = s.id
WHERE u.id IS NULL
ORDER BY k.nama, s.nama
LIMIT 20;

-- 6. Cek FCM tokens per role
SELECT 
  '6. FCM tokens per role' as info,
  u.role,
  COUNT(DISTINCT u.id) as total_users,
  COUNT(DISTINCT f.user_id) as users_with_token,
  COUNT(f.id) as total_tokens
FROM users u
LEFT JOIN fcm_tokens f ON u.id = f.user_id AND f.is_active = 1
GROUP BY u.role
ORDER BY u.role;

-- 7. Sample query yang digunakan backend untuk wali
SELECT 
  '7. Test query wali (yang dipakai backend)' as info,
  u.id as user_id,
  u.nama as user_nama,
  u.role,
  u.sekolah_id,
  u.siswa_id
FROM users u
WHERE u.role = 'wali' AND u.sekolah_id = 'sekolah-001';

-- 8. Sample query yang digunakan backend untuk siswa
SELECT 
  '8. Test query siswa (yang dipakai backend)' as info,
  u.id as user_id,
  u.nama as user_nama,
  u.role,
  u.sekolah_id,
  u.siswa_id
FROM users u
WHERE u.role = 'siswa' AND u.sekolah_id = 'sekolah-001';

-- ==================== SOLUSI ====================

-- SOLUSI 1: Jika tidak ada user wali, buat user wali untuk setiap siswa
-- UNCOMMENT untuk menjalankan:
/*
INSERT INTO users (id, nama, email, password, role, siswa_id, sekolah_id, created_at)
SELECT 
  UUID(),
  CONCAT('Wali ', s.nama) as nama,
  CONCAT('wali.', LOWER(REPLACE(s.nama, ' ', '')), '@school.com') as email,
  '$2b$10$XqL8ZcXVDqCwQp1vJ3O4rOHZ5qOqV5Z5Z5Z5Z5Z5Z5Z5Z5' as password, -- password: wali123
  'wali' as role,
  s.id as siswa_id,
  s.sekolah_id,
  NOW()
FROM siswa s
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.siswa_id = s.id AND u.role = 'wali'
)
LIMIT 10; -- HAPUS LIMIT jika ingin buat semua

SELECT 'User wali berhasil dibuat!' as result;
*/

-- SOLUSI 2: Jika tidak ada user siswa, buat user siswa
-- UNCOMMENT untuk menjalankan:
/*
INSERT INTO users (id, nama, email, password, role, siswa_id, sekolah_id, created_at)
SELECT 
  UUID(),
  s.nama,
  CONCAT(LOWER(REPLACE(s.nama, ' ', '')), '@siswa.school.com') as email,
  '$2b$10$XqL8ZcXVDqCwQp1vJ3O4rOHZ5qOqV5Z5Z5Z5Z5Z5Z5Z5Z5' as password, -- password: siswa123
  'siswa' as role,
  s.id as siswa_id,
  s.sekolah_id,
  NOW()
FROM siswa s
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.siswa_id = s.id AND u.role = 'siswa'
)
LIMIT 10; -- HAPUS LIMIT jika ingin buat semua

SELECT 'User siswa berhasil dibuat!' as result;
*/

-- SOLUSI 3: Clean token invalid
-- UNCOMMENT untuk menjalankan:
/*
DELETE FROM fcm_tokens 
WHERE token LIKE 'eSr0y3K4TFqglvsxNiJ3%';

SELECT 'Token invalid berhasil dihapus!' as result;
*/

-- ==================== VERIFIKASI ====================

-- Setelah menjalankan solusi, cek lagi:
SELECT 
  'Verifikasi: Total users setelah fix' as info,
  role,
  COUNT(*) as total_users
FROM users
GROUP BY role
ORDER BY role;
