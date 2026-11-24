/**
 * Web half of the Neuralwatt provider bundle.
 *
 * Two additions, both native to the shipped surfaces:
 * - a composer-dock pill showing this session's Neuralwatt energy and billed
 *   cost, styled after the shipped statistics pills and opening the same kind
 *   of detail panel on click;
 * - a provider-card extension under Settings → Models showing the account
 *   quota, read from the Host's authenticated `/api/neuralwatt.quota` route.
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
    /** Text-presentation lightning: inherits the tertiary label tone instead of an emoji color. */
    const BOLT = '\u26a1\ufe0e'

    const en = {
      'usage.label': 'Neuralwatt energy',
      'usage.aria': 'Neuralwatt energy and billed cost for this session',
      'usage.title': 'Neuralwatt energy',
      'usage.energy': 'Energy',
      'usage.cost': 'Billed cost',
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
      'quota.nokey': 'Store an API key to read the account quota',
    }
    const zh = {
      'usage.label': 'Neuralwatt 能耗',
      'usage.aria': '本会话中 Neuralwatt 的能耗与计费成本',
      'usage.title': 'Neuralwatt 能耗',
      'usage.energy': '能耗',
      'usage.cost': '计费成本',
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
      'quota.nokey': '存储 API 密钥后可读取账户配额',
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

    /** Subdued glyph: text presentation first, desaturated if the emoji font wins. */
    function Bolt() {
      return h('span', {
        'aria-hidden': true,
        style: {
          fontSize: '13px',
          lineHeight: 1,
          filter: 'grayscale(1)',
          opacity: 0.85,
          flex: 'none',
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
      const reading = `${energy} · ${cost}`
      const aria = `${tr('usage.aria')}: ${reading}`

      const rows = [
        [tr('usage.energy'), energy],
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
        h('span', null, cost))),
      open ? body : null)
    }

    /** Provider-card extension: account quota for the Neuralwatt route. */
    function QuotaCard({ configured, keyConfigured, t }) {
      const tr = typeof t === 'function' ? t : key => key
      const [snapshot, setSnapshot] = React.useState({ kind: 'idle' })
      React.useEffect(() => {
        if (configured !== true) {
          setSnapshot({ kind: 'idle' })
          return undefined
        }
        if (keyConfigured !== true) {
          setSnapshot({ kind: 'nokey' })
          return undefined
        }
        const controller = new AbortController()
        setSnapshot({ kind: 'loading' })
        fetch(QUOTA_PATH, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
          credentials: 'same-origin',
        })
          .then(response => response.json())
          .then((body) => {
            if (controller.signal.aborted) return
            if (body !== null && body.configured === true && body.quota !== null && body.quota !== undefined) {
              setSnapshot({ kind: 'ready', quota: body.quota })
            } else {
              setSnapshot({ kind: 'unavailable' })
            }
          })
          .catch(() => {
            if (!controller.signal.aborted) setSnapshot({ kind: 'unavailable' })
          })
        return () => controller.abort()
      }, [configured, keyConfigured])

      if (snapshot.kind === 'idle') return null
      const style = {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-tertiary)',
      }
      if (snapshot.kind === 'nokey') return h('div', { style, 'data-neuralwatt-quota': 'nokey' }, tr('quota.nokey'))
      if (snapshot.kind === 'loading') return h('div', { style, 'data-neuralwatt-quota': 'loading' }, '\u2026')
      if (snapshot.kind === 'unavailable') {
        return h('div', { style, 'data-neuralwatt-quota': 'unavailable' }, tr('quota.unavailable'))
      }
      const quota = snapshot.quota
      const subscription = quota.subscription
      const balance = quota.balance
      const month = quota.usage === undefined || quota.usage === null ? undefined : quota.usage.current_month
      const rows = []
      if (subscription !== null && subscription !== undefined) {
        rows.push(`${tr('quota.plan')}: ${subscription.plan ?? '\u2014'} (${subscription.status ?? '\u2014'})`)
      }
      if (balance !== undefined && balance !== null && typeof balance.credits_remaining_usd === 'number') {
        rows.push(`${tr('quota.remaining')}: ${formatUsd(balance.credits_remaining_usd)}`)
      }
      if (month !== undefined && month !== null) {
        rows.push(`${tr('quota.month')}: ${formatUsd(month.cost_usd ?? 0)} \u00b7 ${month.requests ?? 0} req \u00b7 ${((month.energy_kwh ?? 0)).toFixed(3)} kWh`)
      }
      if (rows.length === 0) rows.push(tr('quota.unavailable'))
      return h('div', { style, 'data-neuralwatt-quota': 'ready' },
        ...rows.map((line, index) => h('span', { key: String(index) }, line)))
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
        // The Models page exposes one extension area per provider family,
        // keyed by the row's settings namespace.
        ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
          name: 'settings.models.provider-card',
          key: SETTINGS_NS,
          id: 'neuralwatt-quota',
          locale: NS,
        }, QuotaCard))
      },
    }
  },
})
