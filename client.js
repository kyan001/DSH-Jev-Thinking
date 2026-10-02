/**
 * Browser half of dsh-jev-thinking: the row's own configuration page.
 *
 * A plugin page has to be shipped, because no released DSH client builds one
 * from a plugin schema. The page becomes reachable as
 * `Plugins → dsh-jev-thinking → the row's Configure control`, which is where a
 * bundle's row configuration lives; the key is `<package name>#<row id>`.
 *
 * The API key goes to the Harness credential store — the same path the shipped
 * settings pages use — and is read back with `credentials.describe`, so the key
 * is never a settings value and never rides a settings response.
 *
 * Three rules shape this file, each learned by taking the desktop app down:
 *
 *   1. The loader calls the registered factory with `require` alone, so the
 *      factory builds its own CommonJS shim. Without it the import throws.
 *   2. A plugin that throws while activating takes the whole Web boot with it,
 *      and the desktop answers that with a profile-wide recovery. So `apply`
 *      catches everything, and every service is read through `ctx.get(name)` —
 *      the sanctioned optional form, which returns `undefined` instead of
 *      throwing when the service is absent or undeclared.
 *   3. Copy follows the Harness locale: dictionaries register through the public
 *      `locale` service and lookups go through `bind`, which answers the key
 *      itself for anything missing.
 *
 * Written as a module-loader factory with `createElement` instead of JSX, so the
 * package needs no bundler and stays build-free.
 */
