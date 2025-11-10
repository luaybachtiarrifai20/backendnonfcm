const express = require("express");
const router = express.Router();
const { getConnection } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { excelUploadMiddleware } = require("../middleware/upload");
const { generateId, formatDateFromExcel, hashPassword } = require("../utils/helpers");
const XLSX = require("xlsx");

// Get all siswa
router.get("/", authenticateToken, async (req, res) => {
  try {
    console.log("Mengambil data siswa");
    const connection = await getConnection();
    const [siswa] = await connection.execute(`
      SELECT s.*, k.nama as kelas_nama 
      FROM siswa s 
      LEFT JOIN kelas k ON s.kelas_id = k.id
    `);
    await connection.end();
    console.log("Berhasil mengambil data siswa, jumlah:", siswa.length);
    res.json(siswa);
  } catch (error) {
    console.error("ERROR GET SISWA:", error.message);
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

// Get siswa by kelas ID
router.get("/kelas/:kelasId", authenticateToken, async (req, res) => {
  try {
    const { kelasId } = req.params;
    console.log("Mengambil data siswa by kelas ID:", kelasId);

    const connection = await getConnection();
    const [siswa] = await connection.execute(
      "SELECT s.*, k.nama as kelas_nama FROM siswa s LEFT JOIN kelas k ON s.kelas_id = k.id WHERE s.kelas_id = ? ORDER BY s.nama",
      [kelasId]
    );
    await connection.end();

    console.log(
      "Berhasil mengambil data siswa untuk kelas:",
      kelasId,
      "jumlah:",
      siswa.length
    );
    res.json(siswa);
  } catch (error) {
    console.error("ERROR GET SISWA BY KELAS:", error.message);
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

// Get siswa by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Mengambil data siswa by ID:", id);

    const connection = await getConnection();
    const [siswa] = await connection.execute(
      "SELECT s.*, k.nama as kelas_nama FROM siswa s LEFT JOIN kelas k ON s.kelas_id = k.id WHERE s.id = ?",
      [id]
    );
    await connection.end();

    if (siswa.length === 0) {
      return res.status(404).json({ error: "Siswa tidak ditemukan" });
    }

    console.log("Berhasil mengambil data siswa:", id);
    res.json(siswa[0]);
  } catch (error) {
    console.error("ERROR GET SISWA BY ID:", error.message);
    res.status(500).json({ error: "Gagal mengambil data siswa" });
  }
});

// Create siswa
router.post("/", authenticateToken, async (req, res) => {
  let connection;
  try {
    console.log("Menambah siswa baru:", req.body);
    const {
      nis,
      nama,
      kelas_id,
      alamat,
      tanggal_lahir,
      jenis_kelamin,
      nama_wali,
      no_telepon,
      email_wali,
    } = req.body;

    const id = generateId();
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const updatedAt = createdAt;

    connection = await getConnection();

    await connection.beginTransaction();

    try {
      await connection.execute(
        "INSERT INTO siswa (id, nis, nama, kelas_id, alamat, tanggal_lahir, jenis_kelamin, nama_wali, no_telepon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          nis,
          nama,
          kelas_id,
          alamat,
          tanggal_lahir,
          jenis_kelamin,
          nama_wali,
          no_telepon,
          createdAt,
          updatedAt,
        ]
      );

      console.log("Siswa berhasil dimasukkan ke database dengan ID:", id);

      if (email_wali && nama_wali) {
        console.log("Membuat user wali dengan email:", email_wali);

        const [existingUsers] = await connection.execute(
          "SELECT id FROM users WHERE email = ?",
          [email_wali]
        );

        if (existingUsers.length > 0) {
          await connection.rollback();
          return res.status(400).json({
            error: `Email wali '${email_wali}' sudah terdaftar`,
          });
        }

        const waliId = generateId();
        const password = "password123";
        const hashedPassword = await hashPassword(password);

        await connection.execute(
          'INSERT INTO users (id, nama, email, password, role, siswa_id) VALUES (?, ?, ?, ?, "wali", ?)',
          [waliId, nama_wali, email_wali, hashedPassword, id]
        );

        console.log("User wali berhasil dibuat dengan ID:", waliId);
      }

      await connection.commit();
      console.log("Transaction committed successfully");

      res.json({
        message: "Siswa berhasil ditambahkan",
        id,
        info: email_wali
          ? "User wali berhasil dibuat dengan password: password123"
          : "User wali tidak dibuat (email tidak disediakan)",
      });
    } catch (transactionError) {
      await connection.rollback();
      console.error("Transaction error:", transactionError.message);
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR POST SISWA:", error.message);
    console.error("SQL Error code:", error.code);
    console.error("Error stack:", error.stack);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "NIS sudah terdaftar" });
    }

    res.status(500).json({
      error: "Gagal menambah siswa: " + error.message,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
});

// Update siswa
router.put("/:id", authenticateToken, async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    console.log("Update siswa:", id, req.body);
    const {
      nis,
      nama,
      kelas_id,
      alamat,
      tanggal_lahir,
      jenis_kelamin,
      nama_wali,
      no_telepon,
      email_wali,
    } = req.body;
    const updatedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

    connection = await getConnection();

    await connection.beginTransaction();

    try {
      await connection.execute(
        "UPDATE siswa SET nis = ?, nama = ?, kelas_id = ?, alamat = ?, tanggal_lahir = ?, jenis_kelamin = ?, nama_wali = ?, no_telepon = ?, updated_at = ? WHERE id = ?",
        [
          nis,
          nama,
          kelas_id,
          alamat,
          tanggal_lahir,
          jenis_kelamin,
          nama_wali,
          no_telepon,
          updatedAt,
          id,
        ]
      );

      const [existingWali] = await connection.execute(
        "SELECT id, email FROM users WHERE siswa_id = ? AND role = 'wali'",
        [id]
      );

      if (email_wali && nama_wali) {
        if (existingWali.length > 0) {
          if (existingWali[0].email !== email_wali) {
            const [emailCheck] = await connection.execute(
              "SELECT id FROM users WHERE email = ? AND id != ?",
              [email_wali, existingWali[0].id]
            );

            if (emailCheck.length > 0) {
              await connection.rollback();
              await connection.end();
              return res
                .status(400)
                .json({ error: "Email wali sudah digunakan" });
            }
          }

          await connection.execute(
            "UPDATE users SET nama = ?, email = ? WHERE siswa_id = ? AND role = 'wali'",
            [nama_wali, email_wali, id]
          );
        } else {
          const waliId = generateId();
          const password = "password123";
          const hashedPassword = await hashPassword(password);

          const [emailCheck] = await connection.execute(
            "SELECT id FROM users WHERE email = ?",
            [email_wali]
          );

          if (emailCheck.length > 0) {
            await connection.rollback();
            await connection.end();
            return res.status(400).json({
              error: "Email wali sudah digunakan oleh user lain",
            });
          }

          await connection.execute(
            'INSERT INTO users (id, nama, email, password, role, siswa_id) VALUES (?, ?, ?, ?, "wali", ?)',
            [waliId, nama_wali, email_wali, hashedPassword, id]
          );

          console.log("User wali baru berhasil dibuat:", waliId);
        }
      } else if (existingWali.length > 0) {
        await connection.execute(
          "DELETE FROM users WHERE siswa_id = ? AND role = 'wali'",
          [id]
        );
      }

      await connection.commit();
      await connection.end();

      console.log("Siswa berhasil diupdate:", id);
      res.json({
        message: "Siswa berhasil diupdate",
        info:
          email_wali && nama_wali
            ? "User wali berhasil dibuat/diperbarui dengan password: password123"
            : undefined,
      });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR PUT SISWA:", error.message);
    console.error("SQL Error code:", error.code);

    if (connection) {
      await connection.end();
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ error: "NIS sudah terdaftar" });
    }

    res.status(500).json({ error: "Gagal mengupdate siswa: " + error.message });
  }
});

