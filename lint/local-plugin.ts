import { definePlugin, defineRule } from '@oxlint/plugins'
import type { ESTree } from '@oxlint/plugins'

// Walks up the parent chain. Used instead of `sourceCode.getAncestors()`, which returns
// an untyped `Node[]`.
const hasAncestor = (node: ESTree.Node, test: (ancestor: ESTree.Node) => boolean): boolean =>
    node.parent !== null && (test(node.parent) || hasAncestor(node.parent, test))

// A function passed as the first argument to `new Promise(...)`.
const isPromiseExecutor = (node: ESTree.Node): boolean =>
    (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') &&
    node.parent.type === 'NewExpression' &&
    node.parent.callee.type === 'Identifier' &&
    node.parent.callee.name === 'Promise' &&
    node.parent.arguments[0] === node

// Flags every `throw` inside a Promise executor, including inside callbacks nested in it.
// Those nested throws are the dangerous ones: they don't reject the promise, they escape
// as uncaught exceptions and the promise never settles.
const noThrowInPromiseExecutor = defineRule({
    meta: {
        type: 'problem',
        messages: {
            throwInExecutor: 'Call `reject(...)` instead of throwing inside a Promise executor.',
        },
    },
    create(context) {
        return {
            ThrowStatement(node) {
                if (hasAncestor(node, isPromiseExecutor)) {
                    context.report({ node, messageId: 'throwInExecutor' })
                }
            },
        }
    },
})

const DISABLE_DIRECTIVE = /^\s*(?:eslint|oxlint)-disable(?:-next-line|-line)?(?=\s|$)/
const PROTECTED_RULES = new Set([
    'no-explicit-any',
    'no-unsafe-argument',
    'no-unsafe-assignment',
    'no-unsafe-call',
    'no-unsafe-member-access',
    'no-unsafe-return',
    'consistent-type-assertions',
    'no-non-null-assertion',
    'ban-ts-comment',
])

// True for a blanket disable (no rules listed), or one that names a type-safety rule or
// any rule in this plugin. Rule names match with or without their plugin prefix, so
// `no-explicit-any`, `typescript/no-explicit-any` and `@typescript-eslint/no-explicit-any`
// are all caught. Anything after ` -- ` is a description and is ignored.
const silencesTypeSafety = (comment: ESTree.Comment): boolean => {
    const directive = DISABLE_DIRECTIVE.exec(comment.value)
    if (directive === null) {
        return false
    }
    const [ruleList = ''] = comment.value.slice(directive[0].length).split(/\s-{2,}\s/)
    const rules = ruleList.split(',').map((rule) => rule.trim()).filter((rule) => rule !== '')
    return rules.length === 0 || rules.some((rule) =>
        rule.startsWith('local/') || PROTECTED_RULES.has(rule.slice(rule.lastIndexOf('/') + 1)))
}

const noTypeSafetySuppression = defineRule({
    meta: {
        type: 'problem',
        messages: {
            suppression: 'Do not disable the type-safety lint rules. Fix the code instead.',
        },
    },
    create(context) {
        return {
            Program() {
                context.sourceCode.getAllComments()
                    .filter(silencesTypeSafety)
                    .forEach((comment) => context.report({ node: comment, messageId: 'suppression' }))
            },
        }
    },
})

// `typescript/consistent-type-assertions` with `assertionStyle: 'never'` still allows
// `as const` and `<const>x`. This closes that gap.
const noAsConst = defineRule({
    meta: {
        type: 'suggestion',
        messages: {
            asConst: 'No `as`, not even `as const`. Annotate the binding with the exact type instead.',
        },
    },
    create(context) {
        const check = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void => {
            if (
                node.typeAnnotation.type === 'TSTypeReference' &&
                node.typeAnnotation.typeName.type === 'Identifier' &&
                node.typeAnnotation.typeName.name === 'const'
            ) {
                context.report({ node, messageId: 'asConst' })
            }
        }
        return { TSAsExpression: check, TSTypeAssertion: check }
    },
})

// Flags single-member interfaces (without `extends`) and function type aliases that are
// referenced exactly once in the file, so they should be inlined. Unused ones are left to
// `no-unused-vars`. Skipped, because they can't or shouldn't be inlined:
// - exported types (public API)
// - types named in `extends` or `implements` (those clauses need a name)
// - `declare` types, anything inside `declare global` / `declare module`, and .d.ts files
//   (they augment someone else's types)
const noTrivialType = defineRule({
    meta: {
        type: 'suggestion',
        messages: {
            singleMemberInterface: '`{{name}}` is a single-member interface used once. Inline it.',
            singleUseFunctionType: '`{{name}}` is a function type alias used once. Inline the signature.',
        },
    },
    create(context) {
        if (context.filename.endsWith('.d.ts')) {
            return {}
        }
        const candidates: Array<ESTree.TSInterfaceDeclaration | ESTree.TSTypeAliasDeclaration> = []
        const uses = new Map<string, number>()
        const mustStayNamed = new Set<string>()
        const use = (name: string): void => {
            uses.set(name, (uses.get(name) ?? 0) + 1)
        }
        const isLocal = (node: ESTree.TSInterfaceDeclaration | ESTree.TSTypeAliasDeclaration): boolean =>
            !node.declare &&
            node.parent.type !== 'ExportNamedDeclaration' &&
            node.parent.type !== 'ExportDefaultDeclaration' &&
            !hasAncestor(node, (ancestor) => ancestor.type === 'TSModuleDeclaration')

        return {
            TSInterfaceDeclaration(node) {
                if (node.body.body.length === 1 && node.extends.length === 0 && isLocal(node)) {
                    candidates.push(node)
                }
            },
            TSTypeAliasDeclaration(node) {
                if (node.typeAnnotation.type === 'TSFunctionType' && isLocal(node)) {
                    candidates.push(node)
                }
            },
            TSTypeReference(node) {
                if (node.typeName.type === 'Identifier') {
                    use(node.typeName.name)
                }
            },
            TSInterfaceHeritage(node) {
                if (node.expression.type === 'Identifier') {
                    mustStayNamed.add(node.expression.name)
                }
            },
            TSClassImplements(node) {
                if (node.expression.type === 'Identifier') {
                    mustStayNamed.add(node.expression.name)
                }
            },
            ExportSpecifier(node) {
                if (node.local.type === 'Identifier') {
                    mustStayNamed.add(node.local.name)
                }
            },
            'Program:exit'() {
                candidates
                    .filter(({ id }) => !mustStayNamed.has(id.name) && uses.get(id.name) === 1)
                    .forEach((declaration) => context.report({
                        node: declaration.id,
                        messageId: declaration.type === 'TSInterfaceDeclaration'
                            ? 'singleMemberInterface'
                            : 'singleUseFunctionType',
                        data: { name: declaration.id.name },
                    }))
            },
        }
    },
})

export default definePlugin({
    meta: { name: 'local' },
    rules: {
        'no-throw-in-promise-executor': noThrowInPromiseExecutor,
        'no-type-safety-suppression': noTypeSafetySuppression,
        'no-as-const': noAsConst,
        'no-trivial-type': noTrivialType,
    },
})
