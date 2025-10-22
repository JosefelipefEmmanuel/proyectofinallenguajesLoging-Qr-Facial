// ============================
// server.js — versión PRO optimizada con FaceAPI + PDF + QR + Correo + WhatsApp
// ============================
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const nlp = require("compromise");
require("dotenv").config();


// ✅ Solo dos conexiones reales
const dbCentral = require("./database");          // 🌐 base de datos central (nube)
const dbAnalisis = require("./database_local.js"); // 💻 base de datos local (analizador_db)
// Agregar después de: const nlp = require("compromise");

const natural = require('natural');
const stopword = require('stopword');
const jschardet = require('jschardet');
const validator = require('validator');

// Configurar stemmer para español
const stemmerEs = natural.PorterStemmerEs;
const tokenizerEs = new natural.WordTokenizer();

// 🔁 Conexión robusta con reintento automático a analizador_db
async function conectarAnalizadorDB() {
  try {
    const [rows] = await dbAnalisis.query("SELECT 1");
    console.log("✅ Conectado exitosamente a la base de datos local analizador_db.");
  } catch (err) {
    console.error("❌ Error conectando con analizador_db:", err.message);
    console.log("⏳ Reintentando conexión en 5 segundos...");
    setTimeout(conectarAnalizadorDB, 5000);
  }
}

conectarAnalizadorDB();



const { Canvas, Image, ImageData, createCanvas, loadImage } = require("canvas");
const faceapi = require("face-api.js");
const Jimp = require("jimp");
const axios = require("axios");
const { spawn } = require("child_process");


// ============================
// ⚙️ Express + Configuración base
// ============================
const app = express();
const port = 3000;

// ============================
// 🧩 Configuración de sesión
// ============================
const session = require("express-session");

app.use(session({
  secret: "umg_secret_key_2025", // cambia por otra palabra secreta si quieres
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // false porque trabajas en http://localhost
}));


const faceRoutes = require("./routes/face_routes");
app.use("/", faceRoutes);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/uploads"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================
// 🧠 Cargar modelos FaceAPI
// ============================
const MODEL_PATH = path.join(__dirname, "models");
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
Promise.all([
  faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH),
  faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH),
  faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH),
  faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_PATH),
]).then(() => console.log("✅ Modelos de FaceAPI cargados correctamente."));

// ============================
// 🏠 Página principal
// ============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

