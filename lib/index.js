// src/index.ts
import { assertUsableApiKey } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

// src/adapter.ts
import { attributionHeaders, LlmAdapter, LlmError as LlmError2 } from "@deepseek-ai/dsh-llm";

// src/catalog.generated.ts
var NEURALWATT_MODELS = [
  {
    "id": "deepseek-v4.1-flash",
    "name": "DeepSeek V4.1 Flash",
    "contextWindow": 1048560,
    "maxTokens": 393216,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "requiresReasoningContentOnAssistantMessages": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.015,
      "cacheWrite": 0
    }
  },
  {
    "id": "deepseek-v4.1-flash-flex",
    "name": "DeepSeek V4.1 Flash (flex)",
    "contextWindow": 1048560,
    "maxTokens": 393216,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "xhigh",
        "wire": "xhigh"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.0975,
      "output": 0.39,
      "cacheRead": 975e-5,
      "cacheWrite": 0
    }
  },
  {
    "id": "deepseek-v4.1-flash-speed",
    "name": "DeepSeek V4.1 Flash (Speed)",
    "contextWindow": 1048560,
    "maxTokens": 393216,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "xhigh",
        "wire": "xhigh"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.015,
      "cacheWrite": 0
    }
  },
  {
    "id": "gemma-4-31b",
    "name": "Gemma 4 31B",
    "contextWindow": 262128,
    "maxTokens": 16384,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "high",
        "wire": "high"
      }
    ],
    "compat": {
      "supportsReasoningEffort": false,
      "supportsDeveloperRole": false,
      "thinkingFormat": "chat-template"
    },
    "cost": {
      "input": 0.144,
      "output": 0.42,
      "cacheRead": 0.0144,
      "cacheWrite": 0
    }
  },
  {
    "id": "glm-5.3",
    "name": "GLM 5.3",
    "contextWindow": 1048560,
    "maxTokens": 1048560,
    "input": [
      "text"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 1.45,
      "output": 4.5,
      "cacheRead": 0.145,
      "cacheWrite": 0
    }
  },
  {
    "id": "glm-5.3-flex",
    "name": "GLM 5.3 (flex)",
    "contextWindow": 1048560,
    "maxTokens": 1048560,
    "input": [
      "text"
    ],
    "efforts": [
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.9425,
      "output": 2.925,
      "cacheRead": 0.09425,
      "cacheWrite": 0
    }
  },
  {
    "id": "glm-5-long",
    "name": "GLM-5 Long (MCR 1M)",
    "contextWindow": 1048576,
    "maxTokens": 16384,
    "input": [
      "text"
    ],
    "efforts": [
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "high",
        "wire": "high"
      }
    ],
    "compat": {
      "requiresReasoningContentOnAssistantMessages": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 1.1,
      "output": 3.6,
      "cacheRead": 0,
      "cacheWrite": 0
    }
  },
  {
    "id": "glm-5.1-fast-long",
    "name": "GLM-5.1 Fast Long (MCR 1M)",
    "contextWindow": 1048576,
    "maxTokens": 16384,
    "input": [
      "text"
    ],
    "compat": {
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 1.1,
      "output": 3.6,
      "cacheRead": 0,
      "cacheWrite": 0
    }
  },
  {
    "id": "glm-5.3-flash",
    "name": "GLM-5.3 Flash",
    "contextWindow": 1048560,
    "maxTokens": 1048560,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.15,
      "output": 0.5,
      "cacheRead": 0.03,
      "cacheWrite": 0
    }
  },
  {
    "id": "glm-5.3-flash-flex",
    "name": "GLM-5.3 Flash (flex)",
    "contextWindow": 1048560,
    "maxTokens": 1048560,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.0975,
      "output": 0.325,
      "cacheRead": 0.0195,
      "cacheWrite": 0
    }
  },
  {
    "id": "kimi-k2.5-long",
    "name": "Kimi K2.5 Long (MCR 1M)",
    "contextWindow": 1048576,
    "maxTokens": 16384,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "high",
        "wire": "high"
      }
    ],
    "compat": {
      "requiresReasoningContentOnAssistantMessages": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.52,
      "output": 2.59,
      "cacheRead": 0,
      "cacheWrite": 0
    }
  },
  {
    "id": "kimi-k3.1-pro",
    "name": "Kimi K3.1 Pro",
    "contextWindow": 1048560,
    "maxTokens": 1048560,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 2,
      "output": 10,
      "cacheRead": 0.2,
      "cacheWrite": 0
    }
  },
  {
    "id": "kimi-k3.1-pro-flex",
    "name": "Kimi K3.1 Pro (flex)",
    "contextWindow": 1048560,
    "maxTokens": 1048560,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 1.3,
      "output": 6.5,
      "cacheRead": 0.13,
      "cacheWrite": 0
    }
  },
  {
    "id": "mimo-v2.6-pro",
    "name": "MiMo-V2.6-Pro",
    "contextWindow": 1048560,
    "maxTokens": 393216,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "high",
        "wire": "high"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.435,
      "output": 0.87,
      "cacheRead": 36e-4,
      "cacheWrite": 0
    }
  },
  {
    "id": "mimo-v2.6-pro-flex",
    "name": "MiMo-V2.6-Pro (flex)",
    "contextWindow": 1048560,
    "maxTokens": 393216,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "high",
        "wire": "high"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.28275,
      "output": 0.5655,
      "cacheRead": 234e-5,
      "cacheWrite": 0
    }
  },
  {
    "id": "nw-flash",
    "name": "Neuralwatt Flash",
    "contextWindow": 1048560,
    "maxTokens": 393216,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "xhigh",
        "wire": "xhigh"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.15,
      "output": 0.6,
      "cacheRead": 0.015,
      "cacheWrite": 0
    }
  },
  {
    "id": "nw-flash-flex",
    "name": "Neuralwatt Flash (flex)",
    "contextWindow": 1048560,
    "maxTokens": 393216,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "xhigh",
        "wire": "xhigh"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.0975,
      "output": 0.39,
      "cacheRead": 975e-5,
      "cacheWrite": 0
    }
  },
  {
    "id": "nw-large",
    "name": "Neuralwatt Large",
    "contextWindow": 1048560,
    "maxTokens": 1048560,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 2,
      "output": 10,
      "cacheRead": 0.2,
      "cacheWrite": 0
    }
  },
  {
    "id": "nw-large-flex",
    "name": "Neuralwatt Large (flex)",
    "contextWindow": 1048560,
    "maxTokens": 1048560,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "high",
        "wire": "high"
      },
      {
        "id": "max",
        "wire": "max"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 1.3,
      "output": 6.5,
      "cacheRead": 0.13,
      "cacheWrite": 0
    }
  },
  {
    "id": "nw-small",
    "name": "Neuralwatt Small",
    "contextWindow": 262128,
    "maxTokens": 131072,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "xhigh",
        "wire": "xhigh"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.45,
      "output": 3.2,
      "cacheRead": 0.25,
      "cacheWrite": 0
    }
  },
  {
    "id": "nw-small-flex",
    "name": "Neuralwatt Small (flex)",
    "contextWindow": 262128,
    "maxTokens": 131072,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "xhigh",
        "wire": "xhigh"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.2925,
      "output": 2.08,
      "cacheRead": 0.1625,
      "cacheWrite": 0
    }
  },
  {
    "id": "qwen-3.8-27b",
    "name": "Qwen 3.8 27B",
    "contextWindow": 262128,
    "maxTokens": 131072,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "xhigh",
        "wire": "xhigh"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.45,
      "output": 3.2,
      "cacheRead": 0.25,
      "cacheWrite": 0
    }
  },
  {
    "id": "qwen-3.8-27b-flex",
    "name": "Qwen 3.8 27B (flex)",
    "contextWindow": 262128,
    "maxTokens": 131072,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "low",
        "wire": "low"
      },
      {
        "id": "medium",
        "wire": "medium"
      },
      {
        "id": "xhigh",
        "wire": "xhigh"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.2925,
      "output": 2.08,
      "cacheRead": 0.1625,
      "cacheWrite": 0
    }
  },
  {
    "id": "qwen3.6-35b",
    "name": "Qwen3.6 35B",
    "contextWindow": 262128,
    "maxTokens": 65536,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "high",
        "wire": "high"
      }
    ],
    "compat": {
      "supportsReasoningEffort": false,
      "requiresReasoningContentOnAssistantMessages": true,
      "supportsDeveloperRole": false,
      "thinkingFormat": "chat-template"
    },
    "cost": {
      "input": 0.29,
      "output": 1.15,
      "cacheRead": 0.029,
      "cacheWrite": 0
    }
  },
  {
    "id": "qwen3.6-35b-flex",
    "name": "Qwen3.6 35B (flex)",
    "contextWindow": 262128,
    "maxTokens": 131072,
    "input": [
      "text",
      "image"
    ],
    "efforts": [
      {
        "id": "off",
        "wire": "none"
      },
      {
        "id": "high",
        "wire": "high"
      }
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.1885,
      "output": 0.7475,
      "cacheRead": 0.01885,
      "cacheWrite": 0
    }
  },
  {
    "id": "qwen3.6-35b-fast",
    "name": "Qwen3.6 35B Fast",
    "contextWindow": 262128,
    "maxTokens": 65536,
    "input": [
      "text",
      "image"
    ],
    "compat": {
      "supportsReasoningEffort": true,
      "supportsDeveloperRole": false
    },
    "cost": {
      "input": 0.29,
      "output": 1.15,
      "cacheRead": 0.029,
      "cacheWrite": 0
    }
  }
];

