
const EXERCISE_TITLE =
    /^(?:exercise|exerc[ií]cio|exercicio|part|section)\s+\d+/i;

const QUESTION_NUMBER =
    /^(?:question\s*)?\d+\s*[\.\):\-]\s*/i;

const SUBQUESTION =
    /^([a-z])\s*[\)\.]\s*/i;

const OPTION_MARKER =
    /(?:^|\s)([a-z])\s*[\)\.]\s*/gi;

const DEVELOPMENT_CUES = [
    "write", "explain", "describe", "discuss", "justify",
    "calculate", "determine", "give the", "find", "design",
    "implement", "prove", "escreve", "explique", "descreva",
    "discuta", "justifique", "calcule", "apresente",
    "desenvolva", "how much", "how many", "what is",
    "what are", "how does", "given"
];

function findOptions(text, line) {
    const matches = [...text.matchAll(OPTION_MARKER)];

    if (matches.length < 2) return [];

    const options = matches.map((match, index) => {
        const start = match.index + match[0].length;
        const end = matches[index + 1]?.index ?? text.length;

        return {
            label: match[1].toUpperCase(),
            text: text.slice(start, end).trim()
        };
    }).filter(option => option.text);

    if (options.length < 2) return [];

    // Só aceitar sequências de letras consecutivas.
    const labels = options.map(option => option.label);

    for (let i = 1; i < labels.length; i++) {
        if (labels[i].charCodeAt(0) !== labels[i - 1].charCodeAt(0) + 1) {
            return [];
        }
    }

    // Calcular áreas a partir das posições reais dos itens.
    const markers = [];

    line.items.forEach((item, index) => {
        const match = item.text.match(/(?:^|\s)([a-z])\s*[\)\.]/i);

        if (match) {
            markers.push({
                label: match[1].toUpperCase(),
                index
            });
        }
    });

    return options.map(option => {
        const markerIndex = markers.findIndex(
            marker => marker.label === option.label
        );

        if (markerIndex < 0) return option;

        const marker = markers[markerIndex];
        const next = markers[markerIndex + 1];

        const selectedItems = line.items.slice(
            marker.index,
            next?.index ?? line.items.length
        );

        if (!selectedItems.length) return option;

        const left = Math.min(...selectedItems.map(i => i.x));
        const top = Math.min(...selectedItems.map(i => i.y));
        const right = Math.max(
            ...selectedItems.map(i => i.x + i.width)
        );
        const bottom = Math.max(
            ...selectedItems.map(i => i.y + i.height)
        );

        return {
            ...option,
            area: {
                x: Math.max(0, left - 0.006),
                y: Math.max(0, top - 0.008),
                width: Math.min(1 - left, right - left + 0.012),
                height: Math.min(1 - top, bottom - top + 0.016)
            }
        };
    });
}

function looksLikeDevelopment(text) {
    const lower = text.toLowerCase();

    return text.includes("?") ||
        DEVELOPMENT_CUES.some(cue => lower.includes(cue));
}

function looksLikeQuestion(text) {
    return QUESTION_NUMBER.test(text) ||
        SUBQUESTION.test(text) ||
        looksLikeDevelopment(text);
}

export function classifyDocument(documentData) {
    return {
        pageCount: documentData.pageCount,
        pages: documentData.pages.map(page => ({
            ...page,
            lines: page.lines.map(line => {
                const text = line.text.trim();

                if (EXERCISE_TITLE.test(text)) {
                    return { ...line, type: "heading" };
                }

                const options = findOptions(text, line);

                if (options.length >= 2) {
                    return {
                        ...line,
                        type: "multiple_choice",
                        options
                    };
                }

                if (looksLikeQuestion(text)) {
                    return { ...line, type: "question" };
                }

                return { ...line, type: "text" };
            })
        }))
    };
}

export function groupQuestions(classifiedDocument) {
    const questions = [];
    let exercise = null;
    let currentQuestion = null;

    function finishQuestion() {
        if (!currentQuestion) return;

        currentQuestion.text = currentQuestion.text
            .replace(/\s+/g, " ")
            .trim();

        if (currentQuestion.text) {
            questions.push(currentQuestion);
        }

        currentQuestion = null;
    }

    for (const page of classifiedDocument.pages) {
        for (const line of page.lines) {
            const text = line.text.trim();

            if (line.type === "heading") {
                finishQuestion();
                exercise = text;
                continue;
            }

            if (!exercise) continue;
            if (!text) continue;

            const sub = text.match(SUBQUESTION);
            const numbered = QUESTION_NUMBER.test(text);

            if (line.type === "multiple_choice") {
                if (!currentQuestion) {
                    currentQuestion = {
                        exercise,
                        label: null,
                        pageNumber: page.pageNumber,
                        type: "multiple_choice",
                        text,
                        options: line.options,
                        lines: [line]
                    };
                } else {
                    currentQuestion.type = "multiple_choice";
                    currentQuestion.options = line.options;
                    currentQuestion.lines.push(line);
                }
                continue;
            }

            if (sub || numbered || !currentQuestion) {
                finishQuestion();

                currentQuestion = {
                    id: `p${page.pageNumber}-q${questions.length + 1}`,
                    exercise,
                    label: sub ? sub[1].toUpperCase() : null,
                    pageNumber: page.pageNumber,
                    type: "development",
                    text: text.replace(SUBQUESTION, "").trim(),
                    options: [],
                    lines: [line]
                };

                continue;
            }

            // Continuação do enunciado anterior.
            currentQuestion.text += " " + text;
            currentQuestion.lines.push(line);
        }
    }

    finishQuestion();

    // Garantir que perguntas com opções são classificadas corretamente.
    questions.forEach((question, index) => {
        if (question.options?.length >= 2) {
            question.type = "multiple_choice";
        }

        question.id ||= `q-${index + 1}`;
    });

    return questions;
}
