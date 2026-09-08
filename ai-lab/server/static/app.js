let currentTaskId = null;
let lastSampleId = null;

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status}: ${detail}`);
  }
  return response.status === 204 ? null : response.json();
}

async function loadTasks() {
  const tasks = await api("/api/tasks");
  const list = document.getElementById("task-list");
  list.innerHTML = "";
  tasks.forEach((task) => {
    const btn = document.createElement("button");
    btn.textContent = task.label;
    btn.onclick = () => selectTask(task);
    btn.id = `task-btn-${task.task_id}`;
    list.appendChild(btn);
  });
}

function fieldsForTask(taskId) {
  if (taskId === "esp32_robot") {
    return `
      <label>Distance mesuree (cm)</label>
      <input id="field-distance" type="number" value="15" />
      <label>IP de l'ESP32 (optionnel, laisser vide pour simuler)</label>
      <input id="field-ip" placeholder="192.168.1.42" />
      <button class="primary" id="btn-act">Faire agir l'IA</button>
    `;
  }
  if (taskId === "shape_outliner") {
    return `
      <label>Image a analyser</label>
      <input id="field-image" type="file" accept="image/*" />
      <button class="primary" id="btn-act">Detourer les formes</button>
    `;
  }
  return `
    <label>Observation (JSON brut)</label>
    <textarea id="field-json" rows="4">{}</textarea>
    <button class="primary" id="btn-act">Executer</button>
  `;
}

async function buildObservation(taskId) {
  if (taskId === "esp32_robot") {
    const distance = parseFloat(document.getElementById("field-distance").value || "999");
    const ip = document.getElementById("field-ip").value.trim();
    const observation = { distance_cm: distance };
    if (ip) observation.esp32_ip = ip;
    return observation;
  }
  if (taskId === "shape_outliner") {
    const fileInput = document.getElementById("field-image");
    const file = fileInput.files[0];
    if (!file) throw new Error("choisissez une image d'abord");
    const base64 = await fileToBase64(file);
    return { image_base64: base64 };
  }
  return JSON.parse(document.getElementById("field-json").value || "{}");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderAction(taskId, action) {
  const result = document.getElementById("result");
  result.style.display = "block";

  if (taskId === "shape_outliner" && action.preview_base64) {
    const { preview_base64, ...rest } = action;
    result.innerHTML = `<img src="data:image/png;base64,${preview_base64}" /><div>${JSON.stringify(rest, null, 2)}</div>`;
  } else {
    result.textContent = JSON.stringify(action, null, 2);
  }
}

async function selectTask(task) {
  currentTaskId = task.task_id;
  document.querySelectorAll("#task-list button").forEach((b) => b.classList.remove("active"));
  document.getElementById(`task-btn-${task.task_id}`).classList.add("active");

  document.getElementById("task-title").textContent = task.label;
  document.getElementById("task-description").textContent = task.description;
  document.getElementById("task-form").innerHTML = fieldsForTask(task.task_id);
  document.getElementById("result").style.display = "none";
  document.getElementById("feedback-row").style.display = "none";
  document.getElementById("note-label").style.display = "none";
  document.getElementById("note-input").style.display = "none";

  document.getElementById("btn-act").onclick = () => runAct(task.task_id);

  await refreshStats(task.task_id);
  await refreshBases(task.task_id);
}

async function runAct(taskId) {
  try {
    const observation = await buildObservation(taskId);
    const response = await api(`/api/tasks/${taskId}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation }),
    });
    lastSampleId = response.sample_id;
    renderAction(taskId, response.action);
    document.getElementById("feedback-row").style.display = "flex";
    document.getElementById("note-label").style.display = "block";
    document.getElementById("note-input").style.display = "block";
  } catch (err) {
    alert(err.message);
  }
}

async function sendFeedback(rating) {
  if (!currentTaskId || !lastSampleId) return;
  const note = document.getElementById("note-input").value;
  await api("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: currentTaskId, sample_id: lastSampleId, rating, note }),
  });
  document.getElementById("note-input").value = "";
  await refreshStats(currentTaskId);
}

async function refreshStats(taskId) {
  const stats = await api(`/api/tasks/${taskId}/feedback/stats`);
  document.getElementById("stats").innerHTML = `
    <div class="stat">Bien: ${stats.good}</div>
    <div class="stat">Mal: ${stats.bad}</div>
  `;
}

async function refreshBases(taskId) {
  const data = await api(`/api/models/${taskId}`);
  const list = document.getElementById("base-list");
  if (data.bases.length === 0) {
    list.innerHTML = "<p class='subtitle'>Aucune base sauvegardee.</p>";
    return;
  }
  list.innerHTML = data.bases
    .map((base) => {
      const isActive = data.active && data.active.id === base.id;
      return `
        <div class="base-item ${isActive ? "active" : ""}">
          <span>${base.label}${isActive ? " (active)" : ""}</span>
          ${isActive ? "" : `<button data-base-id="${base.id}" class="activate-base">Activer</button>`}
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".activate-base").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/models/${taskId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_id: btn.dataset.baseId }),
      });
      await refreshBases(taskId);
    };
  });
}

document.getElementById("btn-good").onclick = () => sendFeedback("good");
document.getElementById("btn-bad").onclick = () => sendFeedback("bad");

document.getElementById("btn-save-base").onclick = async () => {
  if (!currentTaskId) return;
  const label = document.getElementById("save-label").value;
  await api(`/api/models/${currentTaskId}/save_current`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  document.getElementById("save-label").value = "";
  await refreshBases(currentTaskId);
};

document.getElementById("btn-import-base").onclick = async () => {
  if (!currentTaskId) return;
  const fileInput = document.getElementById("import-file");
  const file = fileInput.files[0];
  if (!file) {
    alert("choisissez un fichier de base d'abord");
    return;
  }
  const formData = new FormData();
  formData.append("file", file);
  await api(`/api/models/${currentTaskId}/import`, { method: "POST", body: formData });
  fileInput.value = "";
  await refreshBases(currentTaskId);
};

loadTasks();
