const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { excelUploadMiddleware } = require("../middleware/upload");
const { generateId, hashPassword } = require("../utils/helpers");
const XLSX = require("xlsx");

// Get all gurus
router.get("/", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data guru");
    const connection = await getConnection();
    const [guru] = await connection.execute(`
      SELECT 
        u.*, 
        k.nama as kelas_nama,
        (SELECT COUNT(*) FROM kelas WHERE wali_kelas_id = u.id) as is_wali_kelas,
        GROUP_CONCAT(DISTINCT mp.nama) as mata_pelajaran_names,
        GROUP_CONCAT(DISTINCT mp.id) as mata_pelajaran_ids
      FROM users u 
      LEFT JOIN kelas k ON u.kelas_id = k.id 
      LEFT JOIN guru_mata_pelajaran gmp ON u.id = gmp.guru_id
      LEFT JOIN mata_pelajaran mp ON gmp.mata_pelajaran_id = mp.id
      WHERE u.role = 'guru'
      GROUP BY u.id
    `);
    await connection.end();
    console.log("Berhasil mengambil data guru, jumlah:", guru.length);
    res.json(guru);
  } catch (error) {
    console.error("ERROR GET GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil data guru" });
  }
});

// Get guru by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data guru by ID:", id);

    const connection = await getConnection();
    const [guru] = await connection.execute(
      `
      SELECT 
        u.*, 
        k.nama as kelas_nama,
        (SELECT COUNT(*) FROM kelas WHERE wali_kelas_id = u.id) as is_wali_kelas,
        GROUP_CONCAT(DISTINCT mp.nama) as mata_pelajaran_names,
        GROUP_CONCAT(DISTINCT mp.id) as mata_pelajaran_ids
      FROM users u 
      LEFT JOIN kelas k ON u.kelas_id = k.id 
      LEFT JOIN guru_mata_pelajaran gmp ON u.id = gmp.guru_id
      LEFT JOIN mata_pelajaran mp ON gmp.mata_pelajaran_id = mp.id
      WHERE u.id = ?
      GROUP BY u.id
    `,
      [id]
    );
    await connection.end();

    if (guru.length === 0) {
      return res.status(404).json({ error: "Guru tidak ditemukan" });
    }

    console.log("Berhasil mengambil data guru:", id);
    res.json(guru[0]);
  } catch (error) {
    console.error("ERROR GET GURU BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data guru" });
  }
});

// Create guru
router.post("/", authenticateToken, async (req, res) => {
  try {
    console.log("Menambah guru baru:", req.body);

    const { nama, email, kelas_id, nip, is_wali_kelas } = req.body;
    const id = generateId();

    const password = "password123";
    console.log("Password to hash:", password);

    if (!password || typeof password !== "string") {
      console.error("Invalid password:", password);
      return res.status(400).json({ error: "Password tidak valid" });
    }

    try {
      const hashedPassword = await hashPassword(password);
      console.log("Password hashed successfully");

      const connection = await getConnection();

      await connection.execute(
        'INSERT INTO users (id, nama, email, password, role, kelas_id, nip, is_wali_kelas) VALUES (?, ?, ?, ?, "guru", ?, ?, ?)',
        [
          id,
          nama,
          email,
          hashedPassword,
          kelas_id || null,
          nip || null,
          is_wali_kelas || false,
        ]
      );

      await connection.end();

      console.log("Guru berhasil ditambahkan:", email);
      res.json({
        message: "Guru berhasil ditambahkan",
        id,
        info: "Password default: password123",
      });
    } catch (hashError) {
      console.error("BCRYPT HASH ERROR:", hashError.message);
      res.status(500).json({ error: "Gagal mengenkripsi password" });
    }
  } catch (error) {
    console.error("ERROR POST GURU:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error stack:", error.stack);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal menambah guru" });
  }
});

