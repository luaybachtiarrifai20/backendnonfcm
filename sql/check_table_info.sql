-- Query untuk memeriksa charset dan collation dari tabel yang direferensi
SELECT 
    t.TABLE_NAME,
    t.TABLE_COLLATION,
    c.COLUMN_NAME,
    c.DATA_TYPE,
    c.CHARACTER_MAXIMUM_LENGTH,
    c.CHARACTER_SET_NAME,
    c.COLLATION_NAME
FROM INFORMATION_SCHEMA.TABLES t
JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
WHERE t.TABLE_SCHEMA = 'vldgkamz_manajemensekolah'
  AND t.TABLE_NAME IN ('users', 'mata_pelajaran', 'bab_materi', 'sub_bab_materi')
  AND c.COLUMN_NAME = 'id'
ORDER BY t.TABLE_NAME;
