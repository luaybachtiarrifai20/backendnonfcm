-- Migration: Create fcm_tokens table
-- Date: 2025-11-10
-- Description: Table untuk menyimpan FCM tokens dari device users

-- Drop table if exists to recreate with correct schema
DROP TABLE IF EXISTS fcm_tokens;

CREATE TABLE fcm_tokens (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  token TEXT NOT NULL,
  device_type VARCHAR(50) DEFAULT 'web',
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Index untuk query yang sering digunakan
  INDEX idx_user_id (user_id),
  INDEX idx_is_active (is_active),
  INDEX idx_user_active (user_id, is_active),
  
  -- Foreign key ke users table
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  
  -- Unique constraint untuk kombinasi user_id dan token
  UNIQUE KEY unique_user_token (user_id, token(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
