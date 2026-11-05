
import { supabase } from "./database.js";

let documentId = null;
let mode = "select";
let currentPage = 1;

let strokes = [];
let selected = [];
let questions = [];

let drawing = false;
let currentStroke = null;
let saveTimer = null;
let editorInitialized = false;

// Controlo dos gestos de toque
let pinching = false;
let activeTouchPointers = new Set();

const canvas = document.getElementById("editor-canvas");
const ctx = canvas.getContext("2d");
const pdfCanvas = document.getElementById("pdf-canvas");

// =====================================
// INICIALIZAÇÃO
// =====================================

export function initEditor(id) {
    documentId = id;

    if (!editorInitialized) {
        document.getElementById("mode-select")
            ?.addEventListener("click", () => setMode("select"));

        document.getElementById("mode-pen")
            ?.addEventListener("click", () => setMode("pen"));

        document.getElementById("mode-erase")
            ?.addEventListener("click", () => setMode("erase"));

        canvas.addEventListener("pointerdown", pointerDown);
        canvas.addEventListener("pointermove", pointerMove);
        canvas.addEventListener("pointerup", pointerUp);
        canvas.addEventListener("pointercancel", pointerCancel);

        window.addEventListener("pdf-page-rendered", event => {
            prepareCanvas(event.detail.page);
        });

        // O PDF Viewer avisa quando começa o zoom com dois dedos
        window.addEventListener("pdf-pinch-start", () => {
            pinching = true;
            activeTouchPointers.clear();

            cancelCurrentStroke();
            draw();
        });

        // O PDF Viewer avisa quando termina o zoom
        window.addEventListener("pdf-pinch-end", () => {
            pinching = false;
            activeTouchPointers.clear();
        });

        editorInitialized = true;
    }

    strokes = [];
    selected = [];
    questions = [];

    drawing = false;
    currentStroke = null;
    pinching = false;
    activeTouchPointers.clear();

    setMode("select");
}

// =====================================
// PERGUNTAS AUTOMÁTICAS
// =====================================

export async function setAutomaticQuestions(foundQuestions) {
    questions = foundQuestions || [];

    await renderQuestions();
}

// =====================================
// APRESENTAÇÃO DAS PERGUNTAS
// =====================================

async function renderQuestions() {
    let panel = document.getElementById("answers-panel");

    if (!panel) {
        panel = document.createElement("section");
        panel.id = "answers-panel";

        document.getElementById("reader-section")
            .appendChild(panel);
    }

    panel.replaceChildren();

    const heading = document.createElement("h2");
    heading.textContent = "Caderno de respostas";
    panel.appendChild(heading);

    if (!questions.length) {
        const message = document.createElement("p");

        message.textContent =
            "Não foram identificadas perguntas neste documento.";

        panel.appendChild(message);
        return;
    }

    for (let index = 0; index < questions.length; index++) {
        const question = questions[index];

        const article = document.createElement("article");
        article.className = "answer-question";
        article.dataset.questionId = question.id;

        const title = document.createElement("h3");

        const exercise =
            question.exercise || `Pergunta ${index + 1}`;

        title.textContent =
            `${exercise}${question.label ? " — " + question.label : ""}`;

        const prompt = document.createElement("p");
        prompt.className = "question-prompt";
        prompt.textContent = question.text || "";

        article.append(title, prompt);

        // Enunciado: não cria caixa de resposta
        if (question.type === "statement") {
            article.classList.add("question-statement");

        // Escolha múltipla
        } else if (question.type === "multiple_choice") {
            await renderMultipleChoice(article, question);

        // Desenvolvimento e alíneas
        } else {
            await renderDevelopment(article, question);
        }

        const pageInfo = document.createElement("small");
        pageInfo.className = "question-page";
        pageInfo.textContent =
            `Página ${question.pageNumber || 1}`;

        article.appendChild(pageInfo);
        panel.appendChild(article);
    }
}

// =====================================
// ESCOLHA MÚLTIPLA
// =====================================

