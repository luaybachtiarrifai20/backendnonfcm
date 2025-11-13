-- Fix: Data truncated for column 'type' issue
-- Ubah kolom type menjadi VARCHAR yang lebih besar

USE manajemen_sekolah;

-- Alternatif 1: Alter kolom jika tabel sudah ada
ALTER TABLE notifications MODIFY COLUMN type VARCHAR(100) NOT NULL;

-- Verifikasi perubahan
DESCRIBE notifications;
