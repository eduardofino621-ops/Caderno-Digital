
import * as pdfjsLib from
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

// Zona inferior onde pode aparecer a numeração.
const FOOTER_LIMIT = 0.94;

// Verificar se um elemento é apenas um número de página.
function isPageNumber(item, pageWidth, pageHeight) {
    const text = item.text.trim();

    if (!/^\d{1,3}$/.test(text)) {
        return false;
    }

    const y = item.y / pageHeight;
    const centerX = (item.x + item.width / 2) / pageWidth;

    return (
        y > FOOTER_LIMIT &&
        centerX > 0.25 &&
        centerX < 0.75 &&
        item.width < 25
    );
}

// Obter o texto de uma linha preservando a ordem e os espaços
// existentes entre os elementos do PDF.
function joinLineItems(items) {
    return items
        .map(item => item.text)
        .join("");
}

// Agrupar elementos de texto na mesma linha.
function groupItemsIntoLines(items) {
    const sortedItems = [...items].sort(
        (a, b) => a.baseline - b.baseline || a.x - b.x
    );

    const rawLines = [];

    for (const item of sortedItems) {
        let line = rawLines.find(existing =>
            Math.abs(existing.baseline - item.baseline) <
            Math.max(3, item.height * 0.45)
        );

        if (!line) {
            line = {
                baseline: item.baseline,
                items: []
            };

            rawLines.push(line);
        }

        line.items.push(item);
    }

    return rawLines
        .sort((a, b) => a.baseline - b.baseline)
        .map((line, index) => {
            line.items.sort((a, b) => a.x - b.x);

            const x = Math.min(
                ...line.items.map(item => item.x)
            );

            const y = Math.min(
                ...line.items.map(item => item.y)
            );

            const right = Math.max(
                ...line.items.map(item => item.x + item.width)
            );

            const bottom = Math.max(
                ...line.items.map(item => item.y + item.height)
            );

            return {
                lineIndex: index,
                text: joinLineItems(line.items),

                x,
                y,
                width: right - x,
                height: bottom - y,

                items: line.items
            };
        });
}

// Converter coordenadas para valores entre 0 e 1.
function normalizeLine(line, pageWidth, pageHeight) {
    return {
        lineIndex: line.lineIndex,
        text: line.text,

        x: line.x / pageWidth,
        y: line.y / pageHeight,
        width: line.width / pageWidth,
        height: line.height / pageHeight,

        items: line.items.map(item => ({
            text: item.text,

            x: item.x / pageWidth,
            y: item.y / pageHeight,
            width: item.width / pageWidth,
            height: item.height / pageHeight,

            fontName: item.fontName,
            fontFamily: item.fontFamily
        }))
    };
}

export async function analyzePDF(url) {
    console.log("A iniciar análise do PDF...");

    const pdf = await pdfjsLib.getDocument(url).promise;

    const result = {
        pageCount: pdf.numPages,
        pages: []
    };

    for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber++
    ) {
        console.log(`A analisar página ${pageNumber}...`);

        const page = await pdf.getPage(pageNumber);

        const viewport = page.getViewport({
            scale: 1
        });

        const content = await page.getTextContent();

        const items = [];

        // Extrair todo o texto disponível.
        // Não remover código, cabeçalhos ou perguntas.
        for (const item of content.items) {
            if (
                typeof item.str !== "string" ||
                !item.str.trim() ||
                !item.transform
            ) {
                continue;
            }

            const transform = pdfjsLib.Util.transform(
                viewport.transform,
                item.transform
            );

            const height = Math.hypot(
                transform[2],
                transform[3]
            );

            const extractedItem = {
                text: item.str,

                x: transform[4],
                y: transform[5] - height,

                width: item.width,
                height,

                baseline: transform[5],

                fontName: item.fontName || "",

                fontFamily:
                    content.styles?.[item.fontName]?.fontFamily || ""
            };

            // Ignorar apenas números de página isolados.
            if (
                isPageNumber(
                    extractedItem,
                    viewport.width,
                    viewport.height
                )
            ) {
                continue;
            }

            items.push(extractedItem);
        }

        // Agrupar os elementos em linhas.
        const groupedLines = groupItemsIntoLines(items);

        // Converter coordenadas para valores normalizados.
        const lines = groupedLines.map(line =>
            normalizeLine(
                line,
                viewport.width,
                viewport.height
            )
        );

        result.pages.push({
            pageNumber,
            width: viewport.width,
            height: viewport.height,
            lines
        });

        console.log(`Página ${pageNumber}:`, {
            elementosExtraidos: items.length,
            linhasExtraidas: lines.length
        });
    }

    console.log("Análise concluída:", result);

    return result;
}
