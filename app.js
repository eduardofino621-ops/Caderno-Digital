import { supabase } from "./database.js";
import {
    initEditor,
    setAutomaticQuestions
} from "./editor.js";

import { analyzePDF } from "./pdf-analyzer.js";

import {
    openPDF,
    nextPage,
    previousPage,
    zoomIn,
    zoomOut,
    closePDF
} from "./pdf-viewer.js";

import { exportEditedPDF } from "./pdf-exporter.js";

// Elementos principais
const authSection = document.getElementById("auth-section");
const librarySection = document.getElementById("library-section");
const readerSection = document.getElementById("reader-section");
const header = document.getElementById("main-header");

const email = document.getElementById("email");
const password = document.getElementById("password");

const authMessage = document.getElementById("auth-message");
const uploadMessage = document.getElementById("upload-message");
const documentList = document.getElementById("document-list");

const exportButton = document.getElementById("export-pdf");

// Documento atualmente aberto
let activeDocument = null;
let activePdfUrl = null;
let activeQuestions = [];


async function login() {
    authMessage.textContent = "A iniciar sessão...";

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.value,
            password: password.value
        });

        if (error) {
            throw error;
        }

        if (!data.session || !data.session.access_token) {
            throw new Error(
                "Login efetuado, mas o Supabase não devolveu uma sessão."
            );
        }

        authMessage.textContent = "Sessão iniciada com sucesso!";

        console.log("LOGIN:", {
            sessionCriada: !!data.session,
            utilizador: !!data.user,
            tokenDisponivel: !!data.session.access_token
        });

        updateInterface(data.session);

    } catch (error) {
        console.error("Erro no login:", error);
        authMessage.textContent = error.message;
    }
}


async function register() {
    authMessage.textContent = "A criar conta...";

    const { error } = await supabase.auth.signUp({
        email: email.value,
        password: password.value
    });

    authMessage.textContent = error
        ? error.message
        : "Conta criada! Confirms o email, se solicitado.";
}

async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
        authMessage.textContent = error.message;
    }
}

// Renomear documento
async function renameDocument(doc) {
    const newTitle = prompt("Novo nome do documento:", doc.title);

    if (newTitle === null) return;

    const title = newTitle.trim();

    if (!title) {
        alert("O nome não pode estar vazio.");
        return;
    }

    const { error } = await supabase
        .from("documents")
        .update({ title })
        .eq("id", doc.id);

    if (error) {
        alert("Erro ao renomear documento: " + error.message);
        return;
    }

    // Atualizar o título caso esteja aberto
    if (activeDocument?.id === doc.id) {
        activeDocument.title = title;

        const readerTitle = document.getElementById("reader-title");
        if (readerTitle) readerTitle.textContent = title;
    }

    await loadDocuments();
}

// Apagar documento e respetivas respostas
async function deleteDocument(doc) {
    const confirmed = confirm(
        `Tens a certeza de que queres apagar "${doc.title}"?\n\n` +
        "Serão eliminados o PDF e todas as respostas associadas.\n\n" +
        "Esta ação não pode ser desfeita."
    );

    if (!confirmed) return;

    uploadMessage.textContent = "A apagar documento...";

    try {
        // 1. Apagar o PDF do Storage
        const { error: storageError } = await supabase
            .storage
            .from("study-pdfs")
            .remove([doc.file_path]);

        if (storageError) {
            throw new Error("Erro ao apagar PDF: " + storageError.message);
        }

        // 2. Apagar todas as respostas associadas
        const { error: answersError } = await supabase
            .from("answers")
            .delete()
            .eq("document_id", doc.id);

        if (answersError) {
            throw new Error(
                "Erro ao apagar respostas: " + answersError.message
            );
        }

        // 3. Apagar o registo do documento
        const { error: documentError } = await supabase
            .from("documents")
            .delete()
            .eq("id", doc.id);

        if (documentError) {
            throw new Error(
                "Erro ao apagar documento: " + documentError.message
            );
        }

        // 4. Se estiver aberto, regressar à biblioteca
        if (activeDocument?.id === doc.id) {
            showLibrary();
        }

        uploadMessage.textContent = "Documento apagado com sucesso!";

        await loadDocuments();

    } catch (error) {
        console.error("Erro ao eliminar documento:", error);
        uploadMessage.textContent = error.message;
    }
}