async function renderMultipleChoice(article, question) {
    const optionsContainer = document.createElement("div");
    optionsContainer.className = "question-options";

    const page = question.pageNumber || 1;

    const { data, error } = await supabase
        .from("answers")
        .select("selected_options")
        .eq("document_id", documentId)
        .eq("question_key", `page-${page}`)
        .maybeSingle();

    if (error) {
        console.error("Erro ao carregar opções:", error);
    }

    const savedOptions = data?.selected_options || [];

    question.options?.forEach(option => {
        const optionId = `auto-${question.id}-${option.label}`;

        const label = document.createElement("label");
        label.className = "question-option";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = savedOptions.includes(optionId);

        const optionText = document.createElement("span");
        optionText.textContent =
            `${option.label}) ${option.text}`;

        checkbox.addEventListener("change", async () => {
            await toggleOption(
                page,
                optionId,
                checkbox.checked
            );
        });

        label.append(checkbox, optionText);
        optionsContainer.appendChild(label);
    });

    article.appendChild(optionsContainer);
}

async function toggleOption(page, optionId, checked) {
    const { data, error } = await supabase
        .from("answers")
        .select("selected_options, drawing_data")
        .eq("document_id", documentId)
        .eq("question_key", `page-${page}`)
        .maybeSingle();

    if (error) {
        console.error("Erro ao carregar seleção:", error);
        showSaveStatus(error);
        return;
    }

    let options = [...(data?.selected_options || [])];

    if (checked && !options.includes(optionId)) {
        options.push(optionId);
    }

    if (!checked) {
        options = options.filter(id => id !== optionId);
    }

    const { error: saveError } = await supabase
        .from("answers")
        .upsert({
            document_id: documentId,
            question_key: `page-${page}`,
            page_number: page,
            answer_type: "page_annotations",
            selected_options: options,
            drawing_data: data?.drawing_data || [],
            updated_at: new Date().toISOString()
        }, {
            onConflict: "document_id,question_key"
        });

    showSaveStatus(saveError);
}

// =====================================
// PERGUNTAS DE DESENVOLVIMENTO
// =====================================

async function renderDevelopment(article, question) {
    const textarea = document.createElement("textarea");

    textarea.className = "development-answer";
    textarea.dataset.questionId = question.id;

    textarea.placeholder = "Escreve aqui a tua resposta...";
    textarea.rows = 6;

    const { data, error } = await supabase
        .from("answers")
        .select("drawing_data")
        .eq("document_id", documentId)
        .eq("question_key", question.id)
        .maybeSingle();

    if (error) {
        console.error("Erro ao carregar resposta:", error);
    }

    const saved = data?.drawing_data?.find(
        item => item.type === "text-answer"
    );

    textarea.value = saved?.text || "";

    textarea.addEventListener("input", () => {
        saveTextAnswer(question.id, textarea.value);
    });

    article.appendChild(textarea);
}

async function saveTextAnswer(questionId, text) {
    clearTimeout(saveTimer);

    saveTimer = setTimeout(async () => {
        const { data: existing, error: readError } = await supabase
            .from("answers")
            .select("drawing_data")
            .eq("document_id", documentId)
            .eq("question_key", questionId)
            .maybeSingle();

        if (readError) {
            showSaveStatus(readError);
            return;
        }

        const drawingData = (existing?.drawing_data || [])
            .filter(item => item.type !== "text-answer");

        drawingData.push({
            type: "text-answer",
            text
        });

        const question = questions.find(q => q.id === questionId);

        const { error } = await supabase
            .from("answers")
            .upsert({
                document_id: documentId,
                question_key: questionId,
                page_number: question?.pageNumber || 1,
                answer_type: "development",
                selected_options: [],
                drawing_data: drawingData,
                updated_at: new Date().toISOString()
            }, {
                onConflict: "document_id,question_key"
            });

        showSaveStatus(error);
    }, 600);
}

// =====================================
// MODOS DE EDIÇÃO
// =====================================

function setMode(newMode) {
    mode = newMode;

    document.querySelectorAll(".editor-toolbar button")
        .forEach(button => button.classList.remove("active"));

    document.getElementById(`mode-${newMode}`)
        ?.classList.add("active");

    const help = {
        select: "Seleciona as respostas no caderno ou navega pelo documento.",
        pen: "Desenha diretamente sobre o documento.",
        erase: "Apaga os traços desenhados."
    };

    document.getElementById("editor-help").textContent =
        help[newMode];

    canvas.style.cursor =
        newMode === "pen" ? "crosshair" : "default";
}

// =====================================
// CANVAS E DESENHO
// =====================================

function getPoint(event) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height
    };
}

