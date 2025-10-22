// database_local.js
const mysql = require("mysql2");

// Creamos un pool de conexiones en lugar de una sola conexión
const dbAnalisis = mysql.createPool({
  host: "db",                 // 👈 nombre del servicio definido en docker-compose.yml
  user: "root",
  password: "12345",
  database: "analizador_db",  // 👈 nombre EXACTO de la base de datos
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,        // hasta 10 conexiones simultáneas
  queueLimit: 0
});

// Comprobamos la conexión inicial
dbAnalisis.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Error conectando con analizador_db:", err.message);
  } else {
    console.log("✅ Conexión comprobada desde database_local.js hacia analizador_db.");
    connection.release(); // liberamos la conexión al pool
  }
});

// Exportamos el pool en modo promesa para poder usar async/await
module.exports = dbAnalisis.promise();
