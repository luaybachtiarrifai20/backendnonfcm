const crypto = require("crypto");
const bcrypt = require("bcryptjs");

// Fungsi untuk membuat UUID
function generateId() {
  return crypto.randomUUID();
}

// Fungsi untuk format tanggal dari Excel
function formatDateFromExcel(dateValue) {
  if (!dateValue) return "";

  console.log("Original date value:", dateValue, "Type:", typeof dateValue);

  try {
    if (typeof dateValue === "string") {
      const dateFormats = [
        "YYYY-MM-DD",
        "DD/MM/YYYY",
        "MM/DD/YYYY",
        "YYYY/MM/DD",
        "DD-MM-YYYY",
        "MM-DD-YYYY",
      ];

      for (const format of dateFormats) {
        const parsed = tryParseDate(dateValue, format);
        if (parsed) {
          return parsed.toISOString().split("T")[0];
        }
      }

      if (dateValue.includes(" ")) {
        const datePart = dateValue.split(" ")[0];
        const parsed = new Date(datePart);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split("T")[0];
        }
      }
    }

    if (typeof dateValue === "number") {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(
        excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000
      );
      if (!isNaN(date.getTime())) {
        return date.toISOString().split("T")[0];
      }
    }

    if (dateValue instanceof Date) {
      if (!isNaN(dateValue.getTime())) {
        return dateValue.toISOString().split("T")[0];
      }
    }

    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  } catch (error) {
    console.error("Error formatting date:", error);
  }

  return "";
}

function tryParseDate(dateString, format) {
  try {
    const parts = dateString.split(/[/\-\.]/);
    if (parts.length !== 3) return null;

    let day, month, year;

    switch (format) {
      case "DD/MM/YYYY":
      case "DD-MM-YYYY":
        day = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        year = parseInt(parts[2]);
        break;
      case "MM/DD/YYYY":
      case "MM-DD-YYYY":
        month = parseInt(parts[0]) - 1;
        day = parseInt(parts[1]);
        year = parseInt(parts[2]);
        break;
      case "YYYY/MM/DD":
      case "YYYY-MM-DD":
        year = parseInt(parts[0]);
        month = parseInt(parts[1]) - 1;
        day = parseInt(parts[2]);
        break;
      default:
        return null;
    }

    if (year < 100) {
      year += 2000;
    }

    const date = new Date(year, month, day);
    if (
      !isNaN(date.getTime()) &&
      date.getDate() === day &&
      date.getMonth() === month &&
      date.getFullYear() === year
    ) {
      return date;
    }
  } catch (error) {
    console.error("Error parsing date:", error);
  }

  return null;
}

// Fungsi untuk hash password
async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

// Fungsi untuk membandingkan password
async function comparePassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

// Fungsi untuk mendapatkan nama hari
function getDayName(dateString) {
  if (!dateString) return "";

  try {
    const days = [
      "Minggu",
      "Senin",
      "Selasa",
      "Rabu",
      "Kamis",
      "Jumat",
      "Sabtu",
    ];
    const date = new Date(dateString);
    return days[date.getDay()];
  } catch (error) {
    console.error("Error parsing date:", error);
    return "";
  }
}

function getClassNames(subject) {
  if (subject.kelas_names) {
    return subject.kelas_names;
  }

  if (subject.kelas_list && Array.isArray(subject.kelas_list)) {
    return subject.kelas_list.map((kelas) => kelas.nama || "").join(", ");
  }

  return "";
}


module.exports = {
  generateId,
  formatDateFromExcel,
  hashPassword,
  comparePassword,
  getDayName,
  tryParseDate,
  getClassNames,

};