// src/catalog.ts
var EFFORT_NAMES = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max"
};
function effortId(id) {
  return id;
}
var Catalog = class {
  byId;
  /**
   * @param models - generated model list; later entries with a duplicate id replace earlier ones.
   */
  constructor(models = NEURALWATT_MODELS) {
    this.byId = new Map(models.map((model) => [model.id, model]));
  }
  /** Every model the route advertises, in display order. */
  list(provider) {
    return [...this.byId.values()].map((model) => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: model.input
    }));
  }
  /** Metadata for one exact model; an unknown id still routes with neutral defaults. */
  resolve(provider, model) {
    const entry = this.byId.get(model);
    if (entry === void 0) return { provider, id: model, name: model };
    return {
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.input,
      context: { contextWindow: entry.contextWindow },
      defaultMaxTokens: entry.maxTokens,
      ...entry.efforts === void 0 ? {} : {
        reasoning: {
          efforts: entry.efforts.map((effort) => ({
            id: effortId(effort.id),
            name: EFFORT_NAMES[effort.id] ?? effort.id
          }))
        }
      }
    };
  }
  /** The catalog entry, or `undefined` for a model id the catalog does not list. */
  get(model) {
    return this.byId.get(model);
  }
  /** Whether the model accepts images. */
  acceptsImages(model) {
    return this.byId.get(model)?.input.includes("image") === true;
  }
  /**
   * Wire spelling of one selected effort.
   * @returns the string to send, `null` to send nothing, or `undefined` when the level is unknown.
   */
  effortWire(model, effort) {
    if (effort === void 0) return null;
    const entry = this.byId.get(model);
    const level = entry?.efforts?.find((candidate) => candidate.id === effort);
    if (level === void 0) return void 0;
    return level.wire ?? null;
  }
};

