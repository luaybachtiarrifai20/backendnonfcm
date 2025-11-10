const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { generateId, hashPassword } = require("../utils/helpers");

// Get all users (admin only)
router.get("/", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    console.log("Mengambil data users");
    const connection = await getConnection();
    const [users] = await connection.execute(`
      SELECT id, nama, email, role, kelas_id, created_at 
      FROM users 
      ORDER BY role, nama
    `);
    await connection.end();
    
    console.log("Berhasil mengambil data users, jumlah:", users.length);
    res.json(users);
  } catch (error) {
    console.error("ERROR GET USERS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data users" });
  }
});

// Get user by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Users hanya bisa melihat data sendiri kecuali admin
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    console.log("Mengambil data user by ID:", id);
    const connection = await getConnection();
    const [users] = await connection.execute(
      "SELECT id, nama, email, role, kelas_id, created_at FROM users WHERE id = ?",
      [id]
    );
    await connection.end();

    if (users.length === 0) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    console.log("Berhasil mengambil data user:", id);
    res.json(users[0]);
  } catch (error) {
    console.error("ERROR GET USER BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data user" });
  }
});

// Create user (admin only)
router.post("/", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    console.log("Menambah user baru:", req.body);
    const { nama, email, password, role, kelas_id } = req.body;

    if (!nama || !email || !password || !role) {
      return res.status(400).json({ error: "Data tidak lengkap" });
    }

    const connection = await getConnection();

    // Cek email duplikat
    const [existingUsers] = await connection.execute(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existingUsers.length > 0) {
      await connection.end();
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }

    const id = generateId();
    const hashedPassword = await hashPassword(password);

    await connection.execute(
      "INSERT INTO users (id, nama, email, password, role, kelas_id) VALUES (?, ?, ?, ?, ?, ?)",
      [id, nama, email, hashedPassword, role, kelas_id || null]
    );

    await connection.end();

    console.log("User berhasil ditambahkan:", id);
    res.json({ 
      message: "User berhasil ditambahkan", 
      id,
      user: { id, nama, email, role, kelas_id }
    });
  } catch (error) {
    console.error("ERROR POST USER:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menambah user" });
  }
});

// Update user
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Users hanya bisa mengupdate data sendiri kecuali admin
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    console.log("Update user:", id, req.body);
    const { nama, email, kelas_id } = req.body;

    const connection = await getConnection();

    // Cek email duplikat (kecuali untuk user yang sama)
    const [existingUsers] = await connection.execute(
      "SELECT id FROM users WHERE email = ? AND id != ?",
      [email, id]
    );

    if (existingUsers.length > 0) {
      await connection.end();
      return res.status(400).json({ error: "Email sudah digunakan" });
    }

    await connection.execute(
      "UPDATE users SET nama = ?, email = ?, kelas_id = ? WHERE id = ?",
      [nama, email, kelas_id || null, id]
    );

    await connection.end();

    console.log("User berhasil diupdate:", id);
    res.json({ message: "User berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT USER:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal mengupdate user" });
  }
});

// Delete user (admin only)
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    const { id } = req.params;
    console.log("Delete user:", id);

    // Cek jika user sedang digunakan
    const connection = await getConnection();
    
    // Cek jika user adalah wali kelas
    const [waliKelas] = await connection.execute(
      "SELECT id FROM kelas WHERE wali_kelas_id = ?",
      [id]
    );

    if (waliKelas.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: "User tidak dapat dihapus karena masih menjadi wali kelas"
      });
    }

    await connection.execute("DELETE FROM users WHERE id = ?", [id]);
    await connection.end();

    console.log("User berhasil dihapus:", id);
    res.json({ message: "User berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE USER:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus user" });
  }
});

// Change password
router.put("/:id/password", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Users hanya bisa mengubah password sendiri
    if (req.user.id !== id) {
      return res.status(403).json({ error: "Akses ditolak" });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Password lama dan baru harus diisi" });
    }

    const connection = await getConnection();
    
    // Verifikasi password lama
    const [users] = await connection.execute(
      "SELECT password FROM users WHERE id = ?",
      [id]
    );

    if (users.length === 0) {
      await connection.end();
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    const { comparePassword } = require("../utils/helpers");
    const isValidPassword = await comparePassword(currentPassword, users[0].password);

    if (!isValidPassword) {
      await connection.end();
      return res.status(400).json({ error: "Password lama tidak sesuai" });
    }

    // Update password baru
    const hashedNewPassword = await hashPassword(newPassword);
    await connection.execute(
      "UPDATE users SET password = ? WHERE id = ?",
      [hashedNewPassword, id]
    );

    await connection.end();

    console.log("Password berhasil diubah untuk user:", id);
    res.json({ message: "Password berhasil diubah" });
  } catch (error) {
    console.error("ERROR CHANGE PASSWORD:", error.message);
    res.status(500).json({ error: "Gagal mengubah password" });
  }
});

module.exports = router;