// Update guru
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Update guru:", id, req.body);

    const { nama, email, kelas_id, nip, is_wali_kelas } = req.body;

    const cleanKelasId = kelas_id || null;
    const cleanNip = nip || null;
    const cleanIsWaliKelas = is_wali_kelas || false;

    const connection = await getConnection();

    const updateData = [
      nama,
      email,
      cleanKelasId,
      cleanNip,
      cleanIsWaliKelas,
      id,
    ];

    console.log("Update data:", updateData);

    await connection.execute(
      "UPDATE users SET nama = ?, email = ?, kelas_id = ?, nip = ?, is_wali_kelas = ? WHERE id = ?",
      updateData
    );

    await connection.end();

    console.log("Guru berhasil diupdate:", id);
    res.json({ message: "Guru berhasil diupdate" });
  } catch (error) {
    console.error("ERROR PUT GURU:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error details:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "Email sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal mengupdate guru" });
  }
});

// Delete guru
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete guru:", id);

    const connection = await getConnection();

    // Cek jika guru adalah wali kelas
    const [waliKelas] = await connection.execute(
      "SELECT id FROM kelas WHERE wali_kelas_id = ?",
      [id]
    );

    if (waliKelas.length > 0) {
      await connection.end();
      return res.status(400).json({
        error: "Guru tidak dapat dihapus karena masih menjadi wali kelas",
      });
    }

    await connection.execute(
      "DELETE FROM users WHERE id = ? AND role = 'guru'",
      [id]
    );
    await connection.end();

    console.log("Guru berhasil dihapus:", id);
    res.json({ message: "Guru berhasil dihapus" });
  } catch (error) {
    console.error("ERROR DELETE GURU:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus guru" });
  }
});

// Add mata pelajaran to guru
router.post("/:id/mata-pelajaran", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { mata_pelajaran_id } = req.body;

    console.log("Menambah mata pelajaran ke guru:", id, mata_pelajaran_id);

    const connection = await getConnection();

    // Check if relationship already exists
    const [existing] = await connection.execute(
      "SELECT * FROM guru_mata_pelajaran WHERE guru_id = ? AND mata_pelajaran_id = ?",
      [id, mata_pelajaran_id]
    );

    if (existing.length > 0) {
      await connection.end();
      return res
        .status(400)
        .json({ error: "Guru sudah memiliki mata pelajaran ini" });
    }

    const relationId = generateId();
    await connection.execute(
      "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id) VALUES (?, ?, ?)",
      [relationId, id, mata_pelajaran_id]
    );

    await connection.end();

    console.log("Mata pelajaran berhasil ditambahkan ke guru");
    res.json({
      message: "Mata pelajaran berhasil ditambahkan",
      id: relationId,
    });
  } catch (error) {
    console.error("ERROR ADD MATA PELAJARAN TO GURU:", error.message);
    res.status(500).json({ error: "Gagal menambah mata pelajaran ke guru" });
  }
});

// Get mata pelajaran by guru
router.get("/:id/mata-pelajaran", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil mata pelajaran untuk guru:", id);

    const connection = await getConnection();

    const [mataPelajaran] = await connection.execute(
      `SELECT mp.* 
       FROM mata_pelajaran mp
       JOIN guru_mata_pelajaran gmp ON mp.id = gmp.mata_pelajaran_id
       WHERE gmp.guru_id = ?`,
      [id]
    );

    await connection.end();

    console.log("Mata pelajaran ditemukan:", mataPelajaran.length);
    res.json(mataPelajaran);
  } catch (error) {
    console.error("ERROR GET MATA PELAJARAN BY GURU:", error.message);
    res.status(500).json({ error: "Gagal mengambil mata pelajaran guru" });
  }
});

