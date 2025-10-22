// ================================================================
// 🚀 PROYECTO UMG - RECONOCIMIENTO FACIAL + ANALIZADOR LÉXICO
// ================================================================

// ===============================
// 🔧 CONFIGURACIÓN GLOBAL
// ===============================
let labeledFaceDescriptors = [];
let modelsLoaded = false;
let selectedEmpresaId = null;
let loadedUsers = new Set();
let recognitionActive = false;
let intervalId = null;
const DEVICE_CODE = '02'; // Identificador del dispositivo

// ===============================
// 🧩 UTILIDADES
// ===============================
function showLoadingMessage(show) {
  const msg = document.getElementById('loading-message');
  if (msg) msg.style.display = show ? 'block' : 'none';
}

function hideEmpresaForm() {
  const form = document.getElementById('empresa-selection');
  if (form) form.style.display = 'none';
}

function capturePhoto(videoElement) {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

// ===============================
// 🤖 CARGA DE MODELOS Y USUARIOS
// ===============================
async function loadModels() {
  const MODEL_URL = '/models';
  await Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  modelsLoaded = true;
  console.log("✅ Modelos FaceAPI cargados.");
}

async function loadLabeledImagesAsync() {
  if (!selectedEmpresaId) return console.error("❌ No se ha seleccionado una empresa.");
  showLoadingMessage(true);
  labeledFaceDescriptors = [];
  loadedUsers.clear();

  try {
    const response = await fetch(`/get-labels?empresaId=${selectedEmpresaId}`);
    const { labels } = await response.json();
    for (const label of labels) await loadUserDescriptor(label);
    console.log("✅ Descriptores cargados:", labeledFaceDescriptors.length);
  } catch (err) {
    console.error("Error cargando descriptores:", err);
  } finally {
    showLoadingMessage(false);
  }
}

async function loadUserDescriptor(label) {
  if (loadedUsers.has(label)) return;
  loadedUsers.add(label);

  try {
    const res = await fetch(`/get-image?name=${label}&empresaId=${selectedEmpresaId}`);
    const blob = await res.blob();
    const img = await faceapi.bufferToImage(blob);
    const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
    if (detection) labeledFaceDescriptors.push(new faceapi.LabeledFaceDescriptors(label, [detection.descriptor]));
  } catch (err) {
    console.error(`Error cargando imagen de ${label}:`, err);
  }
}

// ===============================
// 📸 CÁMARA Y RECONOCIMIENTO
// ===============================
async function startCamera() {
  if (recognitionActive || !modelsLoaded) return;
  recognitionActive = true;

  const video = document.getElementById('video');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    video.play();
  } catch (error) {
    alert('Error al activar la cámara: ' + error.message);
    return;
  }

  video.addEventListener('loadeddata', async () => {
    const cameraContainer = document.getElementById('camera');
    const canvas = faceapi.createCanvasFromMedia(video);
    cameraContainer.appendChild(canvas);
    const displaySize = { width: video.clientWidth, height: video.clientHeight };
    faceapi.matchDimensions(canvas, displaySize);

    intervalId = setInterval(async () => {
      const detections = await faceapi.detectAllFaces(video).withFaceLandmarks().withFaceDescriptors();
      const resized = faceapi.resizeResults(detections, displaySize);

      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      faceapi.draw.drawDetections(canvas, resized);

      if (!labeledFaceDescriptors.length) return;
      const faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.5);
      const results = resized.map(d => faceMatcher.findBestMatch(d.descriptor));

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const box = resized[i].detection.box;
        new faceapi.draw.DrawBox(box, {
          label: result.toString(),
          boxColor: result.label === 'unknown' ? 'red' : 'green'
        }).draw(canvas);

        if (result.label === 'unknown') {
          notifyUser('🔴 Usuario no reconocido', true);
          await registerFailedAttempt(capturePhoto(video));
        } else {
          await handleRecognitionSuccess(result.label, video);
        }
      }
    }, 1000);
  });
}

function stopCamera() {
  const video = document.getElementById('video');
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  recognitionActive = false;
  clearInterval(intervalId);

  const canvas = document.querySelector('#camera canvas');
  if (canvas) canvas.remove();
  document.getElementById('recognition-result').style.display = 'none';
  console.log("🛑 Cámara detenida.");
}

// ===============================
// 🚀 EVENTOS INICIALES
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  const empresaSelect = document.getElementById("empresaSelect");

  try {
    const res = await fetch('/get-empresas');
    const empresas = await res.json();
    empresaSelect.innerHTML = empresas.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
  } catch {
    const errMsg = document.getElementById('error-message');
    if (errMsg) errMsg.textContent = "❌ No se pudieron cargar las empresas.";
  }

  document.getElementById('selectEmpresa').addEventListener('click', async () => {
    selectedEmpresaId = empresaSelect.value;
    if (!selectedEmpresaId) return alert("Seleccione una empresa primero.");
    await loadModels();
    await loadLabeledImagesAsync();
    hideEmpresaForm();
    document.getElementById('main-content').style.display = 'block';
  });

  // Cámara
  document.getElementById('start-camera')?.addEventListener('click', startCamera);
  document.getElementById('stop-camera')?.addEventListener('click', stopCamera);
});

// ===============================
// 📋 REGISTRO DE RECONOCIMIENTO
// ===============================
async function getUserIdByName(name) {
  const res = await fetch(`/get-user-id?name=${name}&empresaId=${selectedEmpresaId}`);
  return res.ok ? (await res.json()).id : null;
}

