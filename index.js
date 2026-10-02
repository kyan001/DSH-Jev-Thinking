/**
 * jev-thinking — let TypeSafe's Jev decide how much thinking each prompt needs,
 * then apply that decision to the request the model actually receives.
 *
 * The four invariants that are easy to get wrong, each with its measurement and
 * full reasoning in README.md:
 *
 *   - the Choice options are the route's own levels, so nothing is ever clamped;
 *   - Jev is asked once per user message, from `agent/request`, because that is
 *     the only hook where the route is known;
 *   - `state` is the previous assistant turn plus this reply, because a short
 *     approval carries no task of its own;
 *   - there is no confidence gate, and adding one back makes things worse.
 *
 * Configuration is declared with `.volatile()` so the Harness renders a form for
 * it, and the API key is read from the Harness credential store (see
 * `resolveApiKey`), never from the plain config.
 */

export const name = 'jev-thinking'

/** `llm` is what tells us which levels the current route actually offers. */
export const inject = ['llm']

/** Longest user prompt sent as Jev's `state`, bounding the per-prompt cost. */
const MAX_STATE_CHARS = 8000

/**
 * Longest previous assistant turn kept as context. The tail is kept rather than
 * the head: a proposal's actionable part — the plan, the list, the question — is
 * at the end, which is the part a short reply is answering.
 */
const MAX_CONTEXT_CHARS = 4000

const INSTRUCTIONS =
  'How much internal reasoning will the work this message sets in motion require? '
  + 'A message can be very short and still authorise a large task: a reply such as '
  + '"好", "可以" or "继续" that approves, confirms or resumes earlier work must be judged '
  + 'by the work it authorises, not by the brevity of the reply. Judge the task, not the acknowledgement.'

/**
 * Boundary text for the level ids this plugin understands, used only when the
 * route supplies no description of its own. These describe what a level *means*;
 * they never decide which levels exist — that stays the route's answer.
 */
const MEANING = {
  off: 'Nothing has to be derived, looked up, or checked, and no further work is authorised. '
    + 'Greetings, thanks, and questions whose answer is already fully stated in the request. '
    + 'A reply that approves, confirms or resumes earlier work does NOT belong here — judge the work instead.',
  minimal: 'One mechanical step whose result is already determined by the request. Renaming, reformatting, copying text through, or restating a single given fact.',
  low: 'A straightforward task down a well-trodden path: one or two steps, and no design choice to make. A small local edit, a single lookup, or a short factual explanation.',
  medium: 'Real reasoning is needed and the route is not obvious at first glance. Reading several files to find a cause, diagnosing a reproducible bug, weighing two or three concrete alternatives, or implementing a non-trivial function.',
  high: 'Deep or extended reasoning over several dependent steps, or genuine uncertainty. Cross-system or architectural design, subtle correctness or concurrency analysis, an ill-defined failure that needs exploration, or a change with a large blast radius.',
  xhigh: 'The deepest reasoning the route offers: open-ended investigation, or a problem whose shape is not yet understood.',
  max: 'The deepest reasoning the route offers: open-ended investigation, or a problem whose shape is not yet understood.',
}

/** Fallbacks, applied by `normalize` when a row omits a field. */
const DEFAULTS = {
  apiKeyRef: 'TYPESAFE_API_KEY',
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  timeoutMs: 2500,
  level: '',
  verbose: false,
}

/**
 * The schema library is a Harness package, so it resolves for a bundle installed
 * into a profile — including from npm — but not for one linked out of a working
 * directory, whose modules resolve from that directory instead. `normalize` is
 * the authority either way, so the plugin still runs without it; it only loses
 * the settings form.
 */
const Schema = await import('@deepseek-ai/schemastery')
  .then((module) => module.default)
  .catch(() => undefined)

export const Config = Schema === undefined ? undefined : Schema.object({
  apiKeyRef: Schema.string().role('credential-ref').default(DEFAULTS.apiKeyRef).volatile()
    .description(`Name in the Harness credential store that holds the key. Defaults to ${DEFAULTS.apiKeyRef}.`),
  endpoint: Schema.string().default(DEFAULTS.endpoint).volatile()
    .description('TypeSafe System One endpoint.'),
  model: Schema.string().default(DEFAULTS.model).volatile()
    .description('TypeSafe model that answers the Choice question.'),
  timeoutMs: Schema.number().default(DEFAULTS.timeoutMs).volatile()
    .description('How long the judgement may take before falling back.'),
  level: Schema.string().default(DEFAULTS.level).volatile()
    .description('Level used when the judgement fails; must be one this route offers, otherwise ignored.'),
  verbose: Schema.boolean().default(DEFAULTS.verbose).volatile()
    .description('Log one line per decision. Reported at warn level, which is the level the Harness keeps.'),
})