// Remove mata pelajaran from guru
router.delete("/:guruId/mata-pelajaran/:mataPelajaranId", authenticateToken, async (req, res) => {
  try {
    const { guruId, mataPelajaranId } = req.params;
    console.log(
      "Menghapus mata pelajaran dari guru:",
      guruId,
      mataPelajaranId
    );

    const connection = await getConnection();

    await connection.execute(
      "DELETE FROM guru_mata_pelajaran WHERE guru_id = ? AND mata_pelajaran_id = ?",
      [guruId, mataPelajaranId]
    );

    await connection.end();

    console.log("Mata pelajaran berhasil dihapus dari guru");
    res.json({ message: "Mata pelajaran berhasil dihapus" });
  } catch (error) {
    console.error("ERROR REMOVE MATA PELAJARAN FROM GURU:", error.message);
    res
      .status(500)
      .json({ error: "Gagal menghapus mata pelajaran dari guru" });
  }
});

// Import guru dari Excel
router.post("/import", authenticateToken, excelUploadMiddleware, async (req, res) => {
  let connection;
  try {
    console.log("Import guru dari Excel (memory storage)");

    if (!req.file) {
      return res.status(400).json({ error: "Tidak ada file yang diupload" });
    }

    console.log("File received in memory:", {
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      bufferLength: req.file.buffer.length,
    });

    // Baca file Excel langsung dari buffer
    const importedTeachers = await readExcelTeachersFromBuffer(
      req.file.buffer
    );

    if (importedTeachers.length === 0) {
      return res.status(400).json({
        error: "Tidak ada data guru yang valid ditemukan dalam file",
      });
    }

    console.log(`Found ${importedTeachers.length} teachers to import`);

    // Ambil data kelas dan mata pelajaran untuk mapping
    connection = await getConnection();
    const [classList] = await connection.execute(
      "SELECT id, nama FROM kelas"
    );
    const [subjectList] = await connection.execute(
      "SELECT id, nama FROM mata_pelajaran"
    );
    await connection.end();

    // Proses import
    const result = await processTeacherImport(
      importedTeachers,
      classList,
      subjectList
    );

    console.log("Import completed:", result);
    res.json({
      message: "Import selesai",
      ...result,
    });
  } catch (error) {
    if (connection) {
      await connection.end();
    }

    console.error("ERROR IMPORT GURU:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      error: "Gagal mengimport guru: " + error.message,
    });
  }
});

