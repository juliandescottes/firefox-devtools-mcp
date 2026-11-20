export interface PageInfo {
  title?: string;
  url?: string;
}

export function formatPageLine(page: PageInfo, idx: number, selectedIdx: number | null): string {
  const marker = idx === selectedIdx ? '>' : ' ';
  const title = (page.title || 'Untitled').substring(0, 40);
  const url = (page.url || 'URL unavailable').substring(0, 200);
  return `${marker}[${idx}] ${title} (${url})`;
}

export function formatPageList(pages: PageInfo[], selectedIdx: number | null): string {
  if (pages.length === 0) {
    return 'No pages';
  }
  const lines: string[] = [
    `${pages.length} pages (selected: ${selectedIdx ?? 'privileged context'})`,
  ];
  pages.forEach((page, idx) => lines.push(formatPageLine(page, idx, selectedIdx)));
  return lines.join('\n');
}
