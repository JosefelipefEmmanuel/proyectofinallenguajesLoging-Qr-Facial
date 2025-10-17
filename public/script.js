// script

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
  document.getElementById('loading-message').style.display = show ? 'block' : 'none';
}

function hideEmpresaForm() {
  document.getElementById('empresa-selection').style.display = 'none';
}



function capturePhoto(videoElement) {
  const canvas = document.createElement('canvas');
  canvas.width = 400; // ✅ Más resolución = mejor detección
  canvas.height = 400;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9); // más calidad
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
  const photoInput = document.getElementById("photo");
  const preview = document.getElementById("preview-image");
  const cameraPreview = document.getElementById("camera-preview");
  const takePhotoBtn = document.getElementById("take-photo-btn");
  const filterSelect = document.getElementById("filterSelect");
  const applyFilterBtn = document.getElementById("apply-filter-btn");
  const empresaSelect = document.getElementById("empresaSelect");

  // 🔸 Cargar lista de empresas
  try {
    const res = await fetch('/get-empresas');
    const empresas = await res.json();
    empresaSelect.innerHTML = empresas.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
  } catch {
    document.getElementById('error-message').textContent = "❌ No se pudieron cargar las empresas.";
  }

  // 🔸 Selección de empresa
  document.getElementById('selectEmpresa').addEventListener('click', async () => {
    selectedEmpresaId = empresaSelect.value;
    if (!selectedEmpresaId) return alert("Seleccione una empresa primero.");
    await loadModels();
    await loadLabeledImagesAsync();
    hideEmpresaForm();
    document.getElementById('main-content').style.display = 'block';
  });

  // 🔸 Botones de cámara
  document.getElementById('start-camera').addEventListener('click', startCamera);
  document.getElementById('stop-camera').addEventListener('click', stopCamera);

  // 📷 Tomar foto
  takePhotoBtn.addEventListener("click", async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    cameraPreview.style.display = "block";
    cameraPreview.srcObject = stream;

    setTimeout(() => {
      const canvas = document.createElement("canvas");
      canvas.width = cameraPreview.videoWidth;
      canvas.height = cameraPreview.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(cameraPreview, 0, 0);
      stream.getTracks().forEach(t => t.stop());

      canvas.toBlob(blob => {
        const file = new File([blob], "captured.jpg", { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        photoInput.files = dt.files;
        preview.src = URL.createObjectURL(file);
        preview.style.display = "block";
        cameraPreview.style.display = "none";
      });
    }, 1000);
  });

  // 🎨 Aplicar filtro
  applyFilterBtn.addEventListener("click", () => {
    const filtro = filterSelect.value;
    if (!photoInput.files[0]) return alert("Sube o toma una foto primero.");

    const reader = new FileReader();
    reader.onload = function (e) {
      const base = new Image();
      base.onload = function () {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = base.width;
        canvas.height = base.height;
        ctx.drawImage(base, 0, 0);

        if (filtro !== "ninguno") {
          const overlay = new Image();
          overlay.src = `/filtros/${filtro}.png`;
          overlay.onload = () => {
            ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(blob => {
              const file = new File([blob], `filtered_${filtro}.png`, { type: "image/png" });
              const dt = new DataTransfer();
              dt.items.add(file);
              photoInput.files = dt.files; // reemplaza el archivo original
              preview.src = URL.createObjectURL(file);
              console.log("✅ Filtro aplicado y actualizado correctamente.");
            });
          };
        } else preview.src = e.target.result;
      };
      base.src = e.target.result;
    };
    reader.readAsDataURL(photoInput.files[0]);
  });

  // 📩 Enviar formulario de registro
  document.getElementById("user-form").addEventListener("submit", async e => {
    e.preventDefault();
    const formData = new FormData(e.target);
    formData.append("filtro", filterSelect.value);
    formData.append("empresaId", selectedEmpresaId);

    showLoadingMessage(true);
    try {
      const res = await fetch("/api/registrar", { method: "POST", body: formData });
      const data = await res.json();
      alert(data.message);
      if (data.success) {
        preview.style.display = "none";
        e.target.reset();
        await loadLabeledImagesAsync();
      }
    } catch (err) {
      console.error("❌ Error al registrar:", err);
      alert("Error al conectar con el servidor.");
    } finally {
      showLoadingMessage(false);
    }
  });
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
    mostrarAccesoReconocido?.(nombre);
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
  el.textContent = message;
  el.style.display = 'block';
  el.style.backgroundColor = isError ? '#ffcccc' : '#ccffcc';
  el.style.color = isError ? 'red' : 'green';
  el.style.fontWeight = 'bold';
}

function showCustomAlert(message) {
  const alertBox = document.getElementById('custom-alert');
  alertBox.textContent = message;
  alertBox.style.display = 'block';
  setTimeout(() => alertBox.style.display = 'none', 4000);
}
