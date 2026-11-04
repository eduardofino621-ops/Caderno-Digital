
import { supabase } from "./database.js";

import {
    PDFDocument,
    StandardFonts,
    rgb
} from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

export async function exportEditedPDF({
    url,
    documentId,
    questions
}) {
    const message = document.getElementById("editor-help");

    try {
        message.textContent = "A preparar o PDF...";

        // Obter o PDF original.
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Não foi possível obter o PDF original.");
        }

        const originalBytes = await response.arrayBuffer();
        const pdfDoc = await PDFDocument.load(originalBytes);

        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // Obter todas as respostas guardadas.
        const { data: answers, error } = await supabase
            .from("answers")
            .select("*")
            .eq("document_id", documentId);

        if (error) throw error;

        const answerMap = new Map(
            (answers || []).map(answer => [
                answer.question_key,
                answer
            ])
        );

        // Incorporar desenhos e seleções nas páginas originais.
        const originalPages = pdfDoc.getPages();

        for (const page of originalPages) {
            const pageNumber = originalPages.indexOf(page) + 1;
            const { width, height } = page.getSize();

            const saved = answerMap.get(`page-${pageNumber}`);

            if (!saved) continue;

            const selected = saved.selected_options || [];
            const drawings = saved.drawing_data || [];

            // Desenhos à mão e zonas manuais.
            for (const item of drawings) {
                if (item.type === "stroke" && item.points?.length > 1) {
                    for (let i = 1; i < item.points.length; i++) {
                        const a = item.points[i - 1];
                        const b = item.points[i];

                        page.drawLine({
                            start: {
                                x: a.x * width,
                                y: height - a.y * height
                            },
                            end: {
                                x: b.x * width,
                                y: height - b.y * height
                            },
                            thickness: item.width || 2,
                            color: rgb(0.14, 0.42, 0.81)
                        });
                    }
                }

                if (item.type === "zone") {
                    page.drawRectangle({
                        x: item.x * width,
                        y: height - (item.y + item.h) * height,
                        width: item.w * width,
                        height: item.h * height,
                        borderColor: rgb(0.15, 0.59, 0.43),
                        borderWidth: 1.5
                    });
                }
            }

            // Assinalar opções selecionadas.
            for (const question of questions) {
                if (question.type !== "multiple_choice" ||
                    question.pageNumber !== pageNumber) {
                    continue;
                }

                for (const option of question.options || []) {
                    const id = `auto-${question.id}-${option.label}`;

                    if (!selected.includes(id) || !option.area) continue;

                    const area = option.area;

                    page.drawRectangle({
                        x: area.x * width,
                        y: height - (area.y + area.height) * height,
                        width: area.width * width,
                        height: area.height * height,
                        color: rgb(0.15, 0.59, 0.43),
                        opacity: 0.20,
                        borderColor: rgb(0.15, 0.59, 0.43),
                        borderWidth: 1.5
                    });
                }
            }
        }

        // Criar páginas adicionais para respostas de desenvolvimento.
        const developmentQuestions = questions.filter(
            question => question.type === "development"
        );

        const answeredQuestions = [];

        for (const question of developmentQuestions) {
            const saved = answerMap.get(question.id);

            const text = saved?.drawing_data?.find(
                item => item.type === "text-answer"
            )?.text || "";

            answeredQuestions.push({ question, text });
        }

        if (answeredQuestions.length) {
            const pageWidth = 595.28;
            const pageHeight = 841.89;
            const margin = 55;
            const lineHeight = 17;

            let page = null;
            let y = 0;

            function newAnswerPage() {
                page = pdfDoc.addPage([pageWidth, pageHeight]);

                page.drawText("Respostas", {
                    x: margin,
                    y: pageHeight - 55,
                    size: 17,
                    font: boldFont,
                    color: rgb(0.15, 0.40, 0.30)
                });

                page.drawLine({
                    start: { x: margin, y: pageHeight - 68 },
                    end: { x: pageWidth - margin, y: pageHeight - 68 },
                    thickness: 1,
                    color: rgb(0.75, 0.80, 0.76)
                });

                y = pageHeight - 100;
            }

            function wrapText(text, maxWidth, size = 11) {
                const words = text.split(/\s+/);
                const lines = [];
                let current = "";

                for (const word of words) {
                    const candidate = current
                        ? `${current} ${word}`
                        : word;

                    if (font.widthOfTextAtSize(candidate, size) > maxWidth &&
                        current) {
                        lines.push(current);
                        current = word;
                    } else {
                        current = candidate;
                    }
                }

                if (current) lines.push(current);
                return lines;
            }

            newAnswerPage();

            for (const { question, text } of answeredQuestions) {
                const heading =
                    `${question.exercise}${question.label ? " — " + question.label : ""}`;

                const headingLines = wrapText(heading, pageWidth - margin * 2, 12);
                const promptLines = wrapText(question.text, pageWidth - margin * 2, 10);
                const answerLines = wrapText(text || "Sem resposta.", pageWidth - margin * 2, 11);

                const requiredHeight =
                    (headingLines.length + promptLines.length + answerLines.length + 3) *
                    lineHeight + 35;

                if (y - requiredHeight < 55) {
                    newAnswerPage();
                }

                headingLines.forEach(line => {
                    page.drawText(line, {
                        x: margin,
                        y,
                        size: 12,
                        font: boldFont
                    });
                    y -= lineHeight;
                });

                y -= 4;

                promptLines.forEach(line => {
                    page.drawText(line, {
                        x: margin,
                        y,
                        size: 10,
                        font
                    });
                    y -= 14;
                });

                y -= 8;

                answerLines.forEach(line => {
                    page.drawText(line, {
                        x: margin,
                        y,
                        size: 11,
                        font
                    });
                    y -= lineHeight;
                });

                y -= 22;

                page.drawLine({
                    start: { x: margin, y },
                    end: { x: pageWidth - margin, y },
                    thickness: 0.5,
                    color: rgb(0.85, 0.85, 0.85)
                });

                y -= 25;
            }
        }

        const finalBytes = await pdfDoc.save();

        const blob = new Blob([finalBytes], {
            type: "application/pdf"
        });

        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = downloadUrl;
        link.download = "Caderno-Digital-respostas.pdf";
        link.click();

        URL.revokeObjectURL(downloadUrl);

        message.textContent = "PDF exportado com sucesso!";
    } catch (error) {
        console.error("Erro na exportação:", error);
        message.textContent = "Erro ao exportar: " + error.message;
    }
}
