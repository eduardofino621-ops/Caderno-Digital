
import { supabase } from "./database.js";

import {
    initEditor,
    setAutomaticQuestions
} from "./editor.js";

import { analyzePDF } from "./pdf-analyzer.js";

import {
    classifyDocument,
    groupQuestions
} from "./document-classifier.js";

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
        : "Conta criada! Confirma o email, se solicitado.";
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

// Abrir documento
async function openDocument(doc) {
    uploadMessage.textContent = "";

    try {
        const { data, error } = await supabase.storage
            .from("study-pdfs")
            .createSignedUrl(doc.file_path, 3600);

        if (error) {
            uploadMessage.textContent = error.message;
            return;
        }

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

        // Inicializar o editor
        initEditor(doc.id);

        // Abrir o PDF
        await openPDF(activePdfUrl);

        // Analisar o conteúdo do PDF
        const analysis = await analyzePDF(activePdfUrl);

        // Classificar o conteúdo
        const classified = classifyDocument(analysis);

        // Agrupar as perguntas e alíneas
        const questions = groupQuestions(classified);

        activeQuestions = questions;

        // Enviar perguntas para o editor
        await setAutomaticQuestions(questions);

        if (exportButton) {
            exportButton.disabled = false;
        }

        console.log("Perguntas identificadas:");

        console.table(
            questions.map(question => ({
                exercício: question.exercise,
                alínea: question.label || "-",
                tipo: question.type,
                enunciado: question.text,
                opções: question.options?.length
                    ? question.options.map(option => option.label).join(", ")
                    : "-"
            }))
        );

    } catch (error) {
        console.error("Erro ao abrir documento:", error);

        uploadMessage.textContent =
            "Não foi possível analisar o documento: " + error.message;
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
            questions: activeQuestions
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
    authSection.hidden = !!session;
    librarySection.hidden = !session;
    readerSection.hidden = true;
    header.hidden = !session;

    if (session) {
        loadDocuments();
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
exportButton.addEventListener("click", exportPDF);

// Estado da autenticação
supabase.auth.onAuthStateChange((_event, session) => {
    updateInterface(session);
});

// Verificar sessão existente
const {
    data: { session }
} = await supabase.auth.getSession();

updateInterface(session);


async function deleteAccount() {
    try {
        const {data, error} = await supabase.auth.getSession();

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

        // 2. Validar que o token ainda funciona
        const {data: userData, error: userError} =
            await supabase.auth.getUser();

        if (userError || !userData.user) {
            throw new Error(
                "A autenticação expirou. Termina sessão e volta a entrar."
            );
        }

        // 3. Chamar Edge Function
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

