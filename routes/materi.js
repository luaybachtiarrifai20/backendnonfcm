const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { generateId } = require("../utils/helpers");

// Get all materi
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { guru_id, mata_pelajaran_id } = req.query;
    console.log("Mengambil data materi");

    let query = `
      SELECT m.*, u.nama as guru_nama, mp.nama as mata_pelajaran_nama
      FROM materi m
      JOIN users u ON m.guru_id = u.id
      JOIN mata_pelajaran mp ON m.mata_pelajaran_id = mp.id
      WHERE 1=1
    `;
    let params = [];

    if (guru_id) {
      query += " AND m.guru_id = ?";
      params.push(guru_id);
    }

    if (mata_pelajaran_id) {
      query += " AND m.mata_pelajaran_id = ?";
      params.push(mata_pelajaran_id);
    }

    const connection = await getConnection();
    const [materi] = await connection.execute(query, params);
    await connection.end();

    console.log("Berhasil mengambil data materi, jumlah:", materi.length);
    res.json(materi);
  } catch (error) {
    console.error("ERROR GET MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil data materi" });
  }
});

// Create materi
router.post("/", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah materi:", req.body);
    const { guru_id, mata_pelajaran_id, judul, deskripsi, file_path } =
      req.body;
    const id = generateId();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO materi (id, guru_id, mata_pelajaran_id, judul, deskripsi, file_path) VALUES (?, ?, ?, ?, ?, ?)",
      [id, guru_id, mata_pelajaran_id, judul, deskripsi, file_path]
    );
    await connection.end();

    console.log("Materi berhasil ditambahkan:", id);
    res.json({ message: "Materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST MATERI:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah materi" });
  }
});

// Get materi by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data materi by ID:", id);

    const connection = await getConnection();
    const [materi] = await connection.execute(
      `SELECT m.*, u.nama as guru_nama, mp.nama as mata_pelajaran_nama
       FROM materi m
       JOIN users u ON m.guru_id = u.id
       JOIN mata_pelajaran mp ON m.mata_pelajaran_id = mp.id
       WHERE m.id = ?`,
      [id]
    );
    await connection.end();

    if (materi.length === 0) {
      return res.status(404).json({ error: "Materi tidak ditemukan" });
    }

    console.log("Berhasil mengambil data materi:", id);
    res.json(materi[0]);
  } catch (error) {
    console.error("ERROR GET MATERI BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data materi" });
  }
});

// Update materi
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update materi:", id, req.body);
    const { judul, deskripsi, file_path } = req.body;

    const connection = await getConnection();
    await connection.execute(
      "UPDATE materi SET judul = ?, deskripsi = ?, file_path = ? WHERE id = ?",
      [judul, deskripsi, file_path, id]
    );
    await connection.end();

    console.log("Materi berhasil diupdate:", id);
    res.json({ message: "Materi berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengupdate materi" });
  }
});

// Delete materi
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete materi:", id);

    const connection = await getConnection();
    await connection.execute("DELETE FROM materi WHERE id = ?", [id]);
    await connection.end();

    console.log("Materi berhasil dihapus:", id);
    res.json({ message: "Materi berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE MATERI:", error.message);
    res.status(500).json({ error: "Gagal menghapus materi" });
  }
});

// Get bab materi
router.get("/bab/:mataPelajaranId", authenticateToken, async (req, res) => {
  try {
    const { mataPelajaranId } = req.params;
    console.log("Mengambil bab materi untuk mata pelajaran:", mataPelajaranId);

    const connection = await getConnection();
    const [babMateri] = await connection.execute(
      `SELECT bm.*, mp.nama as mata_pelajaran_nama
       FROM bab_materi bm
       JOIN mata_pelajaran mp ON bm.mata_pelajaran_id = mp.id
       WHERE bm.mata_pelajaran_id = ?
       ORDER BY bm.urutan`,
      [mataPelajaranId]
    );
    await connection.end();

    console.log("Bab materi ditemukan:", babMateri.length);
    res.json(babMateri);
  } catch (error) {
    console.error("ERROR GET BAB MATERI:", error.message);
    res.status(500).json({ error: "Gagal mengambil bab materi" });
  }
});

// Create bab materi
router.post("/bab", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah bab materi baru:", req.body);
    const { mata_pelajaran_id, judul_bab, urutan } = req.body;
    const id = generateId();

    const connection = await getConnection();
    await connection.execute(
      "INSERT INTO bab_materi (id, mata_pelajaran_id, judul_bab, urutan) VALUES (?, ?, ?, ?)",
      [id, mata_pelajaran_id, judul_bab, urutan]
    );
    await connection.end();

    console.log("Bab materi berhasil ditambahkan:", id);
    res.json({ message: "Bab materi berhasil ditambahkan", id });
  } catch (error) {
    console.error("ERROR POST BAB MATERI:", error.message);
    res.status(500).json({ error: "Gagal menambah bab materi" });
  }
});

module.exports = router;