const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { Canvas, Image, ImageData, createCanvas, loadImage } = require("canvas");
const faceapi = require("face-api.js");

// =====================
// ⚙️ CONFIGURACIÓN BD
// =====================
const db = mysql.createPool({
  host: "66.70.255.24",
  user: "Grupo4",
  password: "ProyectoAut25",
  database: "sistema_autenticacion",
  port: 3306
});

// =====================
// 🧠 CARGA DE MODELOS
// =====================
const MODEL_PATH = path.join(__dirname, "models");
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

async function loadModels() {
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH),
    faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH),
    faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH)
  ]);
  console.log("✅ Modelos FaceAPI cargados.");
}

// =====================
// 🧩 PROCESAMIENTO
// =====================
async function procesarUsuarios() {
  const [usuarios] = await db.query(`
    SELECT id, imagen_referencia 
    FROM autenticacion_facial 
    WHERE imagen_referencia IS NOT NULL
  `);

  console.log(`📸 Procesando ${usuarios.length} registros...`);

  for (const u of usuarios) {
    try {
      const imgBase64 = u.imagen_referencia;
      const buffer = Buffer.from(imgBase64, "base64");
      const img = await loadImage(buffer);
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);

      const detection = await faceapi
        .detectSingleFace(canvas)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detection && detection.descriptor) {
        const encoding = JSON.stringify(Array.from(detection.descriptor));
        await db.query(
          `UPDATE autenticacion_facial SET encoding_facial = ? WHERE id = ?`,
          [encoding, u.id]
        );
        console.log(`✅ Usuario ${u.id} actualizado correctamente.`);
      } else {
        console.warn(`⚠️ No se detectó rostro para usuario ${u.id}.`);
      }
    } catch (err) {
      console.error(`❌ Error con usuario ${u.id}: ${err.message}`);
    }
  }

  console.log("🎉 Reprocesamiento completado.");
  process.exit(0);
}

// =====================
// 🚀 INICIO
// =====================
(async () => {
  await loadModels();
  await procesarUsuarios();
})();
