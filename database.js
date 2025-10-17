// database.js — conexión al servidor central del proyecto de autenticación facial

const mysql = require("mysql2");

const db = mysql.createConnection({
  host: "66.70.255.24",      // IP del servidor central
  user: "Grupo4",            // Usuario asignado a tu grupo
  password: "ProyectoAut25", // Contraseña proporcionada
  database: "sistema_autenticacion", // Nombre del esquema (ajústalo si es distinto)
  port: 3306,                // Puerto estándar MySQL
  multipleStatements: true
});

// Intentar conexión
db.connect((err) => {
  if (err) {
    console.error("❌ Error conectando con la BD centralizada:", err.message);
  } else {
    console.log("✅ Conectado exitosamente a la base de datos central del sistema de autenticación.");
  }
});

module.exports = db;