// Fungsi untuk membaca Excel guru dari buffer
async function readExcelTeachersFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(worksheet);
  console.log("Raw Excel data from buffer:", data);

  const teachers = [];

  data.forEach((row, index) => {
    try {
      const teacherData = mapExcelRowToTeacher(row, index + 2);
      if (teacherData) {
        teachers.push(teacherData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${teachers.length} teachers from Excel buffer`);
  return teachers;
}

// Fungsi mapping row untuk guru
function mapExcelRowToTeacher(row, rowNumber) {
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  const nip =
    normalizedRow["nip"] ||
    normalizedRow["nomor induk pegawai"] ||
    normalizedRow["no induk pegawai"] ||
    normalizedRow["nomor induk"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama guru"] ||
    normalizedRow["nama lengkap"] ||
    "";

  const email =
    normalizedRow["email"] ||
    normalizedRow["email guru"] ||
    normalizedRow["alamat email"] ||
    "";

  const mataPelajaranNama =
    normalizedRow["mata_pelajaran_nama"] ||
    normalizedRow["mata pelajaran"] ||
    normalizedRow["pelajaran"] ||
    normalizedRow["subject"] ||
    "";

  const kelasNama =
    normalizedRow["kelas_nama"] ||
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    "";

  if (!nip || !nama || !email) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nip,
      nama,
      email,
    });
    return null;
  }

  let isWaliKelas = false;
  const waliKelasValue =
    normalizedRow["is_wali_kelas"] ||
    normalizedRow["wali kelas"] ||
    normalizedRow["is_wali"] ||
    normalizedRow["homeroom teacher"] ||
    "";

  if (waliKelasValue) {
    const normalizedWali = waliKelasValue.toString().toLowerCase().trim();
    if (
      normalizedWali.includes("ya") ||
      normalizedWali === "y" ||
      normalizedWali === "yes" ||
      normalizedWali === "true" ||
      normalizedWali === "1"
    ) {
      isWaliKelas = true;
    }
  }

  const noTelepon =
    normalizedRow["no_telepon"] ||
    normalizedRow["no telepon"] ||
    normalizedRow["telepon"] ||
    normalizedRow["phone"] ||
    normalizedRow["nomor telepon"] ||
    "";

  const teacher = {
    nip: nip.toString().trim(),
    nama: nama.toString().trim(),
    email: email.toString().trim(),
    mata_pelajaran_nama: mataPelajaranNama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    no_telepon: noTelepon.toString().trim(),
    is_wali_kelas: isWaliKelas,
    row_number: rowNumber,
  };

  console.log(`Mapped teacher data for row ${rowNumber}:`, teacher);
  return teacher;
}

// Fungsi processTeacherImport
async function processTeacherImport(importedTeachers, classList, subjectList) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const teacherData of importedTeachers) {
      try {
        if (!teacherData.nip || !teacherData.nama || !teacherData.email) {
          results.failed++;
          results.errors.push(
            `Baris ${teacherData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        const [existingNIP] = await connection.execute(
          "SELECT id FROM users WHERE nip = ? AND role = 'guru'",
          [teacherData.nip]
        );

        if (existingNIP.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${teacherData.row_number}: NIP '${teacherData.nip}' sudah terdaftar`
          );
          continue;
        }

        const [existingEmail] = await connection.execute(
          "SELECT id FROM users WHERE email = ?",
          [teacherData.email]
        );

        if (existingEmail.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${teacherData.row_number}: Email '${teacherData.email}' sudah terdaftar`
          );
          continue;
        }

        let kelasId = null;
        if (teacherData.kelas_nama) {
          const classItem = classList.find(
            (cls) =>
              cls.nama.toLowerCase() === teacherData.kelas_nama.toLowerCase()
          );

          if (!classItem) {
            results.failed++;
            results.errors.push(
              `Baris ${teacherData.row_number}: Kelas '${teacherData.kelas_nama}' tidak ditemukan`
            );
            continue;
          }
          kelasId = classItem.id;
        }

        await connection.beginTransaction();

        try {
          const teacherId = generateId();
          const password = "password123";
          const hashedPassword = await hashPassword(password);

          await connection.execute(
            "INSERT INTO users (id, nama, email, password, role, nip, kelas_id, is_wali_kelas, no_telepon) VALUES (?, ?, ?, ?, 'guru', ?, ?, ?, ?)",
            [
              teacherId,
              teacherData.nama,
              teacherData.email,
              hashedPassword,
              teacherData.nip,
              kelasId,
              teacherData.is_wali_kelas,
              teacherData.no_telepon || "",
            ]
          );

          if (teacherData.mata_pelajaran_nama) {
            const mataPelajaranItems = teacherData.mata_pelajaran_nama
              .split(",")
              .map((item) => item.trim());

            for (const mpNama of mataPelajaranItems) {
              const subjectItem = subjectList.find(
                (subj) => subj.nama.toLowerCase() === mpNama.toLowerCase()
              );

              if (subjectItem) {
                const relationId = generateId();
                await connection.execute(
                  "INSERT INTO guru_mata_pelajaran (id, guru_id, mata_pelajaran_id) VALUES (?, ?, ?)",
                  [relationId, teacherId, subjectItem.id]
                );
              }
            }
          }

          await connection.commit();
          results.success++;
        } catch (transactionError) {
          await connection.rollback();
          throw transactionError;
        }
      } catch (teacherError) {
        results.failed++;
        results.errors.push(
          `Baris ${teacherData.row_number}: ${teacherError.message}`
        );
        console.error(
          `Error importing teacher ${teacherData.nip}:`,
          teacherError.message
        );
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

module.exports = router;