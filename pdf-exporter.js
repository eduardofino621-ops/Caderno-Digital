import { supabase } from "./database.js";

import {
    PDFDocument,
    StandardFonts,
    rgb
} from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

export async function exportEditedPDF({
    url,
    documentId,
    questions,
    documentName
}) {
    const message = document.getElementById("editor-help");

    try {
        message.textContent = "A preparar o teu caderno...";

        // ============================================
        // 1. CARREGAR PDF ORIGINAL
        // ============================================

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Não foi possível obter o PDF original.");
        }

        const originalBytes = await response.arrayBuffer();
        const pdfDoc = await PDFDocument.load(originalBytes);

        const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
        const serifBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

        // ============================================
        // 2. IDENTIDADE VISUAL EDITORIAL (Elegante & Premium)
        // ============================================

        const C = {
            green: rgb(0.10, 0.16, 0.14),       // Verde escuro sofisticado (quase carvão)
            greenLight: rgb(0.92, 0.94, 0.93),  // Cinza-esverdeado muito claro
            greenPale: rgb(0.96, 0.97, 0.96),   // Quase translúcido

            ink: rgb(0.15, 0.15, 0.15),         // Preto suave (mais confortável na leitura)
            secondary: rgb(0.35, 0.35, 0.35),   // Cinza médio elegante
            muted: rgb(0.55, 0.55, 0.55),       // Cinza claro para metadados

            line: rgb(0.85, 0.83, 0.80),        // Linhas quentes e subtis
            paper: rgb(0.98, 0.97, 0.95),       // Cor de papel off-white (clássico)
            white: rgb(1, 1, 1),                // Branco puro para destaques

            missing: rgb(0.75, 0.40, 0.35),     // Terracota (elegante em vez de vermelho erro)
            accent: rgb(0.78, 0.55, 0.35)       // Bronze/Dourado mate para detalhes finos
        };

        const W = 595.28;
        const H = 841.89;

        const M = 62;
        const CONTENT = W - (M * 2);

        const TOP = H - 65;
        const BOTTOM = 65;

        // ============================================
        // 3. NOME DO DOCUMENTO
        // ============================================

        function cleanFileName(name) {
            return (name || "Documento")
                .replace(/\.pdf$/i, "")
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
                .replace(/\s+/g, " ")
                .trim() || "Documento";
        }

        const finalName = cleanFileName(documentName);

        const date = new Intl.DateTimeFormat("pt-PT", {
            day: "2-digit",
            month: "long",
            year: "numeric"
        }).format(new Date());

        // ============================================
        // 4. RECUPERAR RESPOSTAS
        // ============================================

        const {data: answers, error} = await supabase
            .from("answers")
            .select("*")
            .eq("document_id", documentId);

        if (error) throw error;

        const answerMap = new Map(
            (answers || []).map(a => [a.question_key, a])
        );

        // ============================================
        // 5. PRESERVAR DESENHOS ORIGINAIS
        // ============================================

        const originalPages = pdfDoc.getPages();

        for (let i = 0; i < originalPages.length; i++) {
            const page = originalPages[i];
            const {width, height} = page.getSize();

            const saved = answerMap.get(`page-${i + 1}`);

            if (!saved?.drawing_data) continue;

            for (const item of saved.drawing_data) {

                if (
                    item.type !== "stroke" ||
                    item.points?.length < 2
                ) {
                    continue;
                }

                for (let p = 1; p < item.points.length; p++) {
                    const a = item.points[p - 1];
                    const b = item.points[p];

                    page.drawLine({
                        start: {
                            x: a.x * width,
                            y: height - (a.y * height)
                        },
                        end: {
                            x: b.x * width,
                            y: height - (b.y * height)
                        },
                        thickness: item.width || 1.5,
                        color: (() => {
                            const hex = item.color || "#202020";

                            return rgb(
                                parseInt(hex.slice(1, 3), 16) / 255,
                                parseInt(hex.slice(3, 5), 16) / 255,
                                parseInt(hex.slice(5, 7), 16) / 255
                            );
                        })(),
                        opacity: item.opacity ?? 1
                    });
                }
            }
        }

        // ============================================
        // 6. PREPARAR EXERCÍCIOS
        // ============================================

        const prepared = (questions || [])
            .filter(q =>
                q.type === "development" ||
                q.type === "multiple_choice"
            )
            .map((question, index) => {

                const saved = answerMap.get(
                    question.type === "multiple_choice"
                        ? `page-${question.pageNumber || 1}`
                        : question.id
                );

                let answer = "";
                let missing = true;

                if (question.type === "development") {

                    const textAnswer = saved?.drawing_data?.find(
                        item => item.type === "text-answer"
                    )?.text;

                    if (textAnswer?.trim()) {
                        answer = textAnswer.trim();
                        missing = false;
                    }
                }

                if (question.type === "multiple_choice") {

                    const selected = saved?.selected_options || [];
                    const labels = [];

                    for (const opt of question.options || []) {

                        const expectedId =
                            `auto-${question.id}-${opt.label}`;

                        if (selected.includes(expectedId)) {
                            labels.push(`${opt.label}. ${opt.text}`);
                            missing = false;
                        }
                    }

                    answer = labels.join("\n");
                }

                return {
                    question,
                    answer: answer || "Ainda sem resposta.",
                    missing,
                    index: index + 1
                };
            });

        // ============================================
        // 7. FUNÇÕES DE TEXTO
        // ============================================

        function wrapText(text, maxWidth, selectedFont, size) {
            const lines = [];

            for (const paragraph of String(text || "").split("\n")) {
                if (!paragraph.trim()) {
                    lines.push("");
                    continue;
                }

                let current = "";

                for (const word of paragraph.split(/\s+/)) {
                    const candidate = current
                        ? `${current} ${word}`
                        : word;

                    if (
                        selectedFont.widthOfTextAtSize(candidate, size)
                        > maxWidth && current
                    ) {
                        lines.push(current);
                        current = word;
                    } else {
                        current = candidate;
                    }
                }

                if (current) lines.push(current);
            }

            return lines;
        }

        function drawText(page, value, x, y, size, selectedFont, color) {
            page.drawText(value, {x, y, size, font: selectedFont, color});
        }

        function drawLines(page, lines, x, y, size, selectedFont, color, spacing) {
            for (const line of lines) {
                if (line) {
                    drawText(page, line, x, y, size, selectedFont, color);
                }
                y -= spacing;
            }
            return y;
        }

        // ============================================
        // 8. PÁGINAS DE RESPOSTAS
        // ============================================

        const answerPages = [];
        let page = null;
        let y = 0;

        function drawHeader(target, pageNumber) {
            drawText(target, "C A D E R N O .", M, TOP, 8, bold, C.green);

            const label = "RESPOSTAS";
            const labelWidth = bold.widthOfTextAtSize(label, 7);

            drawText(target, label, W - M - labelWidth, TOP, 7, bold, C.muted);

            target.drawLine({
                start: {x: M, y: TOP - 12},
                end: {x: W - M, y: TOP - 12},
                thickness: 0.5,
                color: C.line
            });

            // Rodapé
            target.drawLine({
                start: {x: M, y: 48},
                end: {x: W - M, y: 48},
                thickness: 0.5,
                color: C.line
            });

            drawText(target, finalName.slice(0, 65), M, 32, 7, regular, C.muted);

            const pageLabel = String(pageNumber);
            const pageWidth = serifBold.widthOfTextAtSize(pageLabel, 9);

            drawText(target, pageLabel, W - M - pageWidth, 32, 9, serifBold, C.green);
        }

        function newAnswerPage() {
            page = pdfDoc.addPage([W, H]);
            answerPages.push(page);

            // Preencher com o fundo textura de papel
            page.drawRectangle({
                x: 0, y: 0, width: W, height: H, color: C.paper
            });

            drawHeader(page, answerPages.length);
            y = TOP - 55;
        }

        // ============================================
        // 9. DESENHAR PERGUNTAS E RESPOSTAS
        // ============================================

        if (prepared.length > 0) {
            newAnswerPage();

            for (const item of prepared) {
                const {question, answer, missing, index} = item;

                const heading =
                    `EXERCÍCIO ${question.exercise || index}` +
                    (question.label ? `.${question.label}` : "");

                const promptLines = wrapText(question.text, CONTENT - 25, regular, 10.5);
                const answerLines = wrapText(answer, CONTENT - 40, regular, 11);

                const promptHeight = promptLines.length * 16;
                const promptBoxHeight = promptHeight + 20;

                const answerBoxHeight = Math.max(60, answerLines.length * 17 + 45);

                const totalHeight = 35 + promptBoxHeight + 15 + answerBoxHeight + 35;

                // Verificar espaço disponível.
                if (y - totalHeight < BOTTOM + 15) {
                    newAnswerPage();
                }

                // ------------------------------------
                // IDENTIFICAÇÃO (Minimalista)
                // ------------------------------------

                const numberText = String(index).padStart(2, "0");
                const numberWidth = serifBold.widthOfTextAtSize(numberText, 11);

                // Pequeno acento vertical em bronze/terracota
                page.drawRectangle({
                    x: M, y: y - 10, width: 2, height: 12, color: C.accent
                });

                drawText(page, numberText, M + 10, y - 10, 11, serifBold, C.green);
                drawText(page, heading.toUpperCase(), M + 14 + numberWidth, y - 9, 7.5, bold, C.secondary);

                y -= 32;

                // ------------------------------------
                // ENUNCIADO (Estilo Quote/Citação)
                // ------------------------------------

                // Linha lateral subtil em vez de bloco preenchido completo
                page.drawRectangle({
                    x: M,
                    y: y - promptBoxHeight,
                    width: 1.5,
                    height: promptBoxHeight,
                    color: C.line
                });

                drawLines(
                    page, promptLines, M + 15, y - 14, 10.5, regular, C.secondary, 16
                );

                y -= promptBoxHeight + 15;

                // ------------------------------------
                // CAIXA DE RESPOSTA (Branco puro sob o fundo papel)
                // ------------------------------------

                const answerTop = y;
                const answerBottom = y - answerBoxHeight;

                page.drawRectangle({
                    x: M, y: answerBottom, width: CONTENT, height: answerBoxHeight, color: C.white
                });

                // Barra lateral verde elegante
                page.drawRectangle({
                    x: M, y: answerBottom, width: 2.5, height: answerBoxHeight, color: C.green
                });

                drawText(page, "R E S P O S T A", M + 16, answerTop - 18, 6.5, bold, C.muted);

                drawLines(
                    page, answerLines, M + 16, answerTop - 38, 11,
                    missing ? italic : regular,
                    missing ? C.missing : C.ink,
                    17
                );

                y = answerBottom - 35;
            }
        }

        // ============================================
        // 10. CRIAR CAPA NA PRIMEIRA POSIÇÃO
        // ============================================

        const cover = pdfDoc.insertPage(0, [W, H]);

        // Fundo (Papel elegante)
        cover.drawRectangle({
            x: 0, y: 0, width: W, height: H, color: C.paper
        });

        // Barra superior fina e sofisticada
        cover.drawRectangle({
            x: 0, y: H - 4, width: W, height: 4, color: C.green
        });

        // Identificação
        drawText(cover, "C A D E R N O .", M, H - 85, 10, bold, C.green);

        const edition = "EDIÇÃO DE ESTUDO";
        const editionWidth = bold.widthOfTextAtSize(edition, 7);

        drawText(cover, edition, W - M - editionWidth, H - 84, 7, bold, C.muted);

        cover.drawLine({
            start: {x: M, y: H - 108},
            end: {x: W - M, y: H - 108},
            thickness: 0.5,
            color: C.line
        });

        // Elemento decorativo subtil (Terracota)
        cover.drawRectangle({
            x: M, y: H - 263, width: 34, height: 1.5, color: C.accent
        });

        drawText(cover, "CADERNO DE ESTUDO", M, H - 290, 8, bold, C.muted);

        // ============================================
        // NOME DA FICHA EM GRANDE (Com Serif)
        // ============================================

        let titleSize = 42; // Aumentado para impacto visual

        let titleLines = wrapText(finalName, CONTENT, serifBold, titleSize);

        while (titleLines.length > 4 && titleSize > 24) {
            titleSize -= 2;
            titleLines = wrapText(finalName, CONTENT, serifBold, titleSize);
        }

        let titleY = H - 340;

        for (const line of titleLines) {
            drawText(cover, line, M, titleY, titleSize, serifBold, C.ink);
            titleY -= titleSize + 12;
        }

        const subtitleY = titleY - 20;

        drawText(cover, "FICHA DE TRABALHO E RESPOSTAS", M, subtitleY, 7.5, bold, C.secondary);

        // Linha divisória
        cover.drawLine({
            start: {x: M, y: subtitleY - 30},
            end: {x: W - M, y: subtitleY - 30},
            thickness: 0.5,
            color: C.line
        });

        // ============================================
        // INFORMAÇÕES DA CAPA
        // ============================================

        const infoY = Math.min(subtitleY - 85, H - 520);

        drawText(cover, "DOCUMENTO", M, infoY, 7, bold, C.muted);

        const documentLines = wrapText(finalName, CONTENT, regular, 11);

        drawLines(cover, documentLines.slice(0, 2), M, infoY - 20, 11, regular, C.ink, 15);

        const statsY = infoY - 80;

        drawText(cover, "EXERCÍCIOS", M, statsY, 7, bold, C.muted);
        drawText(cover, String(prepared.length), M, statsY - 26, 20, serifBold, C.green);

        drawText(cover, "DATA DE EXPORTAÇÃO", M + 125, statsY, 7, bold, C.muted);
        drawText(cover, date, M + 125, statsY - 24, 11, regular, C.ink);

        // ============================================
        // RODAPÉ DA CAPA (Selo Minimalista)
        // ============================================

        cover.drawLine({
            start: {x: M, y: 85},
            end: {x: W - M, y: 85},
            thickness: 0.5,
            color: C.line
        });

        // ============================================
        // 11. EXPORTAR PDF
        // ============================================

        const finalBytes = await pdfDoc.save();
        const blob = new Blob([finalBytes], {type: "application/pdf"});
        const downloadUrl = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `Caderno_${finalName}.pdf`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => {
            URL.revokeObjectURL(downloadUrl);
        }, 1500);

        message.textContent = "Caderno exportado com sucesso!";

    } catch (error) {
        console.error("Erro na exportação:", error);
        message.textContent = "Erro ao exportar o caderno.";
        alert("Não foi possível exportar: " + error.message);
    }
}