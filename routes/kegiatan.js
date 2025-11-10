const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { generateId } = require("../utils/helpers");

// Get kegiatan by guru
router.get("/guru/:guruId", authenticateToken, async (req, res) => {
  try {
    const { guruId } = req.params;
    console.log("Mengambil kegiatan untuk guru:", guruId);

    const connection = await getConnection();

    const [kegiatan] = await connection.execute(
      `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        u.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        GROUP_CONCAT(DISTINCT s.nama) as siswa_target_names
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
      JOIN kelas kls ON kk.kelas_id = kls.id
      JOIN users u ON kk.guru_id = u.id
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id
      LEFT JOIN siswa s ON kst.siswa_id = s.id
      WHERE kk.guru_id = ?
      GROUP BY kk.id
      ORDER BY kk.tanggal DESC, kk.created_at DESC
    `,
      [guruId]
    );

    await connection.end();

    console.log("Kegiatan ditemukan:", kegiatan.length);
    res.json(kegiatan);
  } catch (error) {
    console.error("ERROR GET KEGIATAN:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kegiatan" });
  }
});

// Get kegiatan by kelas (untuk siswa)
router.get("/kelas/:kelasId", authenticateToken, async (req, res) => {
  try {
    const { kelasId } = req.params;
    const { siswa_id } = req.query;

    console.log("Mengambil kegiatan untuk kelas:", kelasId);

    const connection = await getConnection();

    let query = `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        u.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        (kst.siswa_id IS NOT NULL) as untuk_siswa_ini
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
      JOIN kelas kls ON kk.kelas_id = kls.id
      JOIN users u ON kk.guru_id = u.id
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id AND kst.siswa_id = ?
      WHERE kk.kelas_id = ? AND (kk.target = 'umum' OR kst.siswa_id = ?)
      GROUP BY kk.id
      ORDER BY kk.tanggal DESC, kk.created_at DESC
    `;

    const [kegiatan] = await connection.execute(query, [
      siswa_id,
      kelasId,
      siswa_id,
    ]);

    await connection.end();

    console.log("Kegiatan ditemukan:", kegiatan.length);
    res.json(kegiatan);
  } catch (error) {
    console.error("ERROR GET KEGIATAN KELAS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kegiatan" });
  }
});

// Create kegiatan
router.post("/", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah kegiatan baru:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      judul,
      deskripsi,
      jenis,
      target,
      bab_id,
      sub_bab_id,
      batas_waktu,
      tanggal,
      hari,
      siswa_target,
    } = req.body;

    // Validasi data required
    if (
      !guru_id ||
      !mata_pelajaran_id ||
      !kelas_id ||
      !judul ||
      !tanggal ||
      !hari
    ) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        required: [
          "guru_id",
          "mata_pelajaran_id",
          "kelas_id",
          "judul",
          "tanggal",
          "hari",
        ],
      });
    }

    const id = generateId();
    const connection = await getConnection();

    // Mulai transaction
    await connection.beginTransaction();

    try {
      // Insert kegiatan utama
      await connection.execute(
        `INSERT INTO kegiatan_kelas 
         (id, guru_id, mata_pelajaran_id, kelas_id, judul, deskripsi, jenis, target, 
          bab_id, sub_bab_id, batas_waktu, tanggal, hari) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          guru_id,
          mata_pelajaran_id,
          kelas_id,
          judul,
          deskripsi || null,
          jenis || "materi",
          target || "umum",
          bab_id || null,
          sub_bab_id || null,
          batas_waktu || null,
          tanggal,
          hari,
        ]
      );

      // Jika target khusus, insert siswa target
      if (target === "khusus" && siswa_target && siswa_target.length > 0) {
        for (const siswaId of siswa_target) {
          const targetId = generateId();
          await connection.execute(
            "INSERT INTO kegiatan_siswa_target (id, kegiatan_id, siswa_id) VALUES (?, ?, ?)",
            [targetId, id, siswaId]
          );
        }
      }

      // Commit transaction
      await connection.commit();

      console.log("Kegiatan berhasil ditambahkan:", id);
      res.status(201).json({
        message: "Kegiatan berhasil ditambahkan",
        id,
        type: "created",
      });
    } catch (transactionError) {
      // Rollback jika ada error
      await connection.rollback();
      throw transactionError;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("ERROR CREATE KEGIATAN:", error.message);
    console.error("SQL Error code:", error.code);

    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({ error: "Data referensi tidak valid" });
    }

    res
      .status(500)
      .json({ error: "Gagal menambah kegiatan: " + error.message });
  }
});

// Update kegiatan
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update kegiatan:", id, req.body);

    const {
      judul,
      deskripsi,
      jenis,
      target,
      bab_id,
      sub_bab_id,
      batas_waktu,
      tanggal,
      hari,
      siswa_target,
    } = req.body;

    const connection = await getConnection();
    await connection.beginTransaction();

    try {
      // Update kegiatan utama
      await connection.execute(
        `UPDATE kegiatan_kelas 
         SET judul = ?, deskripsi = ?, jenis = ?, target = ?, 
             bab_id = ?, sub_bab_id = ?, batas_waktu = ?, tanggal = ?, hari = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          judul,
          deskripsi || null,
          jenis,
          target,
          bab_id || null,
          sub_bab_id || null,
          batas_waktu || null,
          tanggal,
          hari,
          id,
        ]
      );

      // Hapus siswa target lama
      await connection.execute(
        "DELETE FROM kegiatan_siswa_target WHERE kegiatan_id = ?",
        [id]
      );

      // Insert siswa target baru jika target khusus
      if (target === "khusus" && siswa_target && siswa_target.length > 0) {
        for (const siswaId of siswa_target) {
          const targetId = generateId();
          await connection.execute(
            "INSERT INTO kegiatan_siswa_target (id, kegiatan_id, siswa_id) VALUES (?, ?, ?)",
            [targetId, id, siswaId]
          );
        }
      }

      await connection.commit();

      console.log("Kegiatan berhasil diupdate:", id);
      res.json({ message: "Kegiatan berhasil diupdate" });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("ERROR UPDATE KEGIATAN:", error.message);
    res.status(500).json({ error: "Gagal mengupdate kegiatan" });
  }
});

