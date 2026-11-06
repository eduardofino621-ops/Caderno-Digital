
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

let pdf = null;
let currentPage = 1;
let zoom = 1;
let rendering = false;
let pendingRender = false;

let pinchAnchor = null;

let canvas;
let context;
let pageInfo;
let zoomInfo;
let loadingMessage;
let container;
let pageLayer;

let pinchActive = false;
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let pinchCurrentZoom = 1;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.5;

let pinchInitialized = false;


/* =====================================
   ABRIR PDF
===================================== */

export async function openPDF(url) {
    canvas = document.getElementById("pdf-canvas");
    context = canvas.getContext("2d");

    pageInfo = document.getElementById("page-info");
    zoomInfo = document.getElementById("zoom-info");
    loadingMessage = document.getElementById("pdf-loading");
    container = document.getElementById("pdf-container");
    pageLayer = document.getElementById("pdf-page-layer");

    initializePinchZoom();

    loadingMessage.hidden = false;
    pageLayer.hidden = true;

    try {
        const loadingTask = pdfjsLib.getDocument(url);
        pdf = await loadingTask.promise;

        currentPage = 1;
        zoom = 1;

        pinchActive = false;
        pinchAnchor = null;
        pinchStartDistance = 0;
        pinchCurrentZoom = 1;

        loadingMessage.hidden = true;
        pageLayer.hidden = false;

        pageLayer.style.transform = "";
        pageLayer.style.transformOrigin = "center center";

        container.scrollTop = 0;
        container.scrollLeft = 0;

        await renderPage();

    } catch (error) {
        loadingMessage.textContent =
            "Não foi possível abrir este PDF: " + error.message;

        console.error(error);
    }
}


/* =====================================
   ZOOM COM DOIS DEDOS
===================================== */

function initializePinchZoom() {
    if (pinchInitialized) return;

    container.style.touchAction = "pan-x pan-y";

    container.addEventListener(
        "touchstart",
        handleTouchStart,
        { passive: false }
    );

    container.addEventListener(
        "touchmove",
        handleTouchMove,
        { passive: false }
    );

    container.addEventListener(
        "touchend",
        handleTouchEnd,
        { passive: false }
    );

    container.addEventListener(
        "touchcancel",
        handleTouchEnd,
        { passive: false }
    );

    pinchInitialized = true;
}


/* =====================================
   DISTÂNCIA ENTRE OS DEDOS
===================================== */

function getDistance(touches) {
    return Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY
    );
}


/* =====================================
   CENTRO DO GESTO
===================================== */

function getPinchCenter(touches) {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    };
}


/* =====================================
   INÍCIO DO PINCH
===================================== */

function handleTouchStart(event) {
    if (event.touches.length !== 2) return;

    event.preventDefault();

    pinchActive = true;

    const center = getPinchCenter(event.touches);
    const rect = pageLayer.getBoundingClientRect();

    const originX = center.x - rect.left;
    const originY = center.y - rect.top;

    pinchStartDistance = getDistance(event.touches);
    pinchStartZoom = zoom;
    pinchCurrentZoom = zoom;

    pinchAnchor = {
        x: center.x,
        y: center.y,
        relativeX: originX / rect.width,
        relativeY: originY / rect.height
    };

    pageLayer.style.transition = "none";

    pageLayer.style.transformOrigin =
        `${originX}px ${originY}px`;

    window.dispatchEvent(
        new Event("pdf-pinch-start")
    );
}


/* =====================================
   MOVIMENTO DO PINCH
===================================== */

function handleTouchMove(event) {
    if (!pinchActive || event.touches.length !== 2) return;

    event.preventDefault();

    const distance = getDistance(event.touches);

    if (!pinchStartDistance) return;

    const ratio = distance / pinchStartDistance;

    pinchCurrentZoom = Math.max(
        MIN_ZOOM,
        Math.min(
            MAX_ZOOM,
            pinchStartZoom * ratio
        )
    );

    const scale = pinchCurrentZoom / pinchStartZoom;

    pageLayer.style.transform = `scale(${scale})`;

    zoomInfo.textContent =
        `${Math.round(pinchCurrentZoom * 100)}%`;
}


/* =====================================
   FIM DO PINCH
===================================== */

async function handleTouchEnd(event) {
    if (!pinchActive || event.touches.length >= 2) return;

    pinchActive = false;

    const newZoom = pinchCurrentZoom;

    pageLayer.style.transform = "";
    pageLayer.style.transformOrigin = "center center";

    zoom = newZoom;

    window.dispatchEvent(
        new Event("pdf-pinch-end")
    );

    await renderPage();

    if (pinchAnchor) {
        const rect = pageLayer.getBoundingClientRect();

        const newPointX =
            rect.left + pinchAnchor.relativeX * rect.width;

        const newPointY =
            rect.top + pinchAnchor.relativeY * rect.height;

        container.scrollLeft +=
            newPointX - pinchAnchor.x;

        container.scrollTop +=
            newPointY - pinchAnchor.y;
    }

    pinchAnchor = null;
    pinchStartDistance = 0;
}


/* =====================================
   RENDERIZAR PÁGINA
===================================== */

async function renderPage() {
    if (!pdf) return;

    if (rendering) {
        pendingRender = true;
        return;
    }

    rendering = true;

    try {
        do {
            pendingRender = false;

            const page = await pdf.getPage(currentPage);

            const baseViewport = page.getViewport({
                scale: 1
            });

            const fitScale = Math.min(
                1.4,
                (container.clientWidth - 24) / baseViewport.width
            );

            const viewport = page.getViewport({
                scale: fitScale * zoom
            });

            const pixelRatio = window.devicePixelRatio || 1;

            canvas.width = Math.floor(
                viewport.width * pixelRatio
            );

            canvas.height = Math.floor(
                viewport.height * pixelRatio
            );

            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;

            await page.render({
                canvasContext: context,
                viewport,
                transform: pixelRatio !== 1
                    ? [pixelRatio, 0, 0, pixelRatio, 0, 0]
                    : null
            }).promise;

            window.dispatchEvent(
                new CustomEvent("pdf-page-rendered", {
                    detail: {
                        page: currentPage
                    }
                })
            );

            pageInfo.textContent =
                `Página ${currentPage} de ${pdf.numPages}`;

            zoomInfo.textContent =
                `${Math.round(zoom * 100)}%`;

            document.getElementById("previous-page").disabled =
                currentPage <= 1;

            document.getElementById("next-page").disabled =
                currentPage >= pdf.numPages;

        } while (pendingRender);

    } finally {
        rendering = false;
    }
}


/* =====================================
   NAVEGAÇÃO
===================================== */

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


/* =====================================
   ZOOM PELOS BOTÕES
===================================== */

export async function zoomIn() {
    if (!pdf) return;

    zoom = Math.min(
        zoom + 0.15,
        MAX_ZOOM
    );

    await renderPage();
}


export async function zoomOut() {
    if (!pdf) return;

    zoom = Math.max(
        zoom - 0.15,
        MIN_ZOOM
    );

    await renderPage();
}


/* =====================================
   FECHAR PDF
===================================== */

export function closePDF() {
    pdf?.destroy();

    pdf = null;
    currentPage = 1;
    zoom = 1;

    pinchActive = false;
    pinchAnchor = null;

    pinchStartDistance = 0;
    pinchStartZoom = 1;
    pinchCurrentZoom = 1;

    pendingRender = false;

    if (pageLayer) {
        pageLayer.style.transform = "";
        pageLayer.style.transformOrigin = "center center";
    }
}