/**
 * A `.volatile()` field parses into a reference read with `.get()`, while a
 * defaulted one stays ordinary data — so every read goes through this.
 */
function plain(value) {
  if (value === null || typeof value !== 'object') return value
  return typeof value.get === 'function' ? value.get() : value
}

/**
 * Decide one level per user prompt and apply it to that turn's requests.
 *
 * @param ctx - the plugin's Host context.
 * @param declared - the row's `config` from `cordis.patch.yml`.
 */
export function apply(ctx, declared) {
  const settings = normalize(declared)
  const logger = typeof ctx.logger === 'function' ? ctx.logger('jev-thinking') : console

  /** agentId -> prompt text parked for a turn that has not been judged yet. */
  const parked = new Map()

  /**
   * agentId -> the tail of that session's latest assistant turn, which is the
   * only place a short reply's actual task is written down.
   */
  const spoken = new Map()

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'assistant/message') return
    const text = textOf(event.data?.message?.content)
    if (text === undefined) return
    spoken.set(session.id, tail(text, MAX_CONTEXT_CHARS))
  })

  ctx.on('agent/pre-step', async ({ agent, messages, turn }, next) => {
    // Never own this decision: another listener may reject the step or replace
    // the batch, and both must survive untouched.
    const decision = await next()
    if (decision.kind !== 'enter') return decision

    const held = parked.get(agent.id)
    if (held !== undefined && held.turn === turn) return decision

    const prompt = promptTextOf(decision.messages ?? messages)
    if (prompt === undefined) return decision

    parked.set(agent.id, { turn, prompt })
    return decision
  })

  ctx.on('agent/request', async ({ agent, turn, signal }, next) => {
    const current = await next()

    const held = parked.get(agent.id)
    if (held === undefined || held.turn !== turn) return current

    // Consume before awaiting, so no later step of this turn asks again.
    parked.delete(agent.id)

    const route = await routeLevels(current.provider, current.model, signal)
    if (route === undefined) return current

    // One option is not a decision; asking would only spend a call.
    if (route.levels.length < 2) {
      if (settings.verbose) {
        logger.warn?.(`${current.provider}/${current.model} offers ${spelled(route) || 'no levels'}; not asking`)
      }
      return current
    }

    const chosen = await decide(subjectOf(agent.id, held.prompt), route.levels, signal) ?? fallbackLevel(route)
    if (chosen === undefined) return current

    if (settings.verbose) {
      // Reported at warn level on purpose: the Harness drops a plugin's
      // info-level lines, so a success trace at info would never be visible.
      logger.warn?.(`${current.provider}/${current.model}: chose ${chosen} of ${spelled(route)}`)
    }
    return { ...current, reasoningEffort: chosen }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    parked.delete(agent.id)
    spoken.delete(agent.id)
  })

  ctx.effect(() => () => {
    parked.clear()
    spoken.clear()
  }, 'jev-thinking: parked prompts and session context')

  /**
   * What Jev is asked about: the reply, and the turn it answers when known.
   * Named fields rather than one joined string, so each part arrives under its
   * own key instead of resting on a prefix the model has to parse back out.
   * One part stays a plain string, which is what the API recommends for text.
   */
  function subjectOf(agentId, prompt) {
    const previous = spoken.get(agentId)
    if (previous === undefined) return prompt
    return { previous_assistant_message: previous, user_reply: prompt }
  }

  /**
   * Which of `levels` this subject needs, or `undefined` when the judgement
   * failed and the caller should fall back.
   */
  async function decide(subject, levels, signal) {
    try {
      const answer = await askJev(subject, levels, signal)
      return answer.choice
    } catch (error) {
      // A cancelled turn is not a judgement failure and needs no warning.
      if (signal?.aborted !== true) {
        logger.warn?.(`judgement failed (${reason(error)}); falling back`)
      }
      return undefined
    }
  }

  /** One Choice call whose options are exactly the levels this route offers. */
  async function askJev(subject, levels, outerSignal) {
    const apiKey = await resolveApiKey()
    if (apiKey === undefined) {
      throw new Error(`no API key: set one on this plugin's page under Plugins, or provide ${settings.apiKeyRef}`)
    }

    // An explicit timer rather than `AbortSignal.timeout`: the latter is
    // unref'd, so it never fires in a process whose event loop has nothing else
    // to do. This plugin's contract is a bounded per-prompt delay, and an
    // ordinary timer is what makes that bound hold regardless of loop state.
    const timeout = new AbortController()
    const timer = setTimeout(
      () => timeout.abort(new Error(`judgement exceeded ${settings.timeoutMs}ms`)),
      settings.timeoutMs,
    )

    try {
      const signal = outerSignal === undefined
        ? timeout.signal
        : AbortSignal.any([outerSignal, timeout.signal])

      const response = await fetch(settings.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          state: subject,
          model: settings.model,
          questions: {
            thinking_level: {
              type: 'choice',
              instructions: INSTRUCTIONS,
              criteria: Object.fromEntries(levels.map((level) => [level.id, describe(level)])),
            },
          },
        }),
        signal,
      })

      if (!response.ok) throw new Error(`TypeSafe answered HTTP ${response.status}`)

      const answer = (await response.json())?.answers?.thinking_level
      const choice = answer?.choice
      if (typeof choice !== 'string' || !levels.some((level) => level.id === choice)) {
        throw new Error(`Jev answered ${JSON.stringify(choice)}, which this route does not offer`)
      }
      return { choice }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * The levels this exact route offers, or `undefined` when support cannot be
   * established — in which case the request is left alone, because guessing
   * fails the call outright.
   */
  async function routeLevels(provider, model, signal) {
    try {
      const info = await ctx.llm.resolveModelInfo(provider, model, signal)
      const levels = []
      for (const effort of info?.reasoning?.efforts ?? []) {
        if (typeof effort?.id !== 'string' || effort.id === '') continue
        if (levels.some((seen) => seen.id === effort.id)) continue
        levels.push({ id: effort.id, name: effort.name, description: effort.description })
      }
      const routeDefault = typeof info?.reasoning?.defaultEffort === 'string' ? info.reasoning.defaultEffort : undefined
      return { levels, routeDefault }
    } catch (error) {
      logger.warn?.(`cannot resolve reasoning levels for ${provider}/${model} (${reason(error)}); leaving the level untouched`)
      return undefined
    }
  }

  /** The level the caller configured, else the route's own declared default. */
  function fallbackLevel(route) {
    if (settings.level !== '' && route.levels.some((level) => level.id === settings.level)) return settings.level
    if (route.routeDefault === undefined) return undefined
    return route.levels.some((level) => level.id === route.routeDefault) ? route.routeDefault : undefined
  }

  /**
   * The key, in precedence order:
   *
   *   1. the Harness credential store, which is where every other key in a
   *      profile already lives — re-read per operation, as its contract
   *      requires, so a rotated key reaches the next prompt without a restart;
   *   2. the process environment, for a shell-launched or containerised host.
   *
   * The row's own configuration page writes to the store, so the key is never a
   * settings value.
   */
  async function resolveApiKey() {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const resolved = await credentials.resolve(settings.apiKeyRef)
      // An empty stored value is not a key; fall through rather than send `Bearer `.
      if (resolved !== undefined && resolved.value !== '') return resolved.value
    }

    const fromEnvironment = process.env[settings.apiKeyRef]
    return fromEnvironment === undefined || fromEnvironment === '' ? undefined : fromEnvironment
  }

  /** `low/high` — the offered ids, for one log line. */
  function spelled(route) {
    return route.levels.map((level) => level.id).join('/')
  }
}