// Delete siswa
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("Delete siswa:", id);

    const connection = await getConnection();

    await connection.beginTransaction();

    try {
      await connection.execute(
        "DELETE FROM users WHERE siswa_id = ? AND role = 'wali'",
        [id]
      );

      await connection.execute("DELETE FROM siswa WHERE id = ?", [id]);

      await connection.commit();
      await connection.end();

      console.log("Siswa berhasil dihapus:", id);
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    }
  } catch (error) {
    console.error("ERROR DELETE SISWA:", error.message);
    console.error("SQL Error code:", error.code);
    res.status(500).json({ error: "Gagal menghapus siswa" });
  }
});

// Import siswa dari Excel
router.post("/import", authenticateToken, excelUploadMiddleware, async (req, res) => {
  let connection;
  try {
    console.log("Import siswa dari Excel (memory storage)");

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
    const importedStudents = await readExcelStudentsFromBuffer(req.file.buffer);

    if (importedStudents.length === 0) {
      return res.status(400).json({
        error: "Tidak ada data siswa yang valid ditemukan dalam file",
      });
    }

    console.log(`Found ${importedStudents.length} students to import`);

    // Ambil data kelas untuk mapping
    connection = await getConnection();
    const [classList] = await connection.execute(
      "SELECT id, nama FROM kelas"
    );
    await connection.end();

    // Proses import
    const result = await processStudentImport(importedStudents, classList);

    console.log("Import completed:", result);
    res.json({
      message: "Import selesai",
      ...result,
    });
  } catch (error) {
    if (connection) {
      await connection.end();
    }

    console.error("ERROR IMPORT SISWA:", error.message);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      error: "Gagal mengimport siswa: " + error.message,
    });
  }
});