async function prepareCanvas(page) {
    currentPage = page;

    const rect = pdfCanvas.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    const pixelRatio = window.devicePixelRatio || 1;

    canvas.width = Math.round(rect.width * pixelRatio);
    canvas.height = Math.round(rect.height * pixelRatio);

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const { data, error } = await supabase
        .from("answers")
        .select("drawing_data")
        .eq("document_id", documentId)
        .eq("question_key", `page-${page}`)
        .maybeSingle();

    if (error) {
        console.error("Erro ao carregar desenhos:", error);
        return;
    }

    strokes = (data?.drawing_data || [])
        .filter(item => item.type === "stroke");

    draw();
}

function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return;

    ctx.clearRect(0, 0, width, height);

    strokes.forEach(stroke => {
        if (stroke.points.length < 2) return;

        ctx.beginPath();

        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        stroke.points.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;

            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
    });
}

// =====================================
// INTERAÇÃO COM O DESENHO
// =====================================

function cancelCurrentStroke() {
    if (currentStroke) {
        const index = strokes.indexOf(currentStroke);

        if (index !== -1) {
            strokes.splice(index, 1);
        }
    }

    drawing = false;
    currentStroke = null;
}

function pointerDown(event) {
    if (event.pointerType === "touch") {
        activeTouchPointers.add(event.pointerId);
    }

    // Não desenhar durante o zoom com dois dedos
    if (pinching || activeTouchPointers.size >= 2) {
        cancelCurrentStroke();
        draw();
        return;
    }

    if (!documentId || !canvas.width) return;

    if (mode === "select") return;

    event.preventDefault();

    canvas.setPointerCapture(event.pointerId);

    const point = getPoint(event);

    if (mode === "pen") {
        drawing = true;

        currentStroke = {
            type: "stroke",
            color: "#246bce",
            width: 2.5,
            page: currentPage,
            points: [point]
        };

        strokes.push(currentStroke);
    }

    if (mode === "erase") {
        eraseAt(point);
    }
}

function pointerMove(event) {
    if (pinching || activeTouchPointers.size >= 2) {
        cancelCurrentStroke();
        draw();
        return;
    }

    if (!drawing || !currentStroke) return;

    event.preventDefault();

    const point = getPoint(event);

    currentStroke.points.push(point);

    draw();
}

function pointerUp(event) {
    if (event.pointerType === "touch") {
        activeTouchPointers.delete(event.pointerId);
    }

    if (pinching) return;

    if (!drawing) return;

    drawing = false;
    currentStroke = null;

    draw();
    savePage();
}

function pointerCancel(event) {
    if (event.pointerType === "touch") {
        activeTouchPointers.delete(event.pointerId);
    }

    cancelCurrentStroke();
    draw();
}

// =====================================
// APAGAR DESENHOS
// =====================================

function eraseAt(point) {
    let nearest = -1;
    let distance = Infinity;

    strokes.forEach((stroke, index) => {
        if (stroke.page !== currentPage) return;

        stroke.points.forEach(p => {
            const d = Math.hypot(
                (p.x - point.x) * canvas.clientWidth,
                (p.y - point.y) * canvas.clientHeight
            );

            if (d < distance) {
                distance = d;
                nearest = index;
            }
        });
    });

    if (nearest !== -1 && distance < 20) {
        strokes.splice(nearest, 1);
    }

    draw();
    savePage();
}

// =====================================
// GUARDAR DESENHOS
// =====================================

async function savePage() {
    const drawingData = strokes.filter(
        stroke => stroke.page === currentPage
    );

    const { data: existing, error: readError } = await supabase
        .from("answers")
        .select("selected_options")
        .eq("document_id", documentId)
        .eq("question_key", `page-${currentPage}`)
        .maybeSingle();

    if (readError) {
        showSaveStatus(readError);
        return;
    }

    const { error } = await supabase
        .from("answers")
        .upsert({
            document_id: documentId,
            question_key: `page-${currentPage}`,
            page_number: currentPage,
            answer_type: "page_annotations",
            selected_options: existing?.selected_options || [],
            drawing_data: drawingData,
            updated_at: new Date().toISOString()
        }, {
            onConflict: "document_id,question_key"
        });

    showSaveStatus(error);
}

// =====================================
// ESTADO DE GRAVAÇÃO
// =====================================

function showSaveStatus(error) {
    const help = document.getElementById("editor-help");

    if (!help) return;

    if (error) {
        console.error("Erro ao guardar:", error);
        help.textContent = "Erro ao sincronizar: " + error.message;
    } else {
        help.textContent = "Alterações guardadas na cloud.";
    }
}
