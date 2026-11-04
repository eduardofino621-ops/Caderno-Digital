import * as pdfjsLib from
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

export async function analyzePDF(url) {
    console.log("A iniciar análise do PDF...");

    const pdf = await pdfjsLib.getDocument(url).promise;

    const result = {
        pageCount: pdf.numPages,
        pages: []
    };

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        console.log(`A analisar página ${pageNumber}...`);

        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();

        const items = [];

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

            items.push({
                text: item.str.trim(),
                x: transform[4],
                y: transform[5] - height,
                width: item.width,
                height,
                baseline: transform[5],
                fontName: item.fontName || "",
                fontFamily:
                    content.styles?.[item.fontName]?.fontFamily || ""
            });
        }

        // Ordenar os elementos pela posição vertical e horizontal.
        items.sort((a, b) =>
            a.baseline - b.baseline || a.x - b.x
        );

        const rawLines = [];

        for (const item of items) {
            let line = rawLines.find(existing =>
                Math.abs(existing.baseline - item.baseline) <
                Math.max(2.5, item.height * 0.4)
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

        const lines = rawLines
            .sort((a, b) => a.baseline - b.baseline)
            .map((line, index) => {
                line.items.sort((a, b) => a.x - b.x);

                const left = Math.min(
                    ...line.items.map(item => item.x)
                );

                const top = Math.min(
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
                    text: line.items.map(item => item.text).join(" "),
                    x: left / viewport.width,
                    y: top / viewport.height,
                    width: (right - left) / viewport.width,
                    height: (bottom - top) / viewport.height,

                    items: line.items.map(item => ({
                        text: item.text,
                        x: item.x / viewport.width,
                        y: item.y / viewport.height,
                        width: item.width / viewport.width,
                        height: item.height / viewport.height,
                        fontName: item.fontName,
                        fontFamily: item.fontFamily
                    }))
                };
            });

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
