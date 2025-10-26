/* Process inline math */
/*
Adapted from markdown-it-katex@2.0.3 to support custom delimiters and allow spaces inside math expressions.

Source: https://app.unpkg.com/markdown-it-katex@2.0.3/files/index.js

Like markdown-it-simplemath, this is a stripped down, simplified version of:
https://github.com/runarberg/markdown-it-math

It differs in that it takes (a subset of) LaTeX as input and relies on KaTeX
for rendering output.
*/

const katex = window.katex;

function general_math_inline(left, right, name, valid_open = () => true, valid_close = () => true) {
    return function(state, silent) {
        const startPos = state.pos;
        if (!state.src.startsWith(left, startPos)) { return false; }

        if (!valid_open(state, startPos)) {
            if (!silent) { state.pending += left; }
            state.pos += left.length;
            return true;
        }

        const start = state.pos + left.length;
        let match = start;
        while ((match = state.src.indexOf(right, match)) !== -1) {
            let pos = match - 1;
            let esc_count = 0;
            while (pos >= 0 && state.src[pos] === '\\') {
                esc_count++;
                pos--;
            }
            if (esc_count % 2 === 1) {
                match += right.length;
                continue;
            }

            if (!valid_close(state, match)) {
                match += right.length;
                continue;
            }

            break;
        }

        if (match === -1) {
            if (!silent) { state.pending += left; }
            state.pos = start;
            return true;
        }

        if (match - start === 0) {
            if (!silent) { state.pending += left + right; }
            state.pos = start;
            return true;
        }

        if (!silent) {
            const token = state.push(name, 'math', 0);
            token.markup = left;
            token.content = state.src.slice(start, match);
        }

        state.pos = match + right.length;
        return true;
    };
}

function general_math_block(left, right, name) {
    return function(state, start, end, silent) {
        let firstLine, lastLine, next, lastPos, found = false, token,
            pos = state.bMarks[start] + state.tShift[start],
            max = state.eMarks[start];

        if (pos + left.length > max) { return false; }
        if (state.src.slice(pos, pos + left.length) !== left) { return false; }

        pos += left.length;
        firstLine = state.src.slice(pos, max);

        if (silent) { return true; }
        if (firstLine.trim().slice(-right.length) === right) {
            firstLine = firstLine.trim().slice(0, -right.length);
            found = true;
        }

        for (next = start; !found; ) {
            next++;
            if (next >= end) { break; }

            pos = state.bMarks[next] + state.tShift[next];
            max = state.eMarks[next];

            if (pos < max && state.tShift[next] < state.blkIndent) {
                break;
            }

            if (state.src.slice(pos, max).trim().slice(-right.length) === right) {
                lastPos = state.src.slice(0, max).lastIndexOf(right);
                lastLine = state.src.slice(pos, lastPos);
                found = true;
            }
        }

        state.line = next + 1;

        token = state.push(name, 'math', 0);
        token.block = true;
        token.content = (firstLine && firstLine.trim() ? firstLine + '\n' : '')
            + state.getLines(start + 1, next, state.tShift[start], true)
            + (lastLine && lastLine.trim() ? lastLine : '');
        token.map = [start, state.line];
        token.markup = left;
        return true;
    };
}

export default function math_plugin(md, options) {
    options = options || {};

    const delimiters = options.delimiters || [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\begin{equation}', right: '\\end{equation}', display: true }
    ];

    delimiters.forEach((d, i) => {
        const ruleName = (d.display ? 'math_block_' : 'math_inline_') + i;
        if (!d.display) {
            let valid_open = () => true;
            let valid_close = () => true;
            if (d.left === '$') {
                valid_open = (state, pos) => {
                    const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
                    return !(prevChar >= 0x30 && prevChar <= 0x39);
                };
                valid_close = (state, pos) => {
                    const nextChar = pos + 1 <= state.posMax ? state.src.charCodeAt(pos + 1) : -1;
                    return !(nextChar >= 0x30 && nextChar <= 0x39);
                };
            }
            md.inline.ruler.after('escape', ruleName, general_math_inline(d.left, d.right, 'math_inline', valid_open, valid_close));
        } else {
            md.block.ruler.after('blockquote', ruleName, general_math_block(d.left, d.right, 'math_block'), {
                alt: ['paragraph', 'reference', 'blockquote', 'list']
            });
        }
    });

    const katexInline = (latex) => {
        options.displayMode = false;
        try {
            if (options.preProcess) {
                latex = options.preProcess(latex);
            }
            return katex.renderToString(latex, options);
        } catch (error) {
            if (options.throwOnError) { console.log(error); }
            return latex;
        }
    };

    const inlineRenderer = (tokens, idx) => katexInline(tokens[idx].content);

    const katexBlock = (latex) => {
        options.displayMode = true;
        try {
            if (options.preProcess) {
                latex = options.preProcess(latex);
            }
            return `<p>${katex.renderToString(latex, options)}</p>`;
        } catch (error) {
            if (options.throwOnError) { console.log(error); }
            return latex;
        }
    };

    const blockRenderer = (tokens, idx) => katexBlock(tokens[idx].content) + '\n';

    md.renderer.rules.math_inline = inlineRenderer;
    md.renderer.rules.math_block = blockRenderer;
};