// src/energy.ts
function createTelemetry() {
  return { energyJoules: 0, costUsd: 0 };
}
var PREFIXES = [
  { prefix: "energy ", apply: (state, value) => {
    if (typeof value.energy_joules === "number") state.energyJoules += value.energy_joules;
    state.energyRaw = value;
  } },
  { prefix: "cost ", apply: (state, value) => {
    if (typeof value.request_cost_usd === "number") state.costUsd += value.request_cost_usd;
    state.costRaw = value;
  } },
  { prefix: "mcr-session ", apply: (state, value) => {
    state.mcrSession = value;
  } }
];
function captureComment(comment, state) {
  for (const entry of PREFIXES) {
    if (!comment.startsWith(entry.prefix)) continue;
    try {
      const value = JSON.parse(comment.slice(entry.prefix.length));
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        entry.apply(state, value);
        return true;
      }
    } catch (_malformedTelemetry) {
    }
    return false;
  }
  return false;
}
function captureQueue(payload, state, tracker) {
  if (tracker.sawContent) return;
  const created = /"created"\s*:\s*(\d+)/.exec(payload);
  const createdAt = created === null ? void 0 : Number(created[1]);
  if (/"delta"\s*:\s*\{\s*\}/.test(payload)) {
    if (tracker.firstHeartbeatCreated === void 0 && createdAt !== void 0) tracker.firstHeartbeatCreated = createdAt;
    return;
  }
  if (!/"delta"\s*:\s*\{[^}]/.test(payload)) return;
  tracker.sawContent = true;
  if (tracker.firstHeartbeatCreated !== void 0 && createdAt !== void 0) {
    state.queueSeconds = Math.max(0, createdAt - tracker.firstHeartbeatCreated);
  }
}
function formatEnergy(joules) {
  if (!Number.isFinite(joules) || joules <= 0) return "0 J";
  if (joules < 1e3) return `${joules.toFixed(1)} J`;
  const kwh = joules / 36e5;
  if (kwh >= 1) return `${kwh.toFixed(3)} kWh`;
  const wh = joules / 3600;
  if (wh >= 1) return `${wh.toFixed(3)} Wh`;
  return `${(joules / 1e3).toFixed(3)} mWh`;
}