window.__ModuleLoader__.load({
  id: 'dsh-jev-thinking',
  factory: (require) => {
    // The CommonJS shim every browser half builds for itself. The loader calls
    // this factory with `require` alone, so `module` and `exports` do not exist
    // until they are made here. `var` rather than `const`: harmless if the file
    // is ever evaluated with them already in scope.
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement

    /** Profile entry id, `<package name>#<row id>` slot key, and locale namespace. */
    const NS = 'dsh-jev-thinking'
    const ROW_KEY = 'dsh-jev-thinking#dsh-jev-thinking'
    const LOCALE_NS = 'dsh-jev-thinking'

    /** The reference the plugin falls back to when the config names none. */
    const DEFAULT_REF = 'TYPESAFE_API_KEY'

    /** Every string this page shows. `{ref}` is filled from the current value. */
    const DICTS = {
      en: {
        credentialName: 'Credential name in the Harness credential store',
        credentialHint: 'The host half resolves this name on every request, so a rotated key needs no restart.',
        apiKey: 'TypeSafe API key',
        keySet: '•••••••• (already set)',
        keyEmpty: 'apikey_…',
        keyHintSet: 'A key is stored. Leave the field empty to keep it; type a new one to replace it.',
        keyHintEmpty: 'No key stored under this name yet.',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved. The key is in the credential store.',
        summaryLoading: 'TypeSafe API key: …',
        summaryUnavailable: 'TypeSafe API key: unavailable',
        summarySet: 'TypeSafe API key: set ({ref})',
        summaryEmpty: 'TypeSafe API key: not set ({ref})',
      },
      zh: {
        credentialName: 'Harness 凭据库中的凭据名',
        credentialHint: '宿主半边每次请求都按这个名字解析，所以轮换密钥不需要重启。',
        apiKey: 'TypeSafe API Key',
        keySet: '••••••••（已设置）',
        keyEmpty: 'apikey_…',
        keyHintSet: '已存有密钥。留空则保留，输入新值则替换。',
        keyHintEmpty: '这个名字下还没有存密钥。',
        save: '保存',
        saving: '保存中…',
        saved: '已保存。密钥在凭据库里。',
        summaryLoading: 'TypeSafe API Key：…',
        summaryUnavailable: 'TypeSafe API Key：不可用',
        summarySet: 'TypeSafe API Key：已设置（{ref}）',
        summaryEmpty: 'TypeSafe API Key：未设置（{ref}）',
      },
    }

    /** Fill `{name}` placeholders. */
    function fill(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole))
    }

    /** Used when this page has no locale service behind it. */
    function fallbackTranslate(key) {
      return DICTS.en[key] ?? key
    }

    /**
     * The translate function for this page. Dictionaries register through the
     * public locale service and lookups go through `bind`; a missing service, a
     * failed registration, or a missing key all fall back rather than throw,
     * because this runs during render.
     */
    function useTranslate(ctx) {
      const locale = ctx.get('locale')
      const [, bump] = React.useState(0)

      React.useEffect(() => {
        if (locale === undefined) return undefined
        const owned = []
        try {
          for (const [id, dict] of Object.entries(DICTS)) {
            const dispose = locale.register(LOCALE_NS, id, dict)
            if (typeof dispose === 'function') owned.push(dispose)
          }
        } catch (error) {
          console.error('[dsh-jev-thinking] locale registration failed; showing English', error)
        }
        if (typeof locale.subscribe === 'function') {
          const unsubscribe = locale.subscribe(() => bump((n) => n + 1))
          if (typeof unsubscribe === 'function') owned.push(unsubscribe)
        }
        return () => { for (const dispose of owned) dispose() }
      }, [locale])

      if (locale === undefined) return fallbackTranslate
      try {
        const bound = locale.bind(LOCALE_NS)
        if (typeof bound === 'function') return bound
      } catch (error) {
        console.error('[dsh-jev-thinking] locale lookup failed; showing English', error)
      }
      return fallbackTranslate
    }

    /**
     * Theme tokens, plus the surface tokens. These are the only shared styling
     * dependency: importing a Harness Client package is forbidden, so the
     * controls are written here and coloured from tokens.
     */
    const ink = {
      primary: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l2)',
      surface: 'var(--dsw-alias-bg-base)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '520px', color: ink.primary },
      field: { display: 'flex', flexDirection: 'column', gap: '6px' },
      label: { fontSize: '13px', color: ink.secondary },
      input: {
        font: 'inherit',
        color: ink.primary,
        background: ink.surface,
        border: `1px solid ${ink.border}`,
        borderRadius: '8px',
        padding: '8px 10px',
        width: '100%',
        boxSizing: 'border-box',
      },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      button: {
        font: 'inherit',
        color: ink.primary,
        background: ink.surface,
        border: `1px solid ${ink.border}`,
        borderRadius: '8px',
        padding: '8px 14px',
        cursor: 'pointer',
      },
      hint: { margin: 0, fontSize: '12px', lineHeight: 1.5, color: ink.secondary },
      okay: { margin: 0, fontSize: '13px', color: ink.success },
      bad: { margin: 0, fontSize: '13px', color: ink.error },
    }

    /** A failure that reached the page, as text. */
    function textOf(error) {
      if (error === null || error === undefined) return 'unknown error'
      return typeof error.message === 'string' ? error.message : String(error)
    }

    /**
     * Every unary Remote call answers `RemoteResult<T>` — `{ ok: true, value }`
     * or `{ ok: false, error }` — and only an assembly fault rejects.
     */
    async function unwrap(promise) {
      const result = await promise
      if (result === null || typeof result !== 'object' || result.ok !== true) {
        throw (result && result.error) || new Error('remote call failed')
      }
      return result.value
    }

    /**
     * The two Remote namespaces this page needs, or `undefined` when this page
     * has no Host behind it. `ctx.get` is the optional form: it answers
     * `undefined` for a service that is absent or not declared, so reading it
     * cannot fail activation.
     */
    function namespaces(ctx) {
      const remote = ctx.get('remote')
      return {
        settings: ctx.get('remote.settings') ?? (remote === undefined ? undefined : remote.settings),
        credentials: ctx.get('remote.credentials') ?? (remote === undefined ? undefined : remote.credentials),
      }
    }

    /** Read and write the row's reference name and its credential-store entry. */
    function createAccess(ctx) {
      return {
        async read() {
          const { settings, credentials } = namespaces(ctx)
          if (settings === undefined) throw new Error('this page is not connected to the Host settings API')

          const described = await unwrap(settings.describe())
          const view = (described && described.namespaces ? described.namespaces : []).find((entry) => entry.ns === NS)
          const named = view && view.value ? view.value.apiKeyRef : undefined
          const ref = typeof named === 'string' && named !== '' ? named : DEFAULT_REF

          let configured
          if (credentials !== undefined) {
            const describedRefs = await unwrap(credentials.describe([ref]))
            configured = describedRefs && describedRefs[ref] ? describedRefs[ref].configured === true : false
          }
          return { ref, revision: view ? view.revision : undefined, configured }
        },

        async save(ref, key, previous, revision) {
          const { settings, credentials } = namespaces(ctx)
          if (credentials === undefined) throw new Error('this page is not connected to the Host credential store')

          if (ref !== previous) {
            if (settings === undefined) throw new Error('this page is not connected to the Host settings API')
            await unwrap(settings.mutate(NS, [{ op: 'set', path: ['apiKeyRef'], value: ref }], revision))
          }
          if (key === '') await unwrap(credentials.unset(ref))
          else await unwrap(credentials.set(ref, key))
        },
      }
    }

    /** A one-line status for the summary view. */
    function Summary({ ctx, access }) {
      const t = useTranslate(ctx)
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
        let live = true
        access.read().then(
          (next) => live && setState(next),
          () => live && setState({ unavailable: true }),
        )
        return () => { live = false }
      }, [access])

      let text = t('summaryLoading')
      if (state && state.unavailable) text = t('summaryUnavailable')
      else if (state) text = fill(t(state.configured ? 'summarySet' : 'summaryEmpty'), { ref: state.ref })
      return h('p', { style: styles.hint }, text)
    }

    /** The row's configuration page. */
    function Page({ ctx, access }) {
      const t = useTranslate(ctx)
      const [ref, setRef] = React.useState(DEFAULT_REF)
      const [loaded, setLoaded] = React.useState(null)
      const [key, setKey] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(undefined)
      const [failure, setFailure] = React.useState(undefined)

      React.useEffect(() => {
        let live = true
        access.read().then(
          (next) => {
            if (!live) return
            setRef(next.ref)
            setLoaded(next)
          },
          (error) => live && setFailure(textOf(error)),
        )
        return () => { live = false }
      }, [access])

      async function save() {
        setBusy(true)
        setNotice(undefined)
        setFailure(undefined)
        try {
          await access.save(ref, key, loaded ? loaded.ref : ref, loaded ? loaded.revision : undefined)
          setKey('')
          setLoaded(await access.read())
          setNotice(t('saved'))
        } catch (error) {
          setFailure(textOf(error))
        } finally {
          setBusy(false)
        }
      }

      const configured = loaded ? loaded.configured : undefined

      return h(
        'div',
        { style: styles.page },
        h(
          'div',
          { style: styles.field },
          h('label', { style: styles.label, htmlFor: 'jev-ref' }, t('credentialName')),
          h('input', {
            id: 'jev-ref',
            style: styles.input,
            value: ref,
            spellCheck: false,
            disabled: busy,
            onChange: (event) => setRef(event.target.value),
          }),
          h('p', { style: styles.hint }, t('credentialHint')),
        ),
        h(
          'div',
          { style: styles.field },
          h('label', { style: styles.label, htmlFor: 'jev-key' }, t('apiKey')),
          h('input', {
            id: 'jev-key',
            style: styles.input,
            type: 'password',
            value: key,
            autoComplete: 'off',
            placeholder: t(configured === true ? 'keySet' : 'keyEmpty'),
            disabled: busy,
            onChange: (event) => setKey(event.target.value),
          }),
          h('p', { style: styles.hint }, t(configured === true ? 'keyHintSet' : 'keyHintEmpty')),
        ),
        h(
          'div',
          { style: styles.row },
          h('button', { style: styles.button, type: 'button', disabled: busy, onClick: save }, t(busy ? 'saving' : 'save')),
          notice === undefined ? null : h('p', { style: styles.okay }, notice),
        ),
        failure === undefined ? null : h('p', { style: styles.bad }, failure),
      )
    }

    function apply(ctx) {
      // A throw here fails the whole Web boot, and the desktop answers that by
      // backing up the profile's patch and disabling every third-party bundle.
      // Losing this page is the correct cost of never doing that.
      try {
        const access = createAccess(ctx)
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            { name: 'plugins.row.config', key: ROW_KEY },
            (slotProps) =>
              slotProps && slotProps.view === 'summary'
                ? h(Summary, { ctx, access })
                : h(Page, { ctx, access }),
          ),
        )
      } catch (error) {
        console.error('[dsh-jev-thinking] activation failed; the configuration page is unavailable', error)
      }
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
