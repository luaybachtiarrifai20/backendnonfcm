-- Migration: Create notifications table
-- Date: 2025-11-12
-- Description: Table untuk menyimpan history notifikasi yang dikirim ke users

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  data JSON,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Index untuk query yang sering digunakan
  INDEX idx_user_id (user_id),
  INDEX idx_type (type),
  INDEX idx_is_read (is_read),
  INDEX idx_user_type (user_id, type),
  INDEX idx_created_at (created_at),
  
  -- Foreign key ke users table
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