// Carregar biblioteca
async function loadDocuments() {
    uploadMessage.textContent = "A carregar documentos...";

    const { data, error } = await supabase
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        uploadMessage.textContent = error.message;
        return;
    }

    documentList.replaceChildren();

    if (!data || data.length === 0) {
        documentList.textContent = "Ainda não tens documentos.";
        uploadMessage.textContent = "";
        return;
    }

    data.forEach(doc => {
        const item = document.createElement("div");
        item.className = "document";

        const title = document.createElement("strong");
        title.textContent = doc.title;

        const details = document.createElement("small");
        details.textContent = doc.file_name;

        const openButton = document.createElement("button");
        openButton.textContent = "Abrir PDF";
        openButton.addEventListener("click", () => {
            openDocument(doc);
        });

        const renameButton = document.createElement("button");
        renameButton.textContent = "Renomear";
        renameButton.addEventListener("click", () => {
            renameDocument(doc);
        });

        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Apagar";
        deleteButton.className = "delete-document";
        deleteButton.addEventListener("click", () => {
            deleteDocument(doc);
        });

        const actions = document.createElement("div");
        actions.className = "document-actions";
        actions.append(openButton, renameButton, deleteButton);

        item.append(title, details, actions);
        documentList.appendChild(item);
    });

    uploadMessage.textContent = "";
}

// Carregar PDF para a biblioteca
async function uploadPDF(file) {
    const {
        data: { user },
        error: userError
    } = await supabase.auth.getUser();

    if (userError || !user) {
        uploadMessage.textContent = "Tens de iniciar sessão.";
        return;
    }

    if (file.type !== "application/pdf") {
        uploadMessage.textContent = "Seleciona um PDF válido.";
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        uploadMessage.textContent = "O PDF ultrapassa os 50 MB.";
        return;
    }

    uploadMessage.textContent = "A carregar documento...";

    const filePath = `${user.id}/${crypto.randomUUID()}.pdf`;

    const { error: storageError } = await supabase.storage
        .from("study-pdfs")
        .upload(filePath, file, {
            contentType: "application/pdf"
        });

    if (storageError) {
        uploadMessage.textContent = storageError.message;
        return;
    }

    const { error: databaseError } = await supabase
        .from("documents")
        .insert({
            user_id: user.id,
            title: file.name.replace(/\.pdf$/i, ""),
            file_name: file.name,
            file_path: filePath
        });

    if (databaseError) {
        await supabase.storage
            .from("study-pdfs")
            .remove([filePath]);

        uploadMessage.textContent = databaseError.message;
        return;
    }

    uploadMessage.textContent = "Documento adicionado com sucesso!";

    await loadDocuments();
}

