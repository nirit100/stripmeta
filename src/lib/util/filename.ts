/**
 * Splits a filename for middle-ellipsis display: the head truncates with an
 * ellipsis while the tail (last `tailLen` chars of the basename plus the full
 * extension) always stays visible, so e.g. "IMG_20260101_vacation.jpg" keeps
 * its "tion.jpg" suffix readable when space is tight.
 *
 * The extension is only recognised when the dot is interior (not a leading dot,
 * not a trailing dot), matching how dotfiles and trailing-dot names are treated
 * as having no extension.
 */
export function splitFilename(name: string, tailLen = 4): { head: string; tail: string } {
  const lastDot = name.lastIndexOf('.');
  const hasExt  = lastDot > 0 && lastDot < name.length - 1;
  const ext  = hasExt ? name.slice(lastDot) : '';
  const base = hasExt ? name.slice(0, lastDot) : name;

  const head = base.length > tailLen ? base.slice(0, -tailLen) : '';
  const tail = (base.length > tailLen ? base.slice(-tailLen) : base) + ext;
  return { head, tail };
}