/** The text one option is described by, preferring the route's own wording. */
function describe(level) {
  if (typeof level.description === 'string' && level.description !== '') return level.description
  if (typeof MEANING[level.id] === 'string') return MEANING[level.id]
  if (typeof level.name === 'string' && level.name !== '') return level.name
  return level.id
}

/** Validate a raw row config into the settings the handlers use. */
function normalize(declared) {
  const raw = declared ?? {}
  const text = (key, fallback) => {
    const value = plain(raw[key])
    return typeof value === 'string' && value !== '' ? value : fallback
  }
  const timeout = plain(raw.timeoutMs)
  const level = plain(raw.level)
  return {
    apiKeyRef: text('apiKeyRef', DEFAULTS.apiKeyRef),
    endpoint: text('endpoint', DEFAULTS.endpoint),
    model: text('model', DEFAULTS.model),
    timeoutMs: typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULTS.timeoutMs,
    level: typeof level === 'string' ? level : DEFAULTS.level,
    verbose: plain(raw.verbose) === true,
  }
}

/**
 * The user-authored text of one admitted batch, or `undefined` when the batch
 * carries none — which is how a tool-result step is told apart from a prompt, so
 * no prompt is parked for it and no call is spent on it.
 */
function promptTextOf(messages) {
  const text = textOf((messages ?? [])
    .filter((message) => message?.role === 'user')
    .flatMap((message) => message.content ?? []))
  if (text === undefined) return undefined
  return text.length > MAX_STATE_CHARS ? text.slice(0, MAX_STATE_CHARS) : text
}

/** The text blocks of one content list, joined, or `undefined` when empty. */
function textOf(content) {
  const parts = []
  for (const block of content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  const text = parts.join('\n').trim()
  return text === '' ? undefined : text
}

/** The last `limit` characters of one string. */
function tail(text, limit) {
  return text.length > limit ? text.slice(text.length - limit) : text
}

/** A short human-readable reason for a caught value. */
function reason(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
