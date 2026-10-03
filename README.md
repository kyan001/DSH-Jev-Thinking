# dsh-jev-thinking

Ask TypeSafe's **Jev** how deep a prompt needs to think. Apply that level to the model request.

**English** · [中文](README.zh.md)

## What it does

For every message you send, the plugin asks Jev one Choice question: *how much internal reasoning does the work in this message require?* It writes the answer into the request's `reasoningEffort`.

Three properties matter.

**The levels come from your model.** The plugin reads the levels the current route offers, such as `off`, `low` and `high`. It sends exactly those levels as the options. Jev cannot choose an unsupported level, and the plugin never adjusts a level afterwards.

**One question per prompt.** A turn with ten tool calls still costs one question. Each subagent is its own prompt.

**Short replies are judged correctly.** The plugin also sends the assistant turn that the reply answers. A reply such as "好" carries no task alone. Without the previous turn, approving a four-step refactor looks like "nothing to reason about".

## Install

In a terminal, install into your profile. Replace `web` with your profile name.

```Shell
dsh plugin --profile web add dsh-jev-thinking
```

Alternatively, from inside DSH, ask the agent to install it:

```Text
plugin_manager { action: install_bundle, target: "dsh-jev-thinking" }
```

## Set the API key

**From DSH.** Open the Plugins page, select `dsh-jev-thinking`, and use the row's **Configure** control. The page stores the key in the Harness credential store, under the name shown in `apiKeyRef` (`TYPESAFE_API_KEY` by default).

**By hand.** Add the key to `~/.dsh/.credentials.yaml` under `refs:`, or set `TYPESAFE_API_KEY` for the DSH process.

The plugin re-reads the store for each request, so a rotated key needs no restart.

## Settings

| Field | Default | Meaning |
|---|---|---|
| `apiKeyRef` | `TYPESAFE_API_KEY` | Name in the credential store. |
| `endpoint` | `https://api.typesafe.ai/v1/systemone` | System One endpoint. |
| `model` | `jev-latest` | Model that answers the question. |
| `timeoutMs` | `2500` | The plugin falls back after this delay. |
| `level` | empty | Level for a failed judgement. The route must offer it, or the plugin ignores it. |
| `verbose` | `false` | Log one line for each decision. |

A judgement fails on a timeout, an HTTP error, a missing key, or an answer outside the offered set. The plugin then falls back in this order: the configured `level`, then the route's own default effort, then no change to the request.

## Known limits

- **The plugin uses only the last turn.** A reference to an older message, such as "do that, as you said", can still be judged wrongly.
- **The previous assistant turn goes to TypeSafe.** This costs about 750 input tokens per prompt in the common case, and up to about 9600.
- **A route that offers `xhigh` or `max` adds them to the options.** Jev can choose them, so expect the highest price on such routes.
- **The plugin does not degrade when credits run out.** Each prompt pays one fast failed request before the fallback.
- **No setting narrows or excludes levels.** Change the code if you need this.

## Development

Maintainers only. After changing code, publish with:

```Shell
npm version patch   # or minor / major
npm publish
```

Requires an npm account with publish rights for this package.

## License

MIT. See [LICENSE](./LICENSE).