// Abrir documento e analisar com IA
async function openDocument(doc) {
    sessionStorage.setItem("activeDocumentId", doc.id);
    uploadMessage.textContent = "";

    try {
        const {data, error} = await supabase.storage
            .from("study-pdfs")
            .createSignedUrl(doc.file_path, 3600);

        if (error) throw error;

        activeDocument = doc;
        activePdfUrl = data.signedUrl;
        activeQuestions = [];

        librarySection.hidden = true;
        readerSection.hidden = false;
        header.hidden = true;

        document.getElementById("reader-title").textContent = doc.title;

        if (exportButton) {
            exportButton.disabled = true;
        }

        initEditor(doc.id);

        // Abrir o PDF
        await openPDF(activePdfUrl);

        // Extrair texto e coordenadas
        uploadMessage.textContent = "A extrair texto do PDF...";

        const pdfAnalysis = await analyzePDF(activePdfUrl);

        if (!pdfAnalysis.pages?.length) {
            throw new Error("Não foi possível extrair páginas do PDF.");
        }

        // Obter a sessão atual
        const {data: sessionData, error: sessionError} =
            await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const session = sessionData.session;

        if (!session?.access_token) {
            throw new Error(
                "Não existe uma sessão ativa. Termina sessão e volta a entrar."
            );
        }

        // Enviar o conteúdo para a Edge Function
        uploadMessage.textContent = "A analisar o documento com inteligência artificial...";

        // Preparar uma versão compacta dos dados para a IA.
        const pagesForAI = pdfAnalysis.pages.map(page => ({
            pageNumber: page.pageNumber,
            width: page.width,
            height: page.height,

            lines: page.lines.map(line => ({
                lineIndex: line.lineIndex,
                text: line.text,

                x: line.x,
                y: line.y,
                width: line.width,
                height: line.height,

                items: (line.items || []).map(item => ({
                    text: item.text,
                    x: item.x,
                    y: item.y,
                    width: item.width,
                    height: item.height
                }))
            }))
        }));

        const requestBody = {
            documentId: doc.id,
            pages: pagesForAI
        };

        // Medir o tamanho real do pedido
        const payloadSize = new TextEncoder().encode(
            JSON.stringify(requestBody)
        ).length;

        console.log("Tamanho do pedido para IA:", {
            bytes: payloadSize,
            megabytes: (payloadSize / 1024 / 1024).toFixed(2)
        });

        // Enviar para a Edge Function
        const {data: result, error: analysisError} =
            await supabase.functions.invoke("analyze-document", {
                body: requestBody
            });

        if (analysisError) {
            let details = analysisError.message;

            if (analysisError.context) {
                try {
                    const response = await analysisError.context.json();
                    details = response.error || response.message || details;
                } catch {
                    // Mantém a mensagem original
                }
            }

            throw new Error("Erro na análise por IA: " + details);
        }

        if (!result?.success) {
            throw new Error(
                result?.error || "A inteligência artificial não devolveu uma análise válida."
            );
        }

        // Obter perguntas devolvidas pela IA
        const questions = result.analysis?.questions;

        if (!Array.isArray(questions)) {
            throw new Error(
                "A resposta da IA não contém uma lista válida de perguntas."
            );
        }

        // Normalizar estrutura para o editor
        activeQuestions = questions.map((question, index) => ({
            id: String(question.id || `question-${index + 1}`),
            exercise: question.exercise || "",
            label: question.label || "",
            pageNumber: Number(question.pageNumber) || 1,
            lineIndex: Number(question.lineIndex) || 0,
            type: [
                "development",
                "multiple_choice",
                "statement"
            ].includes(question.type)
                ? question.type
                : "development",
            context: question.context || "",
            text: question.text || "",
            options: Array.isArray(question.options)
                ? question.options.map(option => ({
                    label: String(option.label || ""),
                    text: String(option.text || ""),
                    area: option.area || null
                }))
                : []
        }));

        // Enviar para o editor
        await setAutomaticQuestions(activeQuestions);

        if (exportButton) {
            exportButton.disabled = false;
        }

        uploadMessage.textContent = "";

        console.log("Análise da IA:", {
            modelo: result.model,
            cache: result.cached,
            total: activeQuestions.length
        });

        console.table(
            activeQuestions.map(question => ({
                exercício: question.exercise,
                alínea: question.label || "-",
                tipo: question.type,
                enunciado: question.text,
                opções: question.options.length
                    ? question.options.map(option => option.label).join(", ")
                    : "-"
            }))
        );

    } catch (error) {
        console.error("Erro ao abrir documento:", error);

        uploadMessage.textContent =
            "Não foi possível analisar o documento: " + error.message;

        if (exportButton) {
            exportButton.disabled = true;
        }
    }
}

// Exportar PDF preenchido

async function exportPDF() {
    if (!activeDocument || !activePdfUrl) {
        alert("Abre primeiro um documento.");
        return;
    }

    try {
        exportButton.disabled = true;
        exportButton.textContent = "A preparar PDF...";

        await exportEditedPDF({
            url: activePdfUrl,
            documentId: activeDocument.id,
            questions: activeQuestions,
            documentName: activeDocument.title
        });

    } catch (error) {
        console.error("Erro ao exportar PDF:", error);

        alert("Não foi possível exportar o PDF: " + error.message);

    } finally {
        exportButton.disabled = false;
        exportButton.textContent = "Exportar PDF preenchido";
    }
}


// Voltar à biblioteca
function showLibrary() {
    closePDF();
    sessionStorage.removeItem("activeDocumentId");

    activeDocument = null;
    activePdfUrl = null;
    activeQuestions = [];

    if (exportButton) {
        exportButton.disabled = true;
    }

    readerSection.hidden = true;
    librarySection.hidden = false;
    header.hidden = false;
}

// Atualizar interface conforme autenticação
function updateInterface(session) {
    const authenticated = !!session;

    authSection.hidden = authenticated;
    header.hidden = !authenticated;

    // Sem sessão: mostrar autenticação
    if (!authenticated) {
        librarySection.hidden = true;
        readerSection.hidden = true;

        sessionStorage.removeItem("activeDocumentId");

        activeDocument = null;
        activePdfUrl = null;
        activeQuestions = [];

        return;
    }

    // Se já existe uma ficha aberta, manter o leitor visível
    if (activeDocument) {
        librarySection.hidden = true;
        readerSection.hidden = false;
    } else {
        librarySection.hidden = false;
        readerSection.hidden = true;
    }

    loadDocuments();
}

