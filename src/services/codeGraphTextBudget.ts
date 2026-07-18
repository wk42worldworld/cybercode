export function estimateCodeGraphTokens(text: string) {
  let ascii = 0
  let nonAscii = 0
  for (const character of text) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1
    else nonAscii += 1
  }
  return Math.ceil(ascii / 4 + nonAscii * 1.25)
}

export function limitTextToTokenBudget(text: string, tokenBudget: number) {
  const budget = Math.max(64, Math.round(tokenBudget))
  if (estimateCodeGraphTokens(text) <= budget) return text
  const footer = '\n\n[Code Graph context truncated to the requested token budget. Refine the query for more.]'
  const bodyBudget = Math.max(1, budget - estimateCodeGraphTokens(footer))
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateCodeGraphTokens(text.slice(0, middle)) <= bodyBudget) low = middle
    else high = middle - 1
  }
  const candidate = text.slice(0, low)
  const newline = candidate.lastIndexOf('\n')
  const body = (newline > candidate.length * 0.72 ? candidate.slice(0, newline) : candidate).trimEnd()
  return `${body}${footer}`
}