// ============================
// 📩 Registrar usuario (usa fn_encriptar_password en la BD)
// ============================
// ============================
// 📩 Registrar usuario (usa fn_encriptar_password en la BD)
// ============================
app.post("/api/registrar", upload.single("photo"), async (req, res) => {
  try {
    const { nombre1, nombre2, nombre3, apellido1, apellido2, correo, telefono, cedula, filtro, password } = req.body;
    let fotoPath = null;

    // 📸 Verificar foto
    if (req.file && req.file.path) {
      fotoPath = path.resolve(__dirname, req.file.path);
      console.log("📁 Foto subida correctamente:", fotoPath);
    } else {
      console.warn("⚠️ No se recibió archivo de foto en la solicitud.");
    }

    // 🧾 Datos básicos
    const codigoQR = `UMG-QR-${Math.floor(100000 + Math.random() * 900000)}`;
    const nombreCompleto = [nombre1, nombre2, nombre3, apellido1, apellido2].filter(Boolean).join(" ");
    const usuario = `${nombre1}.${apellido1}`.toLowerCase();

    const qrPath = `public/uploads/${codigoQR}.png`;
    const qrURL = `http://localhost:${port}/analizador.html?codigo=${codigoQR}`;
    await QRCode.toFile(qrPath, qrURL);
    const qrBuffer = fs.readFileSync(qrPath);

    let fotoFinalPath = fotoPath;
    let fotoFiltradaPath = null;
    let encodingFacial = null;

    // 🧠 Procesar foto si existe
    if (fotoPath) {
      try {
        const imageBuffer = fs.readFileSync(fotoPath);
        const imageBase64 = imageBuffer.toString("base64");

        // 🔍 Segmentar rostro
        const response = await axios.post(
          "http://www.server.daossystem.pro:3405/Rostro/Segmentar",
          { RostroA: imageBase64 },
          { headers: { "Content-Type": "application/json" }, timeout: 10000 }
        );

        if (response.data && response.data.rostro) {
          const imgData = Buffer.from(response.data.rostro, "base64");
          const segmentadoPath = path.resolve(__dirname, "public", "uploads", `${codigoQR}_rostro_segmentado.png`);
          fs.writeFileSync(segmentadoPath, imgData);

          // ✅ Crear copia filtrada personalizada
          const filtradoPath = path.resolve(__dirname, "public", "uploads", `${codigoQR}_rostro_filtrado.png`);
          const jimpImg = await Jimp.read(segmentadoPath);

          const filtroSeleccionado = (filtro || "ninguno").toLowerCase();
          console.log("🎨 Aplicando filtro:", filtroSeleccionado);

          const overlayDir = path.join(__dirname, "filtros");
          let overlayFile = "";

          switch (filtroSeleccionado) {
            case "perro": overlayFile = "perro.png"; break;
            case "gato": overlayFile = "gato.png"; break;
            case "lentes": overlayFile = "lentes.png"; break;
            case "mapache": overlayFile = "mapache.png"; break;
            default: overlayFile = ""; break;
          }

          // 📎 Aplicar overlay si existe
          if (overlayFile) {
            const overlayPath = path.join(overlayDir, overlayFile);
            if (fs.existsSync(overlayPath)) {
              // ✅ Detectar rostro y aplicar overlay con landmarks
              const canvas = await canvasLoadImage(segmentadoPath);
              const detection = await faceapi.detectSingleFace(canvas).withFaceLandmarks().withFaceDescriptor();

              if (detection && detection.landmarks) {
                const landmarks = detection.landmarks;
                const jimpOverlay = await Jimp.read(overlayPath);
                const imgW = jimpImg.bitmap.width;

                if (filtroSeleccionado === "lentes") {
                  const leftEye = landmarks.getLeftEye();
                  const rightEye = landmarks.getRightEye();
                  const eyeCenterX = (leftEye[0].x + rightEye[3].x) / 2;
                  const eyeCenterY = (leftEye[0].y + rightEye[3].y) / 2;
                  const eyeWidth = Math.abs(rightEye[3].x - leftEye[0].x) * 2.4;
                  jimpOverlay.resize(eyeWidth, Jimp.AUTO);

                  const posX = eyeCenterX - jimpOverlay.bitmap.width / 2;
                  const posY = eyeCenterY - jimpOverlay.bitmap.height / 1.9;
                  jimpImg.composite(jimpOverlay, posX, posY, { mode: Jimp.BLEND_SOURCE_OVER, opacitySource: 1 });
                  console.log("🕶️ Filtro de lentes posicionado correctamente.");
                } else if (["perro", "gato", "mapache"].includes(filtroSeleccionado)) {
                  const jaw = landmarks.getJawOutline();
                  const leftEye = landmarks.getLeftEye();
                  const rightEye = landmarks.getRightEye();
                  const nose = landmarks.getNose();

                  // 📏 Calcula proporciones reales del rostro
                  const faceHeight = Math.abs(jaw[8].y - leftEye[0].y) * 2.2; // más cobertura
                  const faceWidth = Math.abs(rightEye[3].x - leftEye[0].x) * 2.4;

                  const jimpOverlay = await Jimp.read(overlayPath);
                  jimpOverlay.resize(faceWidth, faceHeight);

                  // 📍 Centrar el filtro en la cabeza (entre ojos)
                  const centerX = (leftEye[0].x + rightEye[3].x) / 2 - jimpOverlay.bitmap.width / 2;
                  const faceHeightRef = Math.abs(jaw[8].y - leftEye[0].y);
                  const centerY = leftEye[0].y - jimpOverlay.bitmap.height * 0.45 + faceHeightRef * 0.15;

                  jimpImg.composite(jimpOverlay, centerX, centerY, {
                    mode: Jimp.BLEND_SOURCE_OVER,
                    opacitySource: 1,
                  });

                  console.log(`🐶 Filtross ${filtroSeleccionado} adaptado dinámicamente al rostro.`);
                }



                else {
                  jimpImg.composite(jimpOverlay, 0, 0);
                }
              } else {
                console.warn("⚠️ No se pudieron obtener landmarks del rostro.");
              }
            } else {
              console.warn(`⚠️ Archivo de filtro no encontrado: ${overlayFile}`);
            }
          } else {
            jimpImg.contrast(0.2).brightness(0.1);
          }

          await jimpImg.writeAsync(filtradoPath);
          fotoFinalPath = segmentadoPath;
          fotoFiltradaPath = filtradoPath;
          console.log(`✅ Rostro segmentado y filtro "${filtroSeleccionado}" aplicado correctamente.`);
        }
      } catch (error) {
        console.error("❌ Error interno en procesamiento de foto:", error);
        return res.status(500).json({ success: false, message: "Error procesando la foto." });
      }
    } // fin del if (fotoPath)

    // 🧠 Generar encoding facial
    const canvas = await canvasLoadImage(fotoFinalPath);
    const detection = await faceapi.detectSingleFace(canvas).withFaceLandmarks().withFaceDescriptor();

    if (detection && detection.descriptor) {
      encodingFacial = JSON.stringify(Array.from(detection.descriptor));
      console.log("✅ Encoding facial generado correctamente.");
    }

    // 💾 Guardar usuario en la BD
    const sqlUsuario = `CALL sp_registrar_usuario(?, ?, ?, ?, ?, ?, ?, ?, @p_resultado, @p_mensaje);`;
    const imgBase64 = fotoFinalPath ? fs.readFileSync(fotoFinalPath).toString("base64") : null;

    dbCentral.query(sqlUsuario, [usuario, correo, nombreCompleto, password, telefono, imgBase64, 1, 1], async (err) => {
      if (err) {
        console.error("❌ Error al guardar en usuarios:", err);
        return res.status(500).json({ success: false, message: "Error al guardar usuario." });
      }

      const [rowsId] = await dbCentral.promise().query("SELECT id FROM usuarios WHERE email = ? LIMIT 1", [correo]);
      const usuarioId = rowsId?.[0]?.id;

      if (!usuarioId) {
        console.error("❌ No se encontró el usuario recién insertado.");
        return res.status(500).json({ success: false, message: "Usuario no encontrado tras el registro." });
      }

      console.log("🧍 Usuario ID:", usuarioId);

      if (encodingFacial) {
        try {
          await dbCentral.promise().query(
            `INSERT INTO autenticacion_facial (usuario_id, encoding_facial, imagen_referencia, activo, fecha_creacion)
             VALUES (?, ?, ?, 1, NOW())`,
            [usuarioId, encodingFacial, imgBase64]
          );
          console.log("✅ Registro facial guardado correctamente.");
        } catch (err3) {
          console.error("⚠️ Error al guardar autenticación facial:", err3);
        }
      }

      const crypto = require("crypto");
      const qrHash = crypto.createHash("sha256").update(codigoQR).digest("hex");

      try {
        await dbCentral.promise().query(
          `INSERT INTO codigos_qr (usuario_id, codigo_qr, qr_hash, activo)
           VALUES (?, ?, ?, 1)`,
          [usuarioId, codigoQR, qrHash]
        );
        console.log("✅ Código QR y hash guardados correctamente en BD.");
      } catch (err4) {
        console.error("⚠️ Error al guardar código QR:", err4);
      }

      await generarPDFsYEnviarCorreo({
        nombre1,
        apellido1,
        nombreCompleto,
        correo,
        telefono,
        cedula,
        filtro,
        imgOriginalPath: fotoPath,
        imgFiltradaPath: fotoFiltradaPath,
        qrBuffer,
        codigoQR,
        qrPath,
      });

      enviarWhatsApp(nombre1, apellido1, telefono, codigoQR);

      res.json({
        success: true,
        message: "✅ Usuario registrado correctamente. QR vinculado al usuario.",
      });
    });

  } catch (error) {
    console.error("❌ Error externo general en /api/registrar:", error);
    res.status(500).json({ success: false, message: "Error general del servidor (externo)." });
  }
});


