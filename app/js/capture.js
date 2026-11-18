const feedbackStates = new WeakMap();

function showFeedback(button, success) {
  if (!button) return;
  let state = feedbackStates.get(button);
  if (!state) {
    state = { html: button.innerHTML, timer: 0 };
    feedbackStates.set(button, state);
    button.setAttribute("aria-live", "polite");
  }
  clearTimeout(state.timer);
  button.textContent = success ? "Guardada" : "Error";
  state.timer = setTimeout(() => {
    button.innerHTML = state.html;
  }, 1600);
}

export async function saveCanvasAsJPG(source, filename, button) {
  if (!source?.width || !source?.height) {
    showFeedback(button, false);
    return false;
  }

  if (button) button.disabled = true;
  try {
    const output = document.createElement("canvas");
    output.width = source.width;
    output.height = source.height;
    const context = output.getContext("2d");
    context.fillStyle = "#f6f0e3";
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(source, 0, 0);

    const blob = await new Promise((resolve) => output.toBlob(resolve, "image/jpeg", 0.93));
    if (!blob) throw new Error("El navegador no pudo generar el archivo JPG.");

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    showFeedback(button, true);
    return true;
  } catch (error) {
    showFeedback(button, false);
    console.warn("No se pudo guardar la captura JPG.", error.message);
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}
