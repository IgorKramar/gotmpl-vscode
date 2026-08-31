// Extension entry point. VS Code loads this as CommonJS.
//
// Deliberately thin: it registers providers and translates results produced by
// the pure modules into editor API objects. No branching lives here, because
// nothing here can be reached by the test run.
const vscode = require("vscode");
const { resolveAt } = require("./cursor.js");
const { hoverFor } = require("./hover.js");
const { completionsFor } = require("./completion.js");
const { analyze, endInsertionPoint, MESSAGES } = require("./diagnostics.js");

const LANGUAGE = "yaml-gotmpl";

/** Suggestion kind -> editor kind. A table, so the provider decides nothing. */
const COMPLETION_KIND = {
  snippet: vscode.CompletionItemKind.Snippet,
  function: vscode.CompletionItemKind.Function,
  keyword: vscode.CompletionItemKind.Keyword,
};

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection(LANGUAGE);
  context.subscriptions.push(diagnostics);

  /** @param {vscode.TextDocument} document */
  const refresh = (document) => {
    if (document.languageId !== LANGUAGE) return;
    diagnostics.set(
      document.uri,
      analyze(document.getText()).map((finding) => {
        const range = new vscode.Range(finding.line, finding.start, finding.line, finding.end);
        return new vscode.Diagnostic(range, finding.message, vscode.DiagnosticSeverity.Error);
      }),
    );
  };

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(LANGUAGE, {
      provideCodeActions(document, range, actionContext) {
        return actionContext.diagnostics.flatMap((diagnostic) => {
          if (!diagnostic.message.startsWith("Unclosed `")) return [];
          const where = endInsertionPoint(document.getText(), diagnostic.range.start.line);
          if (!where) return [];

          const fix = new vscode.CodeAction("Add {{ end }}", vscode.CodeActionKind.QuickFix);
          fix.edit = new vscode.WorkspaceEdit();
          fix.edit.insert(
            document.uri,
            new vscode.Position(where.line, 0),
            `${where.indent}{{ end }}\n`,
          );
          fix.diagnostics = [diagnostic];
          return [fix];
        });
      },
    }),
  );

  vscode.workspace.textDocuments.forEach(refresh);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => refresh(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(LANGUAGE, {
      provideHover(document, position) {
        const line = document.lineAt(position.line).text;
        const token = resolveAt(line, position.character);
        const markdown = hoverFor(token);
        if (!markdown || !token) return undefined;
        const range = new vscode.Range(
          position.line,
          token.start,
          position.line,
          token.end,
        );
        return new vscode.Hover(new vscode.MarkdownString(markdown), range);
      },
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(LANGUAGE, {
      provideCompletionItems(document, position) {
        const line = document.lineAt(position.line).text;
        return completionsFor(line, position.character).map((suggestion) => {
          const item = new vscode.CompletionItem(suggestion.label, COMPLETION_KIND[suggestion.kind]);
          item.detail = suggestion.detail;
          item.documentation = new vscode.MarkdownString(suggestion.documentation);
          if (suggestion.snippet) item.insertText = new vscode.SnippetString(suggestion.snippet);
          return item;
        });
      },
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
