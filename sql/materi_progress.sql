-- Table untuk menyimpan progress materi (bab dan sub-bab yang sudah diceklis)
-- Digunakan untuk tracking materi yang sudah dipelajari/diajarkan oleh guru
-- NOTE: guru_id adalah id dari tabel users dengan role 'guru'

-- Drop table if exists (untuk re-create dengan tipe data yang benar)
DROP TABLE IF EXISTS materi_progress;

CREATE TABLE materi_progress (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- UUID format: VARCHAR(36) to match referenced tables
    guru_id VARCHAR(36) NOT NULL COMMENT 'ID dari tabel users dengan role guru',
    mata_pelajaran_id VARCHAR(36) NOT NULL,
    bab_id VARCHAR(36) NULL,
    sub_bab_id VARCHAR(36) NULL,
    is_checked BOOLEAN DEFAULT FALSE,
    is_generated BOOLEAN DEFAULT FALSE COMMENT 'Apakah materi sudah pernah di-generate untuk RPP/aktivitas',
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign keys
    -- guru_id references users table (not guru table) because it stores user.id where role='guru'
    FOREIGN KEY (guru_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (mata_pelajaran_id) REFERENCES mata_pelajaran(id) ON DELETE CASCADE,
    FOREIGN KEY (bab_id) REFERENCES bab_materi(id) ON DELETE CASCADE,
    FOREIGN KEY (sub_bab_id) REFERENCES sub_bab_materi(id) ON DELETE CASCADE,
    
    -- Unique constraint untuk memastikan tidak ada duplikasi
    -- Bisa check bab saja (sub_bab_id NULL) atau sub bab spesifik
    UNIQUE KEY unique_progress (guru_id, mata_pelajaran_id, bab_id, sub_bab_id),
    
    -- Indexes for foreign keys (required for InnoDB)
    INDEX idx_fk_guru (guru_id),
    INDEX idx_fk_mata_pelajaran (mata_pelajaran_id),
    INDEX idx_fk_bab (bab_id),
    INDEX idx_fk_sub_bab (sub_bab_id)
) ENGINE=InnoDB;

-- Additional composite index untuk mempercepat query filtering
CREATE INDEX idx_guru_matapelajaran ON materi_progress(guru_id, mata_pelajaran_id);

-- Contoh data dummy (optional, untuk testing)
-- INSERT INTO materi_progress (guru_id, mata_pelajaran_id, bab_id, sub_bab_id, is_checked) 
-- VALUES (1, 1, 1, NULL, TRUE); -- Bab 1 checked, no specific sub-bab
-- INSERT INTO materi_progress (guru_id, mata_pelajaran_id, bab_id, sub_bab_id, is_checked) 
-- VALUES (1, 1, 1, 1, TRUE); -- Sub-bab 1 dari Bab 1 checked
