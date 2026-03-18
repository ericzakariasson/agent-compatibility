export function slugify(input) {
  return String(input).trim().toLowerCase().replace(/\s+/g, "-");
}
