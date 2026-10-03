# dsh-jev-thinking

让 TypeSafe 的 **Jev** 判断每个 prompt 需要多深的思考，并把该档位用于这次模型请求。

[English](README.md) · **中文**

## 它做什么

你每发一条消息，插件就问 Jev 一个 Choice 问题：*这条消息里的工作需要多深的内部推理？* 然后插件把答案写进这次请求的 `reasoningEffort`。

有三点要说明。

**档位来自你的模型。** 插件先读取当前路由支持的档位（如 `off`、`low`、`high`），再把这些档位作为选项发出。Jev 无法选到不支持的档位，插件也从不事后修正档位。

**每个 prompt 只问一次。** 一轮里十次工具调用仍只花一次提问。每个子 agent 算一个 prompt。

**短回复也能判对。** 插件会把它所回答的那轮助手消息一起发出。"好"这类回复本身不携带任务。少了上一轮，"批准四步重构"看起来就是"无需推理"。

## 安装

在终端里装进你的 profile。把 `web` 换成你的 profile 名。

```Shell
dsh plugin --profile web add dsh-jev-thinking
```

也可以在 DSH 里让 agent 代你装：

```Text
plugin_manager { action: install_bundle, target: "dsh-jev-thinking" }
```

## 设置 API Key

**在 DSH 里。** 打开插件页，选中 `dsh-jev-thinking`，用它那一行的**配置**控件。页面会把 key 存进 Harness 凭据库，用的名字就是 `apiKeyRef` 显示的那个（默认 `TYPESAFE_API_KEY`）。

**手动。** 把 key 加到 `~/.dsh/.credentials.yaml` 的 `refs:` 下，或给 DSH 进程设置 `TYPESAFE_API_KEY`。

插件每次请求都重新读取凭据库，所以轮换 key 不需要重启。

## 设置项

| 字段 | 默认 | 含义 |
|---|---|---|
| `apiKeyRef` | `TYPESAFE_API_KEY` | 凭据库里的名字。 |
| `endpoint` | `https://api.typesafe.ai/v1/systemone` | System One 端点。 |
| `model` | `jev-latest` | 回答该问题的模型。 |
| `timeoutMs` | `2500` | 超过这个延迟就回退。 |
| `level` | 空 | 判断失败时用的档位。路由必须支持它，否则插件忽略。 |
| `verbose` | `false` | 每次决策记一行日志。 |

判断会在这些情况失败：超时、HTTP 错误、没有 key、答案不在候选集里。此时插件按顺序回退：先用手配置的 `level`，再用路由自己的默认档，最后不动这次请求。

## 已知边界

- **插件只用最近一轮。** 指代更早消息的说法（如"那按它说的做"）仍可能判偏。
- **上一轮助手消息会发给 TypeSafe。** 常见情况每次约 750 input tokens，最多约 9600。
- **路由若提供 `xhigh` 或 `max`，它们也进选项。** Jev 可能选中，这类路由上要预期最高价格。
- **额度用完时插件不降级。** 每个 prompt 会先付一次快速失败的请求，然后才回退。
- **没有配置项可以收窄或排除档位。** 需要就改代码。

## 开发

仅维护者。改动代码后发布：

```Shell
npm version patch   # 或 minor / major
npm publish
```

需要有本包发布权限的 npm 账号。

## 许可

MIT。见 [LICENSE](./LICENSE)。
