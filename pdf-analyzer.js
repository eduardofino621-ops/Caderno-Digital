
import * as pdfjsLib from
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

// Margem superior onde se encontra o cabeçalho.
const HEADER_LIMIT = 0.115;

// Zona inferior onde pode aparecer a numeração.
const FOOTER_LIMIT = 0.84;

// Verificar se o elemento utiliza uma fonte monoespaçada.
function isMonospace(item) {
    return (
        /mono|courier|typewriter|cmtt/i.test(item.fontFamily || "") ||
        /mono|courier|typewriter|cmtt/i.test(item.fontName || "")
    );
}

// Identificar o início de um bloco de programação.
function isCodeStart(line) {
    const text = line.text.trim();

    return [
        /^(def|async\s+def)\s+\w+\s*\(/,
        /^(function|class)\s+\w+/,
        /^(public|private|static)\s+/,
        /^#include\b/,
        /^import\s+[\w.]+/,
        /^from\s+[\w.]+\s+import\b/,
        /^(for|while|if|elif|else|switch|case)\b/,
        /^(try|catch|finally)\b/,
        /^(return|break|continue)\b/
    ].some(pattern => pattern.test(text));
}

// Verificar se uma linha é essencialmente monoespaçada.
function isCodeLine(line) {
    const items = line.items;

    if (!items.length) return false;

    const totalCharacters = items.reduce(
        (sum, item) => sum + item.text.length,
        0
    );

    const monoCharacters = items.reduce(
        (sum, item) =>
            sum + (isMonospace(item) ? item.text.length : 0),
        0
    );

    if (!totalCharacters) return false;

    return monoCharacters / totalCharacters >= 0.65;
}

// Remover blocos de código completos.
// O bloco começa numa linha com sintaxe de programação
// e continua enquanto as linhas utilizarem fonte monoespaçada.
function removeCodeBlocks(lines) {
    const result = [];
    let insideCode = false;
    let removed = 0;

    for (const line of lines) {
        const mono = isCodeLine(line);

        if (!insideCode && mono && isCodeStart(line)) {
            insideCode = true;
            removed++;
            continue;
        }

        if (insideCode && mono) {
            removed++;
            continue;
        }

        if (insideCode && !mono) {
            insideCode = false;
        }

        result.push(line);
    }

    return {
        lines: result,
        removed
    };
}

// Ignorar números isolados no rodapé.
function isPageNumber(item, pageWidth, pageHeight) {
    const text = item.text.trim();

    if (!/^\d{1,3}$/.test(text)) return false;

    const y = item.y / pageHeight;
    const centerX = (item.x + item.width / 2) / pageWidth;

    return (
        y > FOOTER_LIMIT &&
        centerX > 0.25 &&
        centerX < 0.75 &&
        item.width < 25
    );
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
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();

        const items = [];

        // Extrair apenas texto.
        // Não carregamos operatorList nem analisamos imagens
        // ou elementos gráficos.
        for (const item of content.items) {
            if (!item.str?.trim() || !item.transform) continue;

            const transform = pdfjsLib.Util.transform(
                viewport.transform,
                item.transform
            );

            const height = Math.hypot(
                transform[2],
                transform[3]
            );

            const x = transform[4];
            const y = transform[5] - height;

            const text = item.str.trim();

            // Ignorar cabeçalho pela posição.
            if (y / viewport.height < HEADER_LIMIT) {
                continue;
            }

            const extractedItem = {
                text,
                x,
                y,
                width: item.width,
                height,
                baseline: transform[5],
                fontName: item.fontName || "",
                fontFamily:
                    content.styles?.[item.fontName]?.fontFamily || ""
            };

            // Ignorar numeração de páginas.
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

        // Agrupar elementos de texto em linhas.
        items.sort((a, b) =>
            a.baseline - b.baseline || a.x - b.x
        );

        const rawLines = [];

        for (const item of items) {
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

        let lines = rawLines
            .sort((a, b) => a.baseline - b.baseline)
            .map((line, index) => {
                line.items.sort((a, b) => a.x - b.x);

                const x = Math.min(
                    ...line.items.map(i => i.x)
                );

                const y = Math.min(
                    ...line.items.map(i => i.y)
                );

                const right = Math.max(
                    ...line.items.map(i => i.x + i.width)
                );

                const bottom = Math.max(
                    ...line.items.map(i => i.y + i.height)
                );

                return {
                    lineIndex: index,
                    text: line.items.map(i => i.text).join(" "),
                    x: x / viewport.width,
                    y: y / viewport.height,
                    width: (right - x) / viewport.width,
                    height: (bottom - y) / viewport.height,

                    items: line.items.map(i => ({
                        text: i.text,
                        x: i.x / viewport.width,
                        y: i.y / viewport.height,
                        width: i.width / viewport.width,
                        height: i.height / viewport.height,
                        fontName: i.fontName,
                        fontFamily: i.fontFamily
                    }))
                };
            });

        const originalLineCount = lines.length;

        // Remover blocos de código.
        const codeResult = removeCodeBlocks(lines);
        lines = codeResult.lines;

        result.pages.push({
            pageNumber,
            width: viewport.width,
            height: viewport.height,
            lines
        });

        console.log(`Página ${pageNumber}:`, {
            linhasExtraidas: originalLineCount,
            linhasAnalisadas: lines.length,
            linhasDeCodigoIgnoradas: codeResult.removed
        });
    }

    console.log("Análise concluída:", result);

    return result;
}
