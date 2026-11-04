
const EXERCISE_TITLE =
    /^(?:exerc[ií]cio|exercise|parte|part|sec[cç][aã]o|section|grupo|group)\s+(?:n[.º°]\s*)?\d+\b/i;

const QUESTION_NUMBER =
    /^(?:(?:pergunta|quest[aã]o|question|q)\s*)?\d+(?:\.\d+)*\s*[\.\):\-]\s*/i;

const SUBQUESTION =
    /^\(?([a-z])\s*[\)\.]\s*/i;

const OPTION_START =
    /^\(?([a-h])\s*[\)\.]\s*(.+)$/i;

const DEVELOPMENT_CUES = [
    "explique", "explica", "explicar",
    "descreva", "descreve", "descrever",
    "justifique", "justifica", "justificar",
    "calcule", "calcula", "calcular",
    "determine", "determina", "determinar",
    "apresente", "apresenta", "apresentar",
    "indique", "indica", "indicar",
    "identifique", "identifica", "identificar",
    "analise", "analisa", "analisar",
    "compare", "compara", "comparar",
    "desenvolva", "desenvolve", "desenvolver",
    "escreva", "escreve", "escrever",
    "implemente", "implementar",
    "construa", "construir",
    "demonstre", "demonstrar",
    "resolva", "resolver",
    "prove", "provar",
    "calcular", "explique",
    "calculate", "explain", "describe",
    "justify", "determine", "identify",
    "analyse", "analyze", "compare",
    "discuss", "write", "implement",
    "design", "develop", "find",
    "give", "show", "state",
    "define", "evaluate", "calculate",
    "what is", "what are", "how does",
    "how many", "how much", "why",
    "which", "how", "when", "where"
];

function normalize(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .trim();
}

function hasDevelopmentCue(text) {
    const value = normalize(text).toLowerCase();

    return DEVELOPMENT_CUES.some(cue => {
        const escaped = cue.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

        return new RegExp(
            `(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`,
            "u"
        ).test(value);
    });
}

function looksLikeQuestion(text) {
    const value = normalize(text);

    if (!value) return false;

    return (
        QUESTION_NUMBER.test(value) ||
        /[?？]/.test(value) ||
        hasDevelopmentCue(value) ||
        /^(?:pergunta|quest[aã]o|question)\s*:/i.test(value) ||
        /^(?:qual|quais|quem|quando|onde|como|porque|por que|what|which|who|when|where|how)\b/i.test(value)
    );
}

function getQuestionText(text) {
    return normalize(text)
        .replace(QUESTION_NUMBER, "")
        .replace(/^(?:pergunta|quest[aã]o|question)\s*:\s*/i, "")
        .replace(SUBQUESTION, "")
        .trim();
}

function getOptionArea(line) {
    const items = line.items || [];

    if (!items.length) return null;

    const left = Math.min(...items.map(item => item.x));
    const top = Math.min(...items.map(item => item.y));

    const right = Math.max(
        ...items.map(item => item.x + item.width)
    );

    const bottom = Math.max(
        ...items.map(item => item.y + item.height)
    );

    return {
        x: Math.max(0, left - 0.006),
        y: Math.max(0, top - 0.008),
        width: Math.min(1 - left, right - left + 0.012),
        height: Math.min(1 - top, bottom - top + 0.016)
    };
}

// Verifica se uma alínea é uma pergunta de desenvolvimento.
// É importante fazer isto ANTES de procurar opções.
function isDevelopmentSubquestion(text) {
    const match = normalize(text).match(SUBQUESTION);

    if (!match) return false;

    const body = normalize(text.slice(match[0].length));

    return (
        hasDevelopmentCue(body) ||
        /[?？]/.test(body) ||
        /^(?:qual|quais|quem|quando|onde|como|porque|por que|what|which|who|when|where)\b/i.test(body)
    );
}