// Eliminar conta de utilizador com janela de confirmação
async function deleteAccount() {
    const confirmed = confirm(
        "Tens a certeza absoluta de que queres eliminar a tua conta?\n\n" +
        "Todos os teus documentos, ficheiros PDF e respostas associadas serão apagados permanentemente.\n\n" +
        "Esta ação é irreversível!"
    );

    if (!confirmed) return;

    try {
        const { data, error } = await supabase.auth.getSession();

        console.log("DIAGNÓSTICO DA SESSÃO:", {
            existeSessao: !!data.session,
            existeToken: !!data.session?.access_token,
            erro: error?.message,
            armazenamentoDisponivel: !!window.localStorage
        });

        if (error) throw error;

        const session = data.session;

        if (!session || !session.access_token) {
            throw new Error(
                "Não existe uma sessão ativa nesta aplicação. Termina sessão e volta a entrar."
            );
        }

        // Validar que o token ainda funciona
        const { data: userData, error: userError } = await supabase.auth.getUser();

        if (userError || !userData.user) {
            throw new Error(
                "A autenticação expirou. Termina sessão e volta a entrar."
            );
        }

        // Chamar Edge Function
        const response = await fetch(
            "https://lzmpartyirwmmfazezyx.supabase.co/functions/v1/delete-account",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.access_token}`,
                    "apikey": "sb_publishable_eiucFgPNRD5ZTv6vrVNyNQ_mcl4DhIn"
                },
                body: JSON.stringify({
                    access_token: session.access_token
                })
            }
        );

        const responseText = await response.text();
        let result;

        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error("Resposta inválida: " + responseText);
        }

        if (!response.ok || !result.success) {
            throw new Error(result.error || "Erro ao eliminar conta.");
        }

        alert("Conta eliminada com sucesso!");

        await supabase.auth.signOut();
        window.location.reload();

    } catch (error) {
        console.error("Erro ao eliminar conta:", error);
        alert("Erro ao eliminar conta: " + error.message);
    }
}

// Eventos de autenticação
document.getElementById("login-btn")
    .addEventListener("click", login);

document.getElementById("delete-account")
    ?.addEventListener("click", deleteAccount);

document.getElementById("register-btn")
    .addEventListener("click", register);

document.getElementById("logout-btn")
    .addEventListener("click", logout);

// Upload de PDF
document.getElementById("pdf-input")
    .addEventListener("change", event => {
        const file = event.target.files[0];

        if (file) {
            uploadPDF(file);
        }

        event.target.value = "";
    });

// Navegação
document.getElementById("back-library")
    .addEventListener("click", showLibrary);

document.getElementById("next-page")
    .addEventListener("click", nextPage);

document.getElementById("previous-page")
    .addEventListener("click", previousPage);

// Zoom
document.getElementById("zoom-in")
    .addEventListener("click", zoomIn);

document.getElementById("zoom-out")
    .addEventListener("click", zoomOut);

// Exportação
if (exportButton) {
    exportButton.addEventListener("click", exportPDF);
}

// Estado da autenticação
supabase.auth.onAuthStateChange((_event, session) => {
    updateInterface(session);
});

// Restaurar documento anteriormente aberto
let restoringDocument = false;

async function restoreActiveDocument() {
    if (restoringDocument) return;

    const savedId = sessionStorage.getItem("activeDocumentId");

    if (!savedId) return;

    if (activeDocument?.id === savedId) return;

    restoringDocument = true;

    try {
        // Confirmar sessão
        const { data: sessionData, error: sessionError } =
            await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!sessionData.session) return;

        // Procurar documento guardado
        const { data, error } = await supabase
            .from("documents")
            .select("*")
            .eq("id", savedId)
            .single();

        if (error) throw error;

        if (data) {
            await openDocument(data);
        }

    } catch (error) {
        console.error("Erro ao restaurar documento:", error);
    } finally {
        restoringDocument = false;
    }
}

// Verificar sessão existente no arranque
const {
    data: { session }
} = await supabase.auth.getSession();

updateInterface(session);

// Restaurar ficha imediatamente após carregar a página
if (session) {
    await restoreActiveDocument();
}

// Restaurar também quando regressa ao separador
document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
        await restoreActiveDocument();
    }
});