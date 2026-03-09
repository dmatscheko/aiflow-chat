"""Playwright tests for js/tool-processor.js: parseToolCalls."""

from playwright.sync_api import expect


def test_js_tool_parser(page):
    errors = page.evaluate("""async () => {
        const { parseToolCalls } = await import('/js/tool-processor.js');
        const errors = [];
        function assert(cond, msg) { if (!cond) errors.push(msg); }

        // --- self-closing tags ---
        {
            const { toolCalls, isSelfClosings } = parseToolCalls('<dma:tool_call name="get_datetime"/>');
            assert(toolCalls.length === 1, 'self-closing: 1 call');
            assert(toolCalls[0].name === 'get_datetime', 'self-closing: name');
            assert(Object.keys(toolCalls[0].params).length === 0, 'self-closing: no params');
            assert(isSelfClosings[0] === true, 'self-closing: flag');
        }
        {
            const { toolCalls } = parseToolCalls('<dma:tool_call name="my_tool" extra="ignored"/>');
            assert(toolCalls.length === 1, 'self-closing extra attrs: 1 call');
            assert(toolCalls[0].name === 'my_tool', 'self-closing extra attrs: name');
        }

        // --- tags with content / parameters ---
        {
            const content = '<dma:tool_call name="fetch_web_page">\\n<parameter name="url">https://example.com</parameter>\\n</dma:tool_call>';
            const { toolCalls, isSelfClosings } = parseToolCalls(content);
            assert(toolCalls.length === 1, 'params: 1 call');
            assert(toolCalls[0].name === 'fetch_web_page', 'params: name');
            assert(toolCalls[0].params.url === 'https://example.com', 'params: url value');
            assert(isSelfClosings[0] === false, 'params: not self-closing');
        }
        {
            const content = '<dma:tool_call name="write_file">\\n<parameter name="path">/a/test.txt</parameter>\\n<parameter name="content">Hello World</parameter>\\n</dma:tool_call>';
            const { toolCalls } = parseToolCalls(content);
            assert(toolCalls[0].params.path === '/a/test.txt', 'multi params: path');
            assert(toolCalls[0].params.content === 'Hello World', 'multi params: content');
        }
        {
            const content = '<dma:tool_call name="write_file">\\n<parameter name="content">line 1\\nline 2\\nline 3</parameter>\\n</dma:tool_call>';
            const { toolCalls } = parseToolCalls(content);
            assert(toolCalls[0].params.content.includes('line 1'), 'multiline: has line 1');
            assert(toolCalls[0].params.content.includes('line 3'), 'multiline: has line 3');
        }

        // --- multiple tool calls ---
        {
            const content = 'Text before\\n<dma:tool_call name="get_datetime"/>\\nMiddle\\n<dma:tool_call name="fetch_web_page">\\n<parameter name="url">https://example.com</parameter>\\n</dma:tool_call>';
            const { toolCalls, positions } = parseToolCalls(content);
            assert(toolCalls.length === 2, 'multiple: 2 calls');
            assert(toolCalls[0].name === 'get_datetime', 'multiple: first name');
            assert(toolCalls[1].name === 'fetch_web_page', 'multiple: second name');
            assert(positions.length === 2, 'multiple: 2 positions');
        }

        // --- positions ---
        {
            const tag = '<dma:tool_call name="test"/>';
            const content = 'prefix ' + tag + ' suffix';
            const { positions } = parseToolCalls(content);
            assert(positions.length === 1, 'positions: 1 entry');
            assert(content.slice(positions[0].start, positions[0].end) === tag, 'positions: correct slice');
        }

        // --- type coercion ---
        {
            const tools = [{
                name: 'my_tool',
                inputSchema: {
                    properties: {
                        count: { type: 'integer' },
                        ratio: { type: 'number' },
                        enabled: { type: 'boolean' },
                        label: { type: 'string' },
                    }
                }
            }];

            const mkContent = (paramName, paramValue) =>
                '<dma:tool_call name="my_tool">\\n<parameter name="' + paramName + '">' + paramValue + '</parameter>\\n</dma:tool_call>';

            {
                const { toolCalls } = parseToolCalls(mkContent('count', '42'), tools);
                assert(toolCalls[0].params.count === 42, 'coerce integer');
                assert(typeof toolCalls[0].params.count === 'number', 'coerce integer type');
            }
            {
                const { toolCalls } = parseToolCalls(mkContent('ratio', '3.14'), tools);
                assert(Math.abs(toolCalls[0].params.ratio - 3.14) < 0.001, 'coerce float');
            }
            {
                const { toolCalls } = parseToolCalls(mkContent('enabled', 'true'), tools);
                assert(toolCalls[0].params.enabled === true, 'coerce bool true');
            }
            {
                const { toolCalls } = parseToolCalls(mkContent('enabled', 'false'), tools);
                assert(toolCalls[0].params.enabled === false, 'coerce bool false');
            }
            {
                const { toolCalls } = parseToolCalls(mkContent('count', ''), tools);
                assert(toolCalls[0].params.count === null, 'empty integer -> null');
            }
            {
                const { toolCalls } = parseToolCalls(mkContent('count', 'abc'), tools);
                assert(toolCalls[0].params.count === null, 'non-numeric integer -> null');
            }
            {
                const { toolCalls } = parseToolCalls(mkContent('label', 'Hello World'), tools);
                assert(toolCalls[0].params.label === 'Hello World', 'string unchanged');
            }
        }

        // --- edge cases ---
        {
            assert(parseToolCalls(null).toolCalls.length === 0, 'null content -> empty');
            assert(parseToolCalls('').toolCalls.length === 0, 'empty string -> empty');
            assert(parseToolCalls('Just normal text.').toolCalls.length === 0, 'no tools -> empty');
            assert(parseToolCalls('<dma:tool_call other="val"/>').toolCalls.length === 0, 'no name attr -> skip');
        }
        {
            const content = '<dma:tool_call name="test">\\n<parameter name="code">some <\\\\/dma:tool_call> text</parameter>\\n</dma:tool_call>';
            const { toolCalls } = parseToolCalls(content);
            assert(toolCalls.length === 1, 'escaped closing: 1 call');
            assert(toolCalls[0].params.code.includes('</dma:tool_call>'), 'escaped closing: unescaped in param');
        }
        {
            const { toolCalls } = parseToolCalls('<dma:tool_call name="a"/><dma:tool_call name="b"/>');
            assert(toolCalls[0].id !== toolCalls[1].id, 'unique IDs');
        }

        return errors;
    }""")

    assert errors == [], f"JS parseToolCalls tests failed:\n" + "\n".join(errors)

    page.screenshot(path="test-results/verification_js_tool_parser.png")