function findInlineOptions(text, line) {
    const matches = [
        ...text.matchAll(/(?:^|\s)(?:\(([a-h])\)|([a-h])\s*[\)\.])\s*/gi)
    ];

    if (matches.length < 2) return [];

    // Se o texto antes das opções já for um enunciado,
    // não devemos interpretar as alíneas como opções.
    const firstStart = matches[0].index;

    const questionPart = text.slice(0, firstStart);

    if (
        hasDevelopmentCue(questionPart) ||
        /[?？]/.test(questionPart)
    ) {
        return [];
    }

    const options = matches.map((match, index) => {
        const start = match.index + match[0].length;
        const end = matches[index + 1]?.index ?? text.length;

        return {
            label: (match[1] || match[2]).toUpperCase(),
            text: normalize(text.slice(start, end))
        };
    }).filter(option => option.text);

    if (options.length < 2) return [];

    for (let i = 1; i < options.length; i++) {
        if (
            options[i].label.charCodeAt(0) !==
            options[i - 1].label.charCodeAt(0) + 1
        ) {
            return [];
        }
    }

    return options.map(option => ({
        ...option,
        area: getOptionArea(line)
    }));
}

export function classifyDocument(documentData) {
    if (!documentData || !Array.isArray(documentData.pages)) {
        throw new Error("Estrutura do PDF inválida.");
    }

    return {
        pageCount: documentData.pageCount,

        pages: documentData.pages.map(page => ({
            ...page,

            lines: (page.lines || []).map(line => {
                const text = normalize(line.text);

                if (!text) {
                    return { ...line, type: "text" };
                }

                if (EXERCISE_TITLE.test(text)) {
                    return { ...line, type: "heading" };
                }

                // 1. Primeiro, reconhecer perguntas numeradas.
                if (QUESTION_NUMBER.test(text)) {
                    return { ...line, type: "question" };
                }

                // 2. Depois, reconhecer alíneas de desenvolvimento.
                if (isDevelopmentSubquestion(text)) {
                    return { ...line, type: "question" };
                }

                // 3. Só depois procurar opções de escolha múltipla.
                const inlineOptions = findInlineOptions(text, line);

                if (inlineOptions.length >= 2) {
                    return {
                        ...line,
                        type: "multiple_choice",
                        options: inlineOptions
                    };
                }

                const option = text.match(OPTION_START);

                if (option) {
                    return {
                        ...line,
                        type: "option",
                        options: [{
                            label: option[1].toUpperCase(),
                            text: normalize(option[2]),
                            area: getOptionArea(line)
                        }]
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

    let exercise = "Ficha de trabalho";
    let currentQuestion = null;

    function finishQuestion() {
        if (!currentQuestion) return;

        currentQuestion.text = normalize(currentQuestion.text);

        currentQuestion.options ||= [];

        if (currentQuestion.text) {
            questions.push(currentQuestion);
        }

        currentQuestion = null;
    }

    function startQuestion(line, page, text) {
        const sub = text.match(SUBQUESTION);

        currentQuestion = {
            id: `p${page.pageNumber}-q${questions.length + 1}`,
            exercise,
            label: sub ? sub[1].toUpperCase() : null,
            pageNumber: page.pageNumber,
            type: "development",
            text: getQuestionText(text),
            options: [],
            lines: [line]
        };
    }

    function addOptions(options) {
        if (!currentQuestion) return;

        for (const option of options || []) {
            const exists = currentQuestion.options.some(
                existing => existing.label === option.label
            );

            if (!exists) {
                currentQuestion.options.push(option);
            }
        }

        if (currentQuestion.options.length >= 2) {
            currentQuestion.type = "multiple_choice";
        }
    }

    for (const page of classifiedDocument.pages) {
        for (const line of page.lines) {
            const text = normalize(line.text);

            if (!text) continue;

            if (line.type === "heading") {
                finishQuestion();
                exercise = text;
                continue;
            }

            // Perguntas e alíneas têm prioridade sobre opções.
            if (line.type === "question") {
                finishQuestion();
                startQuestion(line, page, text);
                continue;
            }

            if (line.type === "multiple_choice") {
                if (!currentQuestion) {
                    startQuestion(line, page, text);
                } else {
                    currentQuestion.lines.push(line);
                }

                addOptions(line.options);
                continue;
            }

            if (line.type === "option") {
                if (currentQuestion) {
                    addOptions(line.options);
                    currentQuestion.lines.push(line);
                }

                continue;
            }

            // Texto de continuação do enunciado.
            if (currentQuestion) {
                currentQuestion.text += " " + text;
                currentQuestion.lines.push(line);
            }
        }
    }

    finishQuestion();

    questions.forEach((question, index) => {
        question.id ||= `q-${index + 1}`;

        if (question.options.length >= 2) {
            question.type = "multiple_choice";
        }
    });

    console.log("Perguntas identificadas:", questions);

    return questions;
}
