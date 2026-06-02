export interface ParsedFile {
  path: string;
  hunkLines: HunkLine[];
}

export interface HunkLine {
  type: 'add' | 'del' | 'context';
  content: string;
  newLineNo: number; // -1 for deleted lines
}

/**
 * Parses a GitHub pull request file patch (unified diff without the diff --git header)
 * into a structured list of hunk lines with correct new-file line numbers.
 */
export function parsePatch(filename: string, patch: string | undefined): ParsedFile {
  const hunkLines: HunkLine[] = [];
  if (!patch) return { path: filename, hunkLines };

  const lines = patch.split('\n');
  let newLineNo = 0;

  for (const line of lines) {
    // "\ No newline at end of file" marker — skip, do not increment counter
    if (line.startsWith('\\ ')) continue;

    if (line.startsWith('@@')) {
      // @@ -oldStart[,oldLen] +newStart[,newLen] @@
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) newLineNo = parseInt(m[1], 10) - 1;
      continue;
    }

    if (line.startsWith('+')) {
      newLineNo++;
      hunkLines.push({ type: 'add', content: line.slice(1), newLineNo });
    } else if (line.startsWith('-')) {
      hunkLines.push({ type: 'del', content: line.slice(1), newLineNo: -1 });
    } else {
      newLineNo++;
      hunkLines.push({ type: 'context', content: line.slice(1), newLineNo });
    }
  }

  return { path: filename, hunkLines };
}

/**
 * Builds a snippet of up to 21 lines centred around the given new-file line number,
 * using surrounding context/add/del lines from the hunk for rich context.
 */
export function buildSnippet(hunkLines: HunkLine[], targetLineNo: number): string {
  const idx = hunkLines.findIndex(
    l => l.newLineNo === targetLineNo && l.type === 'add'
  );
  const pivot = idx !== -1
    ? idx
    : hunkLines.findIndex(l => l.newLineNo === targetLineNo);

  if (pivot === -1) return '';

  const start = Math.max(0, pivot - 10);
  const end = Math.min(hunkLines.length - 1, pivot + 10);
  return hunkLines
    .slice(start, end + 1)
    .map(l => l.content)
    .join('\n')
    .slice(0, 1500);
}

/**
 * Splits the full list of added lines across all files into chunks of at most
 * maxLinesPerChunk entries. Useful for rate-limit-aware LLM batching.
 */
export function chunkAddedLines(
  files: ParsedFile[],
  maxLinesPerChunk: number
): Array<Array<{ file: ParsedFile; lineNo: number; content: string }>> {
  const items: Array<{ file: ParsedFile; lineNo: number; content: string }> = [];
  for (const file of files) {
    for (const line of file.hunkLines) {
      if (line.type === 'add') {
        items.push({ file, lineNo: line.newLineNo, content: line.content });
      }
    }
  }

  const chunks: typeof items[] = [];
  for (let i = 0; i < items.length; i += maxLinesPerChunk) {
    chunks.push(items.slice(i, i + maxLinesPerChunk));
  }
  return chunks;
}
