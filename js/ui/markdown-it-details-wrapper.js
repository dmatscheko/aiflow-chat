// Markdown-it plugin to wrap custom tags into <details> elements
//
export default function details_wrapper_plugin(md, options) {
    options = options || {};
    const tags = options.tags || [
        {
            tag: 'think',
            className: 'think',
            summary: 'Thinking',
            attrForTitle: null,
            whole: false,
            contentType: 'text',
            contentWrapper: 'div class="think-content"'
        }
    ];

    function makeBlockRule(config) {
        const tag = config.tag;
        const openingPrefix = '<' + tag;
        const closing = '</' + tag + '>';

        return function(state, start, end, silent) {
            let pos = state.bMarks[start] + state.tShift[start];
            let max = state.eMarks[start];

            if (!state.src.startsWith(openingPrefix, pos)) return false;

            let attrEnd = state.src.indexOf('>', pos + openingPrefix.length);
            if (attrEnd === -1) return false;

            let attrsStr = state.src.slice(pos + openingPrefix.length, attrEnd);

            let title = '';
            if (config.attrForTitle) {
                const match = attrsStr.match(/\sname="([^"]*)"/);
                if (match) title = match[1].trim();
            }

            const openingStart = pos;
            let openingLength = attrEnd - pos + 1;

            let isSelfClosing = false;
            if (state.src.charCodeAt(attrEnd - 1) === 0x2F /* / */) {
                isSelfClosing = true;
            }

            pos = attrEnd + 1;

            if (silent) return true;

            let firstLine = '', lastLine = '', found = isSelfClosing, lastPos;
            let next = start;
            if (!isSelfClosing) {
                let lineMax = state.eMarks[start];
                let firstLineStart = pos;
                firstLine = state.src.slice(pos, lineMax);
                let closingIndex = firstLine.lastIndexOf(closing);
                if (closingIndex !== -1) {
                    let after = firstLine.slice(closingIndex + closing.length);
                    if (after.trim() === '') {
                        firstLine = firstLine.slice(0, closingIndex);
                        found = true;
                    }
                }

                for (; !found; ) {
                    next++;
                    if (next >= end) break;

                    pos = state.bMarks[next] + state.tShift[next];
                    max = state.eMarks[next];

                    if (pos < max && state.tShift[next] < state.blkIndent) break;

                    let lineContent = state.src.slice(pos, max);
                    let closingIndex = lineContent.lastIndexOf(closing);
                    if (closingIndex !== -1) {
                        let after = lineContent.slice(closingIndex + closing.length);
                        if (after.trim() === '') {
                            lastPos = pos + closingIndex;
                            lastLine = state.src.slice(pos, lastPos);
                            found = true;
                        }
                    }
                }
            }

            state.line = next + (found ? 1 : 0);

            const token = state.push('custom_details_' + tag.replace(':', '_'), '', 0);
            token.block = true;
            let contentParts = [];
            if (firstLine.trim() !== '') {
                contentParts.push(firstLine);
            }
            let intermediate = '';
            if (start + 1 < next) {
                intermediate = state.getLines(start + 1, next, state.tShift[start], false);
            }
            if (intermediate) {
                contentParts.push(intermediate);
            }
            if (lastLine.trim() !== '') {
                contentParts.push(lastLine);
            }
            token.content = contentParts.join('\n');
            token.map = [start, state.line];
            token.meta = {
                closed: found || isSelfClosing,
                title: title,
                rawOpening: state.src.slice(openingStart, openingStart + openingLength),
                rawClosing: isSelfClosing ? '' : (found ? closing : ''),
                config: config
            };

            return true;
        };
    }

    tags.forEach(config => {
        const ruleName = 'custom_details_' + config.tag.replace(':', '_');
        md.block.ruler.after('blockquote', ruleName, makeBlockRule(config), {
            alt: ['paragraph', 'reference', 'blockquote', 'list']
        });
        md.renderer.rules[ruleName] = function(tokens, idx /*, options, env, slf */) {
            const token = tokens[idx];
            const meta = token.meta;
            const config = meta.config;

            let fullRaw = meta.rawOpening + token.content + meta.rawClosing;
            let codeContent = (config.whole ? fullRaw : token.content).trim();
            const lang = config.contentType;
            const codeMd = '```' + lang + '\n' + codeContent + '\n```';
            let codeHtml = md.render(codeMd);

            let wrappedContent = config.contentWrapper
                ? `<${config.contentWrapper}>${codeHtml}</${config.contentWrapper.split(' ')[0]}>`
                : codeHtml;

            const detailsOpen = meta.closed ? '' : ' open';
            const summaryTitle = meta.title ? ': ' + meta.title : '';

            return `<details${detailsOpen} class="${config.className}"><summary>${config.summary}${summaryTitle}</summary>${wrappedContent}</details>`;
        };
    });
};