async function handleRecognitionSuccess(nombre, video) {
  const tipo = document.getElementById('tipoRegistro').value;
  if (!tipo) return notifyUser("⚠️ Seleccione Entrada o Salida", true);

  const userId = await getUserIdByName(nombre);
  const photoBase64 = capturePhoto(video);
  const ok = tipo === 'entrada'
    ? await registerEntry(userId, photoBase64)
    : await registerExit(userId);

  if (ok) {
    notifyUser(`✅ ${tipo.toUpperCase()} registrada para ${nombre}`);
    showCustomAlert(`✅ ${tipo.toUpperCase()}: ${nombre}`);
  }
}

// ===============================
// 📥 REGISTROS
// ===============================
async function registerEntry(userId, photoBase64) {
  const res = await fetch('/register-entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usuarioId: userId,
      empresaId: selectedEmpresaId,
      deviceCode: DEVICE_CODE,
      resultado_autenticacion: "Exitosa",
      foto_intento: photoBase64
    })
  });
  return res.ok;
}

async function registerExit(userId) {
  const res = await fetch('/register-exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usuarioId: userId,
      empresaId: selectedEmpresaId,
      deviceCode: DEVICE_CODE
    })
  });
  return res.ok;
}

async function registerFailedAttempt(photoBase64) {
  await fetch('/register-failed-attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Desconocido',
      empresaId: selectedEmpresaId,
      motivo: 'Usuario no registrado',
      fotoIntento: photoBase64,
      deviceCode: DEVICE_CODE
    })
  });
}

// ===============================
// 💬 MENSAJES VISUALES
// ===============================
function notifyUser(message, isError = false) {
  const el = document.getElementById('recognition-result');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  el.style.backgroundColor = isError ? '#ffcccc' : '#ccffcc';
  el.style.color = isError ? 'red' : 'green';
  el.style.fontWeight = 'bold';
}

function showCustomAlert(message) {
  const alertBox = document.getElementById('custom-alert');
  if (!alertBox) return;
  alertBox.textContent = message;
  alertBox.style.display = 'block';
  setTimeout(() => alertBox.style.display = 'none', 4000);
}

// =============================================================
// 🧠 MÓDULO INTEGRADO: ANALIZADOR LÉXICO MULTILINGÜE
// =============================================================
let datosActuales = null;

document.getElementById("formAnalisis")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);

  // ✅ Adjuntar usuario logueado
  const usuarioSesion = JSON.parse(sessionStorage.getItem("sesionActiva") || "{}");
  if (usuarioSesion?.id) formData.append("id_usuario", usuarioSesion.id);

  const res = await fetch("http://localhost:3000/analizar", { method: "POST", body: formData });
  const data = await res.json();
  datosActuales = data;

  const resumen = document.getElementById("resumen");
  const resultados = document.getElementById("resultados");
  const textoResaltado = document.getElementById("textoResaltado");
  if (!resumen || !resultados || !textoResaltado) return;

  resultados.style.display = "block";
  resumen.innerHTML = `
    <p><b>Idioma:</b> ${data.idioma}</p>
    <p><b>Total palabras:</b> ${data.totalPalabras}</p>
    <p><b>Total caracteres:</b> ${data.totalCaracteres}</p>
    <p><b>Top palabras:</b> ${data.topPalabras.map(([w,c])=>w+" ("+c+")").join(", ")}</p>
    <p><b>Menos frecuentes:</b> ${data.menosPalabras.map(([w,c])=>w+" ("+c+")").join(", ")}</p>
    <p><b>Pronombres:</b> ${data.pronombres.join(", ")}</p>
    <p><b>Personas:</b> ${data.personas.join(", ")}</p>
    <p><b>Lugares:</b> ${data.lugares.join(", ")}</p>
    <p><b>Sustantivos:</b> ${data.sustantivos.join(", ")}</p>
    <p><b>Verbos:</b> ${data.verbos.join(", ")}</p>
  `;

  let texto = data.texto;
  data.personas.forEach(p => texto = texto.replace(new RegExp(p, "gi"), `<mark class='persona'>${p}</mark>`));
  data.lugares.forEach(l => texto = texto.replace(new RegExp(l, "gi"), `<mark class='lugar'>${l}</mark>`));
  textoResaltado.innerHTML = `<h3>📝 Texto con entidades resaltadas</h3><p>${texto}</p>`;
});

// 🧹 LIMPIAR
document.getElementById("limpiar")?.addEventListener("click", () => {
  document.getElementById("resumen").innerHTML = "";
  document.getElementById("textoResaltado").innerHTML = "";
  document.getElementById("resultados").style.display = "none";
  datosActuales = null;
});

// 📤 EXPORTAR (Genera PDF desde el servidor)
document.getElementById("exportar")?.addEventListener("click", async () => {
  if (!datosActuales) return alert("⚠️ Primero procesa un archivo antes de exportar.");

  try {
    const res = await fetch("http://localhost:3000/generar-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultados: datosActuales })
    });

    if (!res.ok) throw new Error("Error generando el PDF");

    // 🧾 Descargar el archivo generado
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte_analisis_${Date.now()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

    alert("✅ PDF generado y descargado correctamente");
  } catch (error) {
    console.error("❌ Error al generar PDF:", error);
    alert("❌ Error al generar el PDF.");
  }
});


// 💾 GUARDAR
document.getElementById("guardar")?.addEventListener("click", () => {
  if (!datosActuales) return alert("Primero procesa un archivo.");
  alert("✅ Análisis guardado automáticamente en la base de datos.");
});

// 📧 / 💬
document.getElementById("btnCorreo")?.addEventListener("click", () => alert("📧 Envío por correo en desarrollo."));
document.getElementById("btnWhatsApp")?.addEventListener("click", () => alert("💬 Envío por WhatsApp en desarrollo."));