// ============================
// 🔐 LOGIN USUARIO (Base Centralizada con fn_encriptar_password)
// ============================
// ============================
// 🔐 LOGIN USUARIO (Base Centralizada con fn_encriptar_password)
// ============================

app.post("/api/login", async (req, res) => {
  try {
    const { correo, password } = req.body;
    console.log("📥 Intentando login con:", correo, password);

    if (!correo || !password) {
      return res.status(400).json({
        success: false,
        message: "⚠️ Faltan datos: correo o contraseña",
      });
    }

    const sql = `CALL sp_login_correo(?, ?, @p_resultado, @p_mensaje, @p_session_token);`;

    dbCentral.query(sql, [correo, password], (err) => {
      if (err) {
        console.error("❌ Error al ejecutar SP sp_login_correo:", err);
        return res.status(500).json({
          success: false,
          message: "Error en el servidor (SP).",
        });
      }

      dbCentral.query("SELECT @p_resultado AS resultado, @p_mensaje AS mensaje, @p_session_token AS token;", (err2, rows) => {
        if (err2) {
          console.error("⚠️ Error al obtener resultados del SP:", err2);
          return res.status(500).json({ success: false, message: "Error interno del sistema." });
        }

        const { resultado, mensaje, token } = rows[0] || {};

        if (!resultado || resultado === 0) {
          console.warn("⚠️ Login fallido:", mensaje);
          return res.status(401).json({ success: false, message: mensaje || "Credenciales inválidas." });
        }

        // ✅ Obtener datos del usuario
        dbCentral.query("SELECT id, nombre_completo, email, telefono FROM usuarios WHERE email = ? LIMIT 1", [correo], (err3, rows3) => {
          if (err3 || !rows3.length) {
            console.error("⚠️ No se pudo obtener información del usuario:", err3);
            return res.json({ success: true, message: mensaje || "Inicio de sesión correcto.", token, usuario: { correo } });
          }

          const user = rows3[0];

          // 🧩 ✅ Guardar sesión del usuario logueado
          req.session = req.session || {};
          req.session.user = {
            id_usuario: user.id,
            nombre: user.nombre_completo,
            correo: user.email
          };

          console.log(`✅ Sesión creada para ${user.nombre_completo} (${user.email})`);

          // 🔙 Respuesta al frontend
          res.json({
            success: true,
            message: mensaje || "Inicio de sesión correcto.",
            token,
            usuario: user
          });
        });
      });
    });
  } catch (error) {
    console.error("❌ Error general en /api/login:", error);
    res.status(500).json({ success: false, message: "Error interno del servidor." });
  }
});




// ============================
// 🔑 Login por código QR (base centralizada)
// ============================
app.post("/api/login-qr", (req, res) => {
  const { codigo } = req.body;
  if (!codigo)
    return res.status(400).json({ success: false, message: "Código QR inválido" });

  const sql = `
    SELECT u.id, u.nombre_completo, u.email, u.telefono
    FROM codigos_qr q
    INNER JOIN usuarios u ON q.usuario_id = u.id
    WHERE q.codigo_qr = ? AND q.activo = 1
  `;

  dbCentral.query(sql, [codigo], (err, results) => {

    if (err) {
      console.error("❌ Error en login QR:", err);
      return res.status(500).json({ success: false, message: "Error en el servidor" });
    }

    if (results.length === 0)
      return res.status(401).json({ success: false, message: "QR no registrado o inactivo" });

    const user = results[0];
    console.log(`✅ Login QR exitoso para ${user.nombre_completo} (${user.email})`);
    res.json({
      success: true,
      message: `Bienvenido, ${user.nombre_completo}`,
      usuario: user,
    });
  });
});


