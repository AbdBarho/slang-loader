export type DiagnosticSeverity = 'error' | 'warning' | 'note';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string | null;
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
  raw: string;
}

const HEADER = /^(?:(?:fatal|internal)\s+)?(error|warning|note)(?:\[(\w+)\])?:\s*(.*)$/;
const LOCATION = /^\s*-->\s*(.*?):(\d+):(\d+)\s*$/;

export function parseDiagnostics(text: string): Diagnostic[] {
  if (!text) return [];

  const lines = text.split('\n');
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < lines.length; i++) {
    const header = HEADER.exec(lines[i] ?? '');
    if (!header) continue;

    const location = LOCATION.exec(lines[i + 1] ?? '');
    diagnostics.push({
      severity: header[1] as DiagnosticSeverity,
      code: header[2] ?? null,
      message: header[3] ?? '',
      file: location?.[1] ?? null,
      line: location ? Number(location[2]) : null,
      column: location ? Number(location[3]) : null,
      raw: lines[i] ?? '',
    });
  }

  return diagnostics;
}

export function firstErrorLocation(diagnostics: Diagnostic[]): Diagnostic | undefined {
  return diagnostics.find(d => d.severity === 'error' && d.line !== null);
}
