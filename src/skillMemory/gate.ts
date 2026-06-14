import type { Command } from '../types/command.js'

export type SkillGateDecision = 'reuse' | 'merge' | 'create'

export type SkillGateCandidate = {
  name: string
  description?: string
  whenToUse?: string
}

export type SkillGateMatch = {
  skillName: string
  score: number
  reason: string
}

export type SkillGateResult = {
  decision: SkillGateDecision
  bestMatch?: SkillGateMatch
}

const REUSE_THRESHOLD = 0.88
const MERGE_THRESHOLD = 0.72

function tokenize(value: string | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(
    value
      .toLowerCase()
      .normalize('NFC')
      .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  return intersection / (a.size + b.size - intersection)
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function commandToCandidate(command: Command): SkillGateCandidate {
  return {
    name: command.name,
    description: command.description,
    whenToUse: command.whenToUse,
  }
}

export function scoreSkillSimilarity(
  candidate: SkillGateCandidate,
  existing: SkillGateCandidate,
): SkillGateMatch {
  const candidateName = normalizeName(candidate.name)
  const existingName = normalizeName(existing.name)
  const nameScore =
    candidateName === existingName
      ? 1
      : jaccard(tokenize(candidateName.replace(/-/g, ' ')), tokenize(existingName.replace(/-/g, ' ')))

  const candidateText = [candidate.description, candidate.whenToUse].join(' ')
  const existingText = [existing.description, existing.whenToUse].join(' ')
  const textScore = jaccard(tokenize(candidateText), tokenize(existingText))
  const score = Math.max(nameScore, textScore)

  return {
    skillName: existing.name,
    score,
    reason:
      nameScore >= textScore
        ? 'similar skill name'
        : 'similar description or when_to_use',
  }
}

export function evaluateSkillCreationCandidate(params: {
  candidate: SkillGateCandidate
  existingSkills: Array<Command | SkillGateCandidate>
}): SkillGateResult {
  let bestMatch: SkillGateMatch | undefined

  for (const existing of params.existingSkills) {
    const comparable = 'type' in existing ? commandToCandidate(existing) : existing
    const match = scoreSkillSimilarity(params.candidate, comparable)
    if (!bestMatch || match.score > bestMatch.score) {
      bestMatch = match
    }
  }

  if (!bestMatch) return { decision: 'create' }
  if (bestMatch.score >= REUSE_THRESHOLD) {
    return { decision: 'reuse', bestMatch }
  }
  if (bestMatch.score >= MERGE_THRESHOLD) {
    return { decision: 'merge', bestMatch }
  }
  return { decision: 'create', bestMatch }
}