// Delete kegiatan
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete kegiatan:", id);

    const connection = await getConnection();

    // Hapus otomatis akan cascade ke kegiatan_siswa_target karena foreign key constraint
    await connection.execute("DELETE FROM kegiatan_kelas WHERE id = ?", [id]);
    await connection.end();

    console.log("Kegiatan berhasil dihapus:", id);
    res.json({ message: "Kegiatan berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE KEGIATAN:", error.message);
    res.status(500).json({ error: "Gagal menghapus kegiatan" });
  }
});

// Get kegiatan by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil kegiatan by ID:", id);

    const connection = await getConnection();

    const [kegiatan] = await connection.execute(
      `
      SELECT 
        kk.*,
        mp.nama as mata_pelajaran_nama,
        kls.nama as kelas_nama,
        u.nama as guru_nama,
        bm.judul_bab,
        sbm.judul_sub_bab,
        GROUP_CONCAT(DISTINCT s.id) as siswa_target_ids,
        GROUP_CONCAT(DISTINCT s.nama) as siswa_target_names
      FROM kegiatan_kelas kk
      JOIN mata_pelajaran mp ON kk.mata_pelajaran_id = mp.id
      JOIN kelas kls ON kk.kelas_id = kls.id
      JOIN users u ON kk.guru_id = u.id
      LEFT JOIN bab_materi bm ON kk.bab_id = bm.id
      LEFT JOIN sub_bab_materi sbm ON kk.sub_bab_id = sbm.id
      LEFT JOIN kegiatan_siswa_target kst ON kk.id = kst.kegiatan_id
      LEFT JOIN siswa s ON kst.siswa_id = s.id
      WHERE kk.id = ?
      GROUP BY kk.id
    `,
      [id]
    );

    await connection.end();

    if (kegiatan.length === 0) {
      return res.status(404).json({ error: "Kegiatan tidak ditemukan" });
    }

    console.log("Kegiatan ditemukan:", id);
    
    // Parse siswa target
    const kegiatanData = kegiatan[0];
    if (kegiatanData.siswa_target_ids) {
      kegiatanData.siswa_target = kegiatanData.siswa_target_ids.split(',').map(id => id.trim());
    } else {
      kegiatanData.siswa_target = [];
    }

    res.json(kegiatanData);
  } catch (error) {
    console.error("ERROR GET KEGIATAN BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data kegiatan" });
  }
});

// Get jadwal untuk dropdown (disesuaikan)
router.get("/jadwal/guru/:guruId", authenticateToken, async (req, res) => {
  try {
    const { guruId } = req.params;
    const { hari, tahun_ajaran } = req.query;

    console.log("Mengambil jadwal untuk form kegiatan:", guruId);

    let query = `
      SELECT 
        jm.id,
        jm.kelas_id,
        k.nama as kelas_nama,
        jm.mata_pelajaran_id,
        mp.nama as mata_pelajaran_nama,
        jm.hari_id,
        h.nama as hari_nama
      FROM jadwal_mengajar jm
      JOIN kelas k ON jm.kelas_id = k.id
      JOIN mata_pelajaran mp ON jm.mata_pelajaran_id = mp.id
      JOIN hari h ON jm.hari_id = h.id
      WHERE jm.guru_id = ?
    `;

    let params = [guruId];

    if (hari && hari !== "Semua Hari") {
      query += " AND h.nama = ?";
      params.push(hari);
    }

    if (tahun_ajaran) {
      query += " AND jm.tahun_ajaran = ?";
      params.push(tahun_ajaran);
    }

    query += " ORDER BY h.urutan, k.nama";

    const connection = await getConnection();
    const [jadwal] = await connection.execute(query, params);
    await connection.end();

    console.log("Jadwal ditemukan untuk form:", jadwal.length);
    res.json(jadwal);
  } catch (error) {
    console.error("ERROR GET JADWAL FORM:", error.message);
    res.status(500).json({ error: "Gagal mengambil data jadwal" });
  }
});

module.exports = router;