// ============================
// 🔍 Verificar carné QR (Base Centralizada)
// ============================
app.get("/verificar", (req, res) => {
  const { codigo } = req.query;
  if (!codigo) return res.send("<h3>⚠️ Código no proporcionado.</h3>");

  const sql = `
    SELECT u.*, q.codigo_qr
    FROM codigos_qr q
    INNER JOIN usuarios u ON q.usuario_id = u.id
    WHERE q.codigo_qr = ? AND q.activo = 1
  `;

  dbCentral.query(sql, [codigo], (err, results) => {
    if (err || results.length === 0)
      return res.send("<h3>❌ QR no registrado o inválido.</h3>");

    const user = results[0];
    res.send(`
      <div style="text-align:center;font-family:sans-serif;padding:30px;">
        <img src="https://upload.wikimedia.org/wikipedia/commons/3/39/Logo_UMG.png" width="90">
        <h2>Carné UMG — ${user.nombre_completo}</h2>
        <p><b>Código QR:</b> ${user.codigo_qr}</p>
        <p><b>Correo:</b> ${user.email}</p>
        <p><b>Teléfono:</b> ${user.telefono}</p>
        <p style="color:green;font-weight:bold;">Estado: ACTIVO ✅</p>
      </div>
    `);
  });
});
// ============================
// 👁️ LOGIN POR RECONOCIMIENTO FACIAL (Base Centralizada)
// ============================
app.post("/api/login-face", upload.single("rostro"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No se envió imagen." });

    const uploadedImage = await canvasLoadImage(req.file.path);
    const detection = await faceapi.detectSingleFace(uploadedImage).withFaceLandmarks().withFaceDescriptor();

    if (!detection) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: "No se detectó ningún rostro." });
    }

    // Obtener todos los usuarios con rostro registrado
    const query = `
      SELECT a.usuario_id, a.imagen_referencia, a.encoding_facial, u.nombre_completo
      FROM autenticacion_facial a
      INNER JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.activo = 1
    `;

    dbCentral.query(query, async (err, results) => {
      if (err) {
        console.error("Error al obtener datos faciales:", err);
        return res.status(500).json({ success: false, message: "Error en el servidor." });
      }

      let mejorCoincidencia = null;
      let menorDistancia = 1.0;

      for (const user of results) {
        try {
          const dbEncoding = JSON.parse(user.encoding_facial);
          const distancia = faceapi.euclideanDistance(detection.descriptor, Float32Array.from(dbEncoding));
          if (distancia < menorDistancia) {
            menorDistancia = distancia;
            mejorCoincidencia = user;
          }
        } catch (e) {
          console.error("Error comparando con usuario:", user.usuario_id, e.message);
        }
      }

      fs.unlinkSync(req.file.path);

      if (mejorCoincidencia && menorDistancia < 0.85) {
        console.log(`✅ Rostro reconocido: ${mejorCoincidencia.nombre_completo} (distancia ${menorDistancia.toFixed(2)})`);

        // 🔹 Obtener datos completos del usuario (para incluir email y teléfono)
        // 🔹 Obtener datos completos del usuario (para incluir email y teléfono)
        dbCentral.query(
          "SELECT id, nombre_completo, email, telefono FROM usuarios WHERE id = ? LIMIT 1",
          [mejorCoincidencia.usuario_id],
          (err2, rows2) => {
            if (err2 || !rows2.length) {
              console.error("⚠️ No se pudo obtener datos completos del usuario:", err2);
              return res.json({
                success: true,
                message: `Bienvenido, ${mejorCoincidencia.nombre_completo}`,
                usuario: mejorCoincidencia, // fallback
              });
            }

            const user = rows2[0];
            res.json({
              success: true,
              message: `Bienvenido, ${user.nombre_completo}`,
              usuario: user,
            });
          }
        );
      } else {
        console.log("❌ Ninguna coincidencia facial encontrada.");
        return res.status(401).json({ success: false, message: "Rostro no reconocido." });
      }

    }); // ✅ cierre del db.query

  } catch (error) {
    console.error("❌ Error general en /api/login-face:", error);
    res.status(500).json({ success: false, message: "Error general del servidor." });
  }
}); // ✅ cierre del endpoint /api/login-face




// ============================
// 🧩 Helper para generar PDFs con Puppeteer
// ============================

async function renderHtmlToPdf(htmlString, outPath) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
    timeout: 0,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);

    await page.setContent(htmlString, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 0,
    });

    await page.emulateMediaType("screen");
    await page.pdf({
      path: outPath,
      format: "A4",
      landscape: true, // 📄 Horizontal (apaisado)
      printBackground: true,
      margin: {
        top: "0cm",
        bottom: "0cm",
        left: "0cm",
        right: "0cm"
      },
      preferCSSPageSize: true
    });

  } catch (err) {
    console.error("⚠️ Error generando PDF:", err);
  } finally {
    await browser.close();
  }
}





async function generarPDFsYEnviarCorreo({
  nombre1,
  apellido1,
  nombreCompleto,
  correo,
  telefono,
  cedula,
  filtro,
  imgOriginalPath,      // ✅ ahora recibe las rutas
  imgFiltradaPath,      // ✅ con filtro (si existe)
  qrBuffer,
  codigoQR,
  qrPath
}) {
  console.log("🧾 Entrando a generarPDFsYEnviarCorreo (Puppeteer)...");
  try {
    // 1) Carga plantilla
    const htmlTemplate = fs.readFileSync(
      path.join(__dirname, "public", "plantilla_carnet.html"),
      "utf8"
    );

    // 2) Incrusta LOGO en base64 (evita rutas/OneDrive/timeouts)
    const logoFile = path.join(__dirname, "public", "img", "logo_umg.png");
    const logoBase64 = fs.readFileSync(logoFile).toString("base64");
    const logoData = `data:image/png;base64,${logoBase64}`;

    // 3) Datos comunes
    const qrData = `data:image/png;base64,${qrBuffer.toString("base64")}`;
    // Imagen original (sin filtro)
    const imgOriginalBase64 = fs.readFileSync(imgOriginalPath).toString("base64");
    const fotoDataNormal = `data:image/jpeg;base64,${imgOriginalBase64}`;

    // Imagen filtrada (si existe)
    let fotoDataFiltro = fotoDataNormal;
    if (imgFiltradaPath && fs.existsSync(imgFiltradaPath)) {
      const imgFiltradaBase64 = fs.readFileSync(imgFiltradaPath).toString("base64");
      fotoDataFiltro = `data:image/jpeg;base64,${imgFiltradaBase64}`;
    }


    const baseReplacements = (tpl, versionTexto, color) =>
      tpl
        .replace(/{{LOGO}}/g, logoData)
        .replace(/{{NOMBRE}}/g, nombreCompleto)
        .replace(/{{CEDULA}}/g, cedula || "N/A")
        .replace(/{{CORREO}}/g, correo)
        .replace(/{{TELEFONO}}/g, telefono)
        .replace(/{{CODIGO}}/g, codigoQR)
        .replace(/{{QR}}/g, qrData)
        .replace(/{{FILTRO}}/g, versionTexto)
        .replace(/{{BANDA_COLOR}}/g, color);


    // 4) HTML con filtro y sin filtro
    const htmlConFiltro = baseReplacements(htmlTemplate, "CON FILTRO", "#0069d9")
      .replace(/{{FOTO}}/g, fotoDataFiltro);

    const htmlSinFiltro = baseReplacements(htmlTemplate, "SIN FILTRO", "#6c757d")
      .replace(/{{FOTO}}/g, fotoDataNormal);



    // 5) Rutas de salida
    const pdfConFiltroPath = path.join(__dirname, "public", "uploads", `${codigoQR}_carnet.pdf`);
    const pdfSinFiltroPath = path.join(__dirname, "public", "uploads", `${codigoQR}_sin_filtro.pdf`);

    // 6) Render PDFs
    console.log("📄 Generando PDF con filtro...");
    await renderHtmlToPdf(htmlConFiltro, pdfConFiltroPath);
    console.log("✅ PDF con filtro generado:", pdfConFiltroPath);

    console.log("📄 Generando PDF sin filtro...");
    await renderHtmlToPdf(htmlSinFiltro, pdfSinFiltroPath);
    console.log("✅ PDF sin filtro generado:", pdfSinFiltroPath);

    // 7) Enviar correo
    const port = process.env.PORT || 3000;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });


    await transporter.sendMail({
      from: '"UMG - Registro" <joseemmanuelfelipefranco@gmail.com>',
      to: correo,
      subject: "🎓 Carné Universitario UMG — Registro exitoso",
      html: `<h3>Bienvenido ${nombre1} ${apellido1}</h3>
             <p>Adjuntamos tus carnés (con y sin filtro).</p>
             <p>Escanea tu código QR para iniciar sesión o verificar tu identidad.</p>`,
      attachments: [
        { filename: "carnet_umg_con_filtro.pdf", path: pdfConFiltroPath },
        { filename: "carnet_umg_sin_filtro.pdf", path: pdfSinFiltroPath },
        { filename: "qr.png", path: qrPath },
      ],
    });

    console.log(`📧 Correo enviado correctamente a ${correo}`);
  } catch (error) {
    console.error("❌ Error al generar/enviar PDFs con Puppeteer:", error);
  }
}




function enviarWhatsApp(nombre1, apellido1, telefono, codigoQR) {
  try {
    const pythonScript = path.join(__dirname, "send_whatsapp.py");
    const numeroDestino = `+502${telefono.replace(/\D/g, "")}`;
    console.log("📲 Enviando WhatsApp a", numeroDestino);
    const pythonProcess = spawn("python", [pythonScript, numeroDestino, `${nombre1} ${apellido1}`, codigoQR]);
    pythonProcess.stdout.on("data", (data) => console.log(`🐍 Python: ${data}`));
  } catch (err) {
    console.error("❌ Error al enviar WhatsApp:", err.message);
  }
}

// ============================
// 🧠 ANALIZADOR LÉXICO MEJORADO - FUNCIONAL PARA ESPAÑOL
// ============================
app.post("/analizar", upload.single("archivo"), async (req, res) => {
  try {
    const idioma = req.body.idioma?.toLowerCase() || "es";
    const idUsuario = req.body.id_usuario || null;

    // ✅ Validaciones
    if (!req.file) {
      return res.status(400).json({ error: "No se proporcionó archivo" });
    }

    if (!req.file.originalname.endsWith('.txt')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Solo se permiten archivos .txt" });
    }

    if (req.file.size > 5 * 1024 * 1024) { // 5MB
      fs.unlinkSync(req.file.path);
      return res.status(413).json({ error: "Archivo muy grande (máx. 5MB)" });
    }

    // ✅ Detectar encoding automáticamente
    const buffer = fs.readFileSync(req.file.path);
    const deteccion = jschardet.detect(buffer);
    const encoding = deteccion.encoding || 'utf8';
    let contenido = buffer.toString(encoding);

    // ✅ Sanitizar contenido
    contenido = contenido
      .replace(/&[#A-Za-z0-9]+;/g, "")   // elimina entidades HTML (&...;)
      .replace(/[^\wÁÉÍÓÚáéíóúñÑ\s.,!?/-]/g, "") // mantiene solo texto, números y signos básicos
      .trim();
    contenido = contenido.trim();

    if (contenido.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "El archivo está vacío" });
    }

    console.log(`📝 Analizando archivo: ${req.file.originalname} (${idioma})`);

    let resultado;

    // ✅ Análisis según idioma
    if (idioma === 'es' || idioma === 'español') {
      resultado = analizarEspanol(contenido);
    } else if (idioma === 'en' || idioma === 'inglés' || idioma === 'ingles') {
      resultado = analizarIngles(contenido);
    } else if (idioma === 'ru' || idioma === 'ruso') {
      resultado = analizarRuso(contenido);
    } else {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Idioma no soportado. Use: español, inglés o ruso" });
    }

    // ✅ Clasificaciones adicionales (aplica a todos los idiomas)
    const adicionales = clasificacionesAdicionales(contenido);

    // ✅ Respuesta completa
    const respuesta = {
      idioma,
      ...resultado,
      ...adicionales,
      texto: contenido
    };

    // 💾 Guardar en base de datos local
    const sql = `
      INSERT INTO analisis (
        id_usuario, nombre_archivo, idioma, total_palabras, total_caracteres,
        pronombres_json, entidades_json, lemas_json, fecha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW());
    `;

    dbAnalisis.query(sql, [
      idUsuario,
      req.file.originalname,
      idioma,
      respuesta.totalPalabras,
      respuesta.totalCaracteres,
      JSON.stringify(respuesta.pronombres || []),
      JSON.stringify({ personas: respuesta.personas || [], lugares: respuesta.lugares || [] }),
      JSON.stringify({ sustantivos: respuesta.sustantivos || [], verbos: respuesta.verbos || [] })
    ], (err) => {
      if (err) console.error("⚠️ Error guardando en analizador_db:", err.message);
      else console.log(`✅ Análisis guardado correctamente (${req.file.originalname})`);
    });

    res.json(respuesta);
    fs.unlinkSync(req.file.path);

  } catch (error) {
    console.error("❌ Error en /analizar:", error);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "Error al procesar análisis: " + error.message });
  }
});


// ============================
// 🔧 FUNCIONES AUXILIARES PARA ANÁLISIS
// ============================

