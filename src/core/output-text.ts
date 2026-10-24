/** Images are delivered as channel attachments, never as text links. */
export function stripImageReferences(text:string, imageIds:readonly string[]):string {
  if (!imageIds.length) return text;
  return text
    .replace(/!\[[^\]]*\]\([^\n]*?\)/g,'')
    .replace(/!?\[[^\]]*\]\(asset:\/\/[^\s)]+\)/g,'')
    .replace(/asset:\/\/[^\s<>`）)]+/g,'')
    .replace(/\n[ \t]+\n/g,'\n\n')
    .replace(/\n{3,}/g,'\n\n').trim();
}