// src/wire.ts
import { LlmError } from "@deepseek-ai/dsh-llm";
function textOf(content, images) {
  return content.flatMap((block) => {
    switch (block.type) {
      case "text":
        return [block.text];
      case "image": {
        const image = images.get(block.attachment.attachmentId);
        return block.offloaded === true || image === void 0 ? [`[image omitted from the request: ${block.attachment.name ?? block.attachment.mediaType}]`] : [];
      }
      case "file":
        return [`[file ${block.attachment.name}, ${block.attachment.bytes} bytes \u2014 read it with the file tools]`];
      default:
        return [];
    }
  }).filter((text) => text.length > 0).join("\n");
}
function userContent(content, images) {
  const parts = [];
  for (const block of content) {
    if (block.type === "text") {
      if (block.text.length > 0) parts.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "image") {
      const image = images.get(block.attachment.attachmentId);
      if (block.offloaded === true || image === void 0) {
        parts.push({ type: "text", text: `[image omitted from the request: ${block.attachment.name ?? block.attachment.mediaType}]` });
        continue;
      }
      parts.push({ type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.base64}` } });
      continue;
    }
    if (block.type === "file") {
      parts.push({ type: "text", text: `[file ${block.attachment.name}, ${block.attachment.bytes} bytes \u2014 read it with the file tools]` });
    }
  }
  return parts.every((part) => part.type === "text") ? parts.map((part) => part.text ?? "").join("\n") : parts;
}
function assistantMessage(message, images, compat) {
  const content = message.content;
  const text = content.filter((block) => block.type === "text").map((block) => block.text).join("");
  const calls = content.filter((block) => block.type === "tool-call").map((block) => ({
    id: block.id,
    type: "function",
    function: { name: block.name, arguments: block.arguments.length > 0 ? block.arguments : "{}" }
  }));
  const reasoning = content.filter((block) => block.type === "reasoning").map((block) => block.text).join("");
  void images;
  return {
    role: "assistant",
    content: text.length > 0 ? text : null,
    ...calls.length === 0 ? {} : { tool_calls: calls },
    ...compat?.requiresReasoningContentOnAssistantMessages === true && reasoning.length > 0 ? { reasoning_content: reasoning } : {}
  };
}
function serialize(options, model, images) {
  const compat = model?.compat;
  const messages = [];
  for (const message of options.messages) {
    switch (message.role) {
      case "system":
        messages.push({ role: "system", content: textOf(message.content, images) });
        break;
      case "developer":
        messages.push({ role: "system", content: textOf(message.content, images) });
        break;
      case "user":
        messages.push({ role: "user", content: userContent(message.content, images) });
        break;
      case "assistant":
        messages.push(assistantMessage(message, images, compat));
        break;
      case "tool": {
        const text = textOf(message.content, images);
        messages.push({
          role: "tool",
          tool_call_id: String(message.toolCallId),
          content: message.isError === true && text.length === 0 ? "Tool failed." : text
        });
        break;
      }
    }
  }
  const body = {
    model: options.model,
    messages,
    stream: true
  };
  if (compat?.supportsUsageInStreaming !== false) body.stream_options = { include_usage: true };
  if (options.maxTokens !== void 0) body[compat?.maxTokensField ?? "max_tokens"] = options.maxTokens;
  if (options.temperature !== void 0) body.temperature = options.temperature;
  if (options.stop !== void 0 && options.stop.length > 0) body.stop = options.stop;
  if (options.tools !== void 0 && options.tools.length > 0) {
    body.tools = options.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters }
    }));
  }
  const effort = options.reasoningEffort;
  const wire = model === void 0 ? null : new Map(model.efforts?.map((level) => [level.id, level.wire])).get(effort ?? "");
  if (effort !== void 0 && compat?.supportsReasoningEffort !== false && typeof wire === "string") {
    body.reasoning_effort = wire;
  }
  if (compat?.thinkingFormat === "chat-template") {
    body.chat_template_kwargs = { enable_thinking: effort !== "off" };
  }
  return body;
}
async function* parseSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          if (data.length > 0) {
            const payload = data.join("\n");
            data = [];
            yield { data: payload };
          }
        } else if (line.startsWith(":")) {
          yield { comment: line.slice(1).trim() };
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    const tail = buffer.trim();
    if (tail.startsWith("data:")) data.push(tail.slice(5).replace(/^ /, ""));
    else if (tail.startsWith(":")) yield { comment: tail.slice(1).trim() };
    if (data.length > 0) yield { data: data.join("\n") };
  } finally {
    reader.releaseLock();
  }
}
var BlockBuilder = class {
  nextIndex = 0;
  text;
  reasoning;
  calls = /* @__PURE__ */ new Map();
  /** Start the visible-text block on first use, then stream its delta. */
  pushText(delta) {
    const chunks = [];
    if (this.text === void 0) {
      this.text = { index: this.nextIndex++, parts: [] };
      chunks.push({ type: "block-start", index: this.text.index, blockType: "text" });
    }
    this.text.parts.push(delta);
    chunks.push({ type: "text-delta", index: this.text.index, text: delta });
    return chunks;
  }
  /** Start the reasoning block on first use, then stream its delta. */
  pushReasoning(delta) {
    const chunks = [];
    if (this.reasoning === void 0) {
      this.reasoning = { index: this.nextIndex++, parts: [] };
      chunks.push({ type: "block-start", index: this.reasoning.index, blockType: "reasoning" });
    }
    this.reasoning.parts.push(delta);
    chunks.push({ type: "reasoning-delta", index: this.reasoning.index, text: delta });
    return chunks;
  }
  /** Append one OpenAI tool-call delta, opening its block on first sight. */
  pushToolCall(delta) {
    const key = delta.index ?? 0;
    const chunks = [];
    let call = this.calls.get(key);
    if (call === void 0) {
      call = { index: this.nextIndex++, id: delta.id ?? `call_${key}`, name: "", args: "" };
      this.calls.set(key, call);
      chunks.push({ type: "block-start", index: call.index, blockType: "tool-call" });
    } else if (delta.id !== void 0 && delta.id.length > 0) {
      call.id = delta.id;
    }
    const name2 = delta.function?.name;
    if (name2 !== void 0 && name2.length > 0) call.name += name2;
    const argumentsDelta = delta.function?.arguments ?? "";
    call.args += argumentsDelta;
    chunks.push({
      type: "tool-call-delta",
      index: call.index,
      id: call.id,
      ...name2 === void 0 || name2.length === 0 ? {} : { name: name2 },
      argumentsDelta
    });
    return chunks;
  }
  /** Whether the model produced at least one tool call. */
  hasToolCalls() {
    return this.calls.size > 0;
  }
  /** Close every open block in emission (index) order. */
  finish() {
    const chunks = [];
    const open = [];
    if (this.text !== void 0) open.push({ index: this.text.index, kind: "text", parts: this.text.parts });
    if (this.reasoning !== void 0) open.push({ index: this.reasoning.index, kind: "reasoning", parts: this.reasoning.parts });
    for (const call of this.calls.values()) open.push({ index: call.index, kind: "tool-call", call });
    open.sort((left, right) => left.index - right.index);
    for (const block of open) {
      if (block.kind === "text") {
        chunks.push({ type: "block-end", index: block.index, block: { type: "text", text: block.parts.join("") } });
      } else if (block.kind === "reasoning") {
        chunks.push({ type: "block-end", index: block.index, block: { type: "reasoning", text: block.parts.join("") } });
      } else {
        chunks.push({
          type: "block-end",
          index: block.index,
          block: {
            type: "tool-call",
            id: block.call.id,
            name: block.call.name.length > 0 ? block.call.name : "unknown_tool",
            arguments: block.call.args.length > 0 ? block.call.args : "{}"
          }
        });
      }
    }
    return chunks;
  }
};
function mapUsage(raw) {
  if (raw === null || typeof raw !== "object") return void 0;
  const usage = raw;
  const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : void 0;
  const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : void 0;
  if (prompt === void 0 && completion === void 0) return void 0;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  const cachedTokens = typeof cached === "number" && cached > 0 ? cached : void 0;
  return {
    inputTokens: Math.max(0, (prompt ?? 0) - (cachedTokens ?? 0)),
    outputTokens: completion ?? 0,
    totalTokens: prompt !== void 0 && completion !== void 0 ? prompt + completion : void 0,
    ...cachedTokens === void 0 ? {} : { cacheReadTokens: cachedTokens },
    ...typeof reasoning === "number" && reasoning > 0 ? { reasoningTokens: reasoning } : {}
  };
}
function mapFinish(reason, hasToolCalls) {
  if (reason === "length") return { type: "finish", reason: { kind: "max-tokens" } };
  if (hasToolCalls || reason === "tool_calls" || reason === "function_call") {
    return { type: "finish", reason: { kind: "tool-calls" } };
  }
  return { type: "finish", reason: { kind: "stop" } };
}
function providerError(payload, status) {
  const detail = payload !== null && typeof payload === "object" ? payload.error ?? payload : void 0;
  const message = detail !== null && typeof detail === "object" ? String(detail.message ?? JSON.stringify(detail)) : typeof detail === "string" ? detail : "Neuralwatt API request failed";
  return LlmError.fromFailure({
    message: `Neuralwatt: ${message}`,
    code: typeof detail?.code === "string" ? detail.code : "PROVIDER_HTTP_ERROR",
    ...status === void 0 ? {} : { status }
  });
}

// src/adapter.ts
function excerpt(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 400 ? `${compact.slice(0, 400)}\u2026` : compact;
}
var NeuralwattAdapter = class extends LlmAdapter {
  constructor(options) {
    super();
    this.options = options;
  }
  options;
  stats = {
    requests: 0,
    failed: 0,
    energyJoules: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0
  };
  providerInfo(provider) {
    return { id: provider, name: this.options.displayName };
  }
  listModels(provider) {
    return Promise.resolve(this.options.catalog.list(provider));
  }
  resolveModel(provider, model) {
    return Promise.resolve(this.options.catalog.resolve(provider, model));
  }
  /** Per-process totals for the status tool. */
  snapshot() {
    return { ...this.stats };
  }
  async *stream(options) {
    const model = this.options.catalog.get(options.model);
    this.stats.requests += 1;
    try {
      const key = await this.options.resolveApiKey(options.signal);
      const images = await this.prepareImages(options, model);
      const body = serialize(options, model, images);
      const response = await this.request(body, key, options.signal);
      yield* this.decode(response.body, options, model);
    } catch (error) {
      this.stats.failed += 1;
      throw error;
    }
  }
  /** Read request-ready bytes for every retained image occurrence. */
  async prepareImages(options, model) {
    const images = /* @__PURE__ */ new Map();
    const occurrences = options.messages.flatMap((message) => message.content.filter((block) => block.type === "image" && block.offloaded !== true));
    if (occurrences.length === 0) return images;
    if (model?.input.includes("image") !== true) {
      throw new LlmError2(`Neuralwatt model "${options.model}" does not declare image input`, "UNSUPPORTED_CONTENT");
    }
    const attachments = this.options.attachments();
    if (attachments === void 0) {
      throw new LlmError2("Neuralwatt image input requires the mounted attachment service", "UNSUPPORTED_CONTENT");
    }
    for (const block of occurrences) {
      if (block.type !== "image") continue;
      try {
        const version = await attachments.readImageRequest(
          block.attachment,
          { width: block.attachment.width, height: block.attachment.height, maxBytes: block.attachment.bytes },
          options.signal
        );
        images.set(block.attachment.attachmentId, {
          mediaType: version.mediaType,
          base64: Buffer.from(version.data).toString("base64")
        });
      } catch (error) {
        throw new LlmError2("Neuralwatt could not read a request image", "UNSUPPORTED_CONTENT", { cause: error });
      }
    }
    return images;
  }
  /** POST the serialized request and map transport and HTTP failures. */
  async request(body, key, signal) {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = signal === void 0 ? timeout : AbortSignal.any([signal, timeout]);
    const url = `${this.options.baseURL.replace(/\/+$/, "")}/chat/completions`;
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: combined,
        headers: {
          ...attributionHeaders(),
          "content-type": "application/json",
          "accept": "text/event-stream",
          "authorization": `Bearer ${key}`,
          ...this.options.hostedTools ? {} : { "x-nw-tools-opt-out": "true" }
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (signal?.aborted === true) throw new LlmError2("Neuralwatt request aborted", "ABORTED", { cause: error });
      if (timeout.aborted) throw new LlmError2(`Neuralwatt request exceeded ${this.options.timeoutMs} ms`, "TIMEOUT", { cause: error });
      throw new LlmError2("Neuralwatt transport failed", "TRANSPORT", { cause: error });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw providerError(text.length > 0 ? safeJson(text) ?? { message: excerpt(text) } : void 0, response.status);
    }
    if (response.body === null) throw new LlmError2("Neuralwatt returned no response body", "EMPTY_RESPONSE");
    return response;
  }
  /** Translate one SSE response into harness chunks, in protocol order. */
  async *decode(body, options, model) {
    const blocks = new BlockBuilder();
    const telemetry = createTelemetry();
    const queue = { sawContent: false };
    let usage;
    let finishReason;
    try {
      for await (const event of parseSse(body)) {
        if (event.comment !== void 0) {
          captureComment(event.comment, telemetry);
          continue;
        }
        const payload = event.data;
        if (payload === void 0) continue;
        if (payload === "[DONE]") break;
        captureQueue(payload, telemetry, queue);
        let frame;
        try {
          frame = JSON.parse(payload);
        } catch (_invalidJson) {
          throw new LlmError2("Neuralwatt SSE contains invalid JSON", "MALFORMED_RESPONSE");
        }
        if (frame.error !== void 0 && frame.error !== null) throw providerError(frame);
        if (frame.usage !== void 0) usage = mapUsage(frame.usage);
        const choice = Array.isArray(frame.choices) ? frame.choices[0] : void 0;
        if (choice === void 0) continue;
        const delta = choice.delta ?? {};
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === "string" && reasoning.length > 0) {
          for (const chunk of blocks.pushReasoning(reasoning)) yield chunk;
        }
        if (typeof delta.content === "string" && delta.content.length > 0) {
          for (const chunk of blocks.pushText(delta.content)) yield chunk;
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            for (const chunk of blocks.pushToolCall(call)) yield chunk;
          }
        }
        if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
      }
    } catch (error) {
      if (error instanceof LlmError2) throw error;
      if (options.signal?.aborted === true) throw new LlmError2("Neuralwatt request aborted", "ABORTED", { cause: error });
      throw new LlmError2("Neuralwatt stream failed", "TRANSPORT", { cause: error });
    }
    for (const chunk of blocks.finish()) yield chunk;
    if (usage !== void 0) {
      yield { type: "usage", usage };
      this.stats.inputTokens += usage.inputTokens;
      this.stats.outputTokens += usage.outputTokens;
    }
    yield mapFinish(finishReason, blocks.hasToolCalls());
    this.recordTelemetry(telemetry, options);
  }
  /** Fold one response's energy accounting into process totals and the log. */
  recordTelemetry(telemetry, options) {
    this.stats.energyJoules += telemetry.energyJoules;
    this.stats.costUsd += telemetry.costUsd;
    if (telemetry.queueSeconds !== void 0) this.stats.lastQueueSeconds = telemetry.queueSeconds;
    if (!this.options.logEnergy) return;
    if (telemetry.energyJoules === 0 && telemetry.costUsd === 0 && telemetry.queueSeconds === void 0) return;
    const parts = [
      `model=${options.model}`,
      `energy=${telemetry.energyJoules.toFixed(1)}J`,
      `cost=$${telemetry.costUsd.toFixed(6)}`,
      ...telemetry.queueSeconds === void 0 ? [] : [`queue=${telemetry.queueSeconds.toFixed(1)}s`]
    ];
    this.options.logger.debug(`neuralwatt: ${parts.join(" ")}`);
  }
};
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (_notJson) {
    return void 0;
  }
}

// src/index.ts
var ROUTE = "neuralwatt";
var Config = z.object({
  baseURL: z.string().default("https://api.neuralwatt.com/v1").description("API root of the OpenAI-compatible endpoint."),
  apiKeyEnv: z.string().default("NEURALWATT_API_KEY").description("Credential reference resolved per request; also the environment variable fallback."),
  apiKey: z.string().description("Literal API key fallback. Prefer apiKeyEnv, or put NEURALWATT_API_KEY in $DSH_HOME/.env."),
  displayName: z.string().default("Neuralwatt").description("Label shown by model selectors."),
  hostedTools: z.boolean().default(true).description("Leave Neuralwatt hosted tools available; false sends X-NW-Tools-Opt-Out."),
  logEnergy: z.boolean().default(false).description("Log per-request energy, billed cost, and flex queue telemetry at debug level."),
  timeoutMs: z.number().default(9e5).description("Overall request deadline in milliseconds.")
});
var name = "llm-neuralwatt";
var inject = ["llm"];
async function resolveApiKey(ctx, config) {
  const ref = credentialRef(config.apiKeyEnv);
  const credentials = ctx.get("credentials");
  const stored = credentials === void 0 ? void 0 : await credentials.resolve(ref);
  const candidate = stored?.value ?? launchEnvironmentOf(ctx).get(config.apiKeyEnv)?.value ?? (typeof process.env[config.apiKeyEnv] === "string" ? process.env[config.apiKeyEnv] : void 0) ?? config.apiKey;
  if (candidate === void 0 || candidate.length === 0) {
    throw new Error(
      `llm-neuralwatt: no credential for the ${ROUTE} route. Put ${config.apiKeyEnv}=\u2026 in $DSH_HOME/.env, export ${config.apiKeyEnv}, or store it through the credentials service.`
    );
  }
  return assertUsableApiKey(candidate, "llm-neuralwatt", config.apiKeyEnv);
}
async function fetchQuota(config, key) {
  try {
    const response = await fetch(`${config.baseURL.replace(/\/+$/, "")}/quota`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8e3)
    });
    if (!response.ok) return void 0;
    return await response.json();
  } catch (_quotaUnavailable) {
    return void 0;
  }
}
function quotaReport(quota) {
  if (quota === void 0) return ["Account quota: unavailable (check the API key or network)."];
  const lines = [];
  if (quota.subscription !== null && quota.subscription !== void 0) {
    const plan = quota.subscription.plan ?? "unknown plan";
    const status = quota.subscription.status ?? "unknown status";
    lines.push(`Subscription: ${plan} (${status})`);
    if (typeof quota.subscription.kwh_included === "number") {
      lines.push(`Plan energy: ${quota.subscription.kwh_used ?? 0} / ${quota.subscription.kwh_included} kWh used (${quota.subscription.kwh_remaining ?? 0} kWh remaining)`);
    }
  }
  if (typeof quota.balance?.credits_remaining_usd === "number") {
    lines.push(`Credits remaining: $${quota.balance.credits_remaining_usd.toFixed(2)}`);
  }
  if (quota.usage?.current_month !== void 0) {
    const month = quota.usage.current_month;
    lines.push(`This month: $${(month.cost_usd ?? 0).toFixed(2)}, ${month.requests ?? 0} requests, ${(month.tokens ?? 0).toLocaleString("en-US")} tokens, ${(month.energy_kwh ?? 0).toFixed(3)} kWh`);
  }
  if (quota.usage?.lifetime !== void 0) {
    const lifetime = quota.usage.lifetime;
    lines.push(`Lifetime: $${(lifetime.cost_usd ?? 0).toFixed(2)}, ${lifetime.requests ?? 0} requests, ${(lifetime.energy_kwh ?? 0).toFixed(3)} kWh`);
  }
  return lines;
}
function apply(ctx, config) {
  const catalog = new Catalog();
  const adapter = new NeuralwattAdapter({
    displayName: config.displayName,
    baseURL: config.baseURL,
    catalog,
    timeoutMs: config.timeoutMs,
    hostedTools: config.hostedTools,
    logEnergy: config.logEnergy,
    resolveApiKey: (signal) => resolveApiKey(ctx, config),
    attachments: () => ctx.get("attachments"),
    logger: {
      debug: (message) => ctx.logger.debug(message),
      warn: (message) => ctx.logger.warn(message)
    }
  });
  ctx.llm.registerAdapter([ROUTE], adapter);
  ctx.logger.warn(`llm-neuralwatt: mounted ${catalog.list(ROUTE).length} models at ${config.baseURL}`);
  ctx.inject(["tools"], (child) => {
    child.tools.register(defineTool({
      name: "neuralwatt_status",
      description: "Report Neuralwatt account quota (plan, credits, energy) and this process's token, energy, and billed-cost totals. Use it when the user asks about spend, energy use, or remaining credits for the Neuralwatt route.",
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { report: { type: "string", required: true } }
        },
        render: (_args, value) => [{ type: "text", text: value.report }]
      },
      async execute() {
        const stats = adapter.snapshot();
        const lines = [
          `Neuralwatt route (${config.baseURL})`,
          `Requests this process: ${stats.requests} (${stats.failed} failed)`,
          `Tokens this process: ${stats.inputTokens.toLocaleString("en-US")} in, ${stats.outputTokens.toLocaleString("en-US")} out`,
          `Energy this process: ${formatEnergy(stats.energyJoules)}; billed $${stats.costUsd.toFixed(6)}`,
          ...stats.lastQueueSeconds === void 0 ? [] : [`Last flex queue wait: ${stats.lastQueueSeconds.toFixed(1)} s`],
          ""
        ];
        let quota;
        try {
          quota = await fetchQuota(config, await resolveApiKey(ctx, config));
        } catch (_missingKey) {
          lines.push("Account quota: unavailable (no API key resolved).");
        }
        lines.push(...quotaReport(quota));
        return { report: lines.join("\n") };
      }
    }));
  });
}
var __internals = {
  Catalog,
  NeuralwattAdapter,
  serialize,
  parseSse,
  BlockBuilder,
  mapUsage,
  mapFinish,
  providerError,
  captureComment,
  captureQueue,
  createTelemetry,
  formatEnergy
};
export {
  Config,
  ROUTE,
  __internals,
  apply,
  inject,
  name
};