// 📊 Análisis para ESPAÑOL (funcional)
function analizarEspanol(contenido) {
  // Tokenizar
  const palabras = tokenizerEs.tokenize(contenido.toLowerCase());

  // Pronombres personales en español
  const PRONOMBRES_ES = ['yo', 'tú', 'él', 'ella', 'nosotros', 'nosotras',
    'vosotros', 'vosotras', 'ellos', 'ellas', 'usted',
    'ustedes', 'me', 'te', 'se', 'le', 'nos', 'os', 'les',
    'mi', 'tu', 'su', 'nuestro', 'vuestro'];

  const pronombres = [...new Set(palabras.filter(p => PRONOMBRES_ES.includes(p)))];

  // ✅ Detectar personas (nombres propios - 2+ palabras capitalizadas)
  const patronPersonas = /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})\b/g;
  const personasCandidatas = contenido.match(patronPersonas) || [];

  // Filtrar nombres comunes en español
  const NOMBRES_COMUNES = ['María', 'José', 'Juan', 'Ana', 'Carlos', 'Luis', 'Pedro',
    'Mariano', 'Gálvez', 'García', 'Rodríguez', 'Martínez',
    'González', 'López', 'Hernández', 'Pérez'];

  const personas = [...new Set(personasCandidatas.filter(candidato => {
    const palabrasNombre = candidato.split(' ');
    return palabrasNombre.some(palabra => NOMBRES_COMUNES.includes(palabra));
  }))];

  // ✅ Detectar lugares
  const LUGARES_ES = ['Guatemala', 'México', 'España', 'Argentina', 'Colombia', 'Chile',
    'Perú', 'Venezuela', 'Ecuador', 'Bolivia', 'Paraguay', 'Uruguay',
    'Costa Rica', 'Panamá', 'Cuba', 'República Dominicana', 'Honduras',
    'El Salvador', 'Nicaragua', 'Ciudad de Guatemala', 'Antigua',
    'Quetzaltenango', 'Mixco', 'Villa Nueva', 'Madrid', 'Barcelona',
    'Buenos Aires', 'Bogotá', 'Lima', 'Santiago', 'Caracas'];

  const lugares = [...new Set(
    LUGARES_ES.filter(lugar => {
      const regex = new RegExp(`\\b${lugar}\\b`, 'gi');
      return regex.test(contenido);
    })
  )];

  // ✅ Detectar verbos (terminaciones comunes)
  const terminacionesVerbos = ['ar', 'er', 'ir', 'ando', 'iendo', 'ado', 'ido',
    'aba', 'ía', 'ará', 'erá', 'irá'];
  const verbosDetectados = palabras.filter(p =>
    terminacionesVerbos.some(t => p.endsWith(t)) && p.length > 3
  );

  // ✅ Lematizar verbos (forma raíz)
  const verbos = [...new Set(verbosDetectados.map(v => stemmerEs.stem(v)))].slice(0, 30);

  // ✅ Detectar sustantivos (terminaciones comunes)
  const terminacionesSustantivos = ['ción', 'sión', 'dad', 'tad', 'miento', 'ismo',
    'ista', 'anza', 'encia', 'ancia'];
  const sustantivosDetectados = palabras.filter(p =>
    terminacionesSustantivos.some(t => p.endsWith(t)) ||
    (p.length > 4 && !terminacionesVerbos.some(t => p.endsWith(t)))
  );

  // ✅ Lematizar sustantivos
  const sustantivos = [...new Set(sustantivosDetectados.map(s => stemmerEs.stem(s)))].slice(0, 30);

  // 📊 Calcular frecuencias (filtrar stopwords)
  const stopwordsEs = ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'de', 'del', 'al', 'a', 'en', 'por', 'para', 'con',
    'sin', 'sobre', 'entre', 'que', 'como', 'pero', 'si',
    'no', 'ni', 'y', 'o', 'u', 'es', 'son', 'está', 'están'];

  const palabrasFiltradas = palabras.filter(p =>
    p.length > 2 &&
    !stopwordsEs.includes(p) &&
    !/^\d+$/.test(p) &&        // excluye números puros
    !/^[x#]+[a-z0-9]+$/i.test(p) // excluye tokens tipo x2f, &#...
  );
  const frecuencia = {};
  palabrasFiltradas.forEach(p => {
    frecuencia[p] = (frecuencia[p] || 0) + 1;
  });

  const topPalabras = Object.entries(frecuencia)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const menosPalabras = Object.entries(frecuencia)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 10);

  // Estadísticas adicionales
  const palabrasUnicas = Object.keys(frecuencia).length;
  const densidadLexica = ((palabrasUnicas / palabras.length) * 100).toFixed(2) + '%';
  const totalOraciones = (contenido.match(/[.!?]+/g) || []).length;

  return {
    totalPalabras: palabras.length,
    totalCaracteres: contenido.length,
    palabrasUnicas,
    densidadLexica,
    totalOraciones,
    topPalabras,
    menosPalabras,
    pronombres,
    personas,
    lugares,
    verbos,
    sustantivos
  };
}

// 📊 Análisis para INGLÉS (usa Compromise)
function analizarIngles(contenido) {
  const doc = nlp(contenido);
  const palabras = contenido.match(/\b[a-zA-Z]+\b/g) || [];

  // Frecuencias
  const stopwordsEn = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at',
    'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are',
    'was', 'were', 'been', 'be', 'have', 'has', 'had'];

  const palabrasFiltradas = palabras
    .map(p => p.toLowerCase())
    .filter(p => p.length > 2 && !stopwordsEn.includes(p));

  const frecuencia = {};
  palabrasFiltradas.forEach(p => {
    frecuencia[p] = (frecuencia[p] || 0) + 1;
  });

  const topPalabras = Object.entries(frecuencia)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const menosPalabras = Object.entries(frecuencia)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 10);

  return {
    totalPalabras: palabras.length,
    totalCaracteres: contenido.length,
    palabrasUnicas: Object.keys(frecuencia).length,
    densidadLexica: ((Object.keys(frecuencia).length / palabras.length) * 100).toFixed(2) + '%',
    totalOraciones: (contenido.match(/[.!?]+/g) || []).length,
    topPalabras,
    menosPalabras,
    pronombres: doc.pronouns().out("array"),
    personas: doc.people().out("array"),
    lugares: doc.places().out("array"),
    verbos: [...new Set(doc.verbs().toInfinitive().out("array"))].slice(0, 30),
    sustantivos: [...new Set(doc.nouns().toSingular().out("array"))].slice(0, 30)
  };
}