router.get("/template", authenticateToken, async (req, res) => {
  try {
    const XLSX = require("xlsx");

    // Data contoh untuk template
    const templateData = [
      {
        nis: "2024001",
        nama: "John Doe",
        kelas_nama: "X IPA 1",
        alamat: "Jl. Contoh No. 123",
        tanggal_lahir: "2008-05-15",
        jenis_kelamin: "L",
        nama_wali: "Robert Doe",
        no_telepon: "081234567890",
        email_wali: "robert@example.com",
      },
      {
        nis: "2024002",
        nama: "Jane Smith",
        kelas_nama: "X IPA 2",
        alamat: "Jl. Sample No. 456",
        tanggal_lahir: "2008-08-20",
        jenis_kelamin: "P",
        nama_wali: "Alice Smith",
        no_telepon: "081298765432",
        email_wali: "alice@example.com",
      },
    ];

    // Buat workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(templateData);

    // Tambahkan worksheet ke workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template Siswa");

    // Set header
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_siswa.xlsx"'
    );

    // Tulis ke response
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.send(buffer);
  } catch (error) {
    console.error("ERROR DOWNLOAD TEMPLATE:", error.message);
    res.status(500).json({ error: "Gagal mendownload template" });
  }
});

// Fungsi untuk membaca Excel siswa dari buffer
async function readExcelStudentsFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(worksheet);
  console.log("Raw Excel data from buffer:", data);

  const students = [];

  data.forEach((row, index) => {
    try {
      const studentData = mapExcelRowToStudent(row, index + 2);
      if (studentData) {
        students.push(studentData);
      }
    } catch (error) {
      console.error(`Error processing row ${index + 2}:`, error);
    }
  });

  console.log(`Processed ${students.length} students from Excel buffer`);
  return students;
}

