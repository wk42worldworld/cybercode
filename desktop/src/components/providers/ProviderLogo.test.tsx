import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it } from 'vitest'

import { ProviderLogo } from './ProviderLogo'
import { resolveProviderIdentity } from './providerIdentity'

describe('ProviderLogo', () => {
  it('uses preset provider assets inside the unified logo frame', () => {
    render(<ProviderLogo name="DeepSeek" providerId="deepseek" />)

    expect(screen.getByAltText('DeepSeek logo')).toHaveAttribute('src', '/provider-icons/styled/cybercode-deepseek.png')
    expect(screen.getByAltText('DeepSeek logo')).toHaveStyle({
      objectFit: 'contain',
    })
    expect(screen.getByAltText('DeepSeek logo').parentElement).toHaveAttribute('data-provider-logo', 'deepseek')
  })

  it('infers common model vendors from base URLs and model IDs', () => {
    expect(resolveProviderIdentity({
      name: 'Production gateway',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-5',
    }).id).toBe('openai')

    expect(resolveProviderIdentity({
      name: 'Local',
      modelId: 'qwen3.6',
    }).id).toBe('qwen')
  })

  it('uses the official OpenAI and Google Gemini assets', () => {
    const { rerender } = render(<ProviderLogo name="OpenAI" providerId="openai" />)

    const openAiLogo = screen.getByAltText('OpenAI logo')
    expect(openAiLogo).toHaveAttribute('src', '/provider-icons/official/openai-blossom.svg')
    expect(openAiLogo.parentElement).toHaveAttribute('data-provider-logo-kind', 'asset')
    expect(openAiLogo).not.toHaveStyle({ filter: expect.stringContaining('drop-shadow') })

    rerender(<ProviderLogo name="Gemini" providerId="google" />)

    const geminiLogo = screen.getByAltText('Gemini logo')
    expect(geminiLogo).toHaveAttribute('src', '/provider-icons/official/google-gemini.png')
    expect(geminiLogo.parentElement).toHaveAttribute('data-provider-logo-kind', 'asset')
    expect(geminiLogo).not.toHaveStyle({ filter: expect.stringContaining('drop-shadow') })
  })

  it('renders unknown custom providers as generated monograms', () => {
    render(<ProviderLogo name="Acme Lab" providerId="custom" />)

    const logo = screen.getByRole('img', { name: 'Acme Lab logo' })
    expect(logo).toHaveAttribute('data-provider-logo-kind', 'generated')
    expect(logo).toHaveTextContent('AL')
  })
})