// 📊 Análisis para RUSO
function analizarRuso(contenido) {
  const palabras = contenido.match(/[\p{Script=Cyrillic}]+/gu) || [];

  const frecuencia = {};
  palabras.forEach(p => {
    const lower = p.toLowerCase();
    if (lower.length > 2) {
      frecuencia[lower] = (frecuencia[lower] || 0) + 1;
    }
  });

  return {
    totalPalabras: palabras.length,
    totalCaracteres: contenido.length,
    palabrasUnicas: Object.keys(frecuencia).length,
    densidadLexica: ((Object.keys(frecuencia).length / palabras.length) * 100).toFixed(2) + '%',
    totalOraciones: (contenido.match(/[.!?]+/g) || []).length,
    topPalabras: Object.entries(frecuencia).sort((a, b) => b[1] - a[1]).slice(0, 10),
    menosPalabras: Object.entries(frecuencia).sort((a, b) => a[1] - b[1]).slice(0, 10),
    pronombres: [],
    personas: [],
    lugares: [],
    verbos: [],
    sustantivos: []
  };
}

// 📊 Clasificaciones adicionales (todos los idiomas)
function clasificacionesAdicionales(contenido) {
  return {
    fechas: contenido.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g) || [],
    numeros: contenido.match(/\b\d+(?:\.\d+)?\b/g) || [],
    emails: contenido.match(/\b[\w._%+-]+@[\w.-]+\.[a-z]{2,}\b/gi) || [],
    urls: contenido.match(/https?:\/\/[^\s]+/gi) || [],
    telefonos: contenido.match(/\b\d{4}[-\s]?\d{4}\b/g) || []
  };
}

// ============================
// 📄 GENERAR REPORTE PDF DEL ANÁLISIS
// ============================
const PDFDocument = require("pdfkit");

app.post("/generar-pdf", async (req, res) => {
  try {
    const { resultados } = req.body;
    if (!resultados) {
      return res.status(400).json({ error: "No se recibieron datos para generar el PDF." });
    }

    // 📘 Crear el documento PDF
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `reporte_analisis_${Date.now()}.pdf`;
    const filePath = path.join(__dirname, "public", "uploads", fileName);

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // 🧩 Encabezado
    doc.fontSize(20).text("📊 REPORTE DE ANÁLISIS LÉXICO", { align: "center" });
    doc.moveDown(1);

    // 📋 Datos generales
    doc.fontSize(12)
      .text(`Idioma: ${resultados.idioma}`)
      .text(`Total palabras: ${resultados.totalPalabras}`)
      .text(`Total caracteres: ${resultados.totalCaracteres}`)
      .moveDown();

    // 🔝 Top palabras
    doc.font("Helvetica-Bold").text("Top palabras más frecuentes:", { underline: true });
    doc.font("Helvetica").list(resultados.topPalabras.map(([w, c]) => `${w} (${c})`));
    doc.moveDown();

    // 🔻 Menos frecuentes
    doc.font("Helvetica-Bold").text("Palabras menos frecuentes:", { underline: true });
    doc.font("Helvetica").list(resultados.menosPalabras.map(([w, c]) => `${w} (${c})`));
    doc.moveDown();

    // 💬 Pronombres, Personas, Sustantivos, Verbos
    doc.text(`Pronombres: ${resultados.pronombres.join(", ") || "N/A"}`);
    doc.text(`Personas: ${resultados.personas.join(", ") || "N/A"}`);
    doc.text(`Lugares: ${resultados.lugares.join(", ") || "N/A"}`);
    doc.text(`Sustantivos: ${resultados.sustantivos.join(", ") || "N/A"}`);
    doc.text(`Verbos: ${resultados.verbos.join(", ") || "N/A"}`);
    doc.moveDown(1);

    // 📝 Texto analizado
    doc.font("Helvetica-Bold").text("Texto analizado:", { underline: true });
    doc.font("Helvetica").text(resultados.texto, { align: "justify" });

    // 🏁 Cierre
    doc.moveDown(2);
    doc.fontSize(10).text("Generado automáticamente por el Sistema de Análisis Léxico Multilingüe — UMG 2025", {
      align: "center",
    });

    doc.end();

    // 📨 Enviar el archivo generado
    stream.on("finish", () => {
      res.download(filePath, fileName, (err) => {
        if (err) console.error("⚠️ Error al enviar PDF:", err);
        fs.unlinkSync(filePath); // elimina después de descargar
      });
    });
  } catch (error) {
    console.error("❌ Error generando PDF:", error);
    res.status(500).json({ error: "Error al generar el PDF." });
  }
});



