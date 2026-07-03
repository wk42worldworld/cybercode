import { useMemo, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'
import { Icon } from '../shared/Icon'

type QuestionOption = {
  label: string
  description?: string
}

type Question = {
  question: string
  header?: string
  options?: QuestionOption[]
}

type AskUserInput = {
  questions?: Question[]
  question?: string
  options?: QuestionOption[]
}

type Props = {
  toolUseId: string
  input: unknown
  result?: unknown
}

type QuestionAnswer = {
  type: 'option' | 'custom'
  value: string
}

/**
 * Parse the AskUserQuestion input which may come in different shapes.
 */
function parseInput(input: unknown): Question[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as AskUserInput

  // Shape 1: { questions: [...] }
  if (Array.isArray(obj.questions)) {
    return obj.questions
  }

  // Shape 2: { question: "...", options: [...] }
  if (typeof obj.question === 'string') {
    return [{ question: obj.question, options: obj.options }]
  }

  return []
}

export function AskUserQuestion({ toolUseId, input, result }: Props) {
  const { respondToPermission } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const pendingPermission = useChatStore((s) => activeTabId ? s.sessions[activeTabId]?.pendingPermission : undefined)
  const t = useTranslation()
  const questions = parseInput(input)
  const inputObject = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const [activeTab, setActiveTab] = useState(0)
  const [answersByIndex, setAnswersByIndex] = useState<Record<number, QuestionAnswer>>({})
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const composingRef = useRef(false)

  if (questions.length === 0) return null

  const resultAnswers = useMemo(() => {
    if (!result || typeof result !== 'object') return {}
    const answers = (result as { answers?: unknown }).answers
    return answers && typeof answers === 'object'
      ? answers as Record<string, string>
      : {}
  }, [result])

  const pendingRequest = pendingPermission?.toolUseId === toolUseId ? pendingPermission : null
  const answeredText = useMemo(() => {
    if (Object.keys(resultAnswers).length > 0) {
      return questions
        .map((question) => resultAnswers[question.question])
        .filter((answer): answer is string => typeof answer === 'string' && answer.trim().length > 0)
        .join(', ')
    }
    return Object.values(answersByIndex)
      .map((answer) => answer.value.trim())
      .filter(Boolean)
      .join(', ')
  }, [answersByIndex, questions, resultAnswers])
  const submitted = Object.keys(resultAnswers).length > 0 || hasSubmitted

  const handleSelect = (qIndex: number, label: string) => {
    if (submitted) return
    setAnswersByIndex((prev) => {
      // Toggle: deselect if already selected
      if (prev[qIndex]?.type === 'option' && prev[qIndex]?.value === label) {
        const next = { ...prev }
        delete next[qIndex]
        return next
      }
      return { ...prev, [qIndex]: { type: 'option', value: label } }
    })
  }

  const handleCustomChange = (qIndex: number, value: string) => {
    if (submitted) return
    setAnswersByIndex((prev) => {
      const next = { ...prev }
      if (value.trim()) {
        next[qIndex] = { type: 'custom', value }
      } else if (next[qIndex]?.type === 'custom') {
        delete next[qIndex]
      }
      return next
    })
  }

  const handleSubmit = () => {
    if (submitted) return

    if (!allAnswered) return

    if (!activeTabId || !pendingRequest) return

    const answers = questions.reduce<Record<string, string>>((acc, question, index) => {
      const answer = answersByIndex[index]?.value.trim()
      if (answer) {
        acc[question.question] = answer
      }
      return acc
    }, {})

    setHasSubmitted(true)
    respondToPermission(activeTabId, pendingRequest.requestId, true, {
      updatedInput: {
        ...inputObject,
        answers,
      },
    })
  }

  // All questions must be answered (via selection or free text) to enable submit
  const allAnswered = questions.every((_, i) => answersByIndex[i]?.value.trim())
  const safeActiveTab = Math.min(activeTab, questions.length - 1)
  const activeQuestion = questions[safeActiveTab]
  const activeAnswer = answersByIndex[safeActiveTab]

  if (!activeQuestion) return null

  return (
    <div className={`mb-4 rounded-[var(--radius-lg)] border overflow-hidden ${
      submitted
        ? 'border-[var(--color-border)] bg-[var(--color-surface-container-low)] opacity-70'
        : 'border-[var(--color-brand)] bg-[var(--color-surface-container-lowest)]'
    }`} style={!submitted ? { boxShadow: '0 0 12px var(--color-accent-glow)' } : undefined}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 ${
        submitted
          ? 'bg-[var(--color-surface-container-low)]'
          : 'bg-[var(--color-surface-container)]'
      }`}>
        <div className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-accent-glow)]">
          <Icon name="help" size={18} className="text-[var(--color-brand)]" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">
            {t('question.needsInput')}
          </span>
          {submitted && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)]">
              {t('question.answered')}
            </span>
          )}
        </div>
      </div>

      {/* Question tabs — horizontal tab bar (only show when multiple questions) */}
      {questions.length > 1 && (
        <div className="flex px-4 border-b border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] overflow-x-auto">
          {questions.map((q, i) => {
            const isActive = safeActiveTab === i
            const isAnswered = Boolean(answersByIndex[i]?.value.trim())
            const tabLabel = q.header || `Q${i + 1}`
            return (
              <button
                key={i}
                onClick={() => setActiveTab(i)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'text-[var(--color-brand)]'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {isAnswered && (
                  <Icon name="check_circle" size={14} className="text-[var(--color-success)]" />
                )}
                {tabLabel}
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2 h-[2px] bg-[var(--color-brand)] rounded-t" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Active question content */}
      <div className="px-4 py-3">
        <p className="text-[14px] font-medium text-[var(--color-text-primary)] mb-3">
          {activeQuestion.question}
        </p>

        {/* Option cards */}
        {activeQuestion.options && activeQuestion.options.length > 0 && (
          <div className="space-y-2 mb-3">
            {activeQuestion.options.map((opt, optIndex) => {
              const isSelected = activeAnswer?.type === 'option' && activeAnswer.value === opt.label
              return (
                <button
                  key={optIndex}
                  onClick={() => handleSelect(safeActiveTab, opt.label)}
                  disabled={submitted}
                  className={`w-full text-left px-4 py-3 rounded-[var(--radius-md)] border transition-colors duration-100 cursor-pointer ${
                    isSelected
                      ? 'border-[var(--color-brand)] bg-[var(--color-accent-glow)] ring-1 ring-[var(--color-brand)]/30'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-brand)] hover:bg-[var(--color-accent-glow)]'
                  } ${submitted ? 'cursor-default' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Check indicator */}
                    <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'border-[var(--color-brand)] bg-[var(--color-brand)]'
                      : 'border-[var(--color-border)]'
                    }`}>
                      {isSelected && (
                        <Icon name="check" size={10} className="text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-[14px] font-medium ${
                        isSelected
                          ? 'text-[var(--color-brand)]'
                          : 'text-[var(--color-text-primary)]'
                      }`}>
                        {opt.label}
                      </span>
                      {opt.description && (
                        <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
                          {opt.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Free text input */}
        {!submitted && (
          <div>
            <label className="text-[12px] text-[var(--color-text-tertiary)] mb-1.5 block">
              {t('question.customResponse')}
            </label>
            <input
              type="text"
              value={activeAnswer?.type === 'custom' ? activeAnswer.value : ''}
              onChange={(e) => {
                handleCustomChange(safeActiveTab, e.target.value)
              }}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
              onKeyDown={(e) => {
                if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && allAnswered) handleSubmit()
              }}
              placeholder={t('question.typePlaceholder')}
              className="w-full px-3 py-2 text-[14px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-brand)] focus:shadow-[var(--shadow-focus-ring)]"
            />
          </div>
        )}

        {/* Submitted answer display */}
        {submitted && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            <Icon name="check_circle" size={14} className="text-[var(--color-success)]" />
            <span>
              {t('question.answeredPrefix')}<strong>{answeredText}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Submit button */}
      {!submitted && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)]">
          <Button
            variant="primary"
            size="sm"
            className="!bg-[var(--color-brand)] hover:!bg-[color-mix(in_srgb,var(--color-brand)_85%,white)] !shadow-[0_0_12px_var(--color-accent-glow)]"
            disabled={!allAnswered || !pendingRequest}
            onClick={handleSubmit}
            icon={
              <Icon name="send" size={14} />
            }
          >
            {t('question.submit')}
          </Button>
        </div>
      )}
    </div>
  )
}
