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

  it('renders unknown custom providers as generated monograms', () => {
    render(<ProviderLogo name="Acme Lab" providerId="custom" />)

    const logo = screen.getByRole('img', { name: 'Acme Lab logo' })
    expect(logo).toHaveAttribute('data-provider-logo-kind', 'generated')
    expect(logo).toHaveTextContent('AL')
  })
})
