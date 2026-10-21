import type { CSSRuleDefinition } from '@eslint/css'
import { tokenize, tokenTypes } from '@eslint/css-tree'
import type { ESLint } from 'eslint'
import { ABSOLUTE_UNIT_MESSAGE, isAbsoluteUnit } from './absolute-units.ts'

// ESLint rules for src/styles.css that eslint-cssicorn and @eslint/css don't have.

// The number at the front of a dimension token such as `-0.5px` or `1e3px`.
const NUMBER = /^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/i

const noAbsoluteUnits: CSSRuleDefinition<{ RuleOptions: []; MessageIds: 'absoluteUnit' }> = {
    meta: {
        type: 'problem',
        docs: { description: 'Disallow absolute length units.' },
        messages: { absoluteUnit: ABSOLUTE_UNIT_MESSAGE },
    },
    create(context) {
        return {
            Dimension(node) {
                if (isAbsoluteUnit(node.unit)) {
                    context.report({ node, messageId: 'absoluteUnit', data: { value: `${node.value}${node.unit}` } })
                }
            },
            // Custom property values, which include every @theme token, reach rules as
            // unparsed text, so their dimensions are found by tokenizing it. The tokenizer
            // skips strings, url()s and comments.
            Raw(node) {
                const [rawStart] = context.sourceCode.getRange(node)
                tokenize(node.value, (type, start, end) => {
                    const token = node.value.slice(start, end)
                    if (type === tokenTypes.Dimension && isAbsoluteUnit(token.replace(NUMBER, ''))) {
                        context.report({
                            loc: {
                                start: context.sourceCode.getLocFromIndex(rawStart + start),
                                end: context.sourceCode.getLocFromIndex(rawStart + end),
                            },
                            messageId: 'absoluteUnit',
                            data: { value: token },
                        })
                    }
                })
            },
        }
    },
}

const plugin: ESLint.Plugin = {
    meta: { name: 'local' },
    rules: { 'no-absolute-units': noAbsoluteUnits },
}

export default plugin
