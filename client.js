/**
 * Web half of the Neuralwatt provider bundle.
 *
 * Two additions, both native to the shipped surfaces:
 * - a composer-dock pill showing this session's Neuralwatt energy and billed
 *   cost, styled after the shipped statistics pills and opening the same kind
 *   of detail panel on click;
 * - a provider-card extension under Settings → Models that stores this route's
 *   API key through the harness credential seam and shows the account quota.
 *
 * The pill renders nothing outside a session that used this route, so an
 * unaffected conversation shows no extra chrome.
 */
window.__ModuleLoader__.load({
  id: 'dsh-neuralwatt-provider',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // The shipped stat dialog portals its panel to the document body; do the
    // same when the module table exposes react-dom, and fall back to an
    // in-place fixed panel (which escapes clipping) when it does not.
    let createPortal = null
    try {
      const reactDom = require('react-dom')
      createPortal = reactDom !== null && typeof reactDom.createPortal === 'function' ? reactDom.createPortal : null
    } catch (_noReactDom) {
      createPortal = null
    }

    const NS = 'llm-neuralwatt'
    /** Settings namespace the Host registers for this route; equals the loader row id. */
    const SETTINGS_NS = 'llm-neuralwatt'
    const QUOTA_PATH = '/api/neuralwatt.quota'
    const ROUTE = 'neuralwatt'
    const DEFAULT_REF = 'NEURALWATT_API_KEY'
    /** Text-presentation lightning: inherits the label tone instead of an emoji colour. */
    const BOLT = '\u26a1\ufe0e'

    const en = {
      'usage.aria': 'Neuralwatt energy and billed cost for this session',
      'usage.title': 'Neuralwatt energy',
      'usage.energy': 'Energy',
      'usage.cost': 'Billed cost',
      'usage.carbon': 'Carbon footprint',
      'usage.grid': 'Grid',
      'usage.notReported': 'not reported',
      'usage.requests': 'Requests',
      'usage.input': 'Input tokens',
      'usage.cacheRead': 'Cached input',
      'usage.output': 'Output tokens',
      'usage.queue': 'Last flex queue wait',
      'usage.model': 'Last model',
      'quota.label': 'Account quota',
      'quota.remaining': 'Credits remaining',
      'quota.plan': 'Plan',
      'quota.month': 'This month',
      'quota.unavailable': 'Quota unavailable',
      'key.label': 'API key',
      'key.save': 'Save key',
      'key.remove': 'Remove',
      'key.hint': 'Stored through the harness credential store as',
      'key.saved': 'API key saved.',
      'key.removed': 'API key removed.',
      'key.empty': 'Enter an API key before saving.',
      'key.failed': 'Could not save the API key.',
      'key.readonly': 'This credential store is read-only.',
    }
    const zh = {
      'usage.aria': '本会话中 Neuralwatt 的能耗与计费成本',
      'usage.title': 'Neuralwatt 能耗',
      'usage.energy': '能耗',
      'usage.cost': '计费成本',
      'usage.carbon': '碳足迹',
      'usage.grid': '电网',
      'usage.notReported': '暂无数据',
      'usage.requests': '请求数',
      'usage.input': '输入 Token',
      'usage.cacheRead': '缓存输入',
      'usage.output': '输出 Token',
      'usage.queue': '最近一次弹性队列等待',
      'usage.model': '最近模型',
      'quota.label': '账户配额',
      'quota.remaining': '剩余额度',
      'quota.plan': '套餐',
      'quota.month': '本月',
      'quota.unavailable': '配额不可用',
      'key.label': 'API 密钥',
      'key.save': '保存密钥',
      'key.remove': '移除',
      'key.hint': '通过 Harness 凭据库存储为',
      'key.saved': 'API 密钥已保存。',
      'key.removed': 'API 密钥已移除。',
      'key.empty': '请先输入 API 密钥。',
      'key.failed': '无法保存 API 密钥。',
      'key.readonly': '此凭据库为只读。',
    }

    /** Joules in the same unit ladder the Host report uses. */
    function formatEnergy(joules) {
      if (!Number.isFinite(joules) || joules <= 0) return '0 J'
      if (joules < 1000) return `${joules.toFixed(1)} J`
      const kwh = joules / 3600000
      if (kwh >= 1) return `${kwh.toFixed(3)} kWh`
      const wh = joules / 3600
      if (wh >= 1) return `${wh.toFixed(3)} Wh`
      return `${(joules / 1000).toFixed(3)} mWh`
    }

    /** Grams of CO₂e in the same unit ladder as the Host report. */
    function formatCarbon(grams) {
      if (!Number.isFinite(grams) || grams <= 0) return '0 g'
      if (grams < 1) return `${(grams * 1000).toFixed(2)} mg`
      if (grams < 1000) {
        const decimals = grams < 10 ? 2 : grams < 100 ? 1 : 0
        return `${grams.toFixed(decimals)} g`
      }
      return `${(grams / 1000).toFixed(2)} kg`
    }

    /** Compact USD amount that keeps sub-cent spend legible. */
    function formatUsd(value) {
      if (!Number.isFinite(value) || value <= 0) return '$0'
      if (value >= 0.01) return `$${value.toFixed(2)}`
      return `$${value.toFixed(4)}`
    }

    /** Exact USD amount for the detail panel. */
    function formatExactUsd(value) {
      if (!Number.isFinite(value) || value <= 0) return '$0.00'
      return value >= 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(6)}`
    }

    /** Grouped integer, matching the host's report format. */
    function exactCount(value) {
      return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0'
    }

    // Copied from the shipped statistics pills (StatsPills.module.css): the
    // anchor shrink-wraps the pill so the panel clamp measures it, and the pill
    // inherits the tertiary label tone its neighbours use.
    const anchorStyle = {
      display: 'inline-flex',
      minWidth: 0,
      fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
      lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
    }

    function pillStyle(active) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        boxSizing: 'border-box',
        maxWidth: '100%',
        padding: '1px 8px',
        border: 'none',
        borderRadius: 'var(--dsw-radius-sm)',
        background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
        color: active ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-label-tertiary)',
        font: 'inherit',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 'inherit',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      }
    }

    const labelStyle = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }
    const sepStyle = { color: 'var(--dsw-alias-separator-primary)', margin: '0 6px' }

    /** A slightly brighter, slightly larger reading glyph; muted if the emoji font wins. */
    function Bolt() {
      return h('span', {
        'aria-hidden': true,
        style: {
          fontSize: '15px',
          lineHeight: 1,
          flex: 'none',
          color: 'var(--dsw-alias-label-secondary)',
          filter: 'saturate(0.8)',
        },
      }, BOLT)
    }

    // Copied from the shipped stat dialog (stat-dialog.module.css): anchor
    // placement above the trigger, menu surface, 12px window inset.
    function panelStyle(anchorName) {
      return {
        position: 'fixed',
        zIndex: 1100,
        boxSizing: 'border-box',
        width: 'max-content',
        minWidth: 'min(300px, calc(100vw - 24px))',
        maxWidth: 'min(440px, calc(100vw - 24px))',
        padding: '16px',
        border: 0,
        borderRadius: 'var(--dsw-radius-lg)',
        background: 'var(--dsw-specific-menu)',
        backdropFilter: 'var(--dsw-menu-backdrop-filter)',
        '--dsw-elevation-stroke-color': 'var(--dsw-alias-border-l1)',
        boxShadow: 'var(--dsw-elevation-prominent)',
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'default',
        maxHeight: 'calc(100dvh - 24px)',
        overflowX: 'hidden',
        overflowY: 'auto',
        positionAnchor: anchorName,
        positionArea: 'none',
        top: 'max(12px, var(--dsh-frame-overlay-top, 12px))',
        bottom: 'max(12px, calc(anchor(top) + 8px))',
        left: 'max(12px, anchor(left))',
        right: '12px',
        alignSelf: 'end',
        justifySelf: 'start',
        height: 'fit-content',
        minHeight: 0,
        margin: 0,
      }
    }

    const titleStyle = {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '16px',
      marginBottom: '8px',
      color: 'var(--dsw-alias-label-primary)',
      fontWeight: 500,
    }
    const titleLabelStyle = { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }
    const titleValueStyle = { fontVariantNumeric: 'tabular-nums' }
    const ruleStyle = { marginBottom: '10px', borderTop: '0.5px solid var(--dsw-alias-border-l2)' }
    const detailsStyle = {
      display: 'grid',
      gridTemplateColumns: 'minmax(76px, auto) minmax(0, 1fr)',
      gap: '6px 16px',
      margin: 0,
      color: 'var(--dsw-alias-label-tertiary)',
    }
    const dtStyle = { minWidth: 0, margin: 0 }
    const ddStyle = {
      minWidth: 0,
      margin: 0,
      color: 'var(--dsw-alias-label-secondary)',
      fontVariantNumeric: 'tabular-nums',
      textAlign: 'right',
    }

    /**
     * Composer pill and its detail dialog. The reading stays on one line and
     * the dialog reproduces this session's energy accounting: requests, the
     * three token buckets, billed cost, the last flex queue wait, and the model
     * that produced the latest response.
     */
    function UsagePill({ useProjection, t }) {
      const tr = typeof t === 'function' ? t : key => key
      const usage = useProjection('neuralwattUsage')
      const [open, setOpen] = React.useState(false)
      const [hovered, setHovered] = React.useState(false)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const anchorName = `--nw-energy-${React.useId().replace(/:/g, '')}`

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onPointerDown = (event) => {
          const target = event.target
          if (rootRef.current !== null && rootRef.current.contains(target)) return
          if (panelRef.current !== null && panelRef.current.contains(target)) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open])

      if (usage === null || usage === undefined) return null
      if (usage.provider !== ROUTE || usage.requests === 0) return null

      const energy = formatEnergy(usage.energyJoules)
      const cost = formatUsd(usage.costUsd)
      const carbonKnown = usage.carbonKnown === true
      const carbon = carbonKnown ? `${formatCarbon(usage.carbonGrams)} CO\u2082` : null
      const reading = [energy, cost, carbon].filter(value => value !== null).join(' \u00b7 ')
      const aria = `${tr('usage.aria')}: ${reading}`

      const gridIntensity = usage.lastGridIntensityGco2PerKwh
      const gridText = usage.lastGridId === undefined
        ? null
        : `${usage.lastGridId}${typeof gridIntensity === 'number'
          ? ` \u00b7 ${gridIntensity.toFixed(0)} g CO\u2082/kWh${/fallback/i.test(usage.lastCarbonSource ?? '') ? ' (~estimate)' : ''}`
          : ''}`

      const rows = [
        [tr('usage.energy'), energy],
        [tr('usage.carbon'), carbon === null ? tr('usage.notReported') : `${formatCarbon(usage.carbonGrams)} CO\u2082e`],
        ...gridText === null ? [] : [[tr('usage.grid'), gridText]],
        [tr('usage.cost'), formatExactUsd(usage.costUsd)],
        [tr('usage.requests'), exactCount(usage.requests)],
        [tr('usage.input'), exactCount(usage.inputTokens)],
        [tr('usage.cacheRead'), exactCount(usage.cacheReadTokens)],
        [tr('usage.output'), exactCount(usage.outputTokens)],
      ]
      if (usage.lastQueueSeconds !== undefined) {
        rows.push([tr('usage.queue'), `${usage.lastQueueSeconds.toFixed(1)} s`])
      }
      if (typeof usage.lastModel === 'string' && usage.lastModel.length > 0) {
        rows.push([tr('usage.model'), usage.lastModel])
      }

      const panel = h('div', {
        ref: panelRef,
        role: 'dialog',
        'aria-label': tr('usage.title'),
        'data-neuralwatt-energy': '',
        style: panelStyle(anchorName),
      },
      h('div', { style: titleStyle },
        h('span', { style: titleLabelStyle }, h(Bolt), tr('usage.title')),
        h('span', { style: titleValueStyle }, energy)),
      h('div', { style: ruleStyle, 'aria-hidden': true }),
      h('dl', { style: detailsStyle },
        ...rows.flatMap(([term, value]) => [
          h('dt', { key: `t-${term}`, style: dtStyle }, term),
          h('dd', { key: `d-${term}`, style: ddStyle }, value),
        ])))

      const body = createPortal !== null && typeof document !== 'undefined'
        ? createPortal(panel, document.body)
        : panel

      return h('span', {
        ref: rootRef,
        style: { ...anchorStyle, anchorName },
        'data-neuralwatt-usage': '',
      },
      h('button', {
        type: 'button',
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-label': aria,
        title: open ? undefined : reading,
        style: pillStyle(open || hovered),
        onClick: () => setOpen(value => !value),
        onPointerEnter: () => setHovered(true),
        onPointerLeave: () => setHovered(false),
        onFocus: () => setHovered(true),
        onBlur: () => setHovered(false),
      },
      h(Bolt),
      h('span', { style: labelStyle },
        h('span', null, energy),
        h('span', { style: sepStyle, 'aria-hidden': true }, '\u00b7'),
        h('span', null, cost),
        carbon === null ? null : h('span', { style: sepStyle, 'aria-hidden': true }, '\u00b7'),
        carbon === null ? null : h('span', null, carbon))),
      open ? body : null)
    }

    // Copied from the Models page's own field and button styling
    // (ModelsSection.module.css) so the card's key editor belongs on the page.
    const inputStyle = {
      boxSizing: 'border-box',
      flex: '1 1 auto',
      minWidth: 0,
      height: '32px',
      padding: '0 10px',
      border: '0.5px solid var(--dsw-alias-border-l4)',
      borderRadius: 'var(--dsw-radius-md)',
      font: 'inherit',
      fontSize: '14px',
      lineHeight: '22px',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
    }
    const cardButtonStyle = {
      boxSizing: 'border-box',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      height: '32px',
      padding: '0 12px',
      border: '0.5px solid var(--dsw-alias-border-l3)',
      borderRadius: 'var(--dsw-radius-md)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: '13px',
      lineHeight: '22px',
      cursor: 'pointer',
    }
    const cardDangerStyle = { ...cardButtonStyle, border: 'none', color: 'var(--dsw-alias-state-error-primary)', padding: '0 8px' }
    const cardRowStyle = { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }
    const cardTextStyle = {
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary)',
    }
    const cardLabelStyle = { ...cardTextStyle, color: 'var(--dsw-alias-label-secondary)' }
    const keyBlockStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      marginTop: '10px',
      paddingTop: '10px',
      borderTop: '0.5px solid var(--dsw-alias-border-l2)',
    }

    /**
     * Provider-card extension under Settings → Models: the account quota and
     * the route's API key. The key is written through `remote.credentials`, the
     * same seam the first-party cards use, and never enters configuration.
     */
    function makeQuotaCard(credentials) {
      return function NeuralwattCard({ configured, keyConfigured, t }) {
        const tr = typeof t === 'function' ? t : key => key
        const [quota, setQuota] = React.useState(null)
        const [quotaState, setQuotaState] = React.useState('idle')
        const [ref, setRef] = React.useState(DEFAULT_REF)
        const [info, setInfo] = React.useState(null)
        const [draft, setDraft] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState(null)
        const [generation, setGeneration] = React.useState(0)

        React.useEffect(() => {
          if (configured !== true) {
            setQuotaState('idle')
            return undefined
          }
          const controller = new AbortController()
          let cancelled = false
          setQuotaState(previous => previous === 'ready' ? previous : 'loading')
          fetch(QUOTA_PATH, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
            credentials: 'same-origin',
          })
            .then(response => response.json())
            .then((body) => {
              if (cancelled) return undefined
              const nextRef = body !== null && typeof body === 'object'
                && typeof body.apiKeyEnv === 'string' && body.apiKeyEnv.length > 0
                ? body.apiKeyEnv
                : DEFAULT_REF
              setRef(nextRef)
              const nextQuota = body !== null && typeof body === 'object' ? body.quota : null
              setQuota(nextQuota ?? null)
              setQuotaState(nextQuota ? 'ready' : 'unavailable')
              return credentials.describe([nextRef])
                .then((result) => {
                  if (!cancelled && result !== null && result !== undefined && result.ok === true) {
                    setInfo(result.value[nextRef] ?? null)
                  }
                })
                .catch(() => undefined)
            })
            .catch(() => {
              if (!cancelled) setQuotaState('unavailable')
            })
          return () => {
            cancelled = true
            controller.abort()
          }
        }, [configured, generation])

        const stored = info !== null && info !== undefined ? info.configured === true : keyConfigured === true
        const writable = info === null || info === undefined || info.writable !== false

        const save = async () => {
          const value = draft.trim()
          if (value.length === 0) {
            setNotice({ kind: 'empty' })
            return
          }
          setBusy(true)
          setNotice(null)
          try {
            const result = await credentials.set(ref, value)
            if (result === null || result === undefined || result.ok !== true) {
              setNotice({ kind: 'error', message: result !== null && result !== undefined && result.error !== undefined ? result.error.message : undefined })
              return
            }
            setDraft('')
            setNotice({ kind: 'saved' })
            setGeneration(value => value + 1)
          } catch (error) {
            setNotice({ kind: 'error', message: error instanceof Error ? error.message : undefined })
          } finally {
            setBusy(false)
          }
        }

        const remove = async () => {
          setBusy(true)
          setNotice(null)
          try {
            const result = await credentials.unset(ref)
            if (result === null || result === undefined || result.ok !== true) {
              setNotice({ kind: 'error', message: result !== null && result !== undefined && result.error !== undefined ? result.error.message : undefined })
              return
            }
            setDraft('')
            setNotice({ kind: 'removed' })
            setGeneration(value => value + 1)
          } catch (error) {
            setNotice({ kind: 'error', message: error instanceof Error ? error.message : undefined })
          } finally {
            setBusy(false)
          }
        }

        if (configured !== true) return null

        const quotaRows = []
        if (quotaState === 'ready' && quota !== null && quota !== undefined) {
          const subscription = quota.subscription
          const balance = quota.balance
          const month = quota.usage === undefined || quota.usage === null ? undefined : quota.usage.current_month
          if (subscription !== null && subscription !== undefined) {
            quotaRows.push(`${tr('quota.plan')}: ${subscription.plan ?? '\u2014'} (${subscription.status ?? '\u2014'})`)
          }
          if (balance !== undefined && balance !== null && typeof balance.credits_remaining_usd === 'number') {
            quotaRows.push(`${tr('quota.remaining')}: ${formatUsd(balance.credits_remaining_usd)}`)
          }
          if (month !== undefined && month !== null) {
            quotaRows.push(`${tr('quota.month')}: ${formatUsd(month.cost_usd ?? 0)} \u00b7 ${month.requests ?? 0} req \u00b7 ${((month.energy_kwh ?? 0)).toFixed(3)} kWh`)
          }
        }
        if (quotaRows.length === 0) quotaRows.push(tr('quota.unavailable'))

        const noticeText = notice === null
          ? `${tr('key.hint')} ${ref}`
          : notice.kind === 'saved'
            ? tr('key.saved')
            : notice.kind === 'removed'
              ? tr('key.removed')
              : notice.kind === 'empty'
                ? tr('key.empty')
                : (notice.message !== undefined && notice.message.length > 0 ? notice.message : tr('key.failed'))

        const placeholder = !writable
          ? tr('key.readonly')
          : stored
            ? (info !== null && info !== undefined && typeof info.masked === 'string' && info.masked.length > 0 ? info.masked : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')
            : ref

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' }, 'data-neuralwatt-card': quotaState },
          ...quotaRows.map((line, index) => h('span', { key: `q-${index}`, style: cardTextStyle }, line)),
          h('div', { style: keyBlockStyle },
            h('span', { style: cardLabelStyle }, tr('key.label')),
            h('div', { style: cardRowStyle },
              h('input', {
                type: 'password',
                autoComplete: 'new-password',
                value: draft,
                placeholder,
                disabled: busy || !writable,
                'aria-label': tr('key.label'),
                'data-neuralwatt-key': '',
                style: inputStyle,
                onChange: event => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void save()
                  }
                },
              }),
              h('button', {
                type: 'button',
                style: cardButtonStyle,
                disabled: busy || !writable || draft.trim().length === 0,
                onClick: () => { void save() },
              }, tr('key.save')),
              stored
                ? h('button', {
                  type: 'button',
                  style: cardDangerStyle,
                  disabled: busy || !writable,
                  onClick: () => { void remove() },
                }, tr('key.remove'))
                : null),
            h('span', { style: cardTextStyle, 'aria-live': 'polite' }, noticeText)))
      }
    }

    return {
      name: 'dsh-neuralwatt-provider',
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'llm-neuralwatt: copy dictionaries')
        // A list slot with no owner props: adding a pill never shadows the
        // shipped activity and usage pills.
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'neuralwatt-usage',
          order: 6,
          locale: NS,
        }, UsagePill))
        // The card writes the key through the generated credentials Remote, so
        // it activates only where the Web remotes assembly is mounted.
        ctx.inject(['remote.credentials'], (child) => {
          // Resolve the generated credentials Remote by service key: the dotted
          // namespace proxy and the registry key are two faces of one service.
          const credentials = typeof child.get === 'function'
            ? (child.get('remote.credentials') ?? (child.remote === undefined ? undefined : child.remote.credentials))
            : (child.remote === undefined ? undefined : child.remote.credentials)
          if (credentials === undefined) return
          child.slots.inject('settings.models.provider-card', () => child.slots.register({
            name: 'settings.models.provider-card',
            key: SETTINGS_NS,
            id: 'neuralwatt-quota',
            locale: NS,
          }, makeQuotaCard(credentials)))
        })
      },
    }
  },
})