// Fungsi mapping row untuk siswa
function mapExcelRowToStudent(row, rowNumber) {
  const normalizedRow = {};
  Object.keys(row).forEach((key) => {
    normalizedRow[key.toLowerCase().trim()] = row[key];
  });

  console.log(`Processing row ${rowNumber}:`, normalizedRow);

  const nis =
    normalizedRow["nis"] ||
    normalizedRow["nomor induk"] ||
    normalizedRow["nomor induk siswa"] ||
    normalizedRow["student id"] ||
    "";

  const nama =
    normalizedRow["nama"] ||
    normalizedRow["name"] ||
    normalizedRow["nama siswa"] ||
    normalizedRow["student name"] ||
    "";

  const kelasNama =
    normalizedRow["kelas"] ||
    normalizedRow["class"] ||
    normalizedRow["nama kelas"] ||
    normalizedRow["kelas_nama"] ||
    "";

  const alamat =
    normalizedRow["alamat"] ||
    normalizedRow["address"] ||
    normalizedRow["tempat tinggal"] ||
    "";

  const tanggalLahir =
    normalizedRow["tanggal lahir"] ||
    normalizedRow["tanggal_lahir"] ||
    normalizedRow["birth date"] ||
    normalizedRow["tgl lahir"] ||
    "";

  const jenisKelamin =
    normalizedRow["jenis kelamin"] ||
    normalizedRow["jenis_kelamin"] ||
    normalizedRow["gender"] ||
    normalizedRow["kelamin"] ||
    "";

  const namaWali =
    normalizedRow["nama wali"] ||
    normalizedRow["nama_wali"] ||
    normalizedRow["parent name"] ||
    normalizedRow["wali"] ||
    "";

  const noTelepon =
    normalizedRow["no telepon"] ||
    normalizedRow["no_telepon"] ||
    normalizedRow["telepon"] ||
    normalizedRow["phone"] ||
    normalizedRow["nomor telepon"] ||
    "";

  const emailWali =
    normalizedRow["email wali"] ||
    normalizedRow["email_wali"] ||
    normalizedRow["parent email"] ||
    normalizedRow["email"] ||
    "";

  if (!nis || !nama || !kelasNama) {
    console.log(`Skipping row ${rowNumber}: Missing required data`, {
      nis,
      nama,
      kelasNama,
    });
    return null;
  }

  const formattedTanggalLahir = formatDateFromExcel(tanggalLahir);

  const studentData = {
    nis: nis.toString().trim(),
    nama: nama.toString().trim(),
    kelas_nama: kelasNama.toString().trim(),
    alamat: alamat ? alamat.toString().trim() : "",
    tanggal_lahir: formattedTanggalLahir,
    jenis_kelamin: jenisKelamin ? jenisKelamin.toString().trim() : "",
    nama_wali: namaWali ? namaWali.toString().trim() : "",
    no_telepon: noTelepon ? noTelepon.toString().trim() : "",
    email_wali: emailWali ? emailWali.toString().trim() : "",
    row_number: rowNumber,
  };

  console.log(`Mapped student data for row ${rowNumber}:`, studentData);
  return studentData;
}

// Fungsi processStudentImport
async function processStudentImport(importedStudents, classList) {
  let connection;
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  try {
    connection = await getConnection();

    for (const studentData of importedStudents) {
      try {
        if (!studentData.nis || !studentData.nama || !studentData.kelas_nama) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: Data required tidak lengkap`
          );
          continue;
        }

        const [existingStudent] = await connection.execute(
          "SELECT id FROM siswa WHERE nis = ?",
          [studentData.nis]
        );

        if (existingStudent.length > 0) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: NIS '${studentData.nis}' sudah terdaftar`
          );
          continue;
        }

        const classItem = classList.find(
          (cls) =>
            cls.nama.toLowerCase() === studentData.kelas_nama.toLowerCase()
        );

        if (!classItem) {
          results.failed++;
          results.errors.push(
            `Baris ${studentData.row_number}: Kelas '${studentData.kelas_nama}' tidak ditemukan`
          );
          continue;
        }

        await connection.beginTransaction();

        try {
          const studentId = generateId();
          const createdAt = new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          const updatedAt = createdAt;

          await connection.execute(
            "INSERT INTO siswa (id, nis, nama, kelas_id, alamat, tanggal_lahir, jenis_kelamin, nama_wali, no_telepon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              studentId,
              studentData.nis,
              studentData.nama,
              classItem.id,
              studentData.alamat,
              studentData.tanggal_lahir,
              studentData.jenis_kelamin,
              studentData.nama_wali,
              studentData.no_telepon,
              createdAt,
              updatedAt,
            ]
          );

          if (studentData.email_wali && studentData.nama_wali) {
            const [existingWali] = await connection.execute(
              "SELECT id FROM users WHERE email = ?",
              [studentData.email_wali]
            );

            if (existingWali.length === 0) {
              const waliId = generateId();
              const password = "password123";
              const hashedPassword = await hashPassword(password);

              await connection.execute(
                'INSERT INTO users (id, nama, email, password, role, siswa_id) VALUES (?, ?, ?, ?, "wali", ?)',
                [
                  waliId,
                  studentData.nama_wali,
                  studentData.email_wali,
                  hashedPassword,
                  studentId,
                ]
              );
            }
          }

          await connection.commit();
          results.success++;
        } catch (transactionError) {
          await connection.rollback();
          throw transactionError;
        }
      } catch (studentError) {
        results.failed++;
        results.errors.push(
          `Baris ${studentData.row_number}: ${studentError.message}`
        );
        console.error(
          `Error importing student ${studentData.nis}:`,
          studentError.message
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