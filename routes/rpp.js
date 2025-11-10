const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { uploadMiddleware } = require("../middleware/upload");
const { generateId } = require("../utils/helpers");

// Get all RPP
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { guru_id, status } = req.query;
    console.log("Mengambil data RPP");

    let query = `
      SELECT r.*, 
        mp.nama as mata_pelajaran_nama,
        u.nama as guru_nama,
        k.nama as kelas_nama
      FROM rpp r
      JOIN mata_pelajaran mp ON r.mata_pelajaran_id = mp.id
      JOIN users u ON r.guru_id = u.id
      LEFT JOIN kelas k ON r.kelas_id = k.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND r.guru_id = ?";
      params.push(guru_id);
    }

    if (status) {
      query += " AND r.status = ?";
      params.push(status);
    }

    query += " ORDER BY r.created_at DESC";

    const connection = await getConnection();
    const [rpp] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data RPP, jumlah:", rpp.length);
    res.json(rpp);
  } catch (error) {
    console.error("ERROR GET RPP:", error.message);
    res.status(500).json({ error: "Gagal mengambil data RPP" });
  }
});

// Get RPP by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data RPP by ID:", id);

    const connection = await getConnection();
    const [rpp] = await connection.execute(
      `SELECT r.*, 
        mp.nama as mata_pelajaran_nama,
        u.nama as guru_nama,
        k.nama as kelas_nama
       FROM rpp r
       JOIN mata_pelajaran mp ON r.mata_pelajaran_id = mp.id
       JOIN users u ON r.guru_id = u.id
       LEFT JOIN kelas k ON r.kelas_id = k.id
       WHERE r.id = ?`,
      [id]
    );
    await connection.end();

    if (rpp.length === 0) {
      return res.status(404).json({ error: "RPP tidak ditemukan" });
    }

    console.log("Berhasil mengambil data RPP:", id);
    res.json(rpp[0]);
  } catch (error) {
    console.error("ERROR GET RPP BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data RPP" });
  }
});

// Create RPP
router.post("/", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah RPP:", req.body);
    const {
      guru_id,
      mata_pelajaran_id,
      kelas_id,
      judul,
      semester,
      tahun_ajaran,
      kompetensi_inti,
      kompetensi_dasar,
      indikator,
      tujuan_pembelajaran,
      materi_pokok,
      metode_pembelajaran,
      media_alat,
      sumber_belajar,
      kegiatan_pembelajaran,
      penilaian,
      file_path,
      status = "Menunggu",
    } = req.body;

    // Validasi field required
    if (
      !guru_id ||
      !mata_pelajaran_id ||
      !judul ||
      !semester ||
      !tahun_ajaran
    ) {
      return res.status(400).json({
        error: "Data tidak lengkap",
        required: [
          "guru_id",
          "mata_pelajaran_id",
          "judul",
          "semester",
          "tahun_ajaran",
        ],
      });
    }

    const id = generateId();
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    const connection = await getConnection();

    // Handle undefined values by converting them to null
    const cleanKelasId = kelas_id || null;
    const cleanKompetensiInti = kompetensi_inti || null;
    const cleanKompetensiDasar = kompetensi_dasar || null;
    const cleanIndikator = indikator || null;
    const cleanTujuanPembelajaran = tujuan_pembelajaran || null;
    const cleanMateriPokok = materi_pokok || null;
    const cleanMetodePembelajaran = metode_pembelajaran || null;
    const cleanMediaAlat = media_alat || null;
    const cleanSumberBelajar = sumber_belajar || null;
    const cleanKegiatanPembelajaran = kegiatan_pembelajaran || null;
    const cleanPenilaian = penilaian || null;
    const cleanFilePath = file_path || null;

    await connection.execute(
      `INSERT INTO rpp (
        id, guru_id, mata_pelajaran_id, kelas_id, judul, semester, tahun_ajaran,
        kompetensi_inti, kompetensi_dasar, indikator, tujuan_pembelajaran,
        materi_pokok, metode_pembelajaran, media_alat, sumber_belajar,
        kegiatan_pembelajaran, penilaian, file_path, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        guru_id,
        mata_pelajaran_id,
        cleanKelasId,
        judul,
        semester,
        tahun_ajaran,
        cleanKompetensiInti,
        cleanKompetensiDasar,
        cleanIndikator,
        cleanTujuanPembelajaran,
        cleanMateriPokok,
        cleanMetodePembelajaran,
        cleanMediaAlat,
        cleanSumberBelajar,
        cleanKegiatanPembelajaran,
        cleanPenilaian,
        cleanFilePath,
        status,
        createdAt,
      ]
    );
    await connection.end();

    console.log("Berhasil menambah RPP:", id);
    res.json({ id, message: "RPP berhasil disimpan" });
  } catch (error) {
    console.error("ERROR CREATE RPP:", error.message);
    console.error("Error details:", error);
    res.status(500).json({ error: "Gagal menyimpan RPP: " + error.message });
  }
});

// Update RPP
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update RPP:", id, req.body);
    const {
      judul,
      kelas_id,
      semester,
      tahun_ajaran,
      kompetensi_inti,
      kompetensi_dasar,
      indikator,
      tujuan_pembelajaran,
      materi_pokok,
      metode_pembelajaran,
      media_alat,
      sumber_belajar,
      kegiatan_pembelajaran,
      penilaian,
      file_path,
    } = req.body;

    const connection = await getConnection();

    const updateFields = [];
    const updateValues = [];

    if (judul) {
      updateFields.push("judul = ?");
      updateValues.push(judul);
    }

    if (kelas_id !== undefined) {
      updateFields.push("kelas_id = ?");
      updateValues.push(kelas_id || null);
    }

    if (semester) {
      updateFields.push("semester = ?");
      updateValues.push(semester);
    }

    if (tahun_ajaran) {
      updateFields.push("tahun_ajaran = ?");
      updateValues.push(tahun_ajaran);
    }

    if (kompetensi_inti !== undefined) {
      updateFields.push("kompetensi_inti = ?");
      updateValues.push(kompetensi_inti || null);
    }

    if (kompetensi_dasar !== undefined) {
      updateFields.push("kompetensi_dasar = ?");
      updateValues.push(kompetensi_dasar || null);
    }

    if (indikator !== undefined) {
      updateFields.push("indikator = ?");
      updateValues.push(indikator || null);
    }

    if (tujuan_pembelajaran !== undefined) {
      updateFields.push("tujuan_pembelajaran = ?");
      updateValues.push(tujuan_pembelajaran || null);
    }

    if (materi_pokok !== undefined) {
      updateFields.push("materi_pokok = ?");
      updateValues.push(materi_pokok || null);
    }

    if (metode_pembelajaran !== undefined) {
      updateFields.push("metode_pembelajaran = ?");
      updateValues.push(metode_pembelajaran || null);
    }

    if (media_alat !== undefined) {
      updateFields.push("media_alat = ?");
      updateValues.push(media_alat || null);
    }

    if (sumber_belajar !== undefined) {
      updateFields.push("sumber_belajar = ?");
      updateValues.push(sumber_belajar || null);
    }

    if (kegiatan_pembelajaran !== undefined) {
      updateFields.push("kegiatan_pembelajaran = ?");
      updateValues.push(kegiatan_pembelajaran || null);
    }

    if (penilaian !== undefined) {
      updateFields.push("penilaian = ?");
      updateValues.push(penilaian || null);
    }

    if (file_path !== undefined) {
      updateFields.push("file_path = ?");
      updateValues.push(file_path || null);
    }

    updateFields.push("updated_at = NOW()");
    updateValues.push(id);

    if (updateFields.length === 0) {
      await connection.end();
      return res.status(400).json({ error: "Tidak ada data yang diupdate" });
    }

    const query = `UPDATE rpp SET ${updateFields.join(", ")} WHERE id = ?`;

    await connection.execute(query, updateValues);
    await connection.end();

    console.log("RPP berhasil diupdate:", id);
    res.json({ message: "RPP berhasil diupdate" });
  } catch (error) {
    console.error("ERROR UPDATE RPP:", error.message);
    res.status(500).json({ error: "Gagal mengupdate RPP" });
  }
});

// Update status RPP (untuk admin)
router.put("/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, catatan_admin } = req.body;

    console.log("Update status RPP:", id, status);

    const connection = await getConnection();
    await connection.execute(
      "UPDATE rpp SET status = ?, catatan_admin = ?, updated_at = NOW() WHERE id = ?",
      [status, catatan_admin || "", id]
    );
    await connection.end();

    console.log("Status RPP berhasil diupdate:", id);
    res.json({ message: "Status RPP berhasil diupdate" });
  } catch (error) {
    console.error("ERROR UPDATE RPP STATUS:", error.message);
    res.status(500).json({ error: "Gagal mengupdate status RPP" });
  }
});

// Delete RPP
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete RPP:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM rpp WHERE id = ?", [id]);
    await connection.end();

    console.log("RPP berhasil dihapus:", id);
    res.json({ message: "RPP berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE RPP:", error.message);
    res.status(500).json({ error: "Gagal menghapus RPP" });
  }
});

// Upload file RPP
router.post("/upload", authenticateToken, uploadMiddleware, async (req, res) => {
  try {
    console.log("Upload RPP endpoint hit");

    if (!req.file) {
      console.log("No file received");
      return res.status(400).json({ error: "Tidak ada file yang diupload" });
    }

    console.log("File received:", {
      originalname: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path,
    });

    const fileUrl = `/uploads/rpp/${req.file.filename}`;

    console.log("File uploaded successfully:", fileUrl);

    res.json({
      message: "File berhasil diupload",
      file_path: fileUrl,
      file_name: req.file.originalname,
      file_size: req.file.size,
    });
  } catch (error) {
    console.error("ERROR UPLOAD FILE:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      error: "Gagal mengupload file",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Get RPP by guru
router.get("/guru/:guruId", authenticateToken, async (req, res) => {
  try {
    const { guruId } = req.params;
    const { status } = req.query;

    console.log("Mengambil RPP untuk guru:", guruId);

    let query = `
      SELECT r.*, 
        mp.nama as mata_pelajaran_nama,
        k.nama as kelas_nama
      FROM rpp r
      JOIN mata_pelajaran mp ON r.mata_pelajaran_id = mp.id
      LEFT JOIN kelas k ON r.kelas_id = k.id
      WHERE r.guru_id = ?
    `;

    let params = [guruId];

    if (status) {
      query += " AND r.status = ?";
      params.push(status);
    }

    query += " ORDER BY r.created_at DESC";

    const connection = await getConnection();
    const [rpp] = await connection.execute(query, params);
    await connection.end();

    console.log("RPP ditemukan:", rpp.length);
    res.json(rpp);
  } catch (error) {
    console.error("ERROR GET RPP BY GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil data RPP" });
  }
});

module.exports = router;