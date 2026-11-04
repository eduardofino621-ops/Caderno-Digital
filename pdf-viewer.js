
import * as pdfjsLib from
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

let pdf = null;
let currentPage = 1;
let zoom = 1;
let rendering = false;
let pendingRender = false;

let canvas;
let context;
let pageInfo;
let zoomInfo;
let loadingMessage;

export async function openPDF(url) {
  canvas = document.getElementById("pdf-canvas");
  context = canvas.getContext("2d");

  pageInfo = document.getElementById("page-info");
  zoomInfo = document.getElementById("zoom-info");
  loadingMessage = document.getElementById("pdf-loading");

  loadingMessage.hidden = false;
  document.getElementById("pdf-page-layer").hidden = true;

  try {
    const loadingTask = pdfjsLib.getDocument(url);
    pdf = await loadingTask.promise;

    currentPage = 1;
    zoom = 1;

    loadingMessage.hidden = true;
    document.getElementById("pdf-page-layer").hidden = false;

    await renderPage();
  } catch (error) {
    loadingMessage.textContent =
      "Não foi possível abrir este PDF: " + error.message;
    console.error(error);
  }
}

async function renderPage() {
  if (!pdf) return;

  if (rendering) {
    pendingRender = true;
    return;
  }

  rendering = true;

  try {
    const page = await pdf.getPage(currentPage);

    const container = document.getElementById("pdf-container");

    const baseViewport = page.getViewport({scale: 1});

    const fitScale = Math.min(
        1.4,
        (container.clientWidth - 24) / baseViewport.width
    );

    const viewport = page.getViewport({
      scale: fitScale * zoom
    });

    const pixelRatio = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);

    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    await page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio !== 1
          ? [pixelRatio, 0, 0, pixelRatio, 0, 0]
          : null
    }).promise;

    window.dispatchEvent(new CustomEvent("pdf-page-rendered", {
      detail: {
        page: currentPage
      }
    }));

    pageInfo.textContent =
        `Página ${currentPage} de ${pdf.numPages}`;

    zoomInfo.textContent = `${Math.round(zoom * 100)}%`;

    document.getElementById("previous-page").disabled =
        currentPage <= 1;

    document.getElementById("next-page").disabled =
        currentPage >= pdf.numPages;

  } finally {
    rendering = false;

    if (pendingRender) {
      pendingRender = false;
      await renderPage();
    }
  }
}

export async function nextPage() {
  if (!pdf || currentPage >= pdf.numPages) return;
  currentPage++;
  await renderPage();
}

export async function previousPage() {
  if (!pdf || currentPage <= 1) return;
  currentPage--;
  await renderPage();
}

export async function zoomIn() {
  if (!pdf) return;
  zoom = Math.min(zoom + 0.15, 3);
  await renderPage();
}

export async function zoomOut() {
  if (!pdf) return;
  zoom = Math.max(zoom - 0.15, 0.5);
  await renderPage();
}

export function closePDF() {
  pdf?.destroy();
  pdf = null;
  currentPage = 1;
  zoom = 1;
}