// ============================
// 📧 Enviar resultados del análisis por correo (LEGACY - mantener compatibilidad)
// ============================
app.post("/enviar-correo", async (req, res) => {
  try {
    const { correo, nombre, resultados } = req.body;
    if (!correo || !resultados) {
      return res.status(400).json({ success: false, message: "Faltan datos" });
    }

    // Crear PDF temporal del análisis
    const pdfPath = path.join(__dirname, "public", "uploads", `analisis_${Date.now()}.pdf`);
    const doc = new PDFDocument();
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    doc.fontSize(18).text("📊 REPORTE DE ANÁLISIS LÉXICO", { align: "center" }).moveDown();
    doc.fontSize(12).text(`Usuario: ${nombre}`);
    doc.text(`Correo: ${correo}`).moveDown();
    doc.text(`Idioma: ${resultados.idioma}`);
    doc.text(`Total palabras: ${resultados.totalPalabras}`);
    doc.text(`Total caracteres: ${resultados.totalCaracteres}`).moveDown();

    doc.text("Top palabras más frecuentes:");
    resultados.topPalabras.forEach(([w, c]) => doc.text(`- ${w}: ${c}`));
    doc.moveDown();

    doc.text("Palabras menos frecuentes:");
    resultados.menosPalabras.forEach(([w, c]) => doc.text(`- ${w}: ${c}`));
    doc.moveDown();

    doc.text(`Pronombres: ${resultados.pronombres?.join(", ") || "N/A"}`);
    doc.text(`Personas: ${resultados.personas?.join(", ") || "N/A"}`);
    doc.text(`Lugares: ${resultados.lugares?.join(", ") || "N/A"}`);
    doc.text(`Sustantivos: ${resultados.sustantivos?.join(", ") || "N/A"}`);
    doc.text(`Verbos: ${resultados.verbos?.join(", ") || "N/A"}`).moveDown();
    doc.text("Texto original analizado:").moveDown();
    doc.font("Helvetica-Oblique").text(resultados.texto, { align: "justify" });
    doc.end();

    stream.on("finish", async () => {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        },

      });

      await transporter.sendMail({
        from: '"UMG - Analizador Léxico" <joseemmanuelfelipefranco@gmail.com>',
        to: correo,
        subject: "📊 Resultados del Análisis Léxico UMG",
        html: `<p>Hola <b>${nombre}</b>,</p>
               <p>Adjuntamos tu reporte en PDF con los resultados del análisis léxico.</p>
               <p>Gracias por utilizar la plataforma.</p>`,
        attachments: [
          { filename: "analisis.pdf", path: pdfPath }
        ],
      });

      fs.unlinkSync(pdfPath);
      res.json({ success: true });
    });

  } catch (error) {
    console.error("❌ Error al enviar correo:", error);
    res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
});
// ============================
// 📧💬 Enviar reporte por correo/WhatsApp (UNIFICADO)
// ============================
app.post("/enviar-reporte", async (req, res) => {
  try {
    const { medio, correo, nombre, telefono, resultados } = req.body;

    if (!medio || !resultados) {
      return res.status(400).json({ success: false, message: "Faltan datos obligatorios" });
    }

    // Validar medio
    const mediosValidos = ['email', 'whatsapp', 'ambos'];
    if (!mediosValidos.includes(medio)) {
      return res.status(400).json({ success: false, message: "Medio no válido" });
    }

    // Generar PDF temporal
    const pdfPath = path.join(__dirname, "public", "uploads", `reporte_${Date.now()}.pdf`);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Contenido del PDF
    doc.fontSize(20).text("📊 REPORTE DE ANÁLISIS LÉXICO", { align: "center" });
    doc.moveDown();
    doc.fontSize(12)
      .text(`Usuario: ${nombre || 'Anónimo'}`)
      .text(`Correo: ${correo || 'N/A'}`)
      .moveDown();

    doc.text(`Idioma: ${resultados.idioma}`)
      .text(`Total palabras: ${resultados.totalPalabras}`)
      .text(`Total caracteres: ${resultados.totalCaracteres}`)
      .moveDown();

    doc.font("Helvetica-Bold").text("Top palabras más frecuentes:");
    doc.font("Helvetica");
    resultados.topPalabras.forEach(([w, c]) => doc.text(`  • ${w}: ${c}`));
    doc.moveDown();

    doc.font("Helvetica-Bold").text("Palabras menos frecuentes:");
    doc.font("Helvetica");
    resultados.menosPalabras.forEach(([w, c]) => doc.text(`  • ${w}: ${c}`));
    doc.moveDown();

    doc.text(`Pronombres: ${resultados.pronombres?.join(", ") || "N/A"}`);
    doc.text(`Personas: ${resultados.personas?.join(", ") || "N/A"}`);
    doc.text(`Lugares: ${resultados.lugares?.join(", ") || "N/A"}`);
    doc.moveDown();

    if (resultados.fechas && resultados.fechas.length) {
      doc.text(`Fechas: ${resultados.fechas.join(", ")}`);
    }
    if (resultados.emails && resultados.emails.length) {
      doc.text(`Emails: ${resultados.emails.join(", ")}`);
    }

    doc.moveDown();
    doc.font("Helvetica-Bold").text("Texto analizado:");
    doc.font("Helvetica").text(resultados.texto, { align: "justify" });
    doc.end();

    stream.on("finish", async () => {
      // Enviar por correo
      if (medio === 'email' || medio === 'ambos') {
        if (!correo) {
          fs.unlinkSync(pdfPath);
          return res.status(400).json({ success: false, message: "Correo no proporcionado" });
        }

        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
           user: process.env.EMAIL_USER,
           pass: process.env.EMAIL_PASS
          }
        });

        await transporter.sendMail({
          from: '"UMG - Analizador Léxico" <joseemmanuelfelipefranco@gmail.com>',
          to: correo,
          subject: "📊 Reporte de Análisis Léxico - UMG",
          html: `<p>Hola <b>${nombre}</b>,</p>
                 <p>Adjuntamos tu reporte de análisis léxico en PDF.</p>
                 <p>Gracias por utilizar el sistema UMG.</p>`,
          attachments: [{ filename: "reporte_analisis.pdf", path: pdfPath }]
        });

        console.log(`✅ Reporte enviado por correo a ${correo}`);
      }

      // Enviar por WhatsApp
      if (medio === 'whatsapp' || medio === 'ambos') {
        if (!telefono) {
          fs.unlinkSync(pdfPath);
          return res.status(400).json({ success: false, message: "Teléfono no proporcionado" });
        }

        enviarWhatsApp(nombre.split(' ')[0] || 'Usuario', '', telefono, "Reporte de análisis léxico listo");
        console.log(`✅ Notificación WhatsApp enviada a ${telefono}`);
      }

      fs.unlinkSync(pdfPath);
      res.json({ success: true, message: `Reporte enviado correctamente por ${medio}` });
    });

  } catch (error) {
    console.error("❌ Error enviando reporte:", error);
    res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
});

app.get("/session", (req, res) => {
  res.json(req.session?.user || { message: "Sin sesión activa" });
});

// ============================
// 🚀 Iniciar servidor
// ============================
app.listen(port, () => console.log(`🚀 Servidor activo en http://localhost:${port}`));

// ============================
// 🧠 Helper para Canvas
// ============================
async function canvasLoadImage(filePath) {
  const buffer = fs.readFileSync(filePath);
  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

