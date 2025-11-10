-- Migration: Add is_generated field to materi_progress table
-- Date: 2025-11-06
-- Description: Add tracking for materials that have been used in RPP/activity generation

ALTER TABLE materi_progress 
ADD COLUMN is_generated BOOLEAN DEFAULT FALSE COMMENT 'Apakah materi sudah pernah di-generate untuk RPP/aktivitas' 
AFTER is_